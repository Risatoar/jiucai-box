import { readJson, tradeMasterHome } from './storage.js';
import { join } from 'node:path';
function workdaysBetween(start, end) {
    let count = 0;
    const cursor = new Date(start);
    cursor.setHours(12, 0, 0, 0);
    const limit = new Date(end);
    limit.setHours(12, 0, 0, 0);
    while (cursor < limit) {
        cursor.setDate(cursor.getDate() + 1);
        if (![0, 6].includes(cursor.getDay()))
            count += 1;
    }
    return count;
}
function date(value) {
    const parsed = new Date(`${value.slice(0, 10)}T12:00:00+08:00`);
    if (Number.isNaN(parsed.getTime()))
        throw new Error(`无效日期：${value}`);
    return parsed;
}
export function evaluateGoal(config) {
    const goal = config ?? readJson(join(tradeMasterHome(), 'goals.json'));
    if (goal.status !== 'active') {
        return {
            status: 'unconfigured',
            risk_mode: 'risk_first',
            reasons: ['收益目标尚未确认或未启用'],
            guardrail: '目标未确认时不追收益，不提高仓位、亏损预算或交易频率',
        };
    }
    const current = goal.current_asset;
    const start = goal.phase_start_asset ?? current;
    const target = goal.target_asset ?? (start != null && goal.target_return != null ? start * (1 + goal.target_return) : null);
    const missing = [
        current == null ? 'current_asset' : null,
        start == null ? 'phase_start_asset' : null,
        target == null ? 'target_asset/target_return' : null,
        !goal.target_date ? 'target_date' : null,
    ].filter(Boolean);
    if (missing.length > 0) {
        return { status: 'unconfigured', risk_mode: 'risk_first', reasons: missing, guardrail: '缺少事实时只做风险优先分析' };
    }
    const today = date(goal.as_of_date ?? new Date().toISOString().slice(0, 10));
    const targetDate = date(goal.target_date);
    const remaining = workdaysBetween(today, targetDate);
    const requiredDaily = remaining > 0 ? Math.pow(target / current, 1 / remaining) - 1 : target / current - 1;
    const peak = goal.peak_asset ?? current;
    const drawdown = peak > 0 ? Math.max(0, (peak - current) / peak) : 0;
    const maxDrawdown = goal.max_drawdown ?? 0.08;
    const maxDaily = goal.max_required_daily_return ?? 0.005;
    const tolerance = goal.path_tolerance ?? 0.01;
    let status = 'on_track';
    if (drawdown >= maxDrawdown * 0.8)
        status = 'at_risk';
    else if (remaining <= 0 && current < target)
        status = 'infeasible';
    else if (requiredDaily > maxDaily)
        status = 'infeasible';
    else if (goal.phase_start_date) {
        const totalDays = Math.max(1, workdaysBetween(date(goal.phase_start_date), targetDate));
        const elapsedDays = Math.max(0, workdaysBetween(date(goal.phase_start_date), today));
        const planned = start * Math.pow(target / start, Math.min(1, elapsedDays / totalDays));
        if (current > planned * (1 + tolerance))
            status = 'ahead';
        else if (current < planned * (1 - tolerance))
            status = 'behind';
    }
    const riskMode = ({
        ahead: 'protect_profit',
        on_track: 'standard',
        behind: 'raise_quality_not_risk',
        at_risk: 'defensive',
        infeasible: 'renegotiate_goal',
    })[status];
    return {
        status,
        risk_mode: riskMode,
        current_asset: current,
        target_asset: target,
        gap_amount: target - current,
        remaining_workdays_estimate: remaining,
        required_daily_compound_return: requiredDaily,
        current_drawdown: drawdown,
        max_drawdown: maxDrawdown,
        guardrail: '目标落后时只提高候选质量，不提高仓位、单笔亏损或交易次数',
    };
}
