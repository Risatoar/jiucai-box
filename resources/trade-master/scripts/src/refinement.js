import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadConfig, readJson, tradeMasterHome, writeJson } from './storage.js';
function safe(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}
function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function validateAndPromote(candidate) {
    const config = loadConfig();
    const limits = config.refinement;
    const evidence = candidate.evidence ?? {};
    const historySamples = finite(evidence.history_samples);
    const outOfSampleSamples = finite(evidence.out_of_sample_samples);
    const shadowDays = finite(evidence.shadow_days);
    const drawdownDelta = finite(evidence.drawdown_delta);
    const profitFactor = finite(evidence.profit_factor);
    const losingSamples = finite(evidence.losing_samples);
    const conflicts = finite(evidence.conflicts);
    const outOfSampleAccuracy = finite(evidence.out_of_sample_accuracy);
    const confidenceLowerBound = finite(evidence.confidence_lower_bound);
    const scenarioCoverage = finite(evidence.scenario_coverage);
    const weakScenarioCount = finite(evidence.weak_scenario_count);
    const checks = [
        { name: 'history_samples', passed: historySamples != null && historySamples >= limits.minimum_history_samples, actual: historySamples },
        { name: 'out_of_sample_samples', passed: outOfSampleSamples != null && outOfSampleSamples >= limits.minimum_out_of_sample_samples, actual: outOfSampleSamples },
        { name: 'out_of_sample_accuracy', passed: outOfSampleAccuracy != null && outOfSampleAccuracy >= (limits.minimum_out_of_sample_accuracy ?? 80), actual: outOfSampleAccuracy },
        { name: 'confidence_lower_bound', passed: confidenceLowerBound != null && confidenceLowerBound >= (limits.minimum_confidence_lower_bound ?? 80), actual: confidenceLowerBound },
        { name: 'scenario_coverage', passed: scenarioCoverage != null && scenarioCoverage >= (limits.minimum_scenario_coverage ?? 7), actual: scenarioCoverage },
        { name: 'weak_scenario_count', passed: weakScenarioCount === 0, actual: weakScenarioCount },
        { name: 'shadow_days', passed: shadowDays != null && shadowDays >= limits.minimum_shadow_days, actual: shadowDays },
        { name: 'drawdown_delta', passed: drawdownDelta != null && drawdownDelta <= limits.maximum_drawdown_delta, actual: drawdownDelta },
        {
            name: 'profit_factor',
            passed: (profitFactor != null && profitFactor >= limits.minimum_profit_factor)
                || (outOfSampleSamples != null && outOfSampleSamples > 0 && losingSamples === 0),
            actual: profitFactor ?? (losingSamples === 0 ? 'no_losses' : null),
        },
        { name: 'conflicts', passed: conflicts === 0, actual: conflicts },
    ];
    const passed = checks.every((item) => item.passed);
    const root = tradeMasterHome();
    const candidatePath = join(root, 'strategies', 'candidates', `${safe(candidate.id)}.json`);
    writeJson(candidatePath, { ...candidate, validation: { checked_at: new Date().toISOString(), checks, passed } });
    if (!passed)
        return { status: 'candidate', promoted: false, checks, candidate_file: candidatePath };
    const activePath = join(root, 'strategies', 'active.json');
    const active = readJson(activePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rollbackRelative = `strategies/versions/${timestamp}-before-${safe(candidate.id)}.json`;
    writeJson(join(root, rollbackRelative), active);
    const rules = active.rules.filter((item) => item.id !== candidate.id);
    rules.push({ id: candidate.id, description: candidate.description, ...candidate.rule, evidence: candidate.evidence });
    const next = {
        ...active,
        version: `${timestamp}-${safe(candidate.id)}`,
        updated_at: new Date().toISOString(),
        rules,
        rollback_file: rollbackRelative,
    };
    writeJson(activePath, next);
    return { status: 'promoted', promoted: true, checks, version: next.version, rollback_file: rollbackRelative };
}
export function validateLatestCandidate() {
    const root = join(tradeMasterHome(), 'strategies', 'candidates');
    const files = existsSync(root)
        ? readdirSync(root).filter((name) => /^rolling-backtest-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()
        : [];
    if (!files.length)
        return { status: 'missing', promoted: false, reason: '没有可验证的滚动回测候选' };
    const candidateFile = join(root, files.at(-1));
    return { ...validateAndPromote(readJson(candidateFile)), source_candidate: candidateFile };
}
export function monitorAndRollback(input) {
    const config = loadConfig();
    const root = tradeMasterHome();
    const activePath = join(root, 'strategies', 'active.json');
    const active = readJson(activePath);
    const degraded = input.baseline_win_rate - input.live_win_rate > config.refinement.maximum_live_win_rate_drop
        || input.live_drawdown > input.max_drawdown;
    if (!degraded)
        return { status: 'healthy', rolled_back: false };
    if (!active.rollback_file)
        return { status: 'blocked', rolled_back: false, reason: '没有可用回滚点' };
    const rollbackPath = join(root, active.rollback_file);
    if (!existsSync(rollbackPath))
        return { status: 'blocked', rolled_back: false, reason: `回滚文件不存在：${basename(rollbackPath)}` };
    const previous = readJson(rollbackPath);
    writeJson(activePath, { ...previous, updated_at: new Date().toISOString() });
    return { status: 'rolled_back', rolled_back: true, strategy_id: input.strategy_id, restored_version: previous.version };
}
