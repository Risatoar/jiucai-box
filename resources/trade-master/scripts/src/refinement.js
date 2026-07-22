import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadConfig, readJson, tradeMasterHome, writeJson } from './storage.js';
function safe(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}
export function validateAndPromote(candidate) {
    const config = loadConfig();
    const limits = config.refinement;
    const checks = [
        { name: 'history_samples', passed: candidate.evidence.history_samples >= limits.minimum_history_samples },
        { name: 'out_of_sample_samples', passed: candidate.evidence.out_of_sample_samples >= limits.minimum_out_of_sample_samples },
        { name: 'shadow_days', passed: candidate.evidence.shadow_days >= limits.minimum_shadow_days },
        { name: 'drawdown_delta', passed: candidate.evidence.drawdown_delta <= limits.maximum_drawdown_delta },
        { name: 'profit_factor', passed: candidate.evidence.profit_factor >= limits.minimum_profit_factor },
        { name: 'conflicts', passed: candidate.evidence.conflicts === 0 },
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
