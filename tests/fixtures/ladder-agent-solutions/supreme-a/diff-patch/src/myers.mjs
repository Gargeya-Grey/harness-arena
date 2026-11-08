export function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let last = -1;
  for (let d = 0; d <= max && last < 0; d += 1) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        last = d;
        break;
      }
    }
  }

  const reversed = [];
  let x = n;
  let y = m;
  for (let d = last; d > 0; d -= 1) {
    const at = (k) => trace[d][k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      reversed.push({ type: 'equal', line: a[x] });
    }
    if (down) {
      y -= 1;
      reversed.push({ type: 'insert', line: b[y] });
    } else {
      x -= 1;
      reversed.push({ type: 'delete', line: a[x] });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    reversed.push({ type: 'equal', line: a[x] });
  }
  reversed.reverse();

  // Inside one run of changes, every delete comes before every insert.
  const out = [];
  for (let i = 0; i < reversed.length; ) {
    if (reversed[i].type === 'equal') {
      out.push(reversed[i]);
      i += 1;
      continue;
    }
    const deletes = [];
    const inserts = [];
    for (; i < reversed.length && reversed[i].type !== 'equal'; i += 1) (reversed[i].type === 'delete' ? deletes : inserts).push(reversed[i]);
    for (const item of deletes) out.push(item);
    for (const item of inserts) out.push(item);
  }
  return out;
}
