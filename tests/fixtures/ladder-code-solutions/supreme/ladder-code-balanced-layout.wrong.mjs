function layoutText(text, width, justify) {
  const alnum = (c) => c !== undefined && /^[A-Za-z0-9]$/.test(c);

  // Items: pieces of words. glue = the item continues the word of the item before it.
  const items = [];
  for (const word of text.split(' ').filter((w) => w.length > 0)) {
    const fragments = [];
    let start = 0;
    for (let i = 1; i < word.length - 1; i += 1) {
      if (word[i] === '-' && alnum(word[i - 1]) && alnum(word[i + 1])) {
        fragments.push(word.slice(start, i + 1));
        start = i + 1;
      }
    }
    fragments.push(word.slice(start));
    let first = true;
    for (const fragment of fragments) {
      for (let p = 0; p < fragment.length; p += width) {
        items.push({ s: fragment.slice(p, p + width), glue: !first });
        first = false;
      }
    }
  }
  const n = items.length;
  if (n === 0) return [];

  // bestCost[i] = cost of the cheapest layout of items i..; next[i] = where its first line ends.
  const bestCost = new Array(n + 1).fill(0);
  const next = new Array(n + 1).fill(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let length = items[i].s.length;
    let chosen = -1;
    let cost = Infinity;
    for (let j = i + 1; j <= n; j += 1) {
      if (j > i + 1) length += (items[j - 1].glue ? 0 : 1) + items[j - 1].s.length;
      if (length > width) break;
      const lineCost = j === n ? 0 : (width - length) ** 2;
      const total = lineCost + bestCost[j];
      // On equal cost the later break wins, so the first line is as long as it can be.
      if (total <= Infinity) {
        cost = total;
        chosen = j;
      }
    }
    bestCost[i] = cost;
    next[i] = chosen;
  }

  const out = [];
  for (let i = 0; i < n; ) {
    const j = next[i];
    let gaps = 0;
    let length = items[i].s.length;
    for (let k = i + 1; k < j; k += 1) {
      if (!items[k].glue) gaps += 1;
      length += (items[k].glue ? 0 : 1) + items[k].s.length;
    }
    const extra = justify && j < n && gaps > 0 ? width - length : 0;
    const each = gaps > 0 ? Math.floor(extra / gaps) : 0;
    const more = gaps > 0 ? extra % gaps : 0;
    let line = items[i].s;
    let gap = 0;
    for (let k = i + 1; k < j; k += 1) {
      if (items[k].glue) line += items[k].s;
      else {
        line += ' '.repeat(1 + each + (gap < more ? 1 : 0)) + items[k].s;
        gap += 1;
      }
    }
    out.push(line);
    i = j;
  }
  return out;
}
