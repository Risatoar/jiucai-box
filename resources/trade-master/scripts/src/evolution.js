import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readJson, tradeMasterHome, writeJson } from './storage.js';
const LOW_RISK = new Set(['workflow', 'output', 'automation', 'monitoring', 'data_quality']);
const STRATEGY = new Set(['strategy']);
const PROTECTED = new Set(['constitution', 'user_fact', 'risk_limit', 'data_priority', 'broker_boundary']);
const PROTECTED_TARGET = /(^|\.)(constitution|portfolio|positions?|fills?|trades?|risk|drawdown|cash_buffer|data_priority|broker)(\.|$)/i;
function safe(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}
function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}
function fingerprint(candidate) {
    return JSON.stringify({ target: candidate.target, rule: candidate.rule });
}
function evolutionRoot() {
    return join(tradeMasterHome(), 'evolution');
}
function ensureState() {
    const root = evolutionRoot();
    const activePath = join(root, 'active.json');
    const auditPath = join(root, 'audit.json');
    if (!existsSync(activePath)) {
        writeJson(activePath, { schema_version: 1, version: 'evolution-v1', updated_at: new Date().toISOString(), rules: [] });
    }
    if (!existsSync(auditPath))
        writeJson(auditPath, { schema_version: 1, events: [] });
    return { active: readJson(activePath), audit: readJson(auditPath) };
}
function recordAudit(event) {
    const path = join(evolutionRoot(), 'audit.json');
    const audit = ensureState().audit;
    audit.events.push({ occurred_at: new Date().toISOString(), ...event });
    writeJson(path, audit);
}
function validateCandidate(candidate) {
    if (!candidate.id || !candidate.title || !candidate.description)
        throw new Error('进化候选缺少 id、title 或 description');
    if (!candidate.target || !candidate.rule || typeof candidate.rule !== 'object')
        throw new Error('进化候选缺少 target 或 rule');
    if (!candidate.source?.summary || !candidate.source?.occurred_at)
        throw new Error('进化候选缺少可审计来源');
    if (!Array.isArray(candidate.validation?.acceptance_checks) || candidate.validation.acceptance_checks.length === 0) {
        throw new Error('进化候选至少需要一个验收检查');
    }
}
function classify(candidate) {
    if (PROTECTED.has(candidate.category) || PROTECTED_TARGET.test(candidate.target))
        return 'L3';
    if (STRATEGY.has(candidate.category) || candidate.target.startsWith('strategy.'))
        return 'L2';
    if (LOW_RISK.has(candidate.category))
        return 'L1';
    return 'L3';
}
export function captureAndEvolve(candidate) {
    validateCandidate(candidate);
    const level = classify(candidate);
    const root = evolutionRoot();
    const candidatePath = join(root, 'candidates', `${safe(candidate.id)}.json`);
    const validationPassed = candidate.validation.deterministic_tests_passed
        && candidate.validation.conflicts === 0
        && Boolean(candidate.rollback_plan);
    const captured = {
        ...candidate,
        classification: level,
        captured_at: new Date().toISOString(),
        status: level === 'L3' ? 'protected_blocked' : level === 'L2' ? 'needs_strategy_refinement' : validationPassed ? 'validated' : 'needs_validation',
    };
    writeJson(candidatePath, captured);
    if (level === 'L3') {
        recordAudit({ candidate_id: candidate.id, action: 'blocked', level, target: candidate.target, reason: '命中不可自动修改边界' });
        return { status: 'protected_blocked', evolved: false, level, candidate_file: candidatePath };
    }
    if (level === 'L2') {
        recordAudit({ candidate_id: candidate.id, action: 'routed_to_refinement', level, target: candidate.target });
        return { status: 'needs_strategy_refinement', evolved: false, level, candidate_file: candidatePath, next: '补齐策略 evidence 后运行 refine --candidate' };
    }
    if (!validationPassed) {
        recordAudit({ candidate_id: candidate.id, action: 'captured', level, target: candidate.target, reason: '确定性测试、冲突或回滚计划未通过' });
        return { status: 'needs_validation', evolved: false, level, candidate_file: candidatePath };
    }
    const { active } = ensureState();
    const nextFingerprint = fingerprint(candidate);
    const identical = active.rules.find((item) => item.target === candidate.target && item.fingerprint === nextFingerprint);
    if (identical) {
        recordAudit({ candidate_id: candidate.id, action: 'deduplicated', level, target: candidate.target, active_rule_id: identical.id });
        return { status: 'already_active', evolved: false, level, version: active.version, rule_id: identical.id };
    }
    const versionStamp = timestamp();
    const rollbackRelative = `evolution/versions/${versionStamp}-before-${safe(candidate.id)}.json`;
    writeJson(join(tradeMasterHome(), rollbackRelative), active);
    const rules = active.rules.filter((item) => item.target !== candidate.target);
    rules.push({
        id: candidate.id,
        title: candidate.title,
        description: candidate.description,
        target: candidate.target,
        category: candidate.category,
        rule: candidate.rule,
        source: candidate.source,
        acceptance_checks: candidate.validation.acceptance_checks,
        rollback_plan: candidate.rollback_plan,
        activated_at: new Date().toISOString(),
        fingerprint: nextFingerprint,
        rollback_file: rollbackRelative,
    });
    const next = {
        schema_version: 1,
        version: `${versionStamp}-${safe(candidate.id)}`,
        updated_at: new Date().toISOString(),
        rules,
    };
    writeJson(join(root, 'active.json'), next);
    recordAudit({ candidate_id: candidate.id, action: 'auto_evolved', level, target: candidate.target, version: next.version, rollback_file: rollbackRelative });
    return { status: 'auto_evolved', evolved: true, level, version: next.version, rollback_file: rollbackRelative };
}
export function monitorEvolution(input) {
    const { active } = ensureState();
    if (!input.regression_detected)
        return { status: 'healthy', rolled_back: false, rule_id: input.rule_id };
    const current = active.rules.find((item) => item.id === input.rule_id);
    if (!current)
        return { status: 'blocked', rolled_back: false, reason: '活动进化规则不存在' };
    const rollbackPath = join(tradeMasterHome(), current.rollback_file);
    if (!existsSync(rollbackPath))
        return { status: 'blocked', rolled_back: false, reason: `回滚文件不存在：${basename(rollbackPath)}` };
    const previous = readJson(rollbackPath);
    const previousRule = previous.rules.find((item) => item.target === current.target);
    const rules = active.rules.filter((item) => item.target !== current.target);
    if (previousRule)
        rules.push(previousRule);
    const next = {
        ...active,
        version: `${timestamp()}-rollback-${safe(input.rule_id)}`,
        updated_at: new Date().toISOString(),
        rules,
    };
    writeJson(join(evolutionRoot(), 'active.json'), next);
    recordAudit({ rule_id: input.rule_id, action: 'rolled_back', reason: input.reason, version: next.version });
    return { status: 'rolled_back', rolled_back: true, rule_id: input.rule_id, reason: input.reason, version: next.version };
}
export function evolutionStatus() {
    const root = evolutionRoot();
    const { active, audit } = ensureState();
    const candidateDir = join(root, 'candidates');
    const candidates = existsSync(candidateDir) ? readdirSync(candidateDir).filter((name) => name.endsWith('.json')).sort() : [];
    return { active, candidate_files: candidates, recent_audit: audit.events.slice(-20) };
}
