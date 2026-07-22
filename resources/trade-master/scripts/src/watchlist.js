import { join } from 'node:path';
import { loadPortfolio, readJson, tradeMasterHome } from './storage.js';
const CLOSED = new Set(['closed', 'closed_case', 'removed', 'archived']);
export function watchlistStatus() {
    const watchlist = readJson(join(tradeMasterHome(), 'watchlist.json'));
    const portfolio = loadPortfolio();
    const held = new Map(portfolio.positions
        .filter((item) => item.status === 'confirmed' && item.quantity > 0)
        .map((item) => [item.instrument.code, item]));
    const current = [];
    const closed = [];
    for (const item of watchlist.instruments ?? []) {
        if (CLOSED.has(item.status ?? '')) {
            closed.push(item);
            continue;
        }
        const position = held.get(item.code);
        current.push({
            ...item,
            relation: position ? 'holding_and_watching' : 'watching',
            confirmed_quantity: position?.quantity ?? 0,
        });
    }
    for (const position of held.values()) {
        if (current.some((item) => item.code === position.instrument.code))
            continue;
        current.push({
            ...position.instrument,
            status: 'holding',
            source: 'portfolio_confirmed',
            relation: 'holding_not_explicitly_watched',
            confirmed_quantity: position.quantity,
        });
    }
    const byType = (type) => current.filter((item) => item.type === type);
    return {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        watchlist_updated_at: watchlist.updated_at ?? null,
        current: {
            stocks: byType('stock'),
            etfs: byType('etf'),
            cbonds: byType('cbond'),
            unknown: byType('unknown'),
        },
        current_count: current.length,
        closed_or_archived: closed,
        rule: 'current排除closed_case/removed/archived；确认持仓即使未显式关注也单列，避免漏掉风险管理对象',
    };
}
