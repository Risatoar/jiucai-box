const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveValues = (...values) => values.map((value) => finite(value, NaN))
    .filter((value) => Number.isFinite(value) && value > 0);

const stricterMaximum = (...values) => {
    const usable = positiveValues(...values);
    return usable.length ? Math.min(...usable) : null;
};

const stricterMinimum = (...values) => {
    const usable = positiveValues(...values);
    return usable.length ? Math.max(...usable) : null;
};

export function buildEffectiveCandidateGoals(goals = {}, discipline = {}) {
    const configured = goals.constraints ?? {};
    const operating = discipline.latest_recovery_review?.operating_limits ?? {};
    const maxGrossExposure = stricterMaximum(
        configured.max_gross_exposure_ratio,
        operating.max_gross_exposure_ratio,
    );
    const maxDailyTrades = stricterMaximum(configured.max_daily_trades, operating.max_daily_trades);
    const minimumCashBuffer = stricterMinimum(configured.minimum_cash_buffer, operating.minimum_cash_buffer);
    const singleTradeRisk = stricterMaximum(configured.single_trade_risk_amount, operating.single_trade_risk_amount);
    return {
        ...goals,
        constraints: {
            ...configured,
            ...(maxGrossExposure != null && { max_gross_exposure_ratio: maxGrossExposure }),
            ...(maxDailyTrades != null && { max_daily_trades: Math.floor(maxDailyTrades) }),
            ...(minimumCashBuffer != null && { minimum_cash_buffer: minimumCashBuffer }),
            ...(singleTradeRisk != null && { single_trade_risk_amount: singleTradeRisk }),
            constraint_policy: 'goals_and_discipline_stricter_value',
        },
        effective_constraint_sources: {
            goals_updated_at: goals.updated_at ?? null,
            discipline_updated_at: discipline.updated_at ?? null,
            discipline_operating_limits_applied: Object.keys(operating).length > 0,
        },
    };
}

const LOT_SIZE = {
    stock: 100,
    etf: 100,
    cbond: 10,
};

export function assessCandidateAffordability(candidate, goalProfile = {}) {
    const lotSize = LOT_SIZE[candidate.type] ?? 1;
    const minimumLotNotional = finite(candidate.price) * lotSize;
    const preferredAllocation = finite(goalProfile.allocation_per_position);
    const positionCapacity = finite(goalProfile.exposure_capacity, preferredAllocation);
    const riskBudget = finite(goalProfile.single_trade_risk_amount);
    const sessionLow = finite(candidate.session_low, NaN);
    const minimumLotRisk = Number.isFinite(sessionLow) && sessionLow > 0
        ? Math.max(0, finite(candidate.price) - sessionLow) * lotSize
        : null;
    if (!goalProfile.active || !(positionCapacity > 0)) {
        return {
            eligible: true,
            status: 'not_enforced',
            lot_size: lotSize,
            minimum_lot_notional: Number(minimumLotNotional.toFixed(2)),
            minimum_lot_risk: minimumLotRisk == null ? null : Number(minimumLotRisk.toFixed(2)),
            single_trade_risk_amount: riskBudget || null,
            allocation_per_position: null,
            coverage_ratio: null,
            reason: '资金目标未启用，最小交易单位只展示不作为候选门槛',
        };
    }
    const notionalEligible = minimumLotNotional > 0 && minimumLotNotional <= positionCapacity;
    const riskEligible = !(riskBudget > 0) || minimumLotRisk == null || minimumLotRisk <= riskBudget;
    const eligible = notionalEligible && riskEligible;
    const coverageRatio = minimumLotNotional > 0 ? positionCapacity / minimumLotNotional : 0;
    return {
        eligible,
        status: 'enforced',
        lot_size: lotSize,
        minimum_lot_notional: Number(minimumLotNotional.toFixed(2)),
        minimum_lot_risk: minimumLotRisk == null ? null : Number(minimumLotRisk.toFixed(2)),
        single_trade_risk_amount: riskBudget || null,
        notional_eligible: notionalEligible,
        risk_budget_eligible: riskEligible,
        allocation_per_position: Number(preferredAllocation.toFixed(2)),
        position_capacity: Number(positionCapacity.toFixed(2)),
        coverage_ratio: Number(coverageRatio.toFixed(4)),
        reason: !notionalEligible
            ? `最小交易单位约 ${minimumLotNotional.toFixed(2)} 元，超过当前可用仓位上限 ${positionCapacity.toFixed(2)} 元`
            : !riskEligible
                ? `按当日低点失效计算，最小交易单位风险约 ${minimumLotRisk.toFixed(2)} 元，超过单笔风险预算 ${riskBudget.toFixed(2)} 元`
                : `当前可用仓位和单笔风险预算均可覆盖最小交易单位，资金覆盖倍数 ${coverageRatio.toFixed(2)}`,
    };
}
