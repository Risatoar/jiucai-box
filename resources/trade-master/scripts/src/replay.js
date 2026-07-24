import { generateStrategySignals } from './strategy-engine.js';
import { loadActiveDecisionPolicy } from './strategy-policy.js';
import { inferInstrument } from './providers.js';
import { loadPortfolio } from './storage.js';
function compactPoint(item) {
    return {
        time: item.time,
        side: item.side,
        level: item.level,
        strategy: item.strategy,
        evidence_cluster: item.evidenceCluster,
        period: item.period,
        k_state: item.kState,
        price: item.price,
        confidence: item.confidence,
        reasons: item.reasons,
        invalidation: item.invalidation ?? null,
        virtual_entry_id: item.virtualEntryId ?? null,
    };
}
export async function replayPoints(market, code, date, asOf = `${date}T15:00:00+08:00`) {
    const portfolio = loadPortfolio();
    const stored = portfolio.positions.find((item) => item.instrument.code === code);
    let instrument = stored?.instrument ?? inferInstrument(code);
    try {
        const info = await market.info(code);
        instrument = { code: info.code, name: info.name, type: info.type, exchange: info.exchange };
    }
    catch {
        // 历史回放仍可使用代码推断；身份缺口会在 data_quality 中披露。
    }
    const start = `${date}T00:00:00+08:00`;
    const [intraday, daily] = await Promise.all([
        market.bars(code, '1m', 500, { start, end: asOf, asOf }),
        market.bars(code, '1d', 180, { end: `${date}T09:25:00+08:00`, asOf: `${date}T09:25:00+08:00` }),
    ]);
    const engine = generateStrategySignals(instrument.type, intraday.bars, daily.bars, {
        decisionPolicy: loadActiveDecisionPolicy(),
    });
    const actionable = engine.signals.filter((item) => item.level === 'confirm' || item.level === 'actionable');
    const observations = engine.signals.filter((item) => item.level === 'watch');
    const sourceEvents = portfolio.positions.flatMap((position) => position.sources ?? []).filter((event) => {
        const eventCode = String(event.instrument?.code ?? event.event_id ?? event.note ?? '');
        const eventTime = String(event.occurred_at ?? event.submitted_at ?? event.cancelled_at ?? '');
        const note = String(event.note ?? '');
        return eventCode.includes(code) && eventTime.startsWith(date)
            && /(成交|明确确认已在|确认.*(?:买入|卖出))/.test(note);
    });
    const orderEvents = (portfolio.historical_order_events ?? []).filter((event) => {
        const eventCode = String(event.instrument?.code ?? event.event_id ?? '');
        const eventTime = String(event.submitted_at ?? event.cancelled_at ?? '');
        return eventCode.includes(code) && eventTime.startsWith(date);
    });
    const actualOperations = [
        ...sourceEvents.map((event) => ({ ...event, operation_kind: 'confirmed_fill' })),
        ...orderEvents.map((event) => ({
            ...event,
            operation_kind: Number(event.confirmed_filled_quantity ?? 0) > 0 ? 'confirmed_fill' : String(event.status ?? '').includes('cancel') ? 'cancelled_order' : 'order_event',
        })),
    ];
    return {
        schema_version: 1,
        mode: 'historical_point_replay',
        generated_at: new Date().toISOString(),
        replay: {
            code,
            name: instrument.name,
            type: instrument.type,
            date,
            as_of: asOf,
            daily_context_cutoff: `${date}T09:25:00+08:00`,
            no_lookahead: true,
        },
        data_quality: {
            intraday_source: intraday.source,
            intraday_bars: intraday.bars.length,
            latest_intraday_bar: intraday.bars.at(-1)?.time ?? null,
            daily_source: daily.source,
            daily_bars: daily.bars.length,
            latest_daily_bar: daily.bars.at(-1)?.time ?? null,
            provider_errors: [...intraday.errors, ...daily.errors],
            account_context: '当前账本只用于列出已确认实际操作，不倒灌为历史市场信号',
        },
        context: {
            daily_trend: engine.daily_trend,
            evidence_clusters: engine.evidence_clusters,
            decision_policy_id: engine.decision_policy_id,
        },
        confirmed_points: actionable.map(compactPoint),
        watch_points: observations.map(compactPoint),
        actual_operations: actualOperations,
        interpretation: {
            market_point_is_not_account_action: true,
            forming_never_confirmed: engine.signals.every((item) => item.kState !== 'forming' || item.level === 'watch'),
            model_exit_requires_matching_virtual_entry: true,
        },
        disclaimer: '历史买卖点用于策略审计，不代表当时一定可成交，也不能用未来走势倒推规则正确。',
    };
}
