import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_ROOT, readJson, tradeMasterHome, writeJson } from './storage.js';
const MINIMAL = new Set(['pre_market', 'post_market']);
const INTRADAY_CONTRACT_MARKER = '系统新增盘中双通道约束：';
function taskPrompt(mode) {
    const base = `使用 $trade-master，mode=${mode}，home=~/.trade-master。先读取 evolution/active.json，再严格按 Skill 契约运行；不得操作券商。`;
    if (mode === 'candidate_refresh') {
        return `${base} 使用 candidate_model_v2。任务必须先扫描全部A股、ETF和可转债，并读取 profile.json、goals.json 与 runtime/candidate-pool.json。模型必须把设置中的盈利目标、目标期限、最大资金暴露、实际交易成本和最大回撤换算为标的20交易日收益空间与风险门槛；盈利目标只能提高候选质量，禁止放宽回撤、仓位、追涨或交易频率约束。关注候选也允许为0：candidates 只包含0到5个同时通过目标覆盖率、模型绝对分数、成本效率、日线趋势与风险门槛的标的；buy_ready_candidates 才是其中进一步满足完整5/15分钟闭合结构、独立量能和非追涨条件的人工复核候选。先说明本轮设置对应的目标收益空间，再列“本轮通过绝对门槛的关注候选”和“当前买入条件已满足”；任一列表为空时如实说明，不得为了凑5只降低标准。所有候选必须按单个标的聚合，每个证券使用“## 6位代码 名称”，并在该区块内连续写当前价和数据时间、模型排序依据、目标覆盖率、触发条件、失效条件、主要风险、下一检查点；禁止先列全部标的再按字段拆卡。model.validation_status 不是 validated 时，禁止使用“已验证高置信、高胜率”或给出胜率数字。不得输出本人或家庭账户的持仓、资金、成本、可用数量或减仓提醒；不得承诺盈利、不得自动下单。`;
    }
    if (mode === 'intraday') {
        return `${base} 盘中固定分两条通道。第一条“持仓策略”覆盖本人及已开启监控的家庭账户持仓，分别给出买入、持有、减仓或卖出策略；只有闭合5/15分钟K线和独立量价证据形成强烈买入或卖出信号时才提醒。涉及两个或更多账户时，每个账户必须使用独立二级标题“## 成员名 → 账户名”，并在标题下完整列出该账户的持仓、总数量、可用数量、策略、风险和下一检查点；不得跨账户合并成本、数量、现金或动作，同一证券存在于多个账户时也必须按账户分别生成策略卡。账户内按标的聚合，每个证券使用三级标题“### 6位代码 名称”，并把该标的的当前状态、策略、触发条件、失效条件、风险和下一检查点连续写在同一区块；非持仓候选直接使用二级证券标题，禁止按字段横跨多个标的拆卡。第二条“自选买点”覆盖非持仓关注列表中 source=user 的我的收藏和 source=agent 的AI发现，只检查高质量买点，不输出卖出策略；必须读取本次 watchlist monitor 证据，只在 new_buy_signals 新增或 invalidated_buy_signals 失效时提醒，重复 buy_ready 必须静默。主账户空仓时仍必须每轮完整扫描我的收藏和AI发现，优先寻找可以买入的标的，不能因为没有持仓就省略主账户。只要任一账户或任一自选标的有材料变化并生成回答，所有已启用监控的账户都必须输出；空仓账户固定写明现金状态、关注池扫描覆盖、新增或失效买点、阻断原因和下一检查点。自选新买点归入实际用于执行的主账户，策略卡写该 accountScope，并用 source=user/agent 区分来源。形成中的K线只能预览，不能触发动作。runtime/candidate-pool.json 与 candidate monitor 只用于补充AI候选模型状态，不能替代全量自选扫描。每个提醒写明代码名称、来源、当前价和数据时间、触发条件、失效条件、风险及下一检查点。账户、纪律、费用或现金安全垫不通过时，技术机会和执行阻断分开写；不得自动下单。两条通道都没有材料变化时只返回 NO_REPLY。`;
    }
    if (mode === 'voc_monitor') {
        return `${base} 只分析宿主提供的 newEvents。逐条保留账号、原始发布时间和链接，根据标题、口播、字幕、市场隐喻和上下文推测板块、情绪以及加仓、减仓、清仓或无明确动作；证据不够直接时标注“疑似”和中低置信度，不要因缺少交易执行证据而放弃方向推测。不需要交叉验证具体证券、真实账户持仓、实际成交、成交价格、成交量、K线、完整收盘走势、手续费或交易成本，也不要输出这些限制和待确认项。不要读取用户及家庭账户的交易记录，不要给出用户持仓调整、买卖建议或执行条件。先给新增结论，再给必要原句、反向情绪风险和原文链接。反向指标只能提高风险警惕，不能单独触发交易。newEvents 为空时必须只返回 NO_REPLY。`;
    }
    if (mode === 'midday_review') {
        return `${base} 这是工作日12:00午盘复盘。基于截至上午收盘的全市场广度、指数或代表性ETF走势、成交活跃度、异动候选池、本人及家庭持仓、纪律和待确认交易事实，总结上午盘面并给出下午辅助决策。固定按“上午结论、市场走势与异动、内外围消息影响、持仓与候选、下午操作建议、触发条件/失效条件、风险与下一检查点”输出。消息面只能使用本次证据中可核验且注明时间的信息；证据不足必须明确写“消息面证据待补”，不得编造。下午建议须说明什么情况下继续等、什么情况下人工复核、什么情况下放弃，禁止自动下单或声称成交。本任务应正常生成午盘摘要；只有上午行情证据整体不可用时才返回 NO_REPLY。`;
    }
    if (mode === 'automation_health') {
        return `${base} 只读核对自动化状态、目标任务是否存在、最近成功运行时间和交易窗口漏跑；有故障必须通知，没有变化返回 NO_REPLY。不得借健康修复放宽任何交易闸门。`;
    }
    return `${base} 无材料变化返回 NO_REPLY；有市场机会但执行被阻断时，分开报告机会、执行结论、阻断闸门和下一检查点。`;
}
function mergeIntradayPrompt(prompt) {
    const customPrompt = String(prompt ?? '').split(`\n\n${INTRADAY_CONTRACT_MARKER}`)[0].trim();
    return `${customPrompt}\n\n${INTRADAY_CONTRACT_MARKER}${taskPrompt('intraday')}`.trim();
}
export function planAutomation(preset, customModes = []) {
    const templates = JSON.parse(readFileSync(join(SKILL_ROOT, 'assets', 'automation-templates.json'), 'utf8'));
    const allowed = new Set(templates.tasks.map((item) => item.mode));
    const selected = preset === 'minimal'
        ? templates.tasks.filter((item) => MINIMAL.has(item.mode))
        : preset === 'standard'
            ? templates.tasks
            : preset === 'custom'
                ? templates.tasks.filter((item) => customModes.includes(item.mode))
                : [];
    if (!['minimal', 'standard', 'custom', 'none'].includes(preset))
        throw new Error(`未知 preset：${preset}`);
    const invalid = customModes.filter((mode) => !allowed.has(mode));
    if (invalid.length > 0)
        throw new Error(`未知 mode：${invalid.join(', ')}`);
    const manifest = {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        preset,
        timezone: templates.timezone,
        install_status: 'planned',
        install_rule: '只有当前 CodeAgent 提供原生自动化工具且用户明确同意后，才可逐项安装并回读验证',
        tasks: selected.map((task) => ({
            ...task,
            prompt: taskPrompt(task.mode),
        })),
    };
    writeJson(join(tradeMasterHome(), 'automation', 'manifest.json'), manifest);
    return manifest;
}
export function syncDefaultAutomations() {
    const path = join(tradeMasterHome(), 'automation', 'manifest.json');
    if (!existsSync(path))
        return planAutomation('standard');
    const current = readJson(path);
    const templates = JSON.parse(readFileSync(join(SKILL_ROOT, 'assets', 'automation-templates.json'), 'utf8'));
    const known = new Set((current.tasks ?? []).map((task) => task.id));
    const templateById = new Map(templates.tasks.map((task) => [task.id, task]));
    const localized = (current.tasks ?? []).map((task) => {
        const template = templateById.get(task.id);
        if (!template)
            return task;
        const title = String(task.title ?? '').trim();
        const description = String(task.description ?? '').trim();
        const candidatePromptNeedsUpgrade = task.id === 'candidate_refresh'
            && (!String(task.prompt ?? '').includes('关注候选也允许为0')
                || !String(task.prompt ?? '').includes('目标覆盖率')
                || !String(task.prompt ?? '').includes('按单个标的聚合'));
        const intradayPrompt = String(task.prompt ?? '');
        const intradayContractCount = intradayPrompt.split(INTRADAY_CONTRACT_MARKER).length - 1;
        const intradayPromptNeedsUpgrade = task.id === 'intraday'
            && (!intradayPrompt.includes('new_buy_signals')
                || !intradayPrompt.includes('## 成员名 → 账户名')
                || !intradayPrompt.includes('账户内按标的聚合')
                || !intradayPrompt.includes('空仓账户固定写明')
                || intradayContractCount > 1);
        const vocPromptNeedsUpgrade = task.id === 'voc_monitor'
            && !String(task.prompt ?? '').includes('不需要交叉验证具体证券');
        return {
            ...task,
            title: !title || title === task.id || title === task.mode ? template.title : task.title,
            description: !description || description === '按设定时间自动检查并提醒'
                || (task.id === 'candidate_refresh' && ['开盘期间持续扫描并动态更新可关注候选', '发掘最多5个低风险、高置信度买入观察机会，并更新AI推荐关注列表', '全市场筛选5个模型关注候选，并标出0至5个买入就绪标的', '全市场筛选0至5个合格关注候选，并标出买入就绪标的'].includes(description))
                || (task.id === 'intraday' && description === '持仓、关注品种或候选标的有重要变化时提醒你')
                || (task.id === 'pre_open_refresh' && description === '开盘前更新账户、行情和关注品种') ? template.description : task.description,
            prompt: candidatePromptNeedsUpgrade
                ? taskPrompt(task.mode)
                : intradayPromptNeedsUpgrade
                    ? mergeIntradayPrompt(task.prompt)
                    : vocPromptNeedsUpgrade
                        ? taskPrompt(task.mode)
                        : task.prompt,
            system_default: true,
        };
    });
    const missing = templates.tasks.filter((task) => !known.has(task.id)).map((task) => ({
        ...task,
        prompt: taskPrompt(task.mode),
        enabled: true,
        system_default: true,
    }));
    const localizedChanged = JSON.stringify(localized) !== JSON.stringify(current.tasks ?? []);
    if (!missing.length && !localizedChanged)
        return { ...current, synced: [], localized: [], changed: false };
    const manifest = {
        ...current,
        timezone: current.timezone ?? templates.timezone,
        updated_at: new Date().toISOString(),
        tasks: [...localized, ...missing],
    };
    writeJson(path, manifest);
    return { ...manifest, synced: missing.map((task) => task.id), localized: localizedChanged ? localized.filter((task, index) => JSON.stringify(task) !== JSON.stringify((current.tasks ?? [])[index])).map((task) => task.id) : [], changed: true };
}
