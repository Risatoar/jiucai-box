const CONFIGS = {
    '1m': {
        entryReboundPct: 0.6, oversoldReboundPct: 0.25, oversoldDropPct: 1.8,
        minVolumeRatio: 1, takeProfitPct: 0.6, stopLossPct: 0.15,
        trailingActivatePct: 0.12, trailingPullbackPct: 0.03, skipBars: 5,
        volatilityBaselinePct: 0.25, volatilityMaxScale: 2, afternoonMinConfidence: 0.78,
        oversoldLookback: 60, entryLookback: 6,
    },
    '5m': {
        entryReboundPct: 0.45, oversoldReboundPct: 0.2, oversoldDropPct: 2.2,
        minVolumeRatio: 1, takeProfitPct: 1, stopLossPct: 0.35,
        trailingActivatePct: 0.4, trailingPullbackPct: 0.08, skipBars: 2,
        volatilityBaselinePct: 0.55, volatilityMaxScale: 2, afternoonMinConfidence: 0.72,
        oversoldLookback: 16, entryLookback: 4,
    },
    '15m': {
        entryReboundPct: 0.6, oversoldReboundPct: 0.3, oversoldDropPct: 2.5,
        minVolumeRatio: 1, takeProfitPct: 1.5, stopLossPct: 0.5,
        trailingActivatePct: 0.5, trailingPullbackPct: 0.12, skipBars: 0,
        volatilityBaselinePct: 0.95, volatilityMaxScale: 2, afternoonMinConfidence: 0.68,
        oversoldLookback: 8, entryLookback: 5,
    },
};
export function fusionConfig(period) {
    return CONFIGS[period] ?? CONFIGS['5m'];
}
