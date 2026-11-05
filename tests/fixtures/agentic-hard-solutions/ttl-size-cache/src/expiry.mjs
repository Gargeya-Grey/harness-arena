// An entry set at time t with a time to live of ttl is alive while now < t + ttl
// and expired from t + ttl on. Infinity never expires.
export function expiresAtFor(now, ttlMs) {
  return ttlMs === Infinity ? Infinity : now + ttlMs;
}

export function isExpired(entry, now) {
  return now >= entry.expiresAt;
}
