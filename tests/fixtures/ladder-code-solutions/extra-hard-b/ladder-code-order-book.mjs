function runOrderBook(config, events) {
  const { tick, lot, band } = config;
  const levels = { B: new Map(), S: new Map() };
  const byId = new Map();
  const trades = [];
  const results = [];
  let last = null;

  const total = (o) => o.visible + o.hidden;
  const removeOrder = (o) => {
    const queue = levels[o.side].get(o.price);
    queue.splice(queue.indexOf(o), 1);
    if (!queue.length) levels[o.side].delete(o.price);
    byId.delete(o.id);
  };
  const enqueue = (o) => {
    let queue = levels[o.side].get(o.price);
    if (!queue) {
      queue = [];
      levels[o.side].set(o.price, queue);
    }
    queue.push(o);
    byId.set(o.id, o);
  };
  const bestPrice = (side) => {
    const prices = [...levels[side].keys()];
    if (!prices.length) return null;
    return side === 'B' ? Math.max(...prices) : Math.min(...prices);
  };
  const crosses = (side, limit, price) => limit === null || (side === 'B' ? price <= limit : price >= limit);
  const bandOk = (price) => last === null || Math.abs(price - last) * 100 <= last * band;

  function match(inc) {
    const opp = inc.side === 'B' ? 'S' : 'B';
    let traded = 0;
    while (inc.remaining > 0) {
      const p = bestPrice(opp);
      if (p === null || !crosses(inc.side, inc.limit, p)) break;
      const queue = levels[opp].get(p);
      const r = queue[0];
      if (r.account === inc.account) {
        removeOrder(r);
        continue;
      }
      const q = Math.min(inc.remaining, r.visible);
      trades.push(inc.side === 'B' ? [inc.id, r.id, p, q] : [r.id, inc.id, p, q]);
      last = p;
      inc.remaining -= q;
      traded += q;
      r.visible -= q;
      if (r.visible === 0) {
        if (r.hidden > 0) {
          const slice = Math.min(r.display, r.hidden);
          r.visible = slice;
          r.hidden -= slice;
          queue.shift();
          queue.push(r);
        } else {
          removeOrder(r);
        }
      }
    }
    return traded;
  }

  function rest(inc, display) {
    const shown = display !== null && display < inc.remaining ? display : inc.remaining;
    enqueue({ id: inc.id, account: inc.account, side: inc.side, price: inc.limit, visible: shown, hidden: inc.remaining - shown, display });
  }

  for (const event of events) {
    const kind = event[0];
    if (kind === 'limit' || kind === 'market') {
      const isLimit = kind === 'limit';
      const [, id, account, side, a, b, c, d] = event;
      const price = isLimit ? a : null;
      const qty = isLimit ? b : a;
      const tif = isLimit ? c : 'IOC';
      const display = isLimit && d !== undefined ? d : null;
      const positive = (n, unit) => Number.isInteger(n) && n > 0 && n % unit === 0;
      if (byId.has(id)) { results.push('reject:dup'); continue; }
      if (!positive(qty, lot) || (display !== null && !positive(display, lot))) { results.push('reject:lot'); continue; }
      if (isLimit && !positive(price, tick)) { results.push('reject:tick'); continue; }
      if (isLimit && !bandOk(price)) { results.push('reject:band'); continue; }
      const opp = side === 'B' ? 'S' : 'B';
      if (tif === 'FOK') {
        let available = 0;
        for (const [p, queue] of levels[opp]) {
          if (!crosses(side, price, p)) continue;
          for (const o of queue) if (o.account !== account) available += total(o);
        }
        if (available < qty) { results.push('reject:fok'); continue; }
      }
      if (tif === 'POST') {
        const p = bestPrice(opp);
        if (p !== null && crosses(side, price, p)) { results.push('reject:post'); continue; }
      }
      const inc = { id, account, side, limit: price, remaining: qty };
      const traded = match(inc);
      if (inc.remaining === 0) results.push(`filled:${traded}`);
      else if (isLimit && (tif === 'GTC' || tif === 'POST')) {
        rest(inc, display);
        results.push(`rested:${traded}`);
      } else results.push(`expired:${traded}`);
    } else if (kind === 'cancel') {
      const o = byId.get(event[1]);
      if (!o) { results.push('reject:unknown'); continue; }
      removeOrder(o);
      results.push(`cancelled:${total(o)}`);
    } else if (kind === 'replace') {
      const [, id, price, qty] = event;
      const o = byId.get(id);
      if (!o) { results.push('reject:unknown'); continue; }
      if (!Number.isInteger(qty) || qty <= 0 || qty % lot !== 0) { results.push('reject:lot'); continue; }
      if (!Number.isInteger(price) || price <= 0 || price % tick !== 0) { results.push('reject:tick'); continue; }
      if (!bandOk(price)) { results.push('reject:band'); continue; }
      if (price === o.price && qty <= total(o)) {
        let cut = total(o) - qty;
        const fromHidden = Math.min(cut, o.hidden);
        o.hidden -= fromHidden;
        cut -= fromHidden;
        o.visible -= cut;
        results.push('replaced:0');
      } else {
        removeOrder(o);
        const inc = { id, account: o.account, side: o.side, limit: price, remaining: qty };
        const traded = match(inc);
        if (inc.remaining > 0) rest(inc, o.display);
        results.push(`replaced:${traded}`);
      }
    }
  }

  const listing = (side) => {
    const prices = [...levels[side].keys()].sort((x, y) => (side === 'B' ? y - x : x - y));
    const out = [];
    for (const p of prices) for (const o of levels[side].get(p)) out.push([o.id, p, total(o)]);
    return out;
  };
  return { results, trades, book: [listing('B'), listing('S')] };
}
