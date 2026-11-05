function earlyLabelOrder(nodes, edges) {
  const preds = new Map(nodes.map((name) => [name, new Set()]));
  const outdeg = new Map(nodes.map((name) => [name, 0]));
  const seen = new Set();
  for (const [a, b] of edges) {
    if (a === b) return null;
    const key = JSON.stringify([a, b]);
    if (seen.has(key)) continue;
    seen.add(key);
    preds.get(b).add(a);
    outdeg.set(a, outdeg.get(a) + 1);
  }
  const ready = nodes.filter((name) => outdeg.get(name) === 0);
  const reversed = [];
  while (ready.length > 0) {
    let best = 0;
    for (let i = 1; i < ready.length; i += 1) {
      if (ready[i] > ready[best]) best = i;
    }
    const [name] = ready.splice(best, 1);
    reversed.push(name);
    for (const p of preds.get(name)) {
      outdeg.set(p, outdeg.get(p) - 1);
      if (outdeg.get(p) === 0) ready.push(p);
    }
  }
  if (reversed.length !== nodes.length) return null;
  return reversed.reverse();
}
