// Exact intersection of two convex polygons. Sutherland-Hodgman clipping of
// polygon a by every edge of polygon b, using BigInt rational numbers.
export function clipConvex(a, b) {
  const gcd = (x, y) => {
    if (x < 0n) x = -x;
    if (y < 0n) y = -y;
    while (y !== 0n) {
      const t = x % y;
      x = y;
      y = t;
    }
    return x;
  };
  const F = (n, d = 1n) => {
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    if (g > 1n) {
      n /= g;
      d /= g;
    }
    return { n, d };
  };
  const add = (p, q) => F(p.n * q.d + q.n * p.d, p.d * q.d);
  const sub = (p, q) => F(p.n * q.d - q.n * p.d, p.d * q.d);
  const mul = (p, q) => F(p.n * q.n, p.d * q.d);
  const div = (p, q) => F(p.n * q.d, p.d * q.n);
  const sign = (p) => (p.n > 0n ? 1 : p.n < 0n ? -1 : 0);
  const eq = (p, q) => p.n === q.n && p.d === q.d;
  const fmt = (p) => (p.d === 1n ? p.n.toString() : p.n.toString() + '/' + p.d.toString());

  // Orient counter-clockwise (integer shoelace).
  const orient = (poly) => {
    const pts = poly.map((p) => [BigInt(p[0]), BigInt(p[1])]);
    let s = 0n;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      s += p[0] * q[1] - q[0] * p[1];
    }
    if (s < 0n) pts.reverse();
    return pts;
  };

  const A = orient(a);
  const B = orient(b);
  let poly = A.map((p) => ({ x: F(p[0]), y: F(p[1]) }));

  for (let e = 0; e < B.length && poly.length > 0; e++) {
    const b0 = B[e];
    const b1 = B[(e + 1) % B.length];
    const dx = F(b1[0] - b0[0]);
    const dy = F(b1[1] - b0[1]);
    const bx = F(b0[0]);
    const by = F(b0[1]);
    const side = (p) => sub(mul(dx, sub(p.y, by)), mul(dy, sub(p.x, bx)));
    const sides = poly.map(side);
    const out = [];
    const cnt = poly.length;
    for (let i = 0; i < cnt; i++) {
      const cur = poly[i];
      const nxt = poly[(i + 1) % cnt];
      const sc = sign(sides[i]);
      const sn = sign(sides[(i + 1) % cnt]);
      if (sc >= 0) out.push(cur);
      if ((sc > 0 && sn < 0) || (sc < 0 && sn > 0)) {
        const t = div(sides[i], sub(sides[i], sides[(i + 1) % cnt]));
        out.push({
          x: add(cur.x, mul(t, sub(nxt.x, cur.x))),
          y: add(cur.y, mul(t, sub(nxt.y, cur.y))),
        });
      }
    }
    poly = out;
  }

  const EMPTY = () => ({ area: '0', vertices: [] });

  // Remove repeated vertices.
  const dedupe = (pts) => {
    const r = [];
    for (const p of pts) {
      const last = r[r.length - 1];
      if (last && eq(last.x, p.x) && eq(last.y, p.y)) continue;
      r.push(p);
    }
    while (r.length > 1) {
      const f = r[0];
      const l = r[r.length - 1];
      if (eq(f.x, l.x) && eq(f.y, l.y)) r.pop();
      else break;
    }
    return r;
  };

  let pts = dedupe(poly);
  if (pts.length < 3) return EMPTY();

  // Remove vertices on the straight line between their neighbours.
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i + pts.length - 1) % pts.length];
      const c = pts[i];
      const n = pts[(i + 1) % pts.length];
      const cr = sub(
        mul(sub(c.x, p.x), sub(n.y, c.y)),
        mul(sub(c.y, p.y), sub(n.x, c.x)),
      );
      if (sign(cr) === 0) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  if (pts.length < 3) return EMPTY();

  let area2 = F(0n);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area2 = add(area2, sub(mul(p.x, q.y), mul(q.x, p.y)));
  }
  if (sign(area2) === 0) return EMPTY();
  if (sign(area2) < 0) {
    pts.reverse();
    area2 = F(-area2.n, area2.d);
  }

  // Start at the smallest x, then the smallest y.
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const cx = sign(sub(pts[i].x, pts[s].x));
    if (cx < 0 || (cx === 0 && sign(sub(pts[i].y, pts[s].y)) < 0)) s = i;
  }
  const ordered = pts.slice(s).concat(pts.slice(0, s));

  return {
    area: fmt(div(area2, F(2n))),
    vertices: ordered.map((p) => [fmt(p.x), fmt(p.y)]),
  };
}
