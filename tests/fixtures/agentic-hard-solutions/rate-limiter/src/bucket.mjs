// Token bucket arithmetic. Tokens are counted in micro-tokens (1 token =
// 1,000,000), so refilling is exact integer arithmetic.
const UNIT = 1_000_000;

// A rule is { burst, perSecond }: the bucket holds `burst` tokens and gains
// `perSecond` tokens per second (up to three decimals, for example 0.5 or 1.25).
export function normalizeRule({ burst, perSecond }) {
  if (!Number.isInteger(burst) || burst < 1) throw new RangeError('burst must be a whole number of at least 1');
  if (typeof perSecond !== 'number' || !(perSecond >= 0.001)) throw new RangeError('perSecond must be at least 0.001');
  return { burst, perSecond, capacity: burst * UNIT, rate: Math.round(perSecond * 1000) };
}

export function createBucket(rule, now) {
  return { micro: rule.capacity, at: now };
}

// Adds what has flowed in since the last look. A clock that moves back adds
// nothing, and the time that already counted is not counted again.
function refill(bucket, rule, now) {
  if (now <= bucket.at) return;
  bucket.micro = Math.min(rule.capacity, bucket.micro + (now - bucket.at) * rule.rate);
  bucket.at = now;
}

export function isFull(bucket, rule, now) {
  refill(bucket, rule, now);
  return bucket.micro >= rule.capacity;
}

const msFor = (micro, rule) => Math.ceil(micro / rule.rate);

// Tries to take `cost` tokens. A refused request takes nothing.
// retryAfterMs is 0 when allowed, and null when the cost is more than the burst
// (it can never be allowed).
export function take(bucket, rule, cost, now) {
  if (!Number.isInteger(cost) || cost < 1) throw new RangeError('cost must be a whole number of at least 1');
  refill(bucket, rule, now);
  const need = cost * UNIT;
  let allowed = false;
  let retryAfterMs = need > rule.capacity ? null : msFor(need - bucket.micro, rule);
  if (bucket.micro >= need) {
    bucket.micro -= need;
    allowed = true;
    retryAfterMs = 0;
  }
  return {
    allowed,
    remaining: Math.floor(bucket.micro / UNIT),
    limit: rule.burst,
    retryAfterMs,
    resetMs: msFor(rule.capacity - bucket.micro, rule),
  };
}
