// 'a=1&a=2&b' -> { a: ['1', '2'], b: '' }. A repeated key gives an array in order.
const decode = (text) => {
  const spaced = text.replaceAll('+', ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
};

export function parseQuery(raw) {
  const out = Object.create(null);
  for (const pair of raw.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const key = decode(eq < 0 ? pair : pair.slice(0, eq));
    const value = eq < 0 ? '' : decode(pair.slice(eq + 1));
    out[key] = Object.hasOwn(out, key) ? [].concat(out[key], value) : value;
  }
  return out;
}
