function satisfiesRange(version, range) {
  const isNum = (x) => /^[0-9]+$/.test(x);
  const parseVersion = (s) => {
    const m = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(s);
    if (!m) return null;
    const pre = m[4] === undefined ? [] : m[4].split('.');
    for (const id of pre) {
      if (id === '' || (isNum(id) && id.length > 1 && id[0] === '0')) return null;
    }
    return { major: BigInt(m[1]), minor: BigInt(m[2]), patch: BigInt(m[3]), pre };
  };
  const cmpPre = (x, y) => {
    if (!x.length && !y.length) return 0;
    if (!x.length) return 1;
    if (!y.length) return -1;
    for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
      if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
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
  const sets = range.trim().split('||');
  let anySatisfied = false;
  for (const rawSet of sets) {
    const set = rawSet.trim();
    if (set === '') return false;
    let ok = true;
    for (const token of set.split(/\s+/)) {
      const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(token);
      const v = m ? parseVersion(m[2]) : null;
      if (!v) return false;
      const op = m[1] || '=';
      let pass;
      if (op === '^') {
        let upper;
        if (v.major > 0n) upper = bare(v.major + 1n, 0n, 0n);
        else if (v.minor > 0n) upper = bare(0n, v.minor + 1n, 0n);
        else upper = bare(0n, 0n, v.patch + 1n);
        pass = cmp(target, v) >= 0 && cmp(target, upper) < 0;
      } else if (op === '~') {
        pass = cmp(target, v) >= 0 && cmp(target, bare(v.major, v.minor + 1n, 0n)) < 0;
      } else if (op === '>=') {
        pass = cmp(target, v) >= 0;
      } else if (op === '<=') {
        pass = cmp(target, v) <= 0;
      } else if (op === '>') {
        pass = cmp(target, v) > 0;
      } else if (op === '<') {
        pass = cmp(target, v) < 0;
      } else {
        pass = cmp(target, v) === 0;
      }
      if (!pass) ok = false;
    }
    if (ok) anySatisfied = true;
  }
  return anySatisfied;
}
