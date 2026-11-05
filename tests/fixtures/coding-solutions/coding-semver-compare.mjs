function semverCompare(a, b) {
  const parse = (v) => {
    const [core, ...rest] = v.split('+')[0].split('-');
    const [major, minor, patch] = core.split('.').map(Number);
    return { nums: [major, minor, patch], pre: rest.length ? rest.join('-').split('.') : null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i += 1) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (!x.pre && !y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const numeric = (s) => /^\d+$/.test(s);
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === q) continue;
    if (numeric(p) && numeric(q)) return Number(p) < Number(q) ? -1 : 1;
    if (numeric(p)) return -1;
    if (numeric(q)) return 1;
    return p < q ? -1 : 1;
  }
  if (x.pre.length === y.pre.length) return 0;
  return x.pre.length < y.pre.length ? -1 : 1;
}
