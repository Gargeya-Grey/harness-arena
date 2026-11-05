function matchOrders(orders) {
  const bids = [];
  const asks = [];
  const trades = [];
  let seq = 0;
  for (const order of orders) {
    if (order[0] === 'X') {
      for (const book of [bids, asks]) {
        const at = book.findIndex((r) => r.id === order[1]);
        if (at >= 0) book.splice(at, 1);
      }
      continue;
    }
    const isLimit = order[0] === 'L';
    const id = order[1];
    const side = order[2];
    const limit = isLimit ? order[3] : null;
    let qty = isLimit ? order[4] : order[3];
    const opposite = side === 'B' ? asks : bids;
    while (qty > 0 && opposite.length > 0) {
      let best = 0;
      for (let i = 1; i < opposite.length; i += 1) {
        const r = opposite[i];
        const b = opposite[best];
        const better = side === 'B' ? r.price < b.price : r.price > b.price;
        if (better || (r.price === b.price && r.seq < b.seq)) best = i;
      }
      const maker = opposite[best];
      if (isLimit && (side === 'B' ? maker.price > limit : maker.price < limit)) break;
      const filled = Math.min(qty, maker.qty);
      trades.push([id, maker.id, maker.price, filled]);
      qty -= filled;
      maker.qty -= filled;
      if (maker.qty === 0) opposite.splice(best, 1);
    }
    if (isLimit && qty > 0) {
      (side === 'B' ? bids : asks).push({ id, price: limit, qty, seq });
      seq += 1;
    }
  }
  const levels = (book, descending) => {
    const totals = new Map();
    for (const r of book) totals.set(r.price, (totals.get(r.price) || 0) + r.qty);
    return [...totals].sort((x, y) => (descending ? y[0] - x[0] : x[0] - y[0])).map(([price, qty]) => [price, qty]);
  };
  return { trades, bids: levels(bids, true), asks: levels(asks, false) };
}
