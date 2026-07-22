import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const SKILL_ROOT = resolve(SCRIPT_DIR, '../..');
export function tradeMasterHome() {
    return resolve(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'));
}
export function ensureInsideHome(path) {
    const root = tradeMasterHome();
    const target = resolve(path);
    if (target !== root && !target.startsWith(`${root}/`))
        throw new Error(`路径越界：${target}`);
    return target;
}
export function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}
export function writeJson(path, value) {
    ensureInsideHome(path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export function writeMarkdown(path, value) {
    ensureInsideHome(path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}
function defaults() {
    const root = tradeMasterHome();
    const now = new Date().toISOString();
    return {
        portfolio: {
            schema_version: 1,
            as_of: now,
            cash: null,
            total_asset: null,
            positions: [],
            pending_events: [],
            conflicts: [],
        },
        watchlist: { schema_version: 1, updated_at: now, instruments: [] },
        goals: { schema_version: 1, status: 'needs_confirmation', updated_at: now },
        discipline: { schema_version: 1, state: 'NORMAL', updated_at: now, reasons: [] },
        profile: { schema_version: 1, updated_at: now, preferences: {}, learned_expectations: [] },
        activeStrategies: { schema_version: 1, version: 'builtin-v1', updated_at: now, rules: [] },
        activeEvolution: { schema_version: 1, version: 'evolution-v1', updated_at: now, rules: [] },
        evolutionAudit: { schema_version: 1, events: [] },
        root,
    };
}
export function initializeStore(force = false) {
    const root = tradeMasterHome();
    mkdirSync(root, { recursive: true });
    for (const dir of ['strategies/candidates', 'strategies/versions', 'evolution/candidates', 'evolution/versions', 'cases', 'plans', 'reviews', 'badcases', 'market-cache/data', 'runtime/candidate-model/predictions', 'reports', 'replays', 'automation', 'notifications', 'logs']) {
        mkdirSync(join(root, dir), { recursive: true });
    }
    const seed = defaults();
    const entries = [
        ['portfolio.json', seed.portfolio],
        ['watchlist.json', seed.watchlist],
        ['goals.json', seed.goals],
        ['discipline.json', seed.discipline],
        ['strategy-profile.json', seed.profile],
        ['strategies/active.json', seed.activeStrategies],
        ['evolution/active.json', seed.activeEvolution],
        ['evolution/audit.json', seed.evolutionAudit],
    ];
    const created = [];
    const skipped = [];
    for (const [relative, value] of entries) {
        const path = join(root, relative);
        if (existsSync(path) && !force)
            skipped.push(relative);
        else {
            writeJson(path, value);
            created.push(relative);
        }
    }
    for (const [asset, target] of [
        ['default-config.json', 'config.json'],
        ['default-providers.json', 'providers.json'],
        ['default-notifications.json', 'notifications.json'],
    ]) {
        const path = join(root, target);
        if (existsSync(path) && !force)
            skipped.push(target);
        else {
            cpSync(join(SKILL_ROOT, 'assets', asset), path);
            created.push(target);
        }
    }
    const readme = join(root, 'README.md');
    if (existsSync(readme) && !force)
        skipped.push('README.md');
    else {
        writeMarkdown(readme, `# Trade Master 全局状态\n\n- JSON：配置、持仓、目标、纪律、策略和进化规则的机器事实源。\n- Markdown：作战卡、分析、case 时间线、复盘和 badcase。\n- evolution/ 保存对话优化候选、活动规则、审计和回滚点。\n- Markdown 中的新持仓事实需确认后再写入 portfolio.json。\n- 本目录为明文存储，请自行控制本机访问权限。\n`);
        created.push('README.md');
    }
    return { root, created, skipped };
}
export function loadConfig() {
    const config = readJson(join(tradeMasterHome(), 'config.json'));
    return {
        ...config,
        cache: {
            retention_days: config.cache?.retention_days ?? 30,
            max_entries: config.cache?.max_entries ?? 5000,
            max_bytes: config.cache?.max_bytes ?? 512 * 1024 * 1024,
        },
    };
}
export function loadProviders() {
    return readJson(join(tradeMasterHome(), 'providers.json'));
}
export function loadPortfolio() {
    return readJson(join(tradeMasterHome(), 'portfolio.json'));
}
