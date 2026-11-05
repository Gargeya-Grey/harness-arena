function parseQuery(qs) {
  const text = qs.startsWith('?') ? qs.slice(1) : qs;
  const decode = (piece) => {
    const spaced = piece.replace(/\+/g, ' ');
    try {
      return decodeURIComponent(spaced);
    } catch {
      return spaced;
    }
  };
  const out = new Map();
  for (const part of text.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const key = decode(eq === -1 ? part : part.slice(0, eq));
    const value = eq === -1 ? '' : decode(part.slice(eq + 1));
    if (key === '') continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(value);
  }
  const result = {};
  for (const [key, values] of out) result[key] = values.length === 1 ? values[0] : values;
  return result;
}
