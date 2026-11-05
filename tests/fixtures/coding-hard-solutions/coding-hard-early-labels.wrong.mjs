function earlyLabelOrder(nodes, edges) {
  const succs = new Map(nodes.map((name) => [name, new Set()]));
  const indeg = new Map(nodes.map((name) => [name, 0]));
  const seen = new Set();
  for (const [a, b] of edges) {
    if (a === b) return null;
    const key = JSON.stringify([a, b]);
    if (seen.has(key)) continue;
    seen.add(key);
    succs.get(a).add(b);
    indeg.set(b, indeg.get(b) + 1);
  }
  const ready = nodes.filter((name) => indeg.get(name) === 0);
  const order = [];
  while (ready.length > 0) {
    let best = 0;
    for (let i = 1; i < ready.length; i += 1) {
      if (ready[i] < ready[best]) best = i;
    }
    const [name] = ready.splice(best, 1);
    order.push(name);
    for (const s of succs.get(name)) {
      indeg.set(s, indeg.get(s) - 1);
      if (indeg.get(s) === 0) ready.push(s);
    }
  }
  return order.length === nodes.length ? order : null;
}
