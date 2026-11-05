export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}

export function variance(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  return values.reduce((acc, value) => acc + (value - m) ** 2, 0) / (values.length - 1);
}

/** Nearest-rank percentile, p in 0..1. */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

/** Wilson 95% interval for a proportion. */
export function wilson(successes, n, z = 1.96) {
  if (!n) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function seededRandom(seedText) {
  let seed = 2166136261;
  for (const char of String(seedText)) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap 95% interval of the mean. Deterministic for a given
 * seed, so the same evidence always draws the same error bar. Null below n=3.
 */
export function bootstrapMean(values, seed = 'lab', resamples = 2000) {
  if (values.length < 3) return null;
  const random = seededRandom(seed);
  const means = [];
  for (let r = 0; r < resamples; r += 1) {
    let total = 0;
    for (let i = 0; i < values.length; i += 1) total += values[Math.floor(random() * values.length)];
    means.push(total / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * resamples)], means[Math.ceil(0.975 * resamples) - 1]];
}

/**
 * Percentile bootstrap 95% interval of the mean over clustered values: one array of
 * values per case. Repeats of one case are not independent samples, so each draw
 * picks cases with replacement, then repeats inside each picked case. Three cases
 * with three repeats are three tasks, not nine. Null below 3 cases: repeats of one
 * or two cases say nothing about how the configuration does across cases.
 */
export function bootstrapClustered(groups, seed = 'lab', resamples = 2000) {
  const clusters = groups.filter((group) => group.length);
  if (clusters.length < 3) return null;
  const random = seededRandom(seed);
  const means = [];
  for (let r = 0; r < resamples; r += 1) {
    let total = 0;
    let count = 0;
    for (let c = 0; c < clusters.length; c += 1) {
      const group = clusters[Math.floor(random() * clusters.length)];
      for (let i = 0; i < group.length; i += 1) total += group[Math.floor(random() * group.length)];
      count += group.length;
    }
    means.push(total / count);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * resamples)], means[Math.ceil(0.975 * resamples) - 1]];
}

/**
 * The interval the dashboard shows for a mean of 0..1 values grouped by case: the
 * clustered bootstrap, widened to the Wilson interval with n = number of cases. The
 * bootstrap alone collapses to [1, 1] when every case passes; three passing cases
 * are not proof of a 100% rate.
 */
export function clusteredInterval(groups, seed = 'lab') {
  const boot = bootstrapClustered(groups, seed);
  if (!boot) return null;
  const clusters = groups.filter((group) => group.length);
  const all = clusters.flat();
  const share = all.reduce((a, b) => a + b, 0) / all.length;
  const bound = wilson(share * clusters.length, clusters.length);
  return [Math.min(boot[0], bound[0]), Math.max(boot[1], bound[1])];
}

/**
 * Notional API-equivalent cost in USD. `usage.input_tokens` counts every
 * prompt token, cached or not; cache reads and writes are priced separately
 * when the registry gives a rate, else at the input rate.
 */
export function costUsd(usage, pricing) {
  if (!usage || !pricing) return null;
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  const inRate = pricing.input_per_1m;
  const outRate = pricing.output_per_1m;
  if (typeof inRate !== 'number' || typeof outRate !== 'number') return null;
  const cacheRead = usage.cache_read_tokens || 0;
  const cacheWrite = usage.cache_write_tokens || 0;
  const readRate = pricing.cache_read_per_1m ?? inRate;
  const writeRate = pricing.cache_write_per_1m ?? inRate;
  const uncached = Math.max(0, input - cacheRead - cacheWrite);
  const cost = (uncached * inRate + cacheRead * readRate + cacheWrite * writeRate + output * outRate) / 1e6;
  return Number(cost.toFixed(9));
}
