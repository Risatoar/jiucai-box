import { describe, expect, it } from 'vitest';
import { buildCandidateGoalProfile } from './dist/candidate-goal-profile.js';
import { buildMarketRegime, buildScreeningShortlist, rankModelCandidates } from './dist/candidate-model.js';

const quote = (type, code, overrides = {}) => ({
    instrument: { type, code, name: `${type === 'stock' ? '测试股票' : type === 'etf' ? '测试ETF' : '测试转债'}${code}`, exchange: 'SH' },
    price: type === 'cbond' ? 120 : 10,
    changeRatio: 0.012,
    amount: 200_000_000,
    amplitudeRatio: 0.025,
    turnoverRatio: 0.04,
    high: type === 'cbond' ? 122 : 10.2,
    low: type === 'cbond' ? 118 : 9.8,
    ...overrides,
});

const validation = (code, overrides = {}) => ({
    code,
    status: 'attention',
    checks: {
        quote_and_closed_bars_verified: true,
        five_minute_structure: true,
        fifteen_minute_structure: true,
        independent_volume: true,
        chasing_risk: false,
    },
    technical_evidence: {
        daily: {
            sample_count: 40,
            close: 10.5,
            ma5: 10.2,
            ma20: 10,
            above_ma20: true,
            return_20d_percent: 5,
            drawdown_from_20d_high_percent: -4,
            realized_volatility_20d_percent: 1.2,
            downside_volatility_20d_percent: 0.7,
        },
        intraday: { latest_volume_vs_recent_average: 1.4 },
    },
    blockers: [],
    ...overrides,
});

describe('candidate model v2', () => {
    it('converts the configured portfolio goal, exposure and real minimum commission into instrument return requirements', () => {
        const goal = buildCandidateGoalProfile({
            status: 'active', current_asset: 7580, target_asset: 11370, target_date: '2027-07-22', max_drawdown: 0.03,
            constraints: { max_gross_exposure_ratio: 0.5, max_positions: 2 },
            transaction_costs: { status: 'user_confirmed', commission_min_per_order: 5 },
        }, {}, '2026-07-22T10:00:00+08:00');
        expect(goal).toMatchObject({ active: true, target_return_percent: 50, max_gross_exposure_ratio: 0.5, allocation_per_position: 1895, max_drawdown_percent: 3, max_instrument_drawdown_budget_percent: 6 });
        expect(goal.required_portfolio_return_20d_percent).toBeCloseTo(3.16, 1);
        expect(goal.required_instrument_return_20d_percent.stock).toBeGreaterThan(6.7);
        expect(goal.required_instrument_return_20d_percent.cbond).toBeGreaterThan(6.3);
    });

    it('normalizes each asset class separately and applies instrument-specific safety filters', () => {
        const successful = ['stock', 'etf', 'cbond'].map((type) => ({
            type,
            items: Array.from({ length: 6 }, (_, index) => quote(type, `${type === 'stock' ? '600' : type === 'etf' ? '510' : '113'}${String(index).padStart(3, '0')}`, { amount: 100_000_000 + index * 20_000_000 })),
        }));
        successful.find((item) => item.type === 'cbond').items.push(quote('cbond', '113999', { price: 190 }));
        const shortlist = buildScreeningShortlist(successful, new Set(['600000']), new Set(), new Set(), 36);
        expect(new Set(shortlist.map((item) => item.type))).toEqual(new Set(['stock', 'etf', 'cbond']));
        expect(shortlist.some((item) => item.instrument.code === '600000')).toBe(false);
        expect(shortlist.some((item) => item.instrument.code === '113999')).toBe(false);
        expect(shortlist.every((item) => item.screening_score >= 0 && item.screening_score <= 100)).toBe(true);
    });

    it('returns zero-to-five qualified watch candidates instead of filling weak tail candidates', () => {
        const shortlist = [
            { ...quote('stock', '600001'), type: 'stock', screening_score: 92, screening_components: {}, rank: 1 },
            { ...quote('etf', '510001'), type: 'etf', screening_score: 90, screening_components: {}, rank: 2 },
            { ...quote('cbond', '113001'), type: 'cbond', screening_score: 88, screening_components: {}, rank: 3 },
            { ...quote('stock', '600002'), type: 'stock', screening_score: 86, screening_components: {}, rank: 4 },
            { ...quote('etf', '510002'), type: 'etf', screening_score: 84, screening_components: {}, rank: 5 },
        ].map((item) => ({ ...item, instrument: item.instrument, amplitude_percent: 2.5, session_low: item.low }));
        const validations = shortlist.map((item) => validation(item.instrument.code));
        validations[3] = validation('600002', {
            status: 'waiting',
            technical_evidence: { daily: { sample_count: 40, close: 9, ma5: 9.2, ma20: 10, above_ma20: false, return_20d_percent: -12, drawdown_from_20d_high_percent: -18, realized_volatility_20d_percent: 5, downside_volatility_20d_percent: 4 }, intraday: { latest_volume_vs_recent_average: 0.6 } },
        });
        const result = rankModelCandidates(shortlist, validations, { state: 'mixed' }, 5);
        expect(result.watchCandidates).toHaveLength(4);
        expect(result.buyReadyCandidates.length).toBeGreaterThan(0);
        expect(result.buyReadyCandidates.every((item) => item.status === 'buy_ready')).toBe(true);
        expect(result.watchCandidates.every((item) => item.component_scores.intraday <= 100)).toBe(true);
        expect(result.watchCandidates.some((item) => item.instrument.code === '600002')).toBe(false);
        expect(result.rejectedCandidates.find((item) => item.instrument.code === '600002')).toMatchObject({ status: 'model_rejected', confidence: 'unvalidated' });
    });

    it('rejects a low-opportunity convertible bond even when 5/15 minute structure and volume all pass', () => {
        const candidate = { ...quote('cbond', '123154'), type: 'cbond', screening_score: 77.85, screening_components: {}, rank: 5, amplitude_percent: 0.95, session_low: 126.01 };
        const evidence = validation('123154', {
            technical_evidence: {
                daily: { sample_count: 40, close: 124.863, ma5: 124.384, ma20: 121.2699, above_ma20: true, return_20d_percent: 2.51, drawdown_from_20d_high_percent: -0.34, realized_volatility_20d_percent: 1.13, downside_volatility_20d_percent: 0.7 },
                intraday: { latest_volume_vs_recent_average: 1.13 },
            },
        });
        const result = rankModelCandidates([candidate], [evidence], { state: 'defensive' }, 5);
        expect(result.watchCandidates).toHaveLength(0);
        expect(result.buyReadyCandidates).toHaveLength(0);
        expect(result.rejectedCandidates[0]).toMatchObject({ instrument: { code: '123154' }, status: 'model_rejected', component_scores: { cost_efficiency: 22.44 } });
    });

    it('rejects candidates that cannot cover the configured profit pace without relaxing drawdown controls', () => {
        const goal = buildCandidateGoalProfile({
            status: 'active', current_asset: 7580, target_asset: 11370, target_date: '2027-07-22', max_drawdown: 0.03,
            constraints: { max_gross_exposure_ratio: 0.5, max_positions: 2 },
        }, {}, '2026-07-22T10:00:00+08:00');
        const candidates = ['113001', '113002'].map((code, index) => ({ ...quote('cbond', code), type: 'cbond', screening_score: 90 - index, screening_components: {}, rank: index + 1, amplitude_percent: 2, session_low: 118 }));
        const evidence = [
            validation('113001', { technical_evidence: { daily: { ...validation('x').technical_evidence.daily, return_20d_percent: 7.2, realized_volatility_20d_percent: 1.1 }, intraday: { latest_volume_vs_recent_average: 1.4 } } }),
            validation('113002', { technical_evidence: { daily: { ...validation('x').technical_evidence.daily, return_20d_percent: 4, realized_volatility_20d_percent: 0.7 }, intraday: { latest_volume_vs_recent_average: 1.4 } } }),
        ];
        const result = rankModelCandidates(candidates, evidence, { state: 'mixed' }, 5, goal);
        expect(result.watchCandidates.map((item) => item.instrument.code)).toEqual(['113001']);
        expect(result.watchCandidates[0].component_scores).toMatchObject({ goal_alignment_eligible: true });
        expect(result.rejectedCandidates[0]).toMatchObject({ instrument: { code: '113002' }, component_scores: { goal_opportunity_eligible: false } });
    });

    it('classifies broad stock weakness as a defensive regime', () => {
        const regime = buildMarketRegime([{ type: 'stock', items: Array.from({ length: 10 }, (_, index) => quote('stock', `6000${String(index).padStart(2, '0')}`, { changeRatio: index < 7 ? -0.02 : 0.005 })) }]);
        expect(regime.state).toBe('defensive');
        expect(regime.stock_falling_ratio).toBe(0.7);
    });
});
