function satisfiesRange(version, range) {
  const isNum = (x) => /^[0-9]+$/.test(x);
  const parseVersion = (s) => {
    const m = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(s);
    if (!m) return null;
    const pre = m[4] === undefined ? [] : m[4].split('.');
    for (const id of pre) {
      if (id === '' || (isNum(id) && id.length > 1 && id[0] === '0')) return null;
    }
    if (m[5] !== undefined && m[5].split('.').some((id) => id === '')) return null;
    return { major: BigInt(m[1]), minor: BigInt(m[2]), patch: BigInt(m[3]), pre };
  };
  const cmpPre = (x, y) => {
    if (!x.length && !y.length) return 0;
    if (!x.length) return 1;
    if (!y.length) return -1;
    for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
      const a = x[i];
      const b = y[i];
      if (isNum(a) && isNum(b)) {
        const d = BigInt(a) - BigInt(b);
        if (d !== 0n) return d < 0n ? -1 : 1;
      } else if (isNum(a)) {
        return -1;
      } else if (isNum(b)) {
        return 1;
      } else if (a !== b) {
        return a < b ? -1 : 1;
      }
    }
    if (x.length === y.length) return 0;
    return x.length < y.length ? -1 : 1;
  };
  const cmp = (u, v) => {
    for (const key of ['major', 'minor', 'patch']) {
      if (u[key] !== v[key]) return u[key] < v[key] ? -1 : 1;
    }
    return cmpPre(u.pre, v.pre);
  };
  const bare = (major, minor, patch) => ({ major, minor, patch, pre: [] });

  const target = parseVersion(version);
  if (!target) return false;
  const sets = range.replace(/^[ \t]+|[ \t]+$/g, '').split('||');
  let anySatisfied = false;
  for (const rawSet of sets) {
    const set = rawSet.replace(/^[ \t]+|[ \t]+$/g, '');
    if (set === '') return false;
    const constraints = [];
    const preTuples = [];
    for (const token of set.split(/[ \t]+/)) {
      const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(token);
      const v = m ? parseVersion(m[2]) : null;
      if (!v) return false;
      const op = m[1] || '=';
      if (v.pre.length) preTuples.push(v);
      if (op === '^') {
        let upper;
        if (v.major > 0n) upper = bare(v.major + 1n, 0n, 0n);
        else if (v.minor > 0n) upper = bare(0n, v.minor + 1n, 0n);
        else upper = bare(0n, 0n, v.patch + 1n);
        constraints.push((x) => cmp(x, v) >= 0 && cmp(x, upper) < 0);
      } else if (op === '~') {
        const upper = bare(v.major, v.minor + 1n, 0n);
        constraints.push((x) => cmp(x, v) >= 0 && cmp(x, upper) < 0);
      } else if (op === '>=') {
        constraints.push((x) => cmp(x, v) >= 0);
      } else if (op === '<=') {
        constraints.push((x) => cmp(x, v) <= 0);
      } else if (op === '>') {
        constraints.push((x) => cmp(x, v) > 0);
      } else if (op === '<') {
        constraints.push((x) => cmp(x, v) < 0);
      } else {
        constraints.push((x) => cmp(x, v) === 0);
      }
    }
    if (!constraints.every((check) => check(target))) continue;
    if (target.pre.length) {
      const allowed = preTuples.some((v) => v.major === target.major && v.minor === target.minor && v.patch === target.patch);
      if (!allowed) continue;
    }
    anySatisfied = true;
  }
  return anySatisfied;
}
