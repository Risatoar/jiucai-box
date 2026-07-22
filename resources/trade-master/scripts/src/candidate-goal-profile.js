const DEFAULT_ROUND_TRIP_COST_PERCENT = {
    stock: 0.30,
    etf: 0.20,
    cbond: 0.15,
};

const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const round = (value, digits = 4) => {
    const scale = 10 ** digits;
    return Math.round(finite(value) * scale) / scale;
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, finite(value)));

const inactiveProfile = (reason, goals, profile) => ({
    active: false,
    source: 'user_settings',
    reason,
    target_return_percent: finite(goals?.target_return, finite(profile?.targetReturn) / 100) * 100,
    target_date: goals?.target_date ?? null,
    max_drawdown_percent: finite(goals?.max_drawdown, finite(profile?.maxDrawdown) / 100) * 100 || null,
});

function calendarDaysBetween(from, to) {
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
        return null;
    return Math.max(0, (end.getTime() - start.getTime()) / 86_400_000);
}

function roundTripCosts(goals, allocationPerPosition) {
    const transactionCosts = goals?.transaction_costs ?? {};
    const minimumPerOrder = finite(transactionCosts.commission_min_per_order, NaN);
    const confirmedMinimum = transactionCosts.status === 'user_confirmed' && Number.isFinite(minimumPerOrder) && allocationPerPosition > 0
        ? minimumPerOrder * 2 / allocationPerPosition * 100
        : null;
    return {
        stock: round(confirmedMinimum ?? DEFAULT_ROUND_TRIP_COST_PERCENT.stock),
        etf: round(confirmedMinimum ?? DEFAULT_ROUND_TRIP_COST_PERCENT.etf),
        cbond: DEFAULT_ROUND_TRIP_COST_PERCENT.cbond,
    };
}

export function buildCandidateGoalProfile(goals = {}, profile = {}, asOf = new Date().toISOString()) {
    if (goals.status !== 'active')
        return inactiveProfile('盈利目标尚未启用', goals, profile);
    const currentAsset = finite(goals.current_asset, finite(profile.capital, NaN));
    const targetAsset = finite(goals.target_asset, currentAsset > 0 ? currentAsset * (1 + finite(goals.target_return, finite(profile.targetReturn) / 100)) : NaN);
    const targetDate = goals.target_date;
    const calendarDays = calendarDaysBetween(asOf, targetDate);
    if (!(currentAsset > 0) || !(targetAsset > currentAsset) || !(calendarDays > 0))
        return inactiveProfile('盈利目标缺少有效的当前资产、目标资产或期限', goals, profile);
    const remainingTradingDays = Math.max(1, Math.round(calendarDays * 5 / 7));
    const requiredPortfolioReturn20d = (Math.pow(targetAsset / currentAsset, 20 / remainingTradingDays) - 1) * 100;
    const constraints = goals.constraints ?? {};
    const exposureRatio = clamp(constraints.max_gross_exposure_ratio ?? 1, 0.1, 1);
    const maxPositions = Math.max(1, Math.round(finite(constraints.max_positions, 1)));
    const allocationPerPosition = currentAsset * exposureRatio / maxPositions;
    const costs = roundTripCosts(goals, allocationPerPosition);
    const requiredNetReturn20d = requiredPortfolioReturn20d / exposureRatio;
    const requiredGrossByType = Object.fromEntries(Object.entries(costs).map(([type, cost]) => [
        type,
        round(((1 + requiredNetReturn20d / 100) * (1 + cost / 100) - 1) * 100, 2),
    ]));
    const maxDrawdownPercent = finite(goals.max_drawdown, finite(profile.maxDrawdown) / 100) * 100;
    const maxInstrumentDrawdownBudget = maxDrawdownPercent > 0 ? maxDrawdownPercent / exposureRatio : null;
    return {
        active: true,
        source: 'user_settings',
        current_asset: currentAsset,
        target_asset: targetAsset,
        target_return_percent: round((targetAsset / currentAsset - 1) * 100, 2),
        target_date: targetDate,
        remaining_trading_days_estimate: remainingTradingDays,
        required_portfolio_return_20d_percent: round(requiredPortfolioReturn20d, 2),
        max_gross_exposure_ratio: exposureRatio,
        max_positions: maxPositions,
        allocation_per_position: round(allocationPerPosition, 2),
        round_trip_cost_percent: costs,
        required_instrument_return_20d_percent: requiredGrossByType,
        max_drawdown_percent: round(maxDrawdownPercent, 2),
        max_instrument_drawdown_budget_percent: maxInstrumentDrawdownBudget == null ? null : round(maxInstrumentDrawdownBudget, 2),
        pressure: requiredNetReturn20d > Math.max(3, maxDrawdownPercent) ? 'aggressive' : 'normal',
        guardrail: '盈利目标只提高机会空间门槛，不得放宽最大回撤、仓位、追涨或交易频率约束',
    };
}
