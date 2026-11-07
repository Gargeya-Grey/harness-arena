import { SafeString } from './escape.mjs';

// Helper results are values like any other: written escaped, unless the helper
// returns a SafeString.
export const defaultHelpers = {
  upper: (value) => String(value ?? '').toUpperCase(),
  lower: (value) => String(value ?? '').toLowerCase(),
  json: (value) => JSON.stringify(value),
  join: (list, separator) => (Array.isArray(list) ? list.join(separator ?? ',') : ''),
  default: (value, fallback) => (value === undefined || value === null || value === '' ? fallback : value),
  eq: (a, b) => a === b,
  safe: (value) => new SafeString(value ?? ''),
};
