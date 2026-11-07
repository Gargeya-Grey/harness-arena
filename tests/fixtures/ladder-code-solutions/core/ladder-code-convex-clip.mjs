function clipConvex(a, b) {
  const gcd = (x, y) => {
    let p = x < 0n ? -x : x;
    let q = y < 0n ? -y : y;
    while (q !== 0n) [p, q] = [q, p % q];
    return p;
  };
  const fr = (n, d = 1n) => {
    let num = n;
    let den = d;
    if (den < 0n) {
      num = -num;
      den = -den;
    }
    const g = gcd(num, den) || 1n;
    return [num / g, den / g];
  };
  const add = (p, q) => fr(p[0] * q[1] + q[0] * p[1], p[1] * q[1]);
  const sub = (p, q) => fr(p[0] * q[1] - q[0] * p[1], p[1] * q[1]);
  const mul = (p, q) => fr(p[0] * q[0], p[1] * q[1]);
  const div = (p, q) => fr(p[0] * q[1], p[1] * q[0]);
  const sign = (p) => (p[0] > 0n ? 1 : p[0] < 0n ? -1 : 0);
  const cmp = (p, q) => sign(sub(p, q));
  const same = (u, v) => cmp(u[0], v[0]) === 0 && cmp(u[1], v[1]) === 0;
  const cross = (o, p, q) => sub(mul(sub(p[0], o[0]), sub(q[1], o[1])), mul(sub(p[1], o[1]), sub(q[0], o[0])));
  const twiceArea = (poly) => {
    let s = fr(0n);
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      s = add(s, sub(mul(p[0], q[1]), mul(q[0], p[1])));
    }
    return s;
  };
  const counterClockwise = (list) => {
    const poly = list.map(([x, y]) => [fr(BigInt(x)), fr(BigInt(y))]);
    return sign(twiceArea(poly)) < 0 ? poly.reverse() : poly;
  };

  let subject = counterClockwise(a);
  const clip = counterClockwise(b);
  for (let i = 0; i < clip.length && subject.length > 0; i += 1) {
    const p = clip[i];
    const q = clip[(i + 1) % clip.length];
    const out = [];
    for (let j = 0; j < subject.length; j += 1) {
      const cur = subject[j];
      const nxt = subject[(j + 1) % subject.length];
      const cc = cross(p, q, cur);
      const cn = cross(p, q, nxt);
      if (sign(cc) >= 0) out.push(cur);
      if (sign(cc) * sign(cn) < 0) {
        const t = div(cc, sub(cc, cn));
        out.push([add(cur[0], mul(sub(nxt[0], cur[0]), t)), add(cur[1], mul(sub(nxt[1], cur[1]), t))]);
      }
    }
    subject = out;
  }

  const poly = subject;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < poly.length && !changed; i += 1) {
      if (poly.length > 1 && same(poly[i], poly[(i + 1) % poly.length])) {
        poly.splice(i, 1);
        changed = true;
      }
    }
    for (let i = 0; i < poly.length && !changed; i += 1) {
      const prev = poly[(i + poly.length - 1) % poly.length];
      const next = poly[(i + 1) % poly.length];
      if (poly.length >= 3 && sign(cross(prev, poly[i], next)) === 0) {
        poly.splice(i, 1);
        changed = true;
      }
    }
  }
  const twice = poly.length >= 3 ? twiceArea(poly) : fr(0n);
  const text = (v) => (v[1] === 1n ? v[0].toString() : `${v[0]}/${v[1]}`);
  if (sign(twice) === 0) return { area: '0', vertices: [] };

  let start = 0;
  for (let i = 1; i < poly.length; i += 1) {
    const c = cmp(poly[i][0], poly[start][0]) || cmp(poly[i][1], poly[start][1]);
    if (c < 0) start = i;
  }
  const vertices = [];
  for (let i = 0; i < poly.length; i += 1) {
    const v = poly[(start + i) % poly.length];
    vertices.push([text(v[0]), text(v[1])]);
  }
  return { area: text(mul(twice, fr(1n, 2n))), vertices };
}
