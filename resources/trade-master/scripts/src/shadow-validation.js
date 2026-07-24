import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    multiHorizonSummary,
    objectiveMetric,
    objectivePerformanceSummary,
    objectiveScenarioSummary,
    SCENARIOS,
} from './backtest-metrics.js';
import { buildScenarioCaseLibrary } from './scenario-case-library.js';
import { readJson, tradeMasterHome, writeJson } from './storage.js';

const day = (value) => String(value).slice(0, 10);
const safe = (value) => String(value || 'candidate').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
const fingerprint = (policy) => createHash('sha256').update(JSON.stringify(policy)).digest('hex');
const recordKey = (item) => [
    item.code ?? '',
    item.date ?? '',
    item.time ?? '',
    item.side ?? '',
    item.strategy ?? '',
    item.simulation_track ?? '',
].join('|');
const mergeRecord = (previous, current) => {
    if (!previous)
        return current;
    const outcomes = new Map((previous.outcomes ?? []).map((item) => [item.horizon, item]));
    for (const item of current.outcomes ?? []) {
        const existing = outcomes.get(item.horizon);
        if (!existing || item.status === 'completed' || existing.status !== 'completed')
            outcomes.set(item.horizon, item);
    }
    return { ...previous, ...current, outcomes: [...outcomes.values()].sort((left, right) => left.horizon - right.horizon) };
};
const mergeRecords = (existing, current) => {
    const merged = new Map((existing ?? []).map((item) => [recordKey(item), item]));
    for (const item of current)
        merged.set(recordKey(item), mergeRecord(merged.get(recordKey(item)), item));
    return [...merged.values()].sort((left, right) => `${left.date}${left.time ?? ''}`.localeCompare(`${right.date}${right.time ?? ''}`));
};

export function updateShadowValidation(input) {
    const policyFingerprint = fingerprint(input.policy);
    const asOfDate = day(input.asOf);
    const statePath = join(tradeMasterHome(), 'strategies', 'shadow', `${safe(input.policy.id)}.json`);
    const existing = existsSync(statePath) ? readJson(statePath) : null;
    const reset = !existing || existing.policy_fingerprint !== policyFingerprint;
    const state = reset ? {
        schema_version: 1,
        policy_id: input.policy.id,
        policy_fingerprint: policyFingerprint,
        seed_date: asOfDate,
        validation_dates: [],
        created_at: new Date().toISOString(),
    } : existing;
    const validationDates = new Set(state.validation_dates ?? []);
    if (input.eligible && asOfDate > state.seed_date)
        validationDates.add(asOfDate);
    const forwardRecords = mergeRecords(
        state.forward_records,
        input.records.filter((item) => item.date > state.seed_date),
    );
    const forwardBaselineRecords = mergeRecords(
        state.baseline_forward_records,
        input.baselineRecords.filter((item) => item.date > state.seed_date),
    );
    const forwardCaseRecords = mergeRecords(
        state.forward_case_records,
        (input.caseRecords ?? []).filter((item) => item.date > state.seed_date),
    );
    const forwardRejectedCases = mergeRecords(
        state.forward_rejected_cases,
        (input.rejectedCaseRecords ?? []).filter((item) => item.date > state.seed_date),
    );
    const forwardCaseLibrary = buildScenarioCaseLibrary(forwardCaseRecords, forwardRejectedCases);
    const metrics = objectiveMetric(forwardRecords);
    const scenarios = objectiveScenarioSummary(forwardRecords);
    const performance = objectivePerformanceSummary(forwardRecords);
    const baselinePerformance = objectivePerformanceSummary(forwardBaselineRecords);
    const drawdownDelta = performance.samples && baselinePerformance.samples
        ? Number((performance.max_drawdown_ratio - baselinePerformance.max_drawdown_ratio).toFixed(6))
        : null;
    const minimumSamplesPerScenario = Number(input.minimumSamplesPerScenario) || 5;
    const coveredScenarios = Object.values(scenarios.scenarios)
        .filter((item) => item.samples >= minimumSamplesPerScenario).length;
    const weakScenarios = Object.entries(scenarios.scenarios)
        .filter(([, item]) => item.samples < minimumSamplesPerScenario || (item.accuracy_pct ?? 0) < 80)
        .map(([name]) => name);
    const next = {
        ...state,
        updated_at: new Date().toISOString(),
        last_as_of: input.asOf,
        validation_dates: [...validationDates].sort(),
        shadow_days: validationDates.size,
        forward_records: forwardRecords,
        baseline_forward_records: forwardBaselineRecords,
        forward_case_records: forwardCaseRecords,
        forward_rejected_cases: forwardRejectedCases,
        forward_case_library: forwardCaseLibrary,
        forward_metrics: metrics,
        forward_by_horizon: multiHorizonSummary(forwardRecords),
        forward_scenarios: scenarios.scenarios,
        forward_t_pairs: scenarios.t_pairs,
        forward_risk_recovery_pairs: scenarios.risk_recovery_pairs,
        forward_cycle_ledger: scenarios.cycle_ledger,
        forward_performance: performance,
        baseline_forward_performance: baselinePerformance,
        drawdown_delta: drawdownDelta,
        covered_scenarios: coveredScenarios,
        required_scenarios: SCENARIOS.length,
        weak_scenarios: weakScenarios,
    };
    writeJson(statePath, next);
    return { ...next, state_file: statePath };
}
