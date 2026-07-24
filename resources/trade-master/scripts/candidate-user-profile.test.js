import { describe, expect, it } from 'vitest';
import { buildCandidateUserProfile, scoreCandidateProfileFit } from './dist/candidate-user-profile.js';

const candidate = { type: 'stock', change_percent: 5, amplitude_percent: 5.5 };
const daily = { realized_volatility_20d_percent: 3.5, downside_volatility_20d_percent: 0.8 };

describe('candidate user profile', () => {
    it('turns allowed instruments and selected styles into an executable model policy', () => {
        const policy = buildCandidateUserProfile({
            instruments: ['etf'],
            styles: ['超短', '短线'],
            experience: '1-3年',
            riskRating: '平衡型',
            riskScore: 50,
            tradingHabits: ['盘中可盯盘'],
        });
        expect(policy.allowed_instrument_types).toEqual(['etf']);
        expect(policy.style_weights.intraday).toBeGreaterThan(policy.style_weights.daily);
        expect(policy.experience_level).toBe('developing');
        expect(policy.behavior.intraday_available).toBe(true);
        expect(policy.opportunity_modes).toEqual(['trend', 'oversold_rebound']);
    });

    it('treats all selected horizons as a multi-horizon policy instead of one implicit style', () => {
        const policy = buildCandidateUserProfile({ styles: ['超短', '短线', '波段', '中长线'] });
        expect(policy.style_mode).toBe('multi_horizon');
        expect(policy.opportunity_modes).toEqual(['trend', 'oversold_rebound']);
    });

    it('lets aggressive profiles consider larger daily moves and fit higher volatility', () => {
        const conservative = buildCandidateUserProfile({ riskRating: '保守型', riskScore: 15 });
        const aggressive = buildCandidateUserProfile({ riskRating: '激进型', riskScore: 90 });
        expect(aggressive.daily_change_limits.stock.up).toBeGreaterThan(conservative.daily_change_limits.stock.up);
        expect(aggressive.daily_change_limits.cbond.up).toBeGreaterThan(conservative.daily_change_limits.cbond.up);
        expect(scoreCandidateProfileFit(candidate, daily, aggressive).score)
            .toBeGreaterThan(scoreCandidateProfileFit(candidate, daily, conservative).score);
    });

    it('uses experience for complexity matching without changing hard safety rules', () => {
        const beginner = buildCandidateUserProfile({ experience: '1年以内', riskScore: 50 });
        const advanced = buildCandidateUserProfile({ experience: '5年以上', riskScore: 50 });
        const bond = { type: 'cbond', change_percent: 2, amplitude_percent: 4 };
        expect(scoreCandidateProfileFit(bond, daily, advanced).experience_fit)
            .toBeGreaterThan(scoreCandidateProfileFit(bond, daily, beginner).experience_fit);
        expect(advanced.guardrail).toContain('不得绕过最大回撤');
    });

    it('turns chasing and hold-loss habits into stricter behavioral fit', () => {
        const neutral = buildCandidateUserProfile({ riskScore: 75 });
        const guarded = buildCandidateUserProfile({ riskScore: 75, tradingHabits: ['容易追涨', '容易扛亏'] });
        const guardedFit = scoreCandidateProfileFit(candidate, { ...daily, downside_volatility_20d_percent: 1.4 }, guarded);
        const neutralFit = scoreCandidateProfileFit(candidate, { ...daily, downside_volatility_20d_percent: 1.4 }, neutral);
        expect(guarded.chasing_change_limits.stock).toBeLessThan(neutral.chasing_change_limits.stock);
        expect(guardedFit.behavior_fit).toBeLessThan(neutralFit.behavior_fit);
        expect(guardedFit.risks.length).toBeGreaterThan(0);
    });
});
