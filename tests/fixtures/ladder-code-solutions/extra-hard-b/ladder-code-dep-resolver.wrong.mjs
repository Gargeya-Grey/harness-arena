// Plausible mistakes: a partial "!=" excludes only the filled version ("!=1.2" is !=1.2.0), a partial ">" is read as
// "higher than the filled version" (">1.2" is >1.2.0), and a range with
// a prerelease anywhere in an alternative lets every prerelease through, whatever its MAJOR.MINOR.PATCH.
function resolveDeps(registry, root) {
  const parseVersion = (text) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?$/.exec(text);
    return { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
  };
  const cmpId = (a, b) => {
    const na = /^\d+$/.test(a);
    const nb = /^\d+$/.test(b);
    if (na && nb) return Math.sign(Number(a) - Number(b));
    if (na) return -1;
    if (nb) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  const cmp = (x, y) => {
    for (let i = 0; i < 3; i += 1) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
    if (!x.pre.length && !y.pre.length) return 0;
    if (!x.pre.length) return 1;
    if (!y.pre.length) return -1;
    for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i += 1) {
      const c = cmpId(x.pre[i], y.pre[i]);
      if (c) return c;
    }
    return Math.sign(x.pre.length - y.pre.length);
  };
  const ver = (a, b, c) => ({ n: [a, b, c], pre: [] });

  // A partial version: parts holds the numbers given before the first x, X or *.
  const partial = (text) => {
    const [core, ...preParts] = text.split('-');
    const pieces = core.split('.');
    const parts = [];
    for (const piece of pieces) {
      if (piece === 'x' || piece === 'X' || piece === '*') break;
      parts.push(Number(piece));
    }
    return { parts, full: parts.length === 3, pre: preParts.length ? preParts.join('-').split('.') : [], text };
  };
  const fill = (p) => ver(p.parts[0] ?? 0, p.parts[1] ?? 0, p.parts[2] ?? 0);
  const next = (p) => (p.parts.length === 1 ? ver(p.parts[0] + 1, 0, 0) : ver(p.parts[0], p.parts[1] + 1, 0));
  const exact = (p) => ({ n: p.parts.slice(), pre: p.pre });
  const tupleOf = (p) => (p.full && p.pre.length ? [p.parts.slice()] : []);

  function comparator(token) {
    const m = /^(>=|<=|!=|>|<|=|\^|~)?(.*)$/.exec(token);
    const op = m[1] || '';
    const rest = m[2];
    if (rest === '' || rest === '*' || rest === 'x' || rest === 'X') return { test: () => true, tuples: [] };
    const p = partial(rest);
    let test;
    if (op === '' || op === '=') test = p.full ? (v) => cmp(v, exact(p)) === 0 : (v) => cmp(v, fill(p)) >= 0 && cmp(v, next(p)) < 0;
    else if (op === '>=') test = (v) => cmp(v, p.full ? exact(p) : fill(p)) >= 0;
    else if (op === '>') test = (v) => cmp(v, p.full ? exact(p) : fill(p)) > 0;
    else if (op === '<') test = p.full ? (v) => cmp(v, exact(p)) < 0 : (v) => cmp(v, fill(p)) < 0;
    else if (op === '<=') test = p.full ? (v) => cmp(v, exact(p)) <= 0 : (v) => cmp(v, next(p)) < 0;
    else if (op === '!=') {
      return { test: (v) => cmp(v, p.full ? exact(p) : fill(p)) !== 0, tuples: [] };
    } else {
      const k = p.parts.length;
      let high;
      if (op === '~') high = k === 1 ? ver(p.parts[0] + 1, 0, 0) : ver(p.parts[0], p.parts[1] + 1, 0);
      else if (p.parts[0] > 0 || k === 1) high = ver(p.parts[0] + 1, 0, 0);
      else if (p.parts[1] > 0 || k === 2) high = ver(0, p.parts[1] + 1, 0);
      else high = ver(0, 0, p.parts[2] + 1);
      test = (v) => cmp(v, p.full ? exact(p) : fill(p)) >= 0 && cmp(v, high) < 0;
    }
    return { test, tuples: tupleOf(p) };
  }

  function alternative(text) {
    const trimmed = text.trim();
    const range = /^(\S+) - (\S+)$/.exec(trimmed);
    let comps;
    if (range) {
      const a = partial(range[1]);
      const b = partial(range[2]);
      comps = [{
        test: (v) => cmp(v, a.full ? exact(a) : fill(a)) >= 0 && (b.full ? cmp(v, exact(b)) <= 0 : cmp(v, next(b)) < 0),
        tuples: [...tupleOf(a), ...tupleOf(b)],
      }];
    } else {
      comps = trimmed === '' ? [comparator('')] : trimmed.split(/\s+/).map(comparator);
    }
    return (v) => {
      if (!comps.every((c) => c.test(v))) return false;
      if (!v.pre.length) return true;
      return comps.some((c) => c.tuples.length > 0);
    };
  }
  const rangeCache = new Map();
  const satisfies = (versionText, rangeText) => {
    let tests = rangeCache.get(rangeText);
    if (!tests) {
      tests = rangeText.split('||').map(alternative);
      rangeCache.set(rangeText, tests);
    }
    const v = parseVersion(versionText);
    return tests.some((test) => test(v));
  };

  const order = [];
  const constraints = new Map();
  const chosen = new Map();
  const require = (name, range, undo) => {
    if (!constraints.has(name)) {
      constraints.set(name, []);
      order.push(name);
      undo.names.push(name);
    }
    constraints.get(name).push(range);
    undo.ranges.push(name);
  };
  const rollback = (undo) => {
    for (const name of undo.ranges.reverse()) constraints.get(name).pop();
    for (const name of undo.names) {
      constraints.delete(name);
      order.splice(order.indexOf(name), 1);
    }
  };

  const base = { names: [], ranges: [] };
  for (const [name, range] of Object.entries(root)) require(name, range, base);

  function solve(index) {
    if (index === order.length) return true;
    const name = order[index];
    const versions = Object.keys(registry[name] || {})
      .filter((text) => constraints.get(name).every((range) => satisfies(text, range)))
      .sort((x, y) => cmp(parseVersion(y), parseVersion(x)));
    for (const text of versions) {
      const undo = { names: [], ranges: [] };
      chosen.set(name, text);
      let ok = true;
      for (const [dep, range] of Object.entries(registry[name][text])) {
        if (chosen.has(dep) && !satisfies(chosen.get(dep), range)) {
          ok = false;
          break;
        }
        require(dep, range, undo);
      }
      if (ok && solve(index + 1)) return true;
      rollback(undo);
      chosen.delete(name);
    }
    return false;
  }

  if (!solve(0)) return null;
  return [...chosen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
