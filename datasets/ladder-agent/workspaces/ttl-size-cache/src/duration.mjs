// Durations are written as a number of milliseconds (1500) or as text with
// units: '500ms', '30s', '5m', '2h', '1d', '1.5s', '1h30m'.
const UNITS = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86_400 };
const PART = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/y;

// Returns the duration. Infinity is allowed and means "never".
export function parseDuration(input) {
  if (typeof input === 'number') {
    if (Number.isNaN(input) || input < 0) throw new RangeError(`bad duration: ${input}`);
    return input;
  }
  if (typeof input !== 'string') throw new TypeError(`bad duration: ${String(input)}`);
  const text = input.trim();
  let total = 0;
  let at = 0;
  PART.lastIndex = 0;
  while (at < text.length) {
    PART.lastIndex = at;
    const match = PART.exec(text);
    if (!match) throw new RangeError(`bad duration: ${input}`);
    total += Number(match[1]) * UNITS[match[2]];
    at = PART.lastIndex;
  }
  if (at === 0) throw new RangeError(`bad duration: ${input}`);
  return total;
}
