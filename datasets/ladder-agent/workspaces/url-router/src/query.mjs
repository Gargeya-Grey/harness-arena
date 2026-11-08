// 'a=1&b' -> { a: '1', b: '' }
export function parseQuery(raw) {
  const out = {};
  for (const pair of raw.split('&')) {
    if (pair === '') continue;
    const [key, value = ''] = pair.split('=');
    out[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return out;
}
