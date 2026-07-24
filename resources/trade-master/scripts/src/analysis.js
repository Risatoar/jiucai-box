import { join } from 'node:path';
import { summarizeIndicators } from './indicators.js';
import { evaluateGoal } from './goal.js';
import { loadConfig, loadPortfolio, readJson, tradeMasterHome } from './storage.js';
function lotsFor(type) {
    return type === 'cbond' ? 10 : 100;
}
function suggestedQuantity(position, instrumentType, price, totalAsset, cash, maxRatio) {
    if (position)
        return position.available_quantity;
    if (totalAsset == null || cash == null || price <= 0)
        return null;
    const lot = lotsFor(instrumentType);
    const budget = Math.min(cash, totalAsset * maxRatio);
    return Math.floor(budget / price / lot) * lot;
}
function nonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function money(value) {
    return value == null ? null : Number(value.toFixed(2));
}
function estimateCommission(notional, policy) {
    const minimum = nonNegative(policy.commission_min_per_order);
    const rate = nonNegative(policy.commission_rate);
    if (minimum == null && rate == null)
        return null;
    return Math.max(minimum ?? 0, notional * (rate ?? 0));
}
function estimateCostGate(type, price, quantity, atr, policy) {
    const scope = `live_${type}`;
    const scopeMatches = policy?.applicable_scope?.includes(scope) ?? false;
    const notional = quantity != null && quantity > 0 ? price * quantity : null;
    const unknown = [];
    if (!policy || !scopeMatches) {
        return {
            status: 'missing',
            scope,
            source: null,
            notional: money(notional),
            estimated_buy_cost: null,
            estimated_sell_cost: null,
            estimated_round_trip_cost: null,
            expected_gross_benefit: null,
            expected_net_benefit: null,
            cost_benefit_ratio: null,
            minimum_net_benefit: null,
            unknown_components: ['适用品种的交易费用配置'],
            passed: false,
            reason: '缺少适用品种的交易费用事实，未知成本不能按 0 处理',
        };
    }
    const commissionMinimum = nonNegative(policy.commission_min_per_order);
    const commissionRate = nonNegative(policy.commission_rate);
    const sellTaxRate = nonNegative(policy.sell_tax_rate);
    const transferFeeRate = nonNegative(policy.transfer_fee_rate);
    const otherFee = nonNegative(policy.other_fee_per_order);
    const slippageRate = nonNegative(policy.slippage_buffer_rate);
    const minimumNetBenefit = nonNegative(policy.minimum_net_benefit);
    if (commissionMinimum == null && commissionRate == null)
        unknown.push('佣金');
    if (slippageRate == null)
        unknown.push('滑点/价差缓冲');
    if (otherFee == null)
        unknown.push('其他适用规费');
    if (minimumNetBenefit == null)
        unknown.push('最低净收益门槛');
    if (type === 'stock' && sellTaxRate == null)
        unknown.push('股票卖出税费');
    if (type === 'stock' && transferFeeRate == null)
        unknown.push('股票过户等费率');
    if (notional == null)
        unknown.push('实际交易金额');
    if (atr == null)
        unknown.push('预期价差');
    const commission = notional == null ? null : estimateCommission(notional, policy);
    const knownOtherFee = otherFee ?? 0;
    const knownTransferFee = notional == null ? 0 : notional * (transferFeeRate ?? 0);
    const knownSlippage = notional == null ? 0 : notional * (slippageRate ?? 0);
    const buyCost = commission == null ? null : commission + knownOtherFee + knownTransferFee + knownSlippage;
    const sellTax = notional == null ? 0 : notional * (sellTaxRate ?? 0);
    const sellCost = commission == null ? null : commission + knownOtherFee + knownTransferFee + knownSlippage + sellTax;
    const roundTripCost = buyCost == null || sellCost == null ? null : buyCost + sellCost;
    const grossBenefit = quantity != null && atr != null ? atr * 0.3 * quantity : null;
    const netBenefit = grossBenefit == null || roundTripCost == null ? null : grossBenefit - roundTripCost;
    const costBenefitRatio = grossBenefit != null && grossBenefit > 0 && roundTripCost != null
        ? Number((roundTripCost / grossBenefit).toFixed(4))
        : null;
    const status = unknown.length === 0 ? 'configured' : 'partial';
    const passed = status === 'configured'
        && netBenefit != null
        && minimumNetBenefit != null
        && netBenefit >= minimumNetBenefit;
    const reason = status === 'partial'
        ? `交易成本事实不完整：${unknown.join('、')}`
        : netBenefit == null
            ? '无法验证扣费后的预期净收益'
            : passed
                ? '扣除预计交易成本后达到最低净收益门槛'
                : '扣除预计交易成本后未达到最低净收益门槛';
    return {
        status,
        scope,
        source: policy.source ?? policy.status ?? null,
        confirmed_at: policy.confirmed_at ?? null,
        notional: money(notional),
        estimated_buy_cost: money(buyCost),
        estimated_sell_cost: money(sellCost),
        estimated_round_trip_cost: money(roundTripCost),
        expected_gross_benefit: money(grossBenefit),
        expected_net_benefit: money(netBenefit),
        cost_benefit_ratio: costBenefitRatio,
        minimum_net_benefit: minimumNetBenefit,
        unknown_components: unknown,
        passed,
        reason,
    };
}
export function analyzeEvidence(evidence) {
    const config = loadConfig();
    const portfolio = loadPortfolio();
    const discipline = readJson(join(tradeMasterHome(), 'discipline.json'));
    const strategyProfile = readJson(join(tradeMasterHome(), 'strategy-profile.json'));
    const goal = evaluateGoal();
    const indicators = summarizeIndicators(evidence.bars);
    const quote = evidence.quotes[0];
    const position = portfolio.positions.find((item) => item.instrument.code === evidence.instrument.code && item.status === 'confirmed');
    const latestBar = evidence.bars.at(-1);
    const blockers = [...evidence.market_state.reasons];
    if (portfolio.conflicts.length > 0)
        blockers.push('确认账本存在未解决冲突');
    if (discipline.state === 'COOLDOWN')
        blockers.push('纪律状态为 COOLDOWN，禁止新开仓');
    if (discipline.state === 'STOPPED')
        blockers.push('纪律状态为 STOPPED，只允许减风险和复盘');
    if (latestBar?.closed === false)
        blockers.push('最新 K 线尚未闭合');
    const profitRatio = position?.average_cost && quote
        ? (quote.price - position.average_cost) / position.average_cost
        : null;
    const goalBlocksNewRisk = ['defensive', 'renegotiate_goal'].includes(goal.risk_mode);
    if (goalBlocksNewRisk)
        blockers.push('目标路径要求防守或重新协商，禁止用新增风险追赶收益');
    let action = '继续观察';
    const reasons = [];
    if (discipline.state === 'STOPPED') {
        action = '今日停手';
        reasons.push('纪律闸门禁止新增交易');
    }
    else if (evidence.market_state.stale || evidence.market_state.conflict) {
        action = '风险预警';
        reasons.push('行情证据未通过数据闸门');
    }
    else if (!evidence.market_state.verified || latestBar?.closed === false) {
        action = '继续观察';
        reasons.push('证据不足以形成精确买卖点');
    }
    else if (position) {
        if (indicators.trend === 'down' && indicators.ma20 != null && quote.price < indicators.ma20) {
            action = '观察·下跌';
            reasons.push('持仓价格低于 MA20 且趋势向下，等待品种 playbook 的确认条件');
        }
        else if (profitRatio != null && profitRatio > 0.05 && (indicators.rsi14 ?? 0) >= 75) {
            action = '观察·下跌';
            reasons.push('已有利润且 RSI 偏热，进入分批保护观察');
        }
        else {
            reasons.push('持仓尚未出现独立确认退出结构');
        }
    }
    else if (!goalBlocksNewRisk && discipline.state !== 'COOLDOWN' && indicators.trend === 'up' && (indicators.rsi14 ?? 100) < 70) {
        action = '观察·上涨';
        reasons.push('趋势向上且未过热，仍需市场环境与风险收益比确认');
    }
    else {
        reasons.push('没有同时满足趋势、纪律和确认周期要求');
    }
    const atr = indicators.atr14;
    const quantity = suggestedQuantity(position, evidence.instrument.type, quote.price, portfolio.total_asset, portfolio.cash, config.risk.max_position_ratio);
    const costGate = estimateCostGate(evidence.instrument.type, quote.price, quantity, atr, strategyProfile.preferences?.transaction_costs);
    if (action === '观察·上涨' && !costGate.passed) {
        action = '继续观察';
        blockers.push(costGate.reason);
        reasons.push('新开仓未通过交易成本闸门，不能只看毛价差');
    }
    else if (action === '观察·下跌' && costGate.status !== 'configured') {
        reasons.push('减风险卖出不因成本信息不完整而被否决，但执行前仍需披露卖出侧成本');
    }
    return {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        instrument: evidence.instrument,
        facts: {
            latest_price: quote.price,
            quote_sources: evidence.quotes.map((item) => item.source),
            market_state: evidence.market_state,
            position: position ?? null,
            profit_ratio: profitRatio,
            goal,
            discipline,
            indicators,
            transaction_costs: strategyProfile.preferences?.transaction_costs ?? null,
        },
        decision: {
            action,
            reasons,
            blockers: [...new Set(blockers)],
            suggested_quantity: action.includes('买入') || action.includes('卖出') ? quantity : null,
            cost_gate: costGate,
            confirmation_period: evidence.bars.at(-1)?.period ?? null,
            trigger: action.includes('买入') || action.includes('卖出') ? '等待 closed K、独立证据和风险收益比共同确认' : null,
            price_zone: atr == null ? null : [quote.price - atr * 0.3, quote.price + atr * 0.3],
            invalidation: atr == null ? '数据或纪律状态变化时重新分析' : `价格结构偏离当前参考位约 ${atr.toFixed(3)} 后重新分析`,
            next_check: latestBar?.closed === false ? '等待当前 K 线闭合' : '下一根闭合 K 线或材料变化',
        },
        scenarios: {
            up: '突破近期结构并由成交量或独立信号确认后，重新评估进攻动作',
            range: position ? '仅用确认可用数量规划做T，核心仓不因单一分时信号改变' : '等待区间边界与盈亏比清晰',
            down: position ? '优先保护本金与利润，等待闭合K线和反抽结果' : '不接下跌趋势，保留现金安全垫',
        },
        disclaimer: '仅用于决策辅助，不保证盈利，不连接或操作券商账户。',
    };
}
