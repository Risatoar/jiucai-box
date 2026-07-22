import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CANDIDATE_MODEL_VERSION } from './candidate-model.js';
import { readJson, tradeMasterHome, writeJson } from './storage.js';

const metricsPath = () => join(tradeMasterHome(), 'runtime', 'candidate-model', 'metrics.json');
const predictionRoot = () => join(tradeMasterHome(), 'runtime', 'candidate-model', 'predictions');
const indexPath = () => join(tradeMasterHome(), 'runtime', 'candidate-model', 'index.json');

const round = (value, digits = 4) => {
    const scale = 10 ** digits;
    return Math.round(Number(value) * scale) / scale;
};

const costAssumption = (type) => type === 'stock' ? 0.003 : type === 'etf' ? 0.002 : 0.0015;
const VALIDATION_GATE = {
    out_of_sample_samples: 250,
    shadow_samples: 50,
    precision_at_5: 0.55,
    precision_at_5_lower_bound_95: 0.45,
    win_rate_after_costs: 0.58,
    win_rate_lower_bound_95: 0.52,
    average_return_after_costs: 0.003,
    maximum_drawdown: -0.08,
    maximum_adverse_excursion: -0.06,
    per_asset_samples: 50,
    per_asset_win_rate_after_costs: 0.55,
    per_asset_win_rate_lower_bound_95: 0.45,
};
const atLeast = (value, threshold) => Number.isFinite(value) && value >= threshold;
const wilsonLowerBound = (wins, samples, z = 1.96) => {
    if (!samples)
        return null;
    const rate = wins / samples;
    const denominator = 1 + z ** 2 / samples;
    const centre = rate + z ** 2 / (2 * samples);
    const margin = z * Math.sqrt(rate * (1 - rate) / samples + z ** 2 / (4 * samples ** 2));
    return round((centre - margin) / denominator);
};

const defaultMetrics = () => ({
    schema_version: 1,
    model_version: CANDIDATE_MODEL_VERSION,
    updated_at: null,
    out_of_sample_samples: 0,
    shadow_samples: 0,
    precision_at_5: null,
    precision_at_5_lower_bound_95: null,
    win_rate_after_costs: null,
    win_rate_lower_bound_95: null,
    average_return_after_costs: null,
    maximum_drawdown: null,
    maximum_adverse_excursion: null,
    by_asset: {},
});

export function candidateModelStatus() {
    const stored = existsSync(metricsPath()) ? readJson(metricsPath()) : null;
    const metrics = stored?.model_version === CANDIDATE_MODEL_VERSION ? { ...defaultMetrics(), ...stored } : defaultMetrics();
    const assetEvidenceReady = ['stock', 'etf', 'cbond'].every((type) => {
        const asset = metrics.by_asset?.[type] ?? {};
        return asset.samples >= VALIDATION_GATE.per_asset_samples
            && atLeast(asset.win_rate_after_costs, VALIDATION_GATE.per_asset_win_rate_after_costs)
            && atLeast(asset.win_rate_lower_bound_95, VALIDATION_GATE.per_asset_win_rate_lower_bound_95);
    });
    const validated = metrics.model_version === CANDIDATE_MODEL_VERSION
        && metrics.out_of_sample_samples >= VALIDATION_GATE.out_of_sample_samples
        && metrics.shadow_samples >= VALIDATION_GATE.shadow_samples
        && atLeast(metrics.precision_at_5, VALIDATION_GATE.precision_at_5)
        && atLeast(metrics.precision_at_5_lower_bound_95, VALIDATION_GATE.precision_at_5_lower_bound_95)
        && atLeast(metrics.win_rate_after_costs, VALIDATION_GATE.win_rate_after_costs)
        && atLeast(metrics.win_rate_lower_bound_95, VALIDATION_GATE.win_rate_lower_bound_95)
        && atLeast(metrics.average_return_after_costs, VALIDATION_GATE.average_return_after_costs)
        && atLeast(metrics.maximum_drawdown, VALIDATION_GATE.maximum_drawdown)
        && atLeast(metrics.maximum_adverse_excursion, VALIDATION_GATE.maximum_adverse_excursion)
        && assetEvidenceReady;
    return {
        model_version: CANDIDATE_MODEL_VERSION,
        validation_status: validated ? 'validated' : 'shadow_observation',
        high_confidence_label_allowed: validated,
        metrics,
        missing_evidence: validated ? [] : [
            metrics.out_of_sample_samples < VALIDATION_GATE.out_of_sample_samples && `样本外记录 ${metrics.out_of_sample_samples}/${VALIDATION_GATE.out_of_sample_samples}`,
            metrics.shadow_samples < VALIDATION_GATE.shadow_samples && `影子观察 ${metrics.shadow_samples}/${VALIDATION_GATE.shadow_samples}`,
            !atLeast(metrics.precision_at_5, VALIDATION_GATE.precision_at_5) && `Precision@5 未达到 ${VALIDATION_GATE.precision_at_5}`,
            !atLeast(metrics.precision_at_5_lower_bound_95, VALIDATION_GATE.precision_at_5_lower_bound_95) && `Precision@5置信下界未达到 ${VALIDATION_GATE.precision_at_5_lower_bound_95}`,
            !atLeast(metrics.win_rate_after_costs, VALIDATION_GATE.win_rate_after_costs) && `扣费后胜率未达到 ${VALIDATION_GATE.win_rate_after_costs}`,
            !atLeast(metrics.win_rate_lower_bound_95, VALIDATION_GATE.win_rate_lower_bound_95) && `胜率95%置信下界未达到 ${VALIDATION_GATE.win_rate_lower_bound_95}`,
            !atLeast(metrics.average_return_after_costs, VALIDATION_GATE.average_return_after_costs) && `扣费后平均收益未达到 ${VALIDATION_GATE.average_return_after_costs}`,
            !atLeast(metrics.maximum_drawdown, VALIDATION_GATE.maximum_drawdown) && `最大回撤差于 ${VALIDATION_GATE.maximum_drawdown}`,
            !atLeast(metrics.maximum_adverse_excursion, VALIDATION_GATE.maximum_adverse_excursion) && `最大不利波动差于 ${VALIDATION_GATE.maximum_adverse_excursion}`,
            ...['stock', 'etf', 'cbond'].flatMap((type) => {
                const asset = metrics.by_asset?.[type] ?? {};
                return [
                    !(asset.samples >= VALIDATION_GATE.per_asset_samples) && `${type} 样本 ${asset.samples ?? 0}/${VALIDATION_GATE.per_asset_samples}`,
                    !atLeast(asset.win_rate_after_costs, VALIDATION_GATE.per_asset_win_rate_after_costs) && `${type} 扣费后胜率未达到 ${VALIDATION_GATE.per_asset_win_rate_after_costs}`,
                    !atLeast(asset.win_rate_lower_bound_95, VALIDATION_GATE.per_asset_win_rate_lower_bound_95) && `${type} 胜率置信下界未达到 ${VALIDATION_GATE.per_asset_win_rate_lower_bound_95}`,
                ].filter(Boolean);
            }),
        ].filter(Boolean),
        validation_gate: VALIDATION_GATE,
        disclaimer: validated ? '模型已达到最低证据门槛，但仍不保证盈利。' : '模型仍处于影子观察期，禁止展示“已验证高置信”或承诺胜率。',
    };
}

export function recordCandidatePrediction(pool) {
    const fingerprint = (pool.candidates ?? []).map((item) => `${item.instrument?.code}:${item.status}`).join('|');
    const index = existsSync(indexPath()) ? readJson(indexPath()) : {};
    const lastRecordedAt = index.last_recorded_at ? Date.parse(index.last_recorded_at) : 0;
    if (fingerprint && fingerprint === index.last_fingerprint && Date.parse(pool.generated_at) - lastRecordedAt < 60 * 60_000 && index.last_path)
        return index.last_path;
    const stamp = String(pool.generated_at).replace(/[:.]/g, '-');
    const path = join(tradeMasterHome(), 'runtime', 'candidate-model', 'predictions', `${stamp}.json`);
    const prediction = {
        schema_version: 1,
        model_version: CANDIDATE_MODEL_VERSION,
        generated_at: pool.generated_at,
        market_regime: pool.market_regime,
        validation_status: pool.model?.validation_status,
        candidates: (pool.candidates ?? []).map((item) => ({
            rank: item.rank,
            code: item.instrument?.code,
            name: item.instrument?.name,
            type: item.type,
            entry_price: item.price,
            ranking_score: item.ranking_score,
            status: item.status,
            data_as_of: item.validation?.data_as_of ?? null,
            round_trip_cost_ratio_assumption: costAssumption(item.type),
        })),
        evaluation: { status: 'pending', horizons: ['1d', '3d', '5d'], transaction_costs_required: true },
    };
    writeJson(path, prediction);
    writeJson(indexPath(), { model_version: CANDIDATE_MODEL_VERSION, last_fingerprint: fingerprint, last_recorded_at: pool.generated_at, last_path: path });
    if (!existsSync(metricsPath()))
        writeJson(metricsPath(), defaultMetrics());
    return path;
}

const predictionFiles = () => existsSync(predictionRoot())
    ? readdirSync(predictionRoot()).filter((file) => file.endsWith('.json')).sort()
    : [];

const evaluateCandidate = async (market, candidate, generatedAt, asOf) => {
    const start = generatedAt.slice(0, 10);
    const end = asOf.slice(0, 10);
    const result = await market.bars(candidate.code, '1d', 12, { start, end, asOf });
    const bars = (result.bars ?? []).filter((bar) => bar.closed !== false && String(bar.time).slice(0, 10) >= start);
    if (bars.length < 6)
        return null;
    const entry = Number(candidate.entry_price);
    if (!Number.isFinite(entry) || entry <= 0)
        return null;
    const returns = {};
    for (const horizon of [1, 3, 5]) {
        const close = Number(bars[Math.min(horizon - 1, bars.length - 1)]?.close);
        returns[`${horizon}d`] = Number.isFinite(close) ? round(close / entry - 1) : null;
    }
    const firstFive = bars.slice(0, 5);
    const minimumLow = Math.min(...firstFive.map((bar) => Number(bar.low)).filter(Number.isFinite));
    const cost = Number(candidate.round_trip_cost_ratio_assumption ?? costAssumption(candidate.type));
    return {
        status: 'completed',
        evaluated_at: asOf,
        source: result.source,
        closed_daily_bars: bars.length,
        gross_returns: returns,
        return_5d_after_costs: returns['5d'] == null ? null : round(returns['5d'] - cost),
        maximum_adverse_excursion: Number.isFinite(minimumLow) ? round(minimumLow / entry - 1) : null,
        cost_ratio_assumption: cost,
    };
};

const maximumDrawdown = (returns) => {
    let equity = 1;
    let peak = 1;
    let drawdown = 0;
    for (const value of returns) {
        equity *= 1 + value;
        peak = Math.max(peak, equity);
        drawdown = Math.min(drawdown, equity / peak - 1);
    }
    return round(drawdown);
};

const rebuildMetrics = () => {
    const completed = predictionFiles().map((file) => readJson(join(predictionRoot(), file)))
        .filter((prediction) => prediction.model_version === CANDIDATE_MODEL_VERSION && prediction.evaluation?.status === 'completed');
    const outcomes = completed.flatMap((prediction) => prediction.candidates ?? [])
        .map((candidate) => candidate.outcome)
        .filter((outcome) => outcome?.status === 'completed' && Number.isFinite(outcome.return_5d_after_costs));
    const returns = outcomes.map((outcome) => outcome.return_5d_after_costs);
    const snapshotReturns = completed.map((prediction) => (prediction.candidates ?? [])
        .map((candidate) => candidate.outcome?.return_5d_after_costs)
        .filter(Number.isFinite))
        .filter((values) => values.length)
        .map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
    const successfulSnapshots = completed.filter((prediction) => {
        const values = (prediction.candidates ?? []).map((candidate) => candidate.outcome?.return_5d_after_costs).filter(Number.isFinite);
        return values.length && values.filter((value) => value > 0).length >= Math.ceil(values.length * 0.6);
    }).length;
    const adverse = outcomes.map((outcome) => outcome.maximum_adverse_excursion).filter(Number.isFinite);
    const candidateRecords = completed.flatMap((prediction) => prediction.candidates ?? [])
        .filter((candidate) => candidate.outcome?.status === 'completed' && Number.isFinite(candidate.outcome.return_5d_after_costs));
    const byAsset = Object.fromEntries(['stock', 'etf', 'cbond'].map((type) => {
        const items = candidateRecords.filter((candidate) => candidate.type === type);
        const assetReturns = items.map((candidate) => candidate.outcome.return_5d_after_costs);
        return [type, {
            samples: items.length,
            win_rate_after_costs: items.length ? round(assetReturns.filter((value) => value > 0).length / items.length) : null,
            win_rate_lower_bound_95: items.length ? wilsonLowerBound(assetReturns.filter((value) => value > 0).length, items.length) : null,
            average_return_after_costs: items.length ? round(assetReturns.reduce((sum, value) => sum + value, 0) / items.length) : null,
        }];
    }));
    const metrics = {
        ...defaultMetrics(),
        updated_at: new Date().toISOString(),
        out_of_sample_samples: outcomes.length,
        shadow_samples: completed.length,
        precision_at_5: completed.length ? round(successfulSnapshots / completed.length) : null,
        precision_at_5_lower_bound_95: completed.length ? wilsonLowerBound(successfulSnapshots, completed.length) : null,
        win_rate_after_costs: outcomes.length ? round(outcomes.filter((outcome) => outcome.return_5d_after_costs > 0).length / outcomes.length) : null,
        win_rate_lower_bound_95: outcomes.length ? wilsonLowerBound(outcomes.filter((outcome) => outcome.return_5d_after_costs > 0).length, outcomes.length) : null,
        average_return_after_costs: outcomes.length ? round(returns.reduce((sum, value) => sum + value, 0) / returns.length) : null,
        maximum_drawdown: snapshotReturns.length ? maximumDrawdown(snapshotReturns) : null,
        maximum_adverse_excursion: adverse.length ? round(Math.min(...adverse)) : null,
        by_asset: byAsset,
        cost_assumptions: { stock: 0.003, etf: 0.002, cbond: 0.0015 },
    };
    writeJson(metricsPath(), metrics);
    return metrics;
};

export async function evaluatePendingPredictions(market, asOf = new Date().toISOString(), maximumSnapshots = 2) {
    const pending = predictionFiles().map((file) => ({ file, value: readJson(join(predictionRoot(), file)) }))
        .filter((item) => item.value.model_version === CANDIDATE_MODEL_VERSION && item.value.evaluation?.status === 'pending')
        .slice(0, maximumSnapshots);
    let completed = 0;
    for (const item of pending) {
        const candidates = [];
        let ready = true;
        for (const candidate of item.value.candidates ?? []) {
            try {
                const outcome = await evaluateCandidate(market, candidate, item.value.generated_at, asOf);
                if (!outcome)
                    ready = false;
                candidates.push({ ...candidate, outcome });
            }
            catch {
                ready = false;
                candidates.push(candidate);
            }
        }
        if (!ready)
            continue;
        writeJson(join(predictionRoot(), item.file), { ...item.value, candidates, evaluation: { ...item.value.evaluation, status: 'completed', evaluated_at: asOf } });
        completed += 1;
    }
    return { checked: pending.length, completed, metrics: completed ? rebuildMetrics() : candidateModelStatus().metrics };
}
