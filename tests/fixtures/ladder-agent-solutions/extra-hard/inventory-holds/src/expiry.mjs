// A hold lives from createdAt up to, but not including, expiresAt.
export const isActive = (hold, now) => hold.state === 'active' && now < hold.expiresAt;

// The first expiry: the time to live, but never more than the longest life of a hold.
export const firstExpiry = (now, ttlMs, maxHoldMs) => now + Math.min(ttlMs, maxHoldMs);

// An extension adds to the current expiry, and the hold never lives longer than maxHoldMs in all.
export function extendedExpiry(hold, ms, maxHoldMs) {
  return Math.min(hold.expiresAt + ms, hold.createdAt + maxHoldMs);
}
