#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyzeEvidence } from './analysis.js';
import { planAutomation, syncDefaultAutomations } from './automation.js';
import { monitorCandidatePool, refreshCandidatePool } from './candidate-pool.js';
import { candidateModelStatus } from './candidate-model-status.js';
import { screenConvertibleBonds } from './cbond-screener.js';
import { buildTodayPlan } from './daily-plan.js';
import { evaluateGoal } from './goal.js';
import { captureAndEvolve, evolutionStatus, monitorEvolution } from './evolution.js';
import { MarketService } from './market.js';
import { migrateLegacyMmm } from './migrate.js';
import { configureFeishu, notificationStatus, sendFeishuNotification } from './notifications.js';
import { createProviders } from './providers.js';
import { monitorAndRollback, validateAndPromote } from './refinement.js';
import { replayPoints } from './replay.js';
import { saveReport } from './reports.js';
import { initializeStore, loadConfig, loadPortfolio, loadProviders, readJson, tradeMasterHome, writeJson } from './storage.js';
import { watchlistStatus } from './watchlist.js';
import { acknowledgeWatchlistSignals, monitorWatchlistBuyPoints } from './watchlist-monitor.js';
const args = process.argv.slice(2);
const value = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const has = (name) => args.includes(name);
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
function requireValue(name) {
    const result = value(name);
    if (!result)
        throw new Error(`缺少参数 ${name}`);
    return result;
}
function service() {
    const config = loadConfig();
    return new MarketService(createProviders(loadProviders()), config);
}
function integer(name, fallback) {
    const raw = value(name);
    if (raw == null)
        return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0)
        throw new Error(`${name} 必须是正整数`);
    return parsed;
}
async function main() {
    const [command, subcommand] = args;
    if (command === 'init') {
        print(initializeStore(has('--force')));
        return;
    }
    if (command === 'doctor') {
        const root = tradeMasterHome();
        const checks = {
            node_20_or_newer: Number(process.versions.node.split('.')[0]) >= 20,
            home_exists: existsSync(root),
            config_exists: existsSync(join(root, 'config.json')),
            providers_exists: existsSync(join(root, 'providers.json')),
            portfolio_exists: existsSync(join(root, 'portfolio.json')),
        };
        print({ root, runtime: process.version, checks, ready: Object.values(checks).every(Boolean), next: checks.config_exists ? '可运行分析' : '先运行 init' });
        return;
    }
    if (command === 'market') {
        const market = service();
        if (subcommand === 'search')
            print(await market.search(requireValue('--query')));
        else if (subcommand === 'info')
            print(await market.info(requireValue('--code')));
        else if (subcommand === 'quote')
            print(await market.quotes(requireValue('--code')));
        else if (subcommand === 'universe')
            print(await market.universe((value('--type') ?? 'cbond')));
        else if (subcommand === 'bars')
            print(await market.bars(requireValue('--code'), (value('--period') ?? '1d'), integer('--limit', 180), { start: value('--start'), end: value('--end'), asOf: value('--as-of') }));
        else
            throw new Error('market 支持 search、info、quote、universe、bars');
        return;
    }
    if (command === 'cache') {
        const market = service();
        if (subcommand === 'status')
            print(market.cacheStatus());
        else if (subcommand === 'prune')
            print(market.pruneCache());
        else if (subcommand === 'configure') {
            const config = loadConfig();
            config.cache = {
                retention_days: integer('--retention-days', config.cache?.retention_days ?? 30),
                max_entries: integer('--max-entries', config.cache?.max_entries ?? 5000),
                max_bytes: integer('--max-bytes', config.cache?.max_bytes ?? 512 * 1024 * 1024),
            };
            writeJson(join(tradeMasterHome(), 'config.json'), config);
            print({ updated: true, cache: config.cache, note: '新策略在下次命令启动时生效' });
        }
        else
            throw new Error('cache 支持 status、prune、configure');
        return;
    }
    if (command === 'plan' && subcommand === 'today') {
        const report = await buildTodayPlan(service(), value('--as-of'));
        const saved = has('--save') ? saveReport('reports', `today-${String(report.date)}`, 'Trade Master 今日策略', report) : null;
        print({ ...report, saved });
        return;
    }
    if (command === 'replay' && subcommand === 'points') {
        const code = requireValue('--code');
        const date = requireValue('--date');
        const report = await replayPoints(service(), code, date, value('--as-of') ?? `${date}T15:00:00+08:00`);
        const saved = has('--save') ? saveReport('replays', `${date}-${code}`, `${date} ${code} 买卖点回放`, report) : null;
        print({ ...report, saved });
        return;
    }
    if (command === 'screen' && subcommand === 'cbond') {
        const asOf = requireValue('--as-of');
        const report = await screenConvertibleBonds(service(), asOf, {
            limit: integer('--limit', 5),
            universeLimit: value('--universe-limit') ? integer('--universe-limit', 100) : undefined,
            concurrency: integer('--concurrency', 8),
        });
        const saved = has('--save') ? saveReport('reports', `cbond-${asOf}`, '可转债时点筛选', report) : null;
        print({ ...report, saved });
        return;
    }
    if (command === 'candidate') {
        const market = service();
        if (subcommand === 'refresh')
            print(await refreshCandidatePool(market, value('--as-of') ?? new Date().toISOString(), { maxCandidates: integer('--limit', has('--screening-only') ? 20 : 5), screeningOnly: has('--screening-only'), syncWatchlist: !has('--no-sync') }));
        else if (subcommand === 'monitor')
            print(await monitorCandidatePool(market, integer('--limit', 12)));
        else if (subcommand === 'model-status')
            print(candidateModelStatus());
        else
            throw new Error('candidate 支持 refresh、monitor、model-status');
        return;
    }
    if (command === 'portfolio' && subcommand === 'status') {
        print(loadPortfolio());
        return;
    }
    if (command === 'watchlist') {
        if (subcommand === 'status')
            print(watchlistStatus());
        else if (subcommand === 'monitor')
            print(await monitorWatchlistBuyPoints(service(), value('--limit') ? integer('--limit', 40) : Number.MAX_SAFE_INTEGER));
        else if (subcommand === 'ack')
            print(acknowledgeWatchlistSignals());
        else
            throw new Error('watchlist 支持 status、monitor、ack');
        return;
    }
    if (command === 'notify') {
        if (subcommand === 'configure-feishu') {
            configureFeishu({
                receiverType: has('--chat-id') ? 'chat_id' : 'user_id',
                receiverId: value('--chat-id') ?? requireValue('--user-id'),
                identity: (value('--identity') ?? 'bot'),
                cliPath: value('--cli-path'),
                duplicateWindowMinutes: integer('--duplicate-window-minutes', 60),
            });
            print(notificationStatus());
        }
        else if (subcommand === 'status')
            print(notificationStatus());
        else if (subcommand === 'feishu') {
            const payload = value('--payload')
                ? readJson(resolve(requireValue('--payload')))
                : {
                    mode: value('--mode') ?? 'interactive',
                    severity: value('--severity') ?? 'info',
                    title: requireValue('--title'),
                    summary: requireValue('--summary'),
                    action: value('--action'),
                    detail: value('--detail'),
                    blockers: (value('--blockers') ?? '').split('|').filter(Boolean),
                    next_check: value('--next-check'),
                    data_time: value('--data-time'),
                    fingerprint: value('--fingerprint'),
                };
            print(sendFeishuNotification(payload, has('--dry-run')));
        }
        else
            throw new Error('notify 支持 configure-feishu、status、feishu');
        return;
    }
    if (command === 'goal' && subcommand === 'status') {
        print(evaluateGoal());
        return;
    }
    if (command === 'analyze') {
        const evidencePath = value('--evidence');
        const evidence = evidencePath
            ? readJson(resolve(evidencePath))
            : await service().evidence(requireValue('--code'), (value('--period') ?? '1d'), Number(value('--limit') ?? 180));
        print(analyzeEvidence(evidence));
        return;
    }
    if (command === 'automation' && subcommand === 'plan') {
        const custom = (value('--modes') ?? '').split(',').filter(Boolean);
        print(planAutomation(value('--preset') ?? 'standard', custom));
        return;
    }
    if (command === 'automation' && subcommand === 'sync-defaults') {
        print(syncDefaultAutomations());
        return;
    }
    if (command === 'migrate' && subcommand === 'legacy-mmm') {
        print(migrateLegacyMmm(requireValue('--source'), value('--case-source')));
        return;
    }
    if (command === 'refine') {
        if (value('--candidate'))
            print(validateAndPromote(readJson(resolve(requireValue('--candidate')))));
        else if (value('--monitor'))
            print(monitorAndRollback(readJson(resolve(requireValue('--monitor')))));
        else
            throw new Error('refine 需要 --candidate 或 --monitor');
        return;
    }
    if (command === 'evolve') {
        if (value('--candidate'))
            print(captureAndEvolve(readJson(resolve(requireValue('--candidate')))));
        else if (value('--monitor'))
            print(monitorEvolution(readJson(resolve(requireValue('--monitor')))));
        else if (subcommand === 'status')
            print(evolutionStatus());
        else
            throw new Error('evolve 支持 --candidate、--monitor 或 status');
        return;
    }
    throw new Error('用法：trade-master <init|doctor|market|cache|plan|replay|screen|candidate|portfolio|watchlist|notify|goal|analyze|automation|migrate|refine|evolve>');
}
main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
});
