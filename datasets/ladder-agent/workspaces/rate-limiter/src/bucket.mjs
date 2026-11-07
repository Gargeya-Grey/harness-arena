// Token bucket arithmetic. A bucket holds whole tokens.

// A rule is { burst, perSecond }: the bucket holds `burst` tokens and gains
// `perSecond` tokens per second.
export function normalizeRule({ burst, perSecond }) {
  if (!Number.isInteger(burst) || burst < 1) throw new RangeError('burst must be a whole number of at least 1');
  if (typeof perSecond !== 'number' || !(perSecond > 0)) throw new RangeError('perSecond must be above 0');
  return { burst, perSecond };
}

export function createBucket(rule, now) {
  return { tokens: rule.burst, at: now };
}

function refill(bucket, rule, now) {
  const elapsed = Math.max(0, now - bucket.at);
  bucket.tokens = Math.min(rule.burst, bucket.tokens + Math.round((elapsed * rule.perSecond) / 1000));
  bucket.at = now;
}

export function isFull(bucket, rule, now) {
  refill(bucket, rule, now);
  return bucket.tokens >= rule.burst;
}

const msFor = (tokens, rule) => Math.round((tokens * 1000) / rule.perSecond);

// Tries to take `cost` tokens.
export function take(bucket, rule, cost, now) {
  if (!Number.isInteger(cost) || cost < 1) throw new RangeError('cost must be a whole number of at least 1');
  refill(bucket, rule, now);
  bucket.tokens -= cost;
  const allowed = bucket.tokens >= 0;
  return {
    allowed,
    remaining: Math.max(0, bucket.tokens),
    limit: rule.burst,
    retryAfterMs: allowed ? 0 : msFor(-bucket.tokens, rule),
    resetMs: msFor(rule.burst - bucket.tokens, rule),
  };
}
