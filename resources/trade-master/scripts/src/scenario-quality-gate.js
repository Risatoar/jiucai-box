const round = (value) => Math.round(value * 100) / 100;

function pairMetric(pairs) {
    const correct = pairs.filter((item) => item.correct).length;
    return {
        samples: pairs.length,
        correct,
        accuracy_pct: pairs.length ? round(correct / pairs.length * 100) : null,
    };
}

export function scenarioQualityMetrics(caseLibrary) {
    const actions = caseLibrary.independent.action_metrics;
    const tTrade = pairMetric(caseLibrary.independent.position_cycle_ledger.t_pairs);
    const highLow = pairMetric(caseLibrary.independent.high_low_pairs ?? []);
    return {
        ...Object.fromEntries(Object.entries(actions).map(([name, value]) => [name, {
            samples: value.samples,
            correct: value.correct,
            accuracy_pct: value.accuracy_pct,
        }])),
        t_trade: tTrade,
        high_low_pair: highLow,
        bottom_fishing_abstention: {
            samples: caseLibrary.bottom_fishing_abstentions.samples,
            correct: caseLibrary.bottom_fishing_abstentions.correct_abstentions,
            accuracy_pct: caseLibrary.bottom_fishing_abstentions.accuracy_pct,
        },
    };
}

export function evaluateScenarioQualityGuard(caseLibrary, guard) {
    if (!guard)
        return { enabled: false, ready: true, checks: [], failures: [] };
    const metrics = scenarioQualityMetrics(caseLibrary);
    const checks = [];
    for (const name of guard.optimize ?? []) {
        const metric = metrics[name] ?? { samples: 0, accuracy_pct: null };
        checks.push({
            name,
            role: 'optimize',
            ...metric,
            minimum_samples: guard.minimum_cases_per_type,
            minimum_accuracy_pct: guard.target_accuracy_pct,
            pass: metric.samples >= guard.minimum_cases_per_type
                && (metric.accuracy_pct ?? 0) >= guard.target_accuracy_pct,
        });
    }
    for (const [name, baseline] of Object.entries(guard.protected ?? {})) {
        const metric = metrics[name] ?? { samples: 0, accuracy_pct: null };
        const minimumAccuracy = Math.max(
            guard.target_accuracy_pct,
            baseline - guard.protected_max_degradation_pct,
        );
        checks.push({
            name,
            role: 'protect',
            ...metric,
            baseline_accuracy_pct: baseline,
            maximum_degradation_pct: guard.protected_max_degradation_pct,
            minimum_samples: guard.minimum_cases_per_type,
            minimum_accuracy_pct: round(minimumAccuracy),
            degradation_pct: metric.accuracy_pct == null ? null : round(baseline - metric.accuracy_pct),
            pass: metric.samples >= guard.minimum_cases_per_type
                && (metric.accuracy_pct ?? 0) >= minimumAccuracy,
        });
    }
    const failures = checks.filter((item) => !item.pass);
    return {
        enabled: true,
        target_accuracy_pct: guard.target_accuracy_pct,
        minimum_cases_per_type: guard.minimum_cases_per_type,
        protected_max_degradation_pct: guard.protected_max_degradation_pct,
        ready: failures.length === 0,
        checks,
        failures,
    };
}
