// The best simple answer: keep the list of edges, and answer every query with a fresh union-find over all of them,
// O(q * (n + edges)) in total.
function conflictLedger(n, q, reach, removeTenths, seed) {
  const MOD = 1000000007;
  let x = seed;
  const draw = () => (x = (x * 48271 + 11) % 2147483647);
  const list = [];
  const has = new Set();
  const par = new Int32Array(n);
  const size = new Int32Array(n);
  const flip = new Uint8Array(n);
  const odd = new Uint8Array(n);
  let h = 0;
  for (let op = 0; op < q; op += 1) {
    const kind = draw() % 10;
    const r2 = draw();
    const r3 = draw();
    if (kind >= 7) {
      for (let i = 0; i < n; i += 1) {
        par[i] = i;
        size[i] = 1;
        flip[i] = 0;
        odd[i] = 0;
      }
      let comps = n;
      let oddVerts = 0;
      for (let e = 0; e < list.length; e += 1) {
        const key = list[e];
        let ru = Math.floor(key / n);
        let rv = key % n;
        let pu = 0;
        let pv = 0;
        while (par[ru] !== ru) {
          pu ^= flip[ru];
          ru = par[ru];
        }
        while (par[rv] !== rv) {
          pv ^= flip[rv];
          rv = par[rv];
        }
        if (ru === rv) {
          if (pu === pv && odd[ru] === 0) {
            odd[ru] = 1;
            oddVerts += size[ru];
          }
          continue;
        }
        if (size[ru] < size[rv]) {
          const t = ru;
          ru = rv;
          rv = t;
        }
        par[rv] = ru;
        flip[rv] = pu ^ pv ^ 1;
        if (odd[ru] === 1 && odd[rv] === 0) oddVerts += size[rv];
        else if (odd[ru] === 0 && odd[rv] === 1) oddVerts += size[ru];
        odd[ru] |= odd[rv];
        size[ru] += size[rv];
        comps -= 1;
      }
      let r = r2 % n;
      while (par[r] !== r) r = par[r];
      h = (h * 1000003 + comps) % MOD;
      h = (h * 1000003 + oddVerts) % MOD;
      h = (h * 1000003 + size[r]) % MOD;
      h = (h * 1000003 + odd[r]) % MOD;
    } else if (kind >= 7 - removeTenths) {
      if (list.length > 0) {
        const at = r2 % list.length;
        has.delete(list[at]);
        list[at] = list[list.length - 1];
        list.pop();
      }
    } else {
      const u = r2 % n;
      const v = (u + (r3 % reach)) % n;
      const key = Math.min(u, v) * n + Math.max(u, v);
      if (!has.has(key)) {
        has.add(key);
        list.push(key);
      }
    }
  }
  return h;
}
