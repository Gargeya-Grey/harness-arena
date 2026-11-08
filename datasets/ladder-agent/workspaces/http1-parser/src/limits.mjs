export const DEFAULT_LIMITS = Object.freeze({
  maxLineBytes: 8192,
  maxHeaderBytes: 16384,
  maxHeaders: 100,
  maxBodyBytes: 1048576,
});

/** The limits from the options of RequestParser; throws RangeError for a limit that is not a positive integer. */
export function resolveLimits(options = {}) {
  const limits = { ...DEFAULT_LIMITS };
  for (const name of Object.keys(DEFAULT_LIMITS)) {
    if (options[name] === undefined) continue;
    if (!Number.isInteger(options[name]) || options[name] < 1) throw new RangeError(`${name} must be a positive integer`);
    limits[name] = options[name];
  }
  return limits;
}
