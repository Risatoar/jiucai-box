const round = (value) => Math.round(value * 100) / 100;

function normalizedLots(state) {
    if (Array.isArray(state.sold_lots))
        return state.sold_lots.map((item) => ({ ...item, quantity: round(Number(item.quantity) || 0) })).filter((item) => item.quantity > 0);
    const sold = Math.max(0, Math.min(1, Number(state.sold) || 0));
    if (!sold)
        return [];
    return [{
        price: Number(state.last_sell_price) || null,
        strategy: state.last_sell_strategy ?? null,
        date: state.last_sell_date ?? null,
        quantity: sold,
    }];
}

function withLatestSell(state, lots) {
    const latest = lots.at(-1);
    return {
        ...state,
        sold_lots: lots,
        last_sell_price: latest?.price ?? null,
        last_sell_strategy: latest?.strategy ?? null,
        last_sell_date: latest?.date ?? null,
    };
}

export function applyDecisionTransition(guidance, signal, state) {
    const held = Math.max(0, Math.min(1, Number(state.held) || 0));
    const sold = Math.max(0, Math.min(1, Number(state.sold) || 0));
    const lots = normalizedLots(state);
    if (signal.side === 'sell') {
        const fullExit = guidance.state === 'full_exit_ready';
        const quantity = fullExit ? held : Math.min(0.5, Math.max(0, held - 0.5));
        if (quantity <= 0)
            return null;
        const nextHeld = round(held - quantity);
        const nextSold = round(Math.min(1, sold + quantity));
        const nextLots = [...lots, {
            price: Number(signal.price) || null,
            strategy: signal.strategy ?? null,
            date: String(signal.time ?? '').slice(0, 10) || null,
            quantity,
        }];
        return {
            next_state: withLatestSell({
                held: nextHeld,
                sold: nextSold,
            }, nextLots),
            position_before: held,
            position_after: nextHeld,
            sold_capacity_after: nextSold,
            action_fraction: quantity,
            matched_sell_lots: [],
        };
    }
    const quantity = Math.min(0.5, sold, Math.max(0, 1 - held));
    if (quantity <= 0)
        return null;
    let remaining = quantity;
    const nextLots = lots.map((item) => ({ ...item }));
    const matchedSellLots = [];
    while (remaining > 0 && nextLots.length) {
        const lot = nextLots.at(-1);
        const matchedQuantity = Math.min(remaining, lot.quantity);
        matchedSellLots.push({ ...lot, quantity: round(matchedQuantity) });
        lot.quantity = round(lot.quantity - matchedQuantity);
        remaining = round(remaining - matchedQuantity);
        if (lot.quantity <= 0)
            nextLots.pop();
    }
    const nextHeld = round(held + quantity);
    const nextSold = round(Math.max(0, sold - quantity));
    return {
        next_state: withLatestSell({
            held: nextHeld,
            sold: nextSold,
        }, nextLots),
        position_before: held,
        position_after: nextHeld,
        sold_capacity_after: nextSold,
        action_fraction: quantity,
        matched_sell_lots: matchedSellLots,
    };
}
