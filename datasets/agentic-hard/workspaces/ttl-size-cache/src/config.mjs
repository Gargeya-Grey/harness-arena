import { systemClock } from './clock.mjs';
import { parseDuration } from './duration.mjs';
import { sizeOf } from './sizer.mjs';

// Options: ttl (default time to live), maxEntries, maxBytes, sizeOf(value),
// clock. Every time is in milliseconds once it is normalized.
export function normalize(options = {}) {
  const { ttl, maxEntries = Infinity, maxBytes = Infinity, sizeOf: measure = sizeOf, clock = systemClock } = options;
  for (const [name, value] of [['maxEntries', maxEntries], ['maxBytes', maxBytes]]) {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0) throw new RangeError(`${name} must be a number of at least 0`);
  }
  return { ttlMs: ttl === undefined ? Infinity : parseDuration(ttl), maxEntries, maxBytes, sizeOf: measure, clock };
}
