import { describe, expect, it } from 'vitest';
import { classifyCandidateTempo, selectCandidateMix, selectGlobalCandidateShortlist } from './dist/candidate-shortlist.js';

describe('global candidate shortlist', () => {
    it('keeps asset and rebound diversity when the AI review pool is capped', () => {
        const items = ['stock', 'etf', 'cbond'].flatMap((type, typeIndex) => Array.from({ length: 12 }, (_, index) => ({
            type,
            instrument: { code: `${typeIndex}${String(index).padStart(5, '0')}` },
            screening_score: 100 - typeIndex * 20 - index,
            screening_lane: index === 11 && type !== 'cbond' ? 'rebound_probe' : 'quality',
        })));
        const selected = selectGlobalCandidateShortlist(items, 20);
        expect(selected).toHaveLength(20);
        expect(selected.filter((item) => item.type === 'stock')).toHaveLength(7);
        expect(selected.filter((item) => item.type === 'etf')).toHaveLength(7);
        expect(selected.filter((item) => item.type === 'cbond')).toHaveLength(6);
        expect(selected.filter((item) => item.screening_lane === 'rebound_probe')).toHaveLength(2);
    });

    it('selects two unique names for each of the five strategy baskets', () => {
        const item = (code, type, score, amplitude, volatility, overrides = {}) => ({
            type,
            instrument: { code },
            ranking_score: score,
            amplitude_percent: amplitude,
            change_percent: 2,
            strategy_type: 'trend',
            component_scores: { risk: 75, daily: 72, intraday: 70, screening: 76, cost_efficiency: 70, fundamental_quality: 70 },
            fundamental_assessment: { score: 70 },
            leadership_assessment: { score: 60 },
            validation: {
                checks: { chasing_risk: false, five_minute_structure: false, fifteen_minute_structure: false },
                technical_evidence: {
                    daily: { realized_volatility_20d_percent: volatility, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 1, return_20d_percent: 8 },
                    market_context: { continuity: { mainline_score: 20 } },
                },
            },
            ...overrides,
        });
        const items = [
            item('510001', 'etf', 95, 2.2, 1.3),
            item('510002', 'etf', 94, 2.5, 1.5),
            item('113001', 'cbond', 93, 7.5, 4.5, { validation: { checks: { chasing_risk: false, five_minute_structure: true }, technical_evidence: { daily: { realized_volatility_20d_percent: 4.5, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 1, return_20d_percent: 8 }, market_context: { continuity: { mainline_score: 20 } } } } }),
            item('113002', 'cbond', 92, 7.2, 4.3, { validation: { checks: { chasing_risk: false, fifteen_minute_structure: true }, technical_evidence: { daily: { realized_volatility_20d_percent: 4.3, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 1, return_20d_percent: 8 }, market_context: { continuity: { mainline_score: 20 } } } } }),
            item('600011', 'stock', 91, 5.5, 3.4),
            item('600012', 'stock', 90, 5.6, 3.5),
            item('510011', 'etf', 89, 4.8, 3.5, { leadership_assessment: { score: 90 }, validation: { checks: { chasing_risk: false }, technical_evidence: { daily: { realized_volatility_20d_percent: 3.5, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 1, return_20d_percent: 8 }, market_context: { continuity: { mainline_score: 80 } } } } }),
            item('510012', 'etf', 88, 4.7, 3.4, { leadership_assessment: { score: 88 }, validation: { checks: { chasing_risk: false }, technical_evidence: { daily: { realized_volatility_20d_percent: 3.4, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 1, return_20d_percent: 8 }, market_context: { continuity: { mainline_score: 78 } } } } }),
            item('600021', 'stock', 87, 7.2, 4.6, { change_percent: 9.8, leadership_assessment: { score: 92 }, validation: { checks: { chasing_risk: true, five_minute_structure: true }, technical_evidence: { daily: { realized_volatility_20d_percent: 4.6, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 1, return_20d_percent: 8 }, market_context: { continuity: { mainline_score: 20 } } } } }),
            item('600022', 'stock', 86, 7.0, 4.5, { change_percent: 10.2, leadership_assessment: { score: 90 }, validation: { checks: { chasing_risk: true, fifteen_minute_structure: true }, technical_evidence: { daily: { realized_volatility_20d_percent: 4.5, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 1, return_20d_percent: 8 }, market_context: { continuity: { mainline_score: 20 } } } } }),
        ];
        const selected = selectCandidateMix(items, 10, { risk_score: 75 });
        expect(selected).toHaveLength(10);
        expect(new Set(selected.map((candidate) => candidate.instrument.code))).toHaveProperty('size', 10);
        expect(selected.map((candidate) => candidate.strategy_lane)).toEqual([
            'steady', 'steady', 'short_3d', 'short_3d', 'medium_long',
            'medium_long', 'hot_leader', 'hot_leader', 'limit_up', 'limit_up',
        ]);
        expect(classifyCandidateTempo(items[0], { risk_score: 75 }).classification).toBe('low_volatility');
        expect(selected.filter((candidate) => candidate.strategy_lane === 'limit_up').every((candidate) => candidate.validation.checks.chasing_risk)).toBe(true);
    });

    it('fills scarce baskets with explicitly marked observation-tier candidates', () => {
        const item = (code, type, overrides = {}) => ({
            type,
            instrument: { code },
            ranking_score: 70,
            amplitude_percent: 2,
            change_percent: 0.5,
            strategy_type: 'trend',
            component_scores: { risk: 40, daily: 60, intraday: 30, screening: 65, cost_efficiency: 25 },
            fundamental_assessment: { score: 40 },
            leadership_assessment: { score: 35 },
            validation: {
                checks: { chasing_risk: false, five_minute_structure: false, fifteen_minute_structure: false },
                technical_evidence: {
                    daily: { realized_volatility_20d_percent: 1.5, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 0, return_20d_percent: 0 },
                    market_context: { continuity: { mainline_score: 20 } },
                },
            },
            ...overrides,
        });
        const highElasticity = (extra = {}) => ({
            amplitude_percent: 6,
            validation: {
                checks: { chasing_risk: false, five_minute_structure: false, fifteen_minute_structure: false },
                technical_evidence: {
                    daily: { realized_volatility_20d_percent: 4, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 0, return_20d_percent: 0 },
                    market_context: { continuity: { mainline_score: 20 } },
                },
            },
            ...extra,
        });
        const items = [
            item('510001', 'etf'), item('510002', 'etf'),
            item('113001', 'cbond', highElasticity()), item('113002', 'cbond', highElasticity()),
            item('510011', 'etf', { component_scores: { risk: 20, daily: 60 }, fundamental_assessment: { score: 40 } }),
            item('510012', 'etf', { component_scores: { risk: 20, daily: 60 }, fundamental_assessment: { score: 40 } }),
            item('510021', 'etf', highElasticity({ leadership_assessment: { score: 45 }, validation: { checks: { chasing_risk: false }, technical_evidence: { daily: { realized_volatility_20d_percent: 4, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 0, return_20d_percent: 0 }, market_context: { continuity: { mainline_score: 45 } } } } })),
            item('510022', 'etf', highElasticity({ leadership_assessment: { score: 45 }, validation: { checks: { chasing_risk: false }, technical_evidence: { daily: { realized_volatility_20d_percent: 4, above_ma20: true, ma5: 11, ma20: 10, ma20_slope_5d_percent: 0, return_20d_percent: 0 }, market_context: { continuity: { mainline_score: 45 } } } } })),
            item('600001', 'stock', highElasticity({ change_percent: 2, leadership_assessment: { score: 45 } })),
            item('600002', 'stock', highElasticity({ change_percent: 2, leadership_assessment: { score: 45 } })),
        ];
        const selected = selectCandidateMix(items, 10);
        expect(selected).toHaveLength(10);
        expect(selected.every((candidate) => candidate.selection_tier === 'fallback')).toBe(true);
        expect(selected.map((candidate) => candidate.strategy_lane)).toEqual([
            'steady', 'steady', 'short_3d', 'short_3d', 'medium_long',
            'medium_long', 'hot_leader', 'hot_leader', 'limit_up', 'limit_up',
        ]);
    });
});
