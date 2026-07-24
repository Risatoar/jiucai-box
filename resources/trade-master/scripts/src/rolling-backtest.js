import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { clusteredObjectiveMetric, metric, multiHorizonSummary, objectiveMetric, objectivePerformanceSummary, objectiveScenarioSummary, performanceSummary, SCENARIOS, scenarioSummary, sellTimingSummary, splitOutOfSample, strategyCalibration } from './backtest-metrics.js';
import { createBacktestDiagnostics, pushUniqueRecord, recordBacktestDiagnostics } from './backtest-diagnostics.js';
import { evaluateSignal, executableDaySignal } from './backtest-evaluation.js';
import { generateStrategySignals } from './strategy-engine.js';
import { decisionPolicyForInstrument, loadActiveDecisionPolicy, ROLLING_CANDIDATE_POLICY } from './strategy-policy.js';
import { applyDecisionTransition } from './position-transition.js';
import { rollingBacktestMarkdown } from './rolling-backtest-report.js';
import { buildScenarioCaseLibrary, collectDailyScenarioCases } from './scenario-case-library.js';
import { evaluateScenarioQualityGuard } from './scenario-quality-gate.js';
import { collectDailyCycleCases, collectIntradayTCycleCases, createScenarioCycleTracker, registerScenarioSellCases } from './scenario-cycle-tracker.js';
import { updateShadowValidation } from './shadow-validation.js';
import { inferInstrument } from './providers.js';
import { readJson, tradeMasterHome, writeJson, writeMarkdown } from './storage.js';
export { applyDecisionTransition } from './position-transition.js';
const day = (value) => String(value).slice(0, 10);
const safeRead = (path, fallback) => {
    try {
        return existsSync(path) ? readJson(path) : fallback;
    }
    catch { return fallback; }
};
const subtractDays = (value, days) => {
    const date = new Date(value);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
};
function sourceInstruments() {
    const root = tradeMasterHome();
    const watchlist = safeRead(join(root, 'watchlist.json'), { instruments: [] });
    const portfolio = safeRead(join(root, 'portfolio.json'), { positions: [] });
    const pool = safeRead(join(root, 'runtime', 'candidate-pool.json'), { candidates: [] });
    return [...(portfolio.positions ?? []).map((item) => ({ ...item.instrument, priority: 0, source: 'position' })),
        ...(watchlist.instruments ?? []).map((item) => ({ ...item, priority: String(item.source ?? '').includes('user') ? 1 : 2, source: item.source ?? 'watchlist' })),
        ...(pool.candidates ?? []).map((item) => ({ ...(item.instrument ?? item), priority: 3, source: 'candidate' }))].filter((item) => /^\d{6}$/.test(String(item.code ?? '')));
}
export function selectBacktestUniverse(limit = 25, explicitCodes = []) {
    const requested = Math.max(20, Math.min(240, Number(limit) || 25));
    const explicit = [...new Map(explicitCodes.map((code) => {
        const inferred = inferInstrument(String(code));
        return [inferred.code, { ...inferred, source: 'explicit' }];
    })).values()];
    if (explicit.length >= requested)
        return explicit.slice(0, requested);
    const unique = new Map();
    for (const item of [...explicit, ...sourceInstruments()].sort((left, right) => (left.priority ?? -1) - (right.priority ?? -1))) {
        const inferred = inferInstrument(String(item.code), String(item.name ?? ''));
        if (!['stock', 'etf', 'cbond'].includes(String(item.type ?? inferred.type)))
            continue;
        if (!unique.has(inferred.code)) {
            unique.set(inferred.code, {
                ...inferred,
                name: String(item.name ?? inferred.name),
                type: item.type ?? inferred.type,
                source: item.source ?? 'explicit',
            });
        }
    }
    const buckets = {
        stock: [...unique.values()].filter((item) => item.type === 'stock'),
        etf: [...unique.values()].filter((item) => item.type === 'etf'),
        cbond: [...unique.values()].filter((item) => item.type === 'cbond'),
    };
    const selected = [];
    while (selected.length < requested && Object.values(buckets).some((items) => items.length)) {
        for (const type of ['stock', 'etf', 'cbond']) {
            const item = buckets[type].shift();
            if (item)
                selected.push(item);
            if (selected.length >= requested)
                break;
        }
    }
    return selected;
}
export function canSampleCounterfactualEntry(lastIndex, currentIndex, minimumTradingDays = 5) {
    return lastIndex == null || currentIndex - lastIndex >= minimumTradingDays;
}
function counterfactualFlatEntry(instrument, bars, dailyContext, dailyBars, date, policy, lastIndexes, tradingIndex) {
    const engine = generateStrategySignals(instrument.type, bars, dailyContext, { hasPosition: false, positionQuantity: 0, soldQuantity: 0, decisionPolicy: policy });
    if (!['up', 'down'].includes(engine.daily_trend))
        return null;
    if (!canSampleCounterfactualEntry(lastIndexes[engine.daily_trend], tradingIndex, policy.counterfactual_entry_cooldown_trading_days))
        return null;
    const signal = executableDaySignal(engine);
    const transition = signal?.side === 'buy' ? applyDecisionTransition(engine.position_guidance, signal, { held: 0, sold: 1 }) : null;
    return signal && transition ? {
        trend: engine.daily_trend,
        record: { ...evaluateSignal(signal, instrument, engine.daily_trend, date, dailyBars, engine.position_guidance, transition, engine.downside_risk), simulation_track: `flat_${engine.daily_trend}_entry` },
    } : null;
}
export async function runRollingBacktest(market, options = {}) {
    const asOf = options.asOf ?? new Date().toISOString();
    const windowDays = Math.max(20, Math.min(90, Number(options.days) || 30));
    const horizon = [1, 3, 7, 15].includes(Number(options.horizon)) ? Number(options.horizon) : 3;
    const minimumTradingDays = Math.max(5, Math.min(60, Number(options.minimumTradingDays) || 15));
    const evidenceTag = String(options.evidenceTag ?? '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
    const researchOnly = Boolean(options.researchOnly || evidenceTag || minimumTradingDays < 15);
    const instruments = selectBacktestUniverse(options.limit ?? 25, options.codes ?? []);
    const start = subtractDays(asOf, windowDays);
    const records = [];
    const baselineRecords = [];
    const scenarioCases = [];
    const rejectedScenarioCases = [];
    const policy = options.decisionPolicy ?? ROLLING_CANDIDATE_POLICY;
    const candidatePolicy = evidenceTag ? { ...policy, id: `${policy.id}-${evidenceTag}` } : policy;
    const baselinePolicy = options.baselinePolicy ?? loadActiveDecisionPolicy();
    const errors = [];
    const coverage = [];
    const coverageIssues = [];
    const completedCodes = [];
    let rawActionableSignals = 0;
    let executableDecisions = 0;
    let baselineRawActionableSignals = 0;
    let baselineExecutableDecisions = 0;
    const diagnostics = createBacktestDiagnostics();
    const evaluationDates = new Set();
    for (let offset = 0; offset < instruments.length; offset += 4) {
        await Promise.all(instruments.slice(offset, offset + 4).map(async (instrument) => {
            try {
                const instrumentPolicy = decisionPolicyForInstrument(candidatePolicy, instrument.type);
                const instrumentBaselinePolicy = decisionPolicyForInstrument(baselinePolicy, instrument.type);
                const [intraday, daily] = await Promise.all([
                    market.bars(instrument.code, '5m', 5000, {
                        start,
                        end: asOf,
                        asOf,
                        minimumTradingDays,
                    }),
                    market.bars(instrument.code, '1d', 140, { end: asOf, asOf }),
                ]);
                const byDate = new Map();
                for (const bar of intraday.bars.filter((item) => item.closed !== false)) {
                    const date = day(bar.time);
                    if (date < start || date > day(asOf))
                        continue;
                    byDate.set(date, [...(byDate.get(date) ?? []), bar]);
                }
                let usableTradingDays = 0;
                let positionState = { held: 1, sold: 0 };
                let baselinePositionState = { held: 1, sold: 0 };
                const lastOpportunityIndexes = { up: null, down: null };
                const baselineLastOpportunityIndexes = { up: null, down: null };
                const scenarioCycleTracker = createScenarioCycleTracker();
                for (const [date, bars] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
                    const dailyContext = daily.bars.filter((bar) => day(bar.time) < date && bar.closed !== false);
                    if (dailyContext.length < 20 || bars.length < 30)
                        continue;
                    usableTradingDays += 1;
                    evaluationDates.add(date);
                    const dailyScenarioCases = collectDailyScenarioCases({
                        instrument,
                        bars,
                        dailyContext,
                        dailyBars: daily.bars,
                        date,
                        policy: instrumentPolicy,
                        tradingIndex: usableTradingDays,
                    });
                    scenarioCases.push(...dailyScenarioCases.cases);
                    scenarioCases.push(...collectIntradayTCycleCases({ instrument, bars, dailyContext, dailyBars: daily.bars, date, policy: instrumentPolicy, tradingIndex: usableTradingDays }));
                    rejectedScenarioCases.push(...dailyScenarioCases.rejected);
                    scenarioCases.push(...collectDailyCycleCases({
                        instrument, bars, dailyContext, dailyBars: daily.bars, date,
                        policy: instrumentPolicy, tradingIndex: usableTradingDays,
                    }, scenarioCycleTracker));
                    registerScenarioSellCases(scenarioCycleTracker, dailyScenarioCases.cases);
                    const engine = generateStrategySignals(instrument.type, bars, dailyContext, {
                        hasPosition: positionState.held > 0,
                        positionQuantity: Math.round(positionState.held * 100),
                        soldQuantity: Math.round(positionState.sold * 100),
                        lastSellPrice: positionState.last_sell_price ?? null,
                        lastSellStrategy: positionState.last_sell_strategy ?? null,
                        lastSellDate: positionState.last_sell_date ?? null,
                        decisionPolicy: instrumentPolicy,
                    });
                    recordBacktestDiagnostics(diagnostics, engine, instrumentPolicy);
                    rawActionableSignals += engine.signals.filter((signal) => signal.kState === 'closed' && signal.level === 'actionable').length;
                    const signal = executableDaySignal(engine);
                    const transition = signal ? applyDecisionTransition(engine.position_guidance, signal, positionState) : null;
                    if (signal && transition) {
                        executableDecisions += 1;
                        pushUniqueRecord(records, evaluateSignal(signal, instrument, engine.daily_trend, date, daily.bars, engine.position_guidance, transition, engine.downside_risk));
                        positionState = transition.next_state;
                    }
                    const opportunity = counterfactualFlatEntry(instrument, bars, dailyContext, daily.bars, date, instrumentPolicy, lastOpportunityIndexes, usableTradingDays);
                    if (opportunity) {
                        executableDecisions += pushUniqueRecord(records, opportunity.record) ? 1 : 0;
                        lastOpportunityIndexes[opportunity.trend] = usableTradingDays;
                    }
                    const baselineEngine = generateStrategySignals(instrument.type, bars, dailyContext, {
                        hasPosition: baselinePositionState.held > 0,
                        positionQuantity: Math.round(baselinePositionState.held * 100),
                        soldQuantity: Math.round(baselinePositionState.sold * 100),
                        lastSellPrice: baselinePositionState.last_sell_price ?? null,
                        lastSellStrategy: baselinePositionState.last_sell_strategy ?? null,
                        lastSellDate: baselinePositionState.last_sell_date ?? null,
                        decisionPolicy: instrumentBaselinePolicy,
                    });
                    baselineRawActionableSignals += baselineEngine.signals.filter((item) => item.kState === 'closed' && item.level === 'actionable').length;
                    const baselineSignal = executableDaySignal(baselineEngine);
                    const baselineTransition = baselineSignal ? applyDecisionTransition(baselineEngine.position_guidance, baselineSignal, baselinePositionState) : null;
                    if (baselineSignal && baselineTransition) {
                        baselineExecutableDecisions += 1;
                        pushUniqueRecord(baselineRecords, evaluateSignal(baselineSignal, instrument, baselineEngine.daily_trend, date, daily.bars, baselineEngine.position_guidance, baselineTransition, baselineEngine.downside_risk));
                        baselinePositionState = baselineTransition.next_state;
                    }
                    const baselineOpportunity = counterfactualFlatEntry(instrument, bars, dailyContext, daily.bars, date, instrumentBaselinePolicy, baselineLastOpportunityIndexes, usableTradingDays);
                    if (baselineOpportunity) {
                        baselineExecutableDecisions += pushUniqueRecord(baselineRecords, baselineOpportunity.record) ? 1 : 0;
                        baselineLastOpportunityIndexes[baselineOpportunity.trend] = usableTradingDays;
                    }
                }
                const minuteTradingDays = byDate.size;
                const coverageComplete = minuteTradingDays >= minimumTradingDays
                    && usableTradingDays >= minimumTradingDays;
                const item = {
                    code: instrument.code,
                    intraday_period: '5m',
                    intraday_source: intraday.source,
                    intraday_deduplication: intraday.deduplication ?? null,
                    intraday_trading_days: minuteTradingDays,
                    usable_trading_days: usableTradingDays,
                    daily_context_bars: daily.bars.filter((bar) => bar.closed !== false).length,
                    complete: coverageComplete,
                };
                coverage.push(item);
                if (coverageComplete)
                    completedCodes.push(instrument.code);
                else
                    coverageIssues.push(`${instrument.code}: 5分钟线${minuteTradingDays}日，可用${usableTradingDays}日，低于${minimumTradingDays}日门槛`);
            }
            catch (error) {
                errors.push(`${instrument.code}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }));
    }
    const split = splitOutOfSample(records, [...evaluationDates]);
    const baselineSplit = splitOutOfSample(baselineRecords, [...evaluationDates]);
    const scenarios = scenarioSummary(records, horizon);
    const outOfSampleScenarios = scenarioSummary(split.out_of_sample, horizon);
    const objectiveScenarios = objectiveScenarioSummary(records);
    const objectiveOutOfSampleScenarios = objectiveScenarioSummary(split.out_of_sample);
    const overall = metric(records, horizon);
    const outOfSample = metric(split.out_of_sample, horizon);
    const objectiveOverall = objectiveMetric(records);
    const objectiveHistory = objectiveMetric(split.history);
    const objectiveOutOfSample = objectiveMetric(split.out_of_sample);
    const clusteredObjective = clusteredObjectiveMetric(records);
    const clusteredObjectiveHistory = clusteredObjectiveMetric(split.history);
    const clusteredObjectiveOutOfSample = clusteredObjectiveMetric(split.out_of_sample);
    const caseLibrary = buildScenarioCaseLibrary(scenarioCases, rejectedScenarioCases);
    const scenarioQualityGuard = evaluateScenarioQualityGuard(caseLibrary, candidatePolicy.quality_guard);
    const invalidOutcomes = records.flatMap((record) => record.outcomes.filter((outcome) => outcome.status === 'invalid')
        .map((outcome) => ({ code: record.code, date: record.date, strategy: record.strategy, ...outcome })));
    const baselineOutOfSample = metric(baselineSplit.out_of_sample, horizon);
    const candidatePerformance = performanceSummary(split.out_of_sample, horizon);
    const baselinePerformance = performanceSummary(baselineSplit.out_of_sample, horizon);
    const drawdownDelta = candidatePerformance.samples && baselinePerformance.samples
        ? Number((candidatePerformance.max_drawdown_ratio - baselinePerformance.max_drawdown_ratio).toFixed(6))
        : null;
    const requiredScenarioSamples = 10;
    const historicalCoveredScenarios = Object.values(objectiveOutOfSampleScenarios.scenarios).filter((item) => item.samples >= requiredScenarioSamples).length;
    const historicalWeakScenarios = Object.entries(objectiveOutOfSampleScenarios.scenarios)
        .filter(([, item]) => item.samples < requiredScenarioSamples || (item.accuracy_pct ?? 0) < 80)
        .map(([name]) => name);
    const shadow = updateShadowValidation({
        policy: candidatePolicy,
        asOf,
        records,
        baselineRecords,
        caseRecords: caseLibrary.independent_records,
        rejectedCaseRecords: caseLibrary.bottom_fishing_abstentions.cases,
        horizon,
        minimumSamplesPerScenario: requiredScenarioSamples,
        eligible: completedCodes.length >= 20
            && errors.length === 0
            && coverageIssues.length === 0
            && evaluationDates.has(day(asOf)),
    });
    const promotionOutOfSample = shadow.forward_metrics;
    const promotionPerformance = shadow.forward_performance;
    const coveredScenarios = shadow.covered_scenarios;
    const weakScenarios = shadow.weak_scenarios;
    const ready = !researchOnly
        && completedCodes.length >= 20
        && promotionOutOfSample.samples >= 10
        && (promotionOutOfSample.accuracy_pct ?? 0) >= 80
        && (promotionOutOfSample.confidence_lower_bound_pct ?? 0) >= 80
        && coveredScenarios === SCENARIOS.length
        && weakScenarios.length === 0
        && caseLibrary.coverage.ready
        && scenarioQualityGuard.ready
        && shadow.shadow_days >= 5
        && shadow.drawdown_delta != null
        && shadow.drawdown_delta <= 0.005
        && (
            (promotionPerformance.profit_factor ?? 0) >= 1.05
            || (promotionPerformance.samples >= 10 && promotionPerformance.losing_samples === 0)
        )
        && errors.length === 0
        && coverageIssues.length === 0;
    const report = {
        schema_version: 3,
        mode: 'rolling_multi_scenario_backtest',
        evidence_tag: evidenceTag || null,
        research_only: researchOnly,
        evaluation_contract: {
            direction_correct: 'directional_return_pct > 0',
            t_trade_min_price_discount_pct_by_asset: {
                stock: decisionPolicyForInstrument(candidatePolicy, 'stock').t_reentry_min_discount_pct,
                etf: decisionPolicyForInstrument(candidatePolicy, 'etf').t_reentry_min_discount_pct,
                cbond: decisionPolicyForInstrument(candidatePolicy, 'cbond').t_reentry_min_discount_pct,
            },
            high_low_min_price_discount_pct_by_asset: {
                stock: decisionPolicyForInstrument(candidatePolicy, 'stock').high_low_min_discount_pct,
                etf: decisionPolicyForInstrument(candidatePolicy, 'etf').high_low_min_discount_pct,
                cbond: decisionPolicyForInstrument(candidatePolicy, 'cbond').high_low_min_discount_pct,
            },
            counterfactual_entry_cooldown_trading_days: candidatePolicy.counterfactual_entry_cooldown_trading_days,
            cohort_selection_point_in_time: Boolean(options.cohortSelectionPointInTime),
            temporal_holdout_is_true_out_of_sample: Boolean(options.cohortSelectionPointInTime),
        },
        generated_at: new Date().toISOString(),
        as_of: asOf,
        window_days: windowDays,
        horizon,
        no_lookahead: true,
        decision_policy: candidatePolicy,
        universe: {
            requested: instruments.length,
            processed: coverage.length,
            completed: completedCodes.length,
            intraday_period: '5m',
            minimum_trading_days: minimumTradingDays,
            coverage_tier: minimumTradingDays >= 15 ? 'strict' : 'expanded_partial_history',
            instruments,
            coverage,
            coverage_issues: coverageIssues,
            failed: errors,
        },
        split: {
            cutoff_date: split.cutoff_date,
            evaluation_trading_dates: split.evaluation_trading_dates,
            history_signals: split.history.length,
            out_of_sample_signals: split.out_of_sample.length,
        },
        signal_audit: {
            raw_actionable_signals: rawActionableSignals,
            executable_decisions: executableDecisions,
            excluded_raw_signals: Math.max(0, rawActionableSignals - executableDecisions),
            diagnostics,
        },
        metrics: {
            overall,
            history: metric(split.history, horizon),
            out_of_sample: outOfSample,
            objective: objectiveOverall,
            objective_history: objectiveHistory,
            objective_out_of_sample: objectiveOutOfSample,
            clustered_objective: clusteredObjective,
            clustered_objective_history: clusteredObjectiveHistory,
            clustered_objective_out_of_sample: clusteredObjectiveOutOfSample,
            scenarios: scenarios.scenarios,
            out_of_sample_scenarios: outOfSampleScenarios.scenarios,
            objective_scenarios: objectiveScenarios.scenarios,
            objective_t_trade_pairs: objectiveScenarios.t_pairs,
            objective_risk_recovery_pairs: objectiveScenarios.risk_recovery_pairs,
            objective_position_cycle_ledger: objectiveScenarios.cycle_ledger,
            objective_out_of_sample_scenarios: objectiveOutOfSampleScenarios.scenarios,
            objective_out_of_sample_t_trade_pairs: objectiveOutOfSampleScenarios.t_pairs,
            sell_timing: sellTimingSummary(records),
            out_of_sample_sell_timing: sellTimingSummary(split.out_of_sample),
            by_horizon: {
                overall: multiHorizonSummary(records),
                history: multiHorizonSummary(split.history),
                out_of_sample: multiHorizonSummary(split.out_of_sample),
            },
            strategy_calibration: strategyCalibration(records, horizon),
            out_of_sample_strategy_calibration: strategyCalibration(split.out_of_sample, horizon),
        },
        active_baseline: {
            decision_policy: baselinePolicy,
            split: { history_signals: baselineSplit.history.length, out_of_sample_signals: baselineSplit.out_of_sample.length },
            signal_audit: {
                raw_actionable_signals: baselineRawActionableSignals,
                executable_decisions: baselineExecutableDecisions,
                excluded_raw_signals: Math.max(0, baselineRawActionableSignals - baselineExecutableDecisions),
            },
            out_of_sample: baselineOutOfSample,
            performance: baselinePerformance,
        },
        performance: {
            candidate: candidatePerformance,
            baseline: baselinePerformance,
            drawdown_delta: drawdownDelta,
            objective: {
                candidate: objectivePerformanceSummary(split.out_of_sample),
                baseline: objectivePerformanceSummary(baselineSplit.out_of_sample),
            },
            objective_overall: { candidate: objectivePerformanceSummary(records), baseline: objectivePerformanceSummary(baselineRecords) },
        },
        case_library: caseLibrary,
        scenario_quality_guard: scenarioQualityGuard,
        data_quality: {
            invalid_outcomes: invalidOutcomes.length,
            invalid_records: new Set(invalidOutcomes.map((item) => `${item.code}|${item.date}|${item.strategy}`)).size,
            issues: invalidOutcomes,
        },
        t_pairs: objectiveScenarios.t_pairs,
        out_of_sample_t_pairs: objectiveOutOfSampleScenarios.t_pairs,
        promotion: {
            target_accuracy_pct: 80,
            evidence_source: researchOnly ? 'expanded_research_not_for_promotion' : 'frozen_policy_forward_shadow',
            minimum_instruments: 20,
            minimum_out_of_sample_samples: 10,
            minimum_samples_per_scenario: requiredScenarioSamples,
            historical_out_of_sample_covered_scenarios: historicalCoveredScenarios,
            historical_out_of_sample_weak_scenarios: historicalWeakScenarios,
            shadow_days: shadow.shadow_days,
            shadow_seed_date: shadow.seed_date,
            shadow_metrics: shadow.forward_metrics,
            shadow_case_library: shadow.forward_case_library,
            shadow_position_cycle_ledger: shadow.forward_cycle_ledger,
            covered_scenarios: coveredScenarios,
            required_scenarios: SCENARIOS.length,
            weak_scenarios: weakScenarios,
            ready,
            next: ready
                ? '全部硬门槛通过，可由定时优化任务执行候选晋级'
                : researchOnly ? '扩展研究层只补充场景证据，不参与策略晋级' : '冻结当前候选，继续累计未来交易日影子样本',
        },
        records,
    };
    const date = day(asOf);
    const root = tradeMasterHome();
    const artifactId = `rolling-backtest${evidenceTag ? `-${evidenceTag}` : ''}-${date}`;
    const reportPath = join(root, 'backtests', `${artifactId}.json`);
    const reviewPath = join(root, 'reviews', `${artifactId}.md`);
    const candidatePath = join(root, 'strategies', 'candidates', `${artifactId}.json`);
    writeJson(reportPath, report);
    writeMarkdown(reviewPath, rollingBacktestMarkdown(report));
    writeJson(candidatePath, {
        schema_version: 2,
        id: artifactId,
        description: `近${windowDays}日多场景滚动回测${researchOnly ? '扩展研究证据' : '弱项优化候选'}`,
        rule: { weak_scenarios: weakScenarios, target_accuracy_pct: 80, forbid_lookahead: true, preserve_risk_limits: true, decision_policy: candidatePolicy },
        evidence: {
            history_samples: objectiveHistory.samples,
            out_of_sample_samples: promotionOutOfSample.samples,
            out_of_sample_accuracy: promotionOutOfSample.accuracy_pct,
            confidence_lower_bound: promotionOutOfSample.confidence_lower_bound_pct,
            scenario_coverage: coveredScenarios,
            weak_scenario_count: weakScenarios.length,
            shadow_days: shadow.shadow_days,
            drawdown_delta: shadow.drawdown_delta,
            profit_factor: promotionPerformance.profit_factor,
            losing_samples: promotionPerformance.losing_samples,
            scenario_case_samples: caseLibrary.independent.samples,
            scenario_case_action_metrics: caseLibrary.independent.action_metrics,
            scenario_high_low_pairs: caseLibrary.independent.high_low_pairs.length,
            scenario_high_low_cycle_ledger: caseLibrary.independent.high_low_cycle_ledger,
            scenario_case_coverage: caseLibrary.coverage,
            scenario_quality_guard: scenarioQualityGuard,
            historical_t_pairs: objectiveScenarios.t_pairs.length,
            historical_risk_recovery_pairs: objectiveScenarios.risk_recovery_pairs.length,
            historical_position_cycle_ledger: objectiveScenarios.cycle_ledger,
            bottom_fishing_abstention_samples: caseLibrary.bottom_fishing_abstentions.samples,
            shadow_scenario_case_samples: shadow.forward_case_library.independent.samples,
            shadow_scenario_high_low_pairs: shadow.forward_case_library.independent.high_low_pairs.length,
            shadow_t_pairs: shadow.forward_t_pairs.length,
            conflicts: errors.length + coverageIssues.length,
        },
        validation_status: researchOnly ? 'research_only' : ready ? 'ready_for_promotion' : shadow.shadow_days ? 'shadow_validation' : 'collecting_evidence',
        report_file: reportPath,
        shadow_state_file: shadow.state_file,
    });
    return { ...report, saved: { report: reportPath, review: reviewPath, candidate: candidatePath } };
}

export function latestRollingBacktest() {
    const root = join(tradeMasterHome(), 'backtests');
    const files = existsSync(root) ? readdirSync(root).filter((name) => /^rolling-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort() : [];
    if (!files.length)
        return { status: 'missing', next: '先运行 backtest rolling' };
    const file = join(root, files.at(-1));
    const report = readJson(file);
    return {
        status: 'ready',
        file,
        generated_at: report.generated_at,
        as_of: report.as_of,
        universe: report.universe,
        split: report.split,
        metrics: report.metrics,
        promotion: report.promotion,
    };
}
