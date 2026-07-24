import { describe, expect, it } from 'vitest';
import {
    assessReboundOpportunity,
    assessSectorLeadership,
    assessThemeContinuity,
    buildHotThemeContext,
} from './dist/candidate-market-context.js';
import { buildCandidateUserProfile } from './dist/candidate-user-profile.js';

describe('candidate market context', () => {
    it('derives hot themes from sector ETF breadth, liquidity and momentum', () => {
        const item = (code, name, amount, changeRatio) => ({
            instrument: { code, name, type: 'etf' },
            amount,
            changeRatio,
        });
        const themes = buildHotThemeContext([{ type: 'etf', items: [
            item('512480', '半导体ETF', 2_000_000_000, 0.035),
            item('159995', '芯片ETF', 1_000_000_000, 0.028),
            item('512800', '银行ETF', 200_000_000, -0.005),
        ] }]);
        expect(themes[0]).toMatchObject({ name: '半导体' });
        expect(themes[0].heat_score).toBeGreaterThan(themes[1].heat_score);
        expect(themes[0].representative_codes).toEqual(['512480', '159995']);
    });

    it('requires sector heat, severe drawdown and stabilization for rebound opportunities', () => {
        const candidate = { type: 'stock', amplitude_percent: 5, screening_leadership_score: 72 };
        const daily = {
            drawdown_from_20d_high_percent: -16,
            rebound_from_20d_low_percent: 4,
            rsi14: 36,
            return_20d_percent: -14,
            realized_volatility_20d_percent: 2,
        };
        const validation = {
            checks: { five_minute_structure: true, fifteen_minute_structure: true },
            technical_evidence: {
                intraday: { latest_volume_vs_recent_average: 1.4 },
                market_context: { theme: '半导体', theme_heat_score: 75, continuity: { eligible: true, continuity_score: 72, mainline_score: 73 } },
            },
        };
        const rebound = assessReboundOpportunity(candidate, daily, validation);
        expect(rebound).toMatchObject({ eligible: true, theme: '半导体', reversal_confirmed: true });
        expect(rebound.score).toBeGreaterThan(70);
    });

    it('distinguishes a sustained mainline from a one-day sector spike', () => {
        const bars = (changes) => {
            let close = 10;
            return changes.map((change) => {
                close *= 1 + change;
                return { close, high: close * 1.01, low: close * 0.99 };
            });
        };
        const sustained = assessThemeContinuity(
            bars([0, 0.01, -0.002, 0.012, 0.004, 0.008, -0.003, 0.011, 0.005, 0.009, 0.006, 0.004]),
            { theme: '半导体', theme_heat_score: 75 },
        );
        const spike = assessThemeContinuity(
            bars([0, -0.01, -0.008, -0.006, -0.004, -0.003, -0.005, -0.002, -0.004, -0.003, -0.002, 0.04]),
            { theme: '半导体', theme_heat_score: 75 },
        );
        expect(sustained).toMatchObject({ eligible: true, one_day_spike: false });
        expect(spike).toMatchObject({ eligible: false, one_day_spike: true });
        expect(sustained.mainline_score).toBeGreaterThan(spike.mainline_score);
    });

    it('blocks low-beta defensive stocks for non-conservative profiles without blocking conservative users', () => {
        const candidate = { type: 'stock', amplitude_percent: 1, screening_leadership_score: 50 };
        const daily = { return_20d_percent: 2, realized_volatility_20d_percent: 0.6 };
        const validation = { technical_evidence: { market_context: { theme: null, theme_heat_score: null } } };
        const aggressive = assessSectorLeadership(candidate, daily, validation, buildCandidateUserProfile({ riskScore: 75 }), 'trend', null);
        const conservative = assessSectorLeadership(candidate, daily, validation, buildCandidateUserProfile({ riskScore: 15 }), 'trend', null);
        expect(aggressive).toMatchObject({ eligible: false, defensive_only: true });
        expect(conservative.eligible).toBe(true);
    });
});
