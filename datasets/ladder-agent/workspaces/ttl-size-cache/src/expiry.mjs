// An entry set at time t with a time to live of ttl is alive until t + ttl
// and expired after it. Infinity never expires.
export function expiresAtFor(now, ttlMs) {
  return ttlMs === Infinity ? Infinity : now + ttlMs;
}

export function isExpired(entry, now) {
  return now > entry.expiresAt;
}
