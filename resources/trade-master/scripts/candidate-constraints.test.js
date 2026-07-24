import { describe, expect, it } from 'vitest';
import { buildCandidateGoalProfile } from './dist/candidate-goal-profile.js';
import { assessCandidateAffordability, buildEffectiveCandidateGoals } from './dist/candidate-constraints.js';

describe('candidate effective constraints', () => {
    it('uses the stricter discipline limit and preserves the cash buffer', () => {
        const goals = {
            status: 'active',
            current_asset: 7580,
            target_asset: 9475,
            target_date: '2026-10-22',
            max_drawdown: 0.03,
            constraints: {
                max_gross_exposure_ratio: 1,
                max_positions: 2,
                minimum_cash_buffer: 1300,
                max_daily_trades: 2,
                single_trade_risk_amount: 30,
            },
            transaction_costs: { status: 'user_confirmed', commission_min_per_order: 5 },
        };
        const discipline = {
            latest_recovery_review: {
                operating_limits: {
                    max_gross_exposure_ratio: 0.5,
                    minimum_cash_buffer: 3060,
                    max_daily_trades: 1,
                    single_trade_risk_amount: 20,
                },
            },
        };
        const effective = buildEffectiveCandidateGoals(goals, discipline);
        const profile = buildCandidateGoalProfile(effective, {}, '2026-07-23T09:30:00+08:00');
        expect(effective.constraints).toMatchObject({
            max_gross_exposure_ratio: 0.5,
            minimum_cash_buffer: 3060,
            max_daily_trades: 1,
            single_trade_risk_amount: 20,
        });
        expect(profile).toMatchObject({
            max_gross_exposure_ratio: 0.5,
            exposure_capacity: 3790,
            allocation_per_position: 1895,
            minimum_cash_buffer: 3060,
            max_instrument_drawdown_budget_percent: 6,
        });
        expect(profile.required_instrument_return_20d_percent.stock).toBeGreaterThan(14);
    });

    it('uses total exposure capacity as the hard lot limit and average allocation only as guidance', () => {
        const goalProfile = {
            active: true,
            exposure_capacity: 3790,
            allocation_per_position: 1895,
            single_trade_risk_amount: 20,
        };
        expect(assessCandidateAffordability({ type: 'stock', price: 30 }, goalProfile))
            .toMatchObject({ eligible: true, lot_size: 100, minimum_lot_notional: 3000, position_capacity: 3790 });
        expect(assessCandidateAffordability({ type: 'cbond', price: 220, session_low: 219 }, goalProfile))
            .toMatchObject({ eligible: true, lot_size: 10, minimum_lot_notional: 2200, allocation_per_position: 1895 });
        expect(assessCandidateAffordability({ type: 'cbond', price: 400 }, goalProfile))
            .toMatchObject({ eligible: false, minimum_lot_notional: 4000 });
        expect(assessCandidateAffordability({ type: 'stock', price: 10, session_low: 9.7 }, goalProfile))
            .toMatchObject({ eligible: false, notional_eligible: true, risk_budget_eligible: false, minimum_lot_risk: 30 });
    });
});
