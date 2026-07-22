import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { initializeStore, readJson, tradeMasterHome, writeJson, writeMarkdown } from './storage.js';
function exchange(code) {
    if (/^(5|6|11)/.test(code))
        return 'SH';
    if (/^(0|1|2|3|12)/.test(code))
        return 'SZ';
    if (/^(4|8|92)/.test(code))
        return 'BJ';
    return 'UNKNOWN';
}
function typeFor(code) {
    if (/^(11|12)/.test(code))
        return 'cbond';
    if (/^(15|16|50|51|52|56|58)/.test(code))
        return 'etf';
    return 'stock';
}
function filesUnder(root) {
    if (!existsSync(root))
        return [];
    return readdirSync(root).flatMap((name) => {
        const path = join(root, name);
        return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
}
function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function safe(value) {
    return value.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '-').slice(0, 120);
}
function terminalEvent(event) {
    const status = String(event.status ?? '');
    return /cancelled|filled|rejected|expired|invalidated/.test(status);
}
function cashFromBasis(basis) {
    if (typeof basis !== 'string')
        return null;
    const matched = basis.match(/资金余额\s*([\d.]+)\s*元/);
    const value = Number(matched?.[1]);
    return Number.isFinite(value) ? value : null;
}
function copyTree(source, target) {
    if (!existsSync(source))
        return 0;
    const sourceStat = statSync(source);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: sourceStat.isDirectory(), force: true });
    return sourceStat.isDirectory() ? filesUnder(source).length : 1;
}
function caseStatus(markdown) {
    return markdown.match(/case_status[：:]\s*([^\n]+)/)?.[1]?.trim() ?? 'unknown';
}
export function migrateLegacyMmm(sourceRootInput, caseRootInput) {
    const sourceRoot = resolve(sourceRootInput);
    const caseRoot = resolve(caseRootInput ?? join(dirname(sourceRoot), '持仓跟踪'));
    const required = ['确认持仓.json', '目标与约束.json', '当前纪律状态.json'];
    for (const file of required) {
        if (!existsSync(join(sourceRoot, file)))
            throw new Error(`旧中枢缺少必需文件：${file}`);
    }
    const targetRoot = tradeMasterHome();
    const existedBefore = existsSync(targetRoot);
    const migrationId = new Date().toISOString().replace(/[:.]/g, '-');
    const backupRoot = join(targetRoot, 'backups', migrationId);
    const mutableTargets = ['portfolio.json', 'goals.json', 'discipline.json', 'watchlist.json', 'strategy-profile.json', 'strategies', 'cases', 'plans', 'reviews', 'badcases'];
    if (existedBefore) {
        for (const name of mutableTargets) {
            const path = join(targetRoot, name);
            if (existsSync(path))
                copyTree(path, join(backupRoot, name));
        }
    }
    initializeStore(false);
    const ledger = readJson(join(sourceRoot, '确认持仓.json'));
    const goals = readJson(join(sourceRoot, '目标与约束.json'));
    const discipline = readJson(join(sourceRoot, '当前纪律状态.json'));
    const oldStrategy = readJson(join(sourceRoot, '策略版本/current.json'));
    const registry = readJson(join(sourceRoot, '策略版本/registry.json'));
    const pending = ledger.pending_events ?? [];
    const positions = ledger.positions.map((position) => ({
        ...position,
        instrument: {
            ...position.instrument,
            exchange: exchange(position.instrument.code),
        },
    }));
    const portfolio = {
        schema_version: 1,
        as_of: ledger.as_of,
        cash: cashFromBasis(goals.current_asset_basis),
        total_asset: goals.current_asset ?? null,
        positions: positions,
        pending_events: pending.filter((event) => !terminalEvent(event)),
        conflicts: ledger.conflicts ?? [],
        historical_order_events: pending,
        processed_event_ids: ledger.processed_event_ids ?? [],
        asset_snapshot_as_of: goals.current_asset_as_of ?? null,
        migration: { id: migrationId, source: join(sourceRoot, '确认持仓.json'), copied_not_moved: true },
    };
    writeJson(join(targetRoot, 'portfolio.json'), portfolio);
    writeJson(join(targetRoot, 'goals.json'), {
        ...goals,
        migration: { id: migrationId, source: join(sourceRoot, '目标与约束.json'), copied_not_moved: true },
    });
    writeJson(join(targetRoot, 'discipline.json'), {
        ...discipline,
        migration: { id: migrationId, source: join(sourceRoot, '当前纪律状态.json'), copied_not_moved: true },
    });
    const positionByCode = new Map(positions.map((item) => [item.instrument.code, item]));
    const watchlist = new Map();
    for (const position of positions) {
        watchlist.set(position.instrument.code, {
            ...position.instrument,
            status: position.status === 'confirmed' && position.quantity > 0 ? 'holding' : 'closed_case',
            source: 'legacy_confirmed_ledger',
        });
    }
    const caseFiles = filesUnder(caseRoot).filter((path) => path.endsWith('.md'));
    for (const path of caseFiles) {
        const matched = basename(path).match(/^(\d{6})-(.+)\.md$/);
        if (!matched)
            continue;
        const [, code, name] = matched;
        const markdown = readFileSync(path, 'utf8');
        const position = positionByCode.get(code);
        const status = caseStatus(markdown);
        if (!watchlist.has(code)) {
            watchlist.set(code, { code, name, type: typeFor(code), exchange: exchange(code), status: status.startsWith('active') ? 'watching' : 'closed_case', source: 'legacy_case' });
        }
        const targetDir = join(targetRoot, 'cases', `${code}-${safe(name)}`);
        copyTree(path, join(targetDir, 'timeline.md'));
        writeJson(join(targetDir, 'state.json'), {
            schema_version: 1,
            instrument: position?.instrument ?? { code, name, type: typeFor(code), exchange: exchange(code) },
            case_status: status,
            position: position ?? null,
            migrated_at: new Date().toISOString(),
            source: path,
        });
    }
    writeJson(join(targetRoot, 'watchlist.json'), {
        schema_version: 1,
        updated_at: new Date().toISOString(),
        instruments: [...watchlist.values()],
        migration: { id: migrationId, derived_from: ['确认持仓.json', '持仓跟踪/*.md'] },
    });
    writeJson(join(targetRoot, 'strategy-profile.json'), {
        schema_version: 1,
        updated_at: new Date().toISOString(),
        preferences: {
            allowed_instrument_types: goals.constraints?.allowed_instrument_types ?? ['stock', 'etf', 'cbond'],
            constraints: goals.constraints ?? {},
            transaction_costs: goals.transaction_costs ?? {},
        },
        behavioral_guardrails: goals.guardrails ?? [],
        learned_expectations: [
            {
                id: 'LR-20260710-001',
                status: 'active',
                scope: 'high_volatility_cbond_intraday_risk',
                rule: '1分钟跌破只预警；至少等待完整5分钟K；策略要求反抽失败时必须一并确认；模型虚拟仓退出不得映射为真实持仓止损',
                source_badcase: 'badcase-20260710-123255-false-stop',
            },
        ],
        migration: { id: migrationId, legacy_strategy_version: registry.active_version ?? oldStrategy.version ?? null },
    });
    writeJson(join(targetRoot, 'strategies/active.json'), {
        schema_version: 1,
        version: `${String(registry.active_version ?? oldStrategy.version ?? '1.0.0')}-migrated`,
        updated_at: new Date().toISOString(),
        rules: [
            {
                id: 'LR-20260710-001',
                instrument_type: 'cbond',
                warning_period: '1m',
                confirmation_period: '5m',
                require_closed_bar: true,
                map_model_position_to_real_position: false,
                source_badcase: 'badcase-20260710-123255-false-stop',
            },
        ],
        rollback_file: null,
        legacy_strategy: oldStrategy,
        migration: { id: migrationId, candidates_auto_promoted: false },
    });
    for (const candidate of registry.candidates ?? []) {
        const id = String(candidate.id ?? `legacy-candidate-${Date.now()}`);
        writeJson(join(targetRoot, 'strategies/candidates', `${safe(id)}.json`), {
            schema_version: 1,
            ...candidate,
            migrated_at: new Date().toISOString(),
            migration_status: 'legacy_candidate_not_promoted',
        });
    }
    const copied = {
        plans: copyTree(join(sourceRoot, '每日策略'), join(targetRoot, 'plans')),
        reviews: copyTree(join(sourceRoot, '盘后复盘'), join(targetRoot, 'reviews')),
        badcases: copyTree(join(sourceRoot, 'badcases'), join(targetRoot, 'badcases')),
        legacy_strategy_versions: copyTree(join(sourceRoot, '策略版本'), join(targetRoot, 'legacy/strategy-versions')),
        legacy_simulation: copyTree(join(sourceRoot, '模拟盘'), join(targetRoot, 'legacy/simulation')),
    };
    for (const file of required)
        copyTree(join(sourceRoot, file), join(targetRoot, 'legacy/source-core', file));
    for (const file of ['执行授权.json', '待确认委托.json', 'README.md']) {
        copyTree(join(sourceRoot, file), join(targetRoot, 'legacy/execution-and-source', file));
    }
    const sourceFiles = [...filesUnder(sourceRoot), ...caseFiles];
    const manifest = sourceFiles.map((path) => ({
        source: path,
        relative_path: path.startsWith(sourceRoot) ? relative(sourceRoot, path) : relative(caseRoot, path),
        size: statSync(path).size,
        sha256: sha256(path),
    }));
    writeJson(join(targetRoot, 'legacy/source-manifest.json'), { schema_version: 1, migration_id: migrationId, files: manifest });
    const report = {
        schema_version: 1,
        migration_id: migrationId,
        migrated_at: new Date().toISOString(),
        source_root: sourceRoot,
        case_root: caseRoot,
        target_root: targetRoot,
        source_deleted: false,
        target_existed_before: existedBefore,
        backup_root: existedBefore ? backupRoot : null,
        counts: {
            source_files: manifest.length,
            positions: positions.length,
            active_positions: positions.filter((item) => item.status === 'confirmed' && item.quantity > 0).length,
            pending_events: portfolio.pending_events.length,
            historical_order_events: pending.length,
            watchlist: watchlist.size,
            cases: caseFiles.length,
            strategy_candidates: registry.candidates?.length ?? 0,
            ...copied,
        },
        safety: {
            execution_authorization_activated: false,
            legacy_orders_activated: false,
            simulation_state_activated: false,
            legacy_candidates_auto_promoted: false,
        },
        warnings: [
            '旧执行授权、历史委托和模拟盘状态仅归档到 legacy，不在 Trade Master 中生效。',
            '可用数量带原有效日期，跨交易日后必须重新确认。',
            '118071 的上午截图价格未迁移为收盘价或收益事实。',
            '159516 保留为 closed case，不作为当前持仓。',
        ],
    };
    writeJson(join(targetRoot, 'migration', `${migrationId}.json`), report);
    writeMarkdown(join(targetRoot, 'migration', `${migrationId}.md`), [
        '# Trade Master 旧交易中枢迁移报告',
        '',
        `- 迁移时间：${report.migrated_at}`,
        `- 源目录：${sourceRoot}`,
        `- 目标目录：${targetRoot}`,
        `- 源文件：${report.counts.source_files}`,
        `- 持仓记录：${report.counts.positions}（当前有效 ${report.counts.active_positions}）`,
        `- 关注标的：${report.counts.watchlist}`,
        `- 单标的 case：${report.counts.cases}`,
        `- badcase：${report.counts.badcases}`,
        '',
        '## 安全处理',
        '',
        '- 原始文件未删除。',
        '- 旧执行授权、委托历史和模拟盘状态只归档，不激活。',
        '- 旧候选策略只进入候选区，不自动升级。',
        '',
        '## 需要后续刷新',
        '',
        '- 跨交易日后刷新持仓可用数量、现金和总资产。',
        '- 使用内置多源行情重新获取当前价格，不沿用历史截图价格。',
    ].join('\n'));
    return report;
}
