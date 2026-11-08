// Correct, but rebuilds the union-find from every present edge at every query: about (queries * present edges) steps.
function bipartiteTimeline(n, events, seed) {
  let list = events;
  if (typeof events === 'number') {
    list = [];
    let x = seed;
    const draw = () => {
      x = (x * 48271 + 11) % 2147483647;
      return x;
    };
    let added = 0;
    for (let i = 0; i < events; i += 1) {
      const a = draw();
      const b = draw();
      const c = draw();
      const kind = a % 8;
      if (kind <= 2) {
        const u = (b % n) + 1;
        let v = (c % n) + 1;
        if (Math.floor(a / 8) % 1500 !== 0 && u % 2 === v % 2) v = (v % n) + 1;
        list.push(['add', u, v]);
        added += 1;
      } else if (kind === 3) {
        if (added > 0) list.push(['del', (b % added) + 1]);
      } else {
        list.push(['query']);
      }
    }
  }
  const eu = [];
  const ev = [];
  const alive = [];
  const parent = new Int32Array(n);
  const parity = new Uint8Array(n);
  const find = (a) => {
    let p = 0;
    let r = a;
    while (parent[r] !== r) {
      p ^= parity[r];
      r = parent[r];
    }
    // path compression
    let q = p;
    while (parent[a] !== r && a !== r) {
      const nextNode = parent[a];
      const par = parity[a];
      parent[a] = r;
      parity[a] = q;
      q ^= par;
      a = nextNode;
    }
    return r;
  };
  const parOf = (a) => {
    let p = 0;
    while (parent[a] !== a) {
      p ^= parity[a];
      a = parent[a];
    }
    return p;
  };
  let sum = 0;
  let queries = 0;
  for (const event of list) {
    if (event[0] === 'add') {
      eu.push(event[1] - 1);
      ev.push(event[2] - 1);
      alive.push(true);
    } else if (event[0] === 'del') {
      const k = event[1] - 1;
      if (k >= 0 && k < eu.length) alive[k] = false;
    } else {
      queries += 1;
      for (let i = 0; i < n; i += 1) {
        parent[i] = i;
        parity[i] = 0;
      }
      let components = n;
      let odd = 0;
      for (let k = 0; k < eu.length; k += 1) {
        if (!alive[k]) continue;
        const ra = find(eu[k]);
        const rb = find(ev[k]);
        const pa = parOf(eu[k]);
        const pb = parOf(ev[k]);
        if (ra === rb) {
          if (pa === pb) odd += 1;
        } else {
          parent[ra] = rb;
          parity[ra] = pa ^ pb ^ 1;
          components -= 1;
        }
      }
      sum += queries * (2 * components + (odd === 0 ? 1 : 0));
    }
  }
  return sum;
}
