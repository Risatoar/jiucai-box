import { describe, expect, it } from 'vitest';
import { buildCandidateGoalProfile } from './dist/candidate-goal-profile.js';
import { buildMarketRegime, buildScreeningShortlist, rankModelCandidates } from './dist/candidate-model.js';
import { buildCandidateUserProfile } from './dist/candidate-user-profile.js';

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
            ma20_slope_5d_percent: 1,
            above_ma20: true,
            return_20d_percent: 5,
            drawdown_from_20d_high_percent: -4,
            realized_volatility_20d_percent: 1.2,
            downside_volatility_20d_percent: 0.7,
        },
        intraday: { latest_volume_vs_recent_average: 1.4 },
        market_context: { theme: '半导体', theme_heat_score: 72, continuity: { eligible: true, continuity_score: 70, mainline_score: 71 } },
        fundamental: { status: 'verified', score: 70, buy_ready_eligible: true, risks: [], event_risk_status: 'manual_check_required' },
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

    it('normalizes each allowed asset class separately without a convertible-bond price hard filter', () => {
        const successful = ['stock', 'etf', 'cbond'].map((type) => ({
            type,
            items: Array.from({ length: 6 }, (_, index) => quote(type, `${type === 'stock' ? '600' : type === 'etf' ? '510' : '113'}${String(index).padStart(3, '0')}`, { amount: 100_000_000 + index * 20_000_000 })),
        }));
        successful.find((item) => item.type === 'cbond').items.push(quote('cbond', '113999', { price: 190 }));
        const shortlist = buildScreeningShortlist(successful, new Set(['600000']), new Set(), new Set(), 36);
        expect(new Set(shortlist.map((item) => item.type))).toEqual(new Set(['stock', 'etf', 'cbond']));
        expect(shortlist.some((item) => item.instrument.code === '600000')).toBe(false);
        expect(shortlist.some((item) => item.instrument.code === '113999')).toBe(true);
        expect(shortlist.every((item) => item.screening_score >= 0 && item.screening_score <= 100)).toBe(true);
    });

    it('keeps capital-heavy technology pullbacks in a dedicated hot-pullback lane', () => {
        const ordinary = Array.from({ length: 18 }, (_, index) => quote('stock', `600${String(index).padStart(3, '0')}`, {
            amount: 100_000_000 + index * 40_000_000,
            turnoverRatio: 0.015 + index * 0.001,
            amplitudeRatio: 0.02 + index * 0.0005,
            changeRatio: 0.01 + index * 0.0005,
        }));
        const deepTech = quote('stock', '000021', {
            instrument: { type: 'stock', code: '000021', name: '深科技', exchange: 'SZ' },
            amount: 5_261_000_000,
            turnoverRatio: 0.0846,
            amplitudeRatio: 0.065,
            changeRatio: -0.0281,
        });
        const hTech = quote('stock', '002185', {
            instrument: { type: 'stock', code: '002185', name: '华天科技', exchange: 'SZ' },
            amount: 7_464_000_000,
            turnoverRatio: 0.1254,
            amplitudeRatio: 0.078,
            changeRatio: -0.03963,
        });
        const sectors = {
            sectors: [{
                name: '电子',
                heat_score: 66,
                breadth_percent: 54,
                change_percent: -0.8,
                member_codes: ['000021', '002185'],
            }],
        };
        const shortlist = buildScreeningShortlist(
            [{ type: 'stock', items: [...ordinary, deepTech, hTech] }],
            new Set(),
            new Set(),
            new Set(),
            20,
            buildCandidateUserProfile({ riskScore: 60 }),
            { state: 'mixed' },
            sectors,
        );
        for (const code of ['000021', '002185']) {
            expect(shortlist.find((item) => item.instrument.code === code)).toMatchObject({
                heat_state: 'hot_pullback',
                screening_lane: 'pullback',
                market_context: { industry: '电子', theme: '半导体', sector_heat_score: 66 },
            });
        }
    });

    it('reserves hot-trend slots so strong technology stocks are not crowded out by pullbacks', () => {
        const ordinary = Array.from({ length: 16 }, (_, index) => quote('stock', `601${String(index).padStart(3, '0')}`, {
            amount: 100_000_000 + index * 35_000_000,
            turnoverRatio: 0.012 + index * 0.001,
            amplitudeRatio: 0.018 + index * 0.0005,
            changeRatio: index < 6 ? -0.02 : 0.01,
        }));
        const targets = [
            quote('stock', '000021', {
                instrument: { type: 'stock', code: '000021', name: '深科技', exchange: 'SZ' },
                amount: 3_878_000_000,
                turnoverRatio: 0.0615,
                amplitudeRatio: 0.074,
                changeRatio: 0.0264,
            }),
            quote('stock', '002185', {
                instrument: { type: 'stock', code: '002185', name: '华天科技', exchange: 'SZ' },
                amount: 5_155_000_000,
                turnoverRatio: 0.0856,
                amplitudeRatio: 0.0916,
                changeRatio: 0.0243,
            }),
        ];
        const sectors = { sectors: [{ name: '电子', heat_score: 66, member_codes: targets.map((item) => item.instrument.code) }] };
        const shortlist = buildScreeningShortlist(
            [{ type: 'stock', items: [...ordinary, ...targets] }],
            new Set(),
            new Set(),
            new Set(),
            20,
            buildCandidateUserProfile({ riskScore: 60 }),
            { state: 'defensive' },
            sectors,
        );
        expect(shortlist.filter((item) => ['000021', '002185'].includes(item.instrument.code)))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ instrument: expect.objectContaining({ code: '000021' }), heat_state: 'hot_trend', screening_lane: 'hot_trend' }),
                expect.objectContaining({ instrument: expect.objectContaining({ code: '002185' }), heat_state: 'hot_trend', screening_lane: 'hot_trend' }),
            ]));
    });

    it('treats absolute convertible-bond price as a display fact instead of a quality score', () => {
        const successful = [{
            type: 'cbond',
            items: [
                quote('cbond', '113120', { price: 120 }),
                quote('cbond', '113300', { price: 300 }),
            ],
        }];
        const shortlist = buildScreeningShortlist(successful, new Set(), new Set(), new Set(), 12);
        const lowPrice = shortlist.find((item) => item.instrument.code === '113120');
        const highPrice = shortlist.find((item) => item.instrument.code === '113300');
        expect(highPrice.screening_score).toBe(lowPrice.screening_score);
        expect(highPrice.screening_components).not.toHaveProperty('price');
        expect(lowPrice.screening_components).not.toHaveProperty('price');
    });

    it('reserves a profile-fit lane for aggressive volatility without using high price as a shortcut', () => {
        const quality = Array.from({ length: 12 }, (_, index) => quote('cbond', `113${String(index).padStart(3, '0')}`, {
            amount: 100_000_000 + index * 10_000_000,
            amplitudeRatio: 0.03,
            turnoverRatio: 0.08,
        }));
        const highVolatility = quote('cbond', '113999', {
            price: 105,
            amount: 21_000_000,
            amplitudeRatio: 0.061,
            turnoverRatio: 0,
        });
        const successful = [{ type: 'cbond', items: [...quality, highVolatility] }];
        const conservative = buildCandidateUserProfile({ riskScore: 15, riskRating: '保守型' });
        const aggressive = buildCandidateUserProfile({ riskScore: 90, riskRating: '激进型' });
        const conservativeCodes = buildScreeningShortlist(successful, new Set(), new Set(), new Set(), 12, conservative)
            .map((item) => item.instrument.code);
        const aggressiveCandidate = buildScreeningShortlist(successful, new Set(), new Set(), new Set(), 12, aggressive)
            .find((item) => item.instrument.code === '113999');
        expect(conservativeCodes).not.toContain('113999');
        expect(aggressiveCandidate).toMatchObject({ price: 105 });
    });

    it('hard-filters unselected asset classes but keeps large movers available to every strategy catalog', () => {
        const successful = [
            { type: 'stock', items: [quote('stock', '600001', { changeRatio: 0.08 })] },
            { type: 'etf', items: [quote('etf', '510001')] },
            { type: 'cbond', items: [quote('cbond', '113001', { price: 205, changeRatio: 0.14 })] },
        ];
        const conservative = buildCandidateUserProfile({ instruments: ['stock', 'etf', 'cbond'], riskScore: 15 });
        const aggressive = buildCandidateUserProfile({ instruments: ['stock', 'etf', 'cbond'], riskScore: 90, riskRating: '激进型' });
        const etfOnly = buildCandidateUserProfile({ instruments: ['etf'], riskScore: 50 });
        expect(new Set(buildScreeningShortlist(successful, new Set(), new Set(), new Set(), 36, conservative).map((item) => item.instrument.code)))
            .toEqual(new Set(['600001', '510001', '113001']));
        expect(new Set(buildScreeningShortlist(successful, new Set(), new Set(), new Set(), 36, aggressive).map((item) => item.instrument.code)))
            .toEqual(new Set(['600001', '510001', '113001']));
        expect(buildScreeningShortlist(successful, new Set(), new Set(), new Set(), 36, etfOnly).map((item) => item.type)).toEqual(['etf']);
    });

    it('moves the momentum target with risk appetite and reweights missing turnover data', () => {
        const successful = [{ type: 'cbond', items: [quote('cbond', '113050', { changeRatio: 0.05, turnoverRatio: 0 })] }];
        const conservative = buildCandidateUserProfile({ riskScore: 15, riskRating: '保守型' });
        const aggressive = buildCandidateUserProfile({ riskScore: 90, riskRating: '激进型' });
        const conservativeCandidate = buildScreeningShortlist(successful, new Set(), new Set(), new Set(), 12, conservative)[0];
        const aggressiveCandidate = buildScreeningShortlist(successful, new Set(), new Set(), new Set(), 12, aggressive)[0];
        expect(aggressiveCandidate.screening_components.momentum).toBeGreaterThan(conservativeCandidate.screening_components.momentum);
        expect(aggressiveCandidate.screening_components.activity).toBeUndefined();
        expect(aggressiveCandidate.screening_data_availability.turnover).toBe(false);
        expect(aggressiveCandidate.screening_score).toBeGreaterThan(0);
    });

    it('uses trading style, experience and risk appetite in the final model weights and score', () => {
        const item = { ...quote('stock', '600088'), type: 'stock', screening_score: 88, screening_components: {}, rank: 1, amplitude_percent: 5.2, change_percent: 4.5, session_low: 9.5 };
        const evidence = validation('600088', { technical_evidence: { daily: { ...validation('x').technical_evidence.daily, realized_volatility_20d_percent: 3.4, downside_volatility_20d_percent: 0.8 }, intraday: { latest_volume_vs_recent_average: 1.4 } } });
        const shortAggressive = buildCandidateUserProfile({ styles: ['超短'], experience: '5年以上', riskScore: 90, riskRating: '激进型' });
        const longConservative = buildCandidateUserProfile({ styles: ['中长线'], experience: '1年以内', riskScore: 15, riskRating: '保守型' });
        const aggressiveResult = rankModelCandidates([item], [evidence], { state: 'mixed' }, 5, { active: false }, shortAggressive);
        const conservativeResult = rankModelCandidates([item], [evidence], { state: 'mixed' }, 5, { active: false }, longConservative);
        const aggressiveItem = [...aggressiveResult.watchCandidates, ...aggressiveResult.rejectedCandidates][0];
        const conservativeItem = [...conservativeResult.watchCandidates, ...conservativeResult.rejectedCandidates][0];
        expect(aggressiveItem.model_weights.intraday).toBeGreaterThan(conservativeItem.model_weights.intraday);
        expect(conservativeItem.model_weights.daily).toBeGreaterThan(aggressiveItem.model_weights.daily);
        expect(aggressiveItem.component_scores.profile_alignment).toBeGreaterThan(conservativeItem.component_scores.profile_alignment);
    });

    it('admits a confirmed oversold rebound below MA20 when its hot sector and leadership both pass', () => {
        const candidate = {
            ...quote('stock', '688981', { price: 10, amplitudeRatio: 0.05 }),
            type: 'stock',
            screening_score: 82,
            screening_leadership_score: 72,
            screening_components: {},
            screening_lane: 'rebound_probe',
            rank: 1,
            amplitude_percent: 5,
            change_percent: 1.5,
            session_low: 9.4,
        };
        const evidence = validation('688981', {
            technical_evidence: {
                daily: {
                    sample_count: 40,
                    close: 8,
                    ma5: 8.2,
                    ma20: 10,
                    above_ma20: false,
                    return_20d_percent: -14,
                    drawdown_from_20d_high_percent: -16,
                    rebound_from_20d_low_percent: 4,
                    rsi14: 36,
                    realized_volatility_20d_percent: 2,
                    downside_volatility_20d_percent: 0.7,
                },
                intraday: { latest_volume_vs_recent_average: 1.4 },
                market_context: { theme: '半导体', theme_heat_score: 75, continuity: { eligible: true, continuity_score: 72, mainline_score: 73 } },
                fundamental: { status: 'verified', score: 68, buy_ready_eligible: true, risks: [] },
            },
        });
        const result = rankModelCandidates(
            [candidate],
            [evidence],
            { state: 'mixed' },
            5,
            { active: false },
            buildCandidateUserProfile({ riskScore: 75, riskRating: '进取型' }),
        );
        expect(result.watchCandidates[0]).toMatchObject({
            instrument: { code: '688981' },
            strategy_type: 'oversold_rebound',
            opportunity_evidence: { theme: '半导体', eligible: true },
            leadership_assessment: { eligible: true },
        });
    });

    it('keeps the steady basket capped at two and rejects a clear downtrend', () => {
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
        const result = rankModelCandidates(shortlist, validations, { state: 'mixed' }, 10, { active: false }, buildCandidateUserProfile({ riskScore: 15, riskRating: '保守型' }));
        expect(result.watchCandidates.filter((item) => item.strategy_lane === 'steady')).toHaveLength(2);
        expect(result.watchCandidates.length).toBeLessThanOrEqual(4);
        expect(result.buyReadyCandidates.length).toBeGreaterThan(0);
        expect(result.buyReadyCandidates.every((item) => item.status === 'buy_ready')).toBe(true);
        expect(result.watchCandidates.every((item) => item.component_scores.intraday <= 100)).toBe(true);
        expect(result.watchCandidates.some((item) => item.instrument.code === '600002')).toBe(false);
        expect(result.rejectedCandidates.find((item) => item.instrument.code === '600002')).toMatchObject({ status: 'model_rejected', confidence: 'unvalidated' });
    });

    it('keeps a low-opportunity convertible bond as observation-only instead of buy-ready', () => {
        const candidate = { ...quote('cbond', '123154'), type: 'cbond', screening_score: 77.85, screening_components: {}, rank: 5, amplitude_percent: 0.95, session_low: 126.01 };
        const evidence = validation('123154', {
            technical_evidence: {
                daily: { sample_count: 40, close: 124.863, ma5: 124.384, ma20: 121.2699, above_ma20: true, return_20d_percent: 2.51, drawdown_from_20d_high_percent: -0.34, realized_volatility_20d_percent: 1.13, downside_volatility_20d_percent: 0.7 },
                intraday: { latest_volume_vs_recent_average: 1.13 },
            },
        });
        const result = rankModelCandidates([candidate], [evidence], { state: 'defensive' }, 5);
        expect(result.watchCandidates).toHaveLength(1);
        expect(result.buyReadyCandidates).toHaveLength(0);
        expect(result.watchCandidates[0]).toMatchObject({
            instrument: { code: '123154' },
            status: 'watching',
            model_eligible: false,
            selection_tier: 'fallback',
            component_scores: { cost_efficiency: 22.44 },
        });
        expect(result.watchCandidates[0].risks[0]).toContain('观察级补位');
    });

    it('keeps valid opportunities on the watchlist while profit pace remains a buy-ready gate', () => {
        const goal = buildCandidateGoalProfile({
            status: 'active', current_asset: 7580, target_asset: 11370, target_date: '2027-07-22', max_drawdown: 0.03,
            constraints: { max_gross_exposure_ratio: 0.5, max_positions: 2 },
        }, {}, '2026-07-22T10:00:00+08:00');
        const candidates = ['113001', '113002'].map((code, index) => ({ ...quote('cbond', code), type: 'cbond', screening_score: 90 - index, screening_components: {}, rank: index + 1, amplitude_percent: 2, session_low: 118 }));
        const evidence = [
            validation('113001', { technical_evidence: { daily: { ...validation('x').technical_evidence.daily, return_20d_percent: 7.2, realized_volatility_20d_percent: 1.1 }, intraday: { latest_volume_vs_recent_average: 1.4 } } }),
            validation('113002', { technical_evidence: { daily: { ...validation('x').technical_evidence.daily, return_20d_percent: 4, realized_volatility_20d_percent: 0.7 }, intraday: { latest_volume_vs_recent_average: 1.4 } } }),
        ];
        const result = rankModelCandidates(candidates, evidence, { state: 'mixed' }, 10, goal);
        expect(result.watchCandidates.map((item) => item.instrument.code)).toEqual(['113001', '113002']);
        expect(result.watchCandidates.find((item) => item.instrument.code === '113002').component_scores)
            .toMatchObject({ goal_opportunity_eligible: false });
        expect(result.buyReadyCandidates.map((item) => item.instrument.code)).not.toContain('113002');
    });

    it('rejects a volatile high-level distribution downtrend instead of treating volatility as opportunity', () => {
        const candidate = {
            ...quote('cbond', '123274', { price: 148.854, changeRatio: 0.0391, amplitudeRatio: 0.06 }),
            type: 'cbond',
            screening_score: 88,
            screening_leadership_score: 75,
            screening_components: {},
            rank: 1,
            amplitude_percent: 6,
            session_low: 140,
        };
        const evidence = validation('123274', {
            technical_evidence: {
                daily: {
                    sample_count: 40,
                    close: 148.854,
                    ma5: 158,
                    ma20: 190,
                    ma20_slope_5d_percent: -8,
                    above_ma20: false,
                    return_20d_percent: -8.93,
                    drawdown_from_20d_high_percent: -45,
                    rebound_from_20d_low_percent: 3,
                    rsi14: 31,
                    realized_volatility_20d_percent: 5,
                    downside_volatility_20d_percent: 3,
                },
                intraday: { latest_volume_vs_recent_average: 1.6 },
                market_context: { theme: null, theme_heat_score: null, continuity: { eligible: false, mainline_score: 0 } },
                fundamental: { status: 'incomplete', score: 45, buy_ready_eligible: false, risks: [] },
            },
        });
        const result = rankModelCandidates(
            [candidate],
            [evidence],
            { state: 'mixed' },
            5,
            { active: false },
            buildCandidateUserProfile({ riskScore: 75, riskRating: '进取型' }),
        );
        expect(result.watchCandidates).toHaveLength(0);
        expect(result.rejectedCandidates[0]).toMatchObject({
            instrument: { code: '123274' },
            strategy_type: 'trend',
            status: 'model_rejected',
        });
    });

    it('classifies broad stock weakness as a defensive regime', () => {
        const regime = buildMarketRegime([{ type: 'stock', items: Array.from({ length: 10 }, (_, index) => quote('stock', `6000${String(index).padStart(2, '0')}`, { changeRatio: index < 7 ? -0.02 : 0.005 })) }]);
        expect(regime.state).toBe('defensive');
        expect(regime.stock_falling_ratio).toBe(0.7);
    });
});
