import { join } from 'node:path';
import { evaluateGoal } from './goal.js';
import { generateStrategySignals } from './strategy-engine.js';
import { loadConfig, loadPortfolio, readJson, tradeMasterHome } from './storage.js';
const CLOSED_WATCH_STATUSES = new Set(['closed', 'closed_case', 'removed', 'archived']);
function shanghaiDate(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
}
function independentExit(signal) {
    return signal.side === 'sell' && signal.kState === 'closed' && signal.level !== 'watch'
        && signal.strategy !== 'legacy_fusion_nine_turn';
}
async function analyzeItem(market, instrument, position, date, asOf) {
    const [quotes, dailyResult, minuteResult] = await Promise.all([
        market.quotes(instrument.code),
        market.bars(instrument.code, '1d', 180, { end: asOf, asOf }).then((value) => ({ value, error: null })).catch((error) => ({ value: null, error })),
        market.bars(instrument.code, '1m', 500, { start: `${date}T09:30:00+08:00`, end: asOf, asOf }).then((value) => ({ value, error: null })).catch((error) => ({ value: null, error })),
    ]);
    try {
        const dailyBars = dailyResult.value?.bars ?? [];
        const todayBars = (minuteResult.value?.bars ?? []).filter((bar) => bar.time.startsWith(date));
        const engine = generateStrategySignals(instrument.type, todayBars, dailyBars);
        const latestSignals = engine.signals.slice(-12);
        const exits = latestSignals.filter(independentExit);
        const entries = latestSignals.filter((item) => item.side === 'buy' && item.kState === 'closed' && item.level !== 'watch');
        return {
            instrument,
            position,
            quote: quotes.quotes[0] ?? null,
            quote_sources: quotes.quotes.map((item) => item.source),
            quote_errors: quotes.errors,
            market_state: {
                latest_bar: todayBars.at(-1)?.time ?? dailyBars.at(-1)?.time ?? null,
                intraday_bars: todayBars.length,
                daily_trend: engine.daily_trend,
            },
            latest_signals: latestSignals,
            strategy_view: exits.length > 0 ? '持仓出现独立退出结构，进入风险复核' : entries.length > 0 ? '出现确认买点，但仍受账户和纪律闸门约束' : '没有新的确认动作',
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
            quote: quotes.quotes[0] ?? null,
            quote_sources: quotes.quotes.map((item) => item.source),
            market_state: { latest_bar: null, intraday_bars: 0, daily_trend: 'unknown' },
            latest_signals: [],
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
    const goal = evaluateGoal();
    const activePositions = portfolio.positions.filter((item) => item.status === 'confirmed' && item.quantity > 0);
    const instruments = new Map();
    for (const position of activePositions) {
        instruments.set(position.instrument.code, {
            instrument: { ...position.instrument, quoteId: `${position.instrument.exchange === 'SH' ? 1 : 0}.${position.instrument.code}` },
            position,
        });
    }
    if (discipline.state !== 'STOPPED' && discipline.state !== 'COOLDOWN') {
        for (const item of watchlist.instruments ?? []) {
            if (CLOSED_WATCH_STATUSES.has(item.status) || instruments.has(item.code))
                continue;
            instruments.set(item.code, { instrument: item, position: null });
        }
    }
    const analyses = await Promise.all([...instruments.values()].map((item) => analyzeItem(market, item.instrument, item.position, date, asOf)));
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
    const action = discipline.state === 'STOPPED'
        ? '今日停手'
        : discipline.state === 'COOLDOWN'
            ? '继续观察'
            : analyses.some((item) => item.latest_signals.some(independentExit))
                ? '风险预警'
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
                : '先等待闭合K线和独立证据，质量不足时保留现金。',
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
            up: '持仓上涨时只按品种策略保护利润；STOPPED期间不因强势追买。',
            range: '无确认信号时不制造交易；做T必须先通过费用、可用数量和现金闸门。',
            down: '优先识别完整闭合破位与反抽失败；模型虚拟退出不能直接替代真实持仓决策。',
        },
        next_check: staleAvailability.length > 0 || portfolio.cash == null || portfolio.total_asset == null
            ? '先刷新券商持仓、可用、冻结、现金和委托成交事实'
            : '下一根闭合K线或账户事实变化',
        cache: market.cacheStatus(),
        disclaimer: '仅用于决策辅助，不保证盈利，不连接或操作券商账户。',
    };
}
