import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateGoal } from './goal.js';
import { generateStrategySignals } from './strategy-engine.js';
import { decisionPolicyForInstrument, loadIntradayDecisionPolicy } from './strategy-policy.js';
import { loadConfig, loadPortfolio, readJson, tradeMasterHome } from './storage.js';
const CLOSED_WATCH_STATUSES = new Set(['closed', 'closed_case', 'removed', 'archived']);
const signalAccountKey = (code, accountScope) => `${code}|${accountScope ?? ''}`;
export function shanghaiDate(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
}
function independentExit(signal) {
    return signal.side === 'sell' && signal.kState === 'closed' && signal.level === 'actionable'
        && signal.strategy !== 'legacy_fusion_nine_turn';
}
function independentEntry(signal) {
    return signal.side === 'buy' && signal.kState === 'closed' && signal.level === 'actionable';
}
export async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const run = async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
    return results;
}
function normalizePosition(position, accountScope) {
    return {
        instrument: position.instrument,
        quantity: Number(position.quantity ?? 0),
        available_quantity: Number(position.available_quantity ?? position.availableQuantity ?? 0),
        average_cost: position.average_cost ?? position.averageCost ?? null,
        status: position.status,
        restrictions: position.restrictions ?? [],
        account_scope: accountScope,
    };
}
export function collectLastSellPrices(records = []) {
    return new Map([...collectLastSellContexts(records)].map(([key, value]) => [key, value.price]));
}
export function collectLastSellContexts(records = []) {
    const prices = new Map();
    for (const record of [...records].sort((left, right) => String(left.recordedAt ?? '').localeCompare(String(right.recordedAt ?? '')))) {
        if (record.evaluationEligible === false || !Number.isFinite(Number(record.referencePrice)))
            continue;
        const key = signalAccountKey(record.code, record.accountScope);
        if (record.side === 'sell')
            prices.set(key, { price: Number(record.referencePrice), strategy: record.strategy ?? null });
        else if (record.side === 'buy')
            prices.delete(key);
    }
    return prices;
}
export function collectPlanTargets(portfolio, household, watchlist, disciplineState) {
    const targets = [];
    const heldCodes = new Set();
    const watchByCode = new Map((watchlist.instruments ?? []).map((item) => [item.code, item]));
    for (const position of portfolio.positions ?? []) {
        if (position.status !== 'confirmed' || Number(position.quantity) <= 0)
            continue;
        heldCodes.add(position.instrument.code);
        targets.push({
            instrument: position.instrument,
            position: normalizePosition(position, '我 → 我的主账户'),
            accountScope: '我 → 我的主账户',
            positionSource: 'primary',
        });
    }
    const members = new Map((household?.members ?? []).map((member) => [member.id, member]));
    for (const account of household?.accounts ?? []) {
        if (account.source === 'primary' || account.monitoringEnabled === false)
            continue;
        const member = members.get(account.memberId);
        if (!member || member.monitoringEnabled === false)
            continue;
        const accountScope = `${member.name} → ${account.name}`;
        for (const position of account.positions ?? []) {
            if (position.status === 'closed' || Number(position.quantity) <= 0)
                continue;
            heldCodes.add(position.instrument.code);
            const watchItem = watchByCode.get(position.instrument.code);
            targets.push({
                instrument: { ...(watchItem ?? {}), ...position.instrument },
                position: normalizePosition(position, accountScope),
                accountScope,
                positionSource: 'household',
            });
        }
    }
    if (!['STOPPED', 'COOLDOWN'].includes(disciplineState)) {
        for (const item of watchlist.instruments ?? []) {
            if (CLOSED_WATCH_STATUSES.has(item.status) || heldCodes.has(item.code))
                continue;
            targets.push({ instrument: item, position: null, accountScope: null, positionSource: 'watchlist' });
        }
    }
    return targets;
}
export async function analyzePlanTarget(market, target, date, asOf, decisionPolicy, lastSellContext) {
    const { instrument, position, accountScope, positionSource } = target;
    const [quotes, dailyResult, minuteResult] = await Promise.all([
        market.quotes(instrument.code),
        market.bars(instrument.code, '1d', 180, { end: asOf, asOf }).then((value) => ({ value, error: null })).catch((error) => ({ value: null, error })),
        market.bars(instrument.code, '1m', 500, { start: `${date}T09:30:00+08:00`, end: asOf, asOf }).then((value) => ({ value, error: null })).catch((error) => ({ value: null, error })),
    ]);
    try {
        const dailyBars = dailyResult.value?.bars ?? [];
        const todayBars = (minuteResult.value?.bars ?? []).filter((bar) => bar.time.startsWith(date));
        const observedReduction = Number(instrument.monitoring_plan?.observed_quantity_reduction_since_previous_snapshot);
        const engine = generateStrategySignals(instrument.type, todayBars, dailyBars, {
            hasPosition: Boolean(position),
            accountScope,
            positionQuantity: position?.quantity ?? null,
            availableQuantity: position?.available_quantity ?? null,
            averageCost: position?.average_cost ?? null,
            soldQuantity: Number.isFinite(observedReduction) && observedReduction > 0 ? observedReduction : null,
            lastSellPrice: lastSellContext?.price ?? null,
            lastSellStrategy: lastSellContext?.strategy ?? null,
            decisionPolicy: decisionPolicyForInstrument(decisionPolicy, instrument.type),
        });
        const latestSignals = engine.signals.slice(-12);
        const exits = latestSignals.filter(independentExit);
        const entries = latestSignals.filter(independentEntry);
        return {
            instrument,
            position,
            account_scope: accountScope,
            position_source: positionSource,
            quote: quotes.quotes[0] ?? null,
            quote_sources: quotes.quotes.map((item) => item.source),
            quote_errors: quotes.errors,
            market_state: {
                latest_bar: todayBars.at(-1)?.time ?? dailyBars.at(-1)?.time ?? null,
                intraday_bars: todayBars.length,
                daily_trend: engine.daily_trend,
                decision_policy_id: engine.decision_policy_id,
            },
            downside_risk: engine.downside_risk,
            latest_signals: latestSignals,
            position_guidance: engine.position_guidance,
            strategy_view: engine.position_guidance?.action
                ?? (exits.length > 0 ? '持仓出现独立退出结构，进入风险复核' : entries.length > 0 ? '出现确认买点，但仍受账户和纪律闸门约束' : '没有新的确认动作'),
            material_change: Boolean(engine.position_guidance?.material_change),
            errors: [
                ...(dailyResult.value?.errors ?? []),
                ...(minuteResult.value?.errors ?? []),
                ...(dailyResult.error ? [dailyResult.error instanceof Error ? dailyResult.error.message : String(dailyResult.error)] : []),
                ...(minuteResult.error ? [minuteResult.error instanceof Error ? minuteResult.error.message : String(minuteResult.error)] : []),
            ],
        };
    }
    catch (error) {
        return {
            instrument,
            position,
            account_scope: accountScope,
            position_source: positionSource,
            quote: quotes.quotes[0] ?? null,
            quote_sources: quotes.quotes.map((item) => item.source),
            market_state: { latest_bar: null, intraday_bars: 0, daily_trend: 'unknown' },
            latest_signals: [],
            position_guidance: {
                state: 'market_unavailable',
                action: '行情证据不可用，保留上一计划但不得沿用旧买卖信号执行',
                preserve_core: Boolean(position),
                material_change: false,
                reentry_plan_required: false,
            },
            strategy_view: '行情证据不可用，只保留账户与纪律结论',
            errors: [...quotes.errors, error instanceof Error ? error.message : String(error)],
        };
    }
}
export async function buildTodayPlan(market, asOf = new Date().toISOString()) {
    const at = new Date(asOf);
    if (!Number.isFinite(at.getTime()))
        throw new Error(`无效 as-of：${asOf}`);
    const date = shanghaiDate(at);
    const portfolio = loadPortfolio();
    const config = loadConfig();
    const discipline = readJson(join(tradeMasterHome(), 'discipline.json'));
    const watchlist = readJson(join(tradeMasterHome(), 'watchlist.json'));
    const householdPath = join(tradeMasterHome(), 'household/portfolio.json');
    const household = existsSync(householdPath) ? readJson(householdPath) : null;
    const goal = evaluateGoal();
    const activePositions = portfolio.positions.filter((item) => item.status === 'confirmed' && item.quantity > 0);
    const targets = collectPlanTargets(portfolio, household, watchlist, discipline.state);
    const decisionPolicy = loadIntradayDecisionPolicy();
    const ledgerPath = join(tradeMasterHome(), 'signals', 'ledger.json');
    const lastSellContexts = collectLastSellContexts(existsSync(ledgerPath) ? readJson(ledgerPath).records : []);
    const analyses = await mapWithConcurrency(targets, 4, (target) => analyzePlanTarget(
        market,
        target,
        date,
        asOf,
        decisionPolicy,
        lastSellContexts.get(signalAccountKey(target.instrument.code, target.accountScope)) ?? null,
    ));
    const blockers = [];
    if (!portfolio.as_of.startsWith(date))
        blockers.push(`账户快照停留在${portfolio.as_of}，现金、总资产、冻结和活动委托需刷新`);
    if (portfolio.cash == null || portfolio.total_asset == null)
        blockers.push('清仓后的现金、总资产、手续费和到账金额尚未确认');
    if (portfolio.conflicts.length > 0)
        blockers.push('确认账本存在未解决冲突');
    if (discipline.state === 'STOPPED')
        blockers.push('纪律状态STOPPED，只允许核对、复盘和降低风险');
    if (discipline.state === 'COOLDOWN')
        blockers.push('纪律状态COOLDOWN，禁止新开仓');
    if (goal.risk_mode === 'defensive' || goal.risk_mode === 'renegotiate_goal')
        blockers.push('收益目标引擎要求防守，禁止增加风险追赶目标');
    const staleAvailability = activePositions.filter((item) => item.available_quantity_valid_for !== date).map((item) => item.instrument.code);
    if (staleAvailability.length > 0)
        blockers.push(`可用数量已过期：${staleAvailability.join('、')}`);
    const fullExitReady = analyses.some((item) => item.position_guidance?.state === 'full_exit_ready');
    const opportunityReady = analyses.some((item) => ['reentry_ready', 'trend_add_ready', 'range_low_add', 'entry_ready'].includes(item.position_guidance?.state));
    const action = discipline.state === 'STOPPED'
        ? '今日停手'
        : discipline.state === 'COOLDOWN'
            ? '继续观察'
            : fullExitReady
                ? '清仓风险复核'
            : analyses.some((item) => item.latest_signals.some(independentExit))
                ? '风险预警'
                : opportunityReady
                    ? '买点复核'
                : '继续观察';
    return {
        schema_version: 1,
        mode: 'pre_market',
        generated_at: new Date().toISOString(),
        as_of: asOf,
        date,
        conclusion: {
            action,
            summary: action === '今日停手'
                ? '不新增股票、ETF或可转债仓位；只核对活动持仓并处理经独立闭合结构确认的风险。'
                : action === '清仓风险复核'
                    ? '下跌趋势仍有较大亏损空间时允许果断清仓；清仓后自动保留重新买回观察，不把卖出作为终点。'
                    : action === '买点复核'
                        ? '出现低吸、回补或上涨趋势回踩买点，先核对账户与风险预算后分批评估。'
                        : '按下跌、震荡、上涨阶段分别处理；没有确认动作时不制造交易。',
            maximum_risk: `单笔风险不超过${(config.risk.max_single_trade_loss_ratio * 100).toFixed(2)}%账户资产，且不得突破现金安全垫`,
        },
        account: {
            portfolio_as_of: portfolio.as_of,
            cash: portfolio.cash,
            total_asset: portfolio.total_asset,
            active_positions: activePositions,
            pending_events: portfolio.pending_events,
            conflicts: portfolio.conflicts,
        },
        goal,
        discipline,
        blockers,
        instruments: analyses,
        scenarios: {
            up: '优先拿住核心仓，在回踩后重新转强时提示低吸；单一MACD转弱或普通冲高不卖核心筹码。',
            range: '围绕确认区间下沿低吸、上沿高抛；只有边界和反转证据同时成立才提示做T。',
            down: '有更多亏损空间时允许果断清仓；风险释放后持续寻找止跌、收复和回踩确认的重新买回点。',
        },
        next_check: staleAvailability.length > 0 || portfolio.cash == null || portfolio.total_asset == null
            ? '先刷新券商持仓、可用、冻结、现金和委托成交事实'
            : '下一根闭合K线或账户事实变化',
        cache: market.cacheStatus(),
        disclaimer: '仅用于决策辅助，不保证盈利，不连接或操作券商账户。',
    };
}
