import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncDefaultAutomations } from './dist/automation.js';

const previousHome = process.env.TRADE_MASTER_HOME;

afterEach(() => {
    if (previousHome == null)
        delete process.env.TRADE_MASTER_HOME;
    else
        process.env.TRADE_MASTER_HOME = previousHome;
});

describe('automation default migration', () => {
    it('upgrades an existing intraday task to the two-lane monitoring contract', async () => {
        const home = await mkdtemp(join(tmpdir(), 'automation-sync-'));
        process.env.TRADE_MASTER_HOME = home;
        const automationHome = join(home, 'automation');
        await mkdir(automationHome, { recursive: true });
        await writeFile(join(automationHome, 'manifest.json'), JSON.stringify({
            schema_version: 1,
            timezone: 'Asia/Shanghai',
            tasks: [{
                id: 'intraday', mode: 'intraday', title: '盘中盯盘',
                description: '持仓、关注品种或候选标的有重要变化时提醒你',
                prompt: '旧盘中提示词', enabled: true,
            }],
        }));

        const synced = syncDefaultAutomations();
        const intraday = synced.tasks.find((task) => task.id === 'intraday');
        expect(intraday.description).toBe('监控持仓强买卖信号，并扫描我的收藏和AI发现的高质量买点');
        expect(intraday.prompt).toContain('new_buy_signals');
        expect(intraday.prompt).toContain('source=user');
        expect(intraday.prompt).toContain('source=agent');
        expect(intraday.prompt).toContain('## 成员名 → 账户名');
        expect(intraday.prompt).toContain('同一证券存在于多个账户时也必须按账户分别生成策略卡');
        expect(intraday.prompt).toContain('账户内按标的聚合');
        expect(intraday.prompt).toContain('空仓账户固定写明');
        expect(intraday.prompt).toContain('旧盘中提示词');
        expect(synced.localized).toContain('intraday');
    });

    it('upgrades a two-lane intraday task that still lacks account separation', async () => {
        const home = await mkdtemp(join(tmpdir(), 'automation-account-sync-'));
        process.env.TRADE_MASTER_HOME = home;
        const automationHome = join(home, 'automation');
        await mkdir(automationHome, { recursive: true });
        await writeFile(join(automationHome, 'manifest.json'), JSON.stringify({
            tasks: [{ id: 'intraday', mode: 'intraday', prompt: '已有 new_buy_signals、source=user、source=agent 双通道规则', enabled: true }],
        }));

        const synced = syncDefaultAutomations();
        const intraday = synced.tasks.find((task) => task.id === 'intraday');
        expect(intraday.prompt).toContain('已有 new_buy_signals');
        expect(intraday.prompt).toContain('## 成员名 → 账户名');
        expect(synced.localized).toContain('intraday');
    });

    it('collapses repeated intraday contracts while preserving custom priorities', async () => {
        const home = await mkdtemp(join(tmpdir(), 'automation-contract-dedupe-'));
        process.env.TRADE_MASTER_HOME = home;
        const automationHome = join(home, 'automation');
        await mkdir(automationHome, { recursive: true });
        await writeFile(join(automationHome, 'manifest.json'), JSON.stringify({
            tasks: [{
                id: 'intraday', mode: 'intraday', enabled: true,
                prompt: '300438鹏辉能源是老婆账户唯一最高优先级关注标的。\n\n系统新增盘中双通道约束：旧规则 new_buy_signals\n\n系统新增盘中双通道约束：新版规则 new_buy_signals ## 成员名 → 账户名',
            }],
        }));

        const synced = syncDefaultAutomations();
        const intraday = synced.tasks.find((task) => task.id === 'intraday');
        expect(intraday.prompt).toContain('300438鹏辉能源是老婆账户唯一最高优先级关注标的');
        expect(intraday.prompt.match(/系统新增盘中双通道约束：/g)).toHaveLength(1);
        expect(intraday.prompt).toContain('## 成员名 → 账户名');
        expect(synced.localized).toContain('intraday');
    });

    it('upgrades candidate output to one continuous block per instrument', async () => {
        const home = await mkdtemp(join(tmpdir(), 'automation-candidate-grouping-'));
        process.env.TRADE_MASTER_HOME = home;
        const automationHome = join(home, 'automation');
        await mkdir(automationHome, { recursive: true });
        await writeFile(join(automationHome, 'manifest.json'), JSON.stringify({
            tasks: [{
                id: 'candidate_refresh', mode: 'candidate_refresh', enabled: true,
                prompt: '已有关注候选也允许为0和目标覆盖率，但仍按字段拆卡。',
            }],
        }));

        const synced = syncDefaultAutomations();
        const candidate = synced.tasks.find((task) => task.id === 'candidate_refresh');
        expect(candidate.prompt).toContain('所有候选必须按单个标的聚合');
        expect(candidate.prompt).toContain('禁止先列全部标的再按字段拆卡');
        expect(synced.localized).toContain('candidate_refresh');
    });
});
