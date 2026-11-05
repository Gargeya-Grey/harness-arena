function topoOrder(deps) {
  const names = new Set();
  for (const [task, pre] of Object.entries(deps)) {
    names.add(task);
    for (const p of pre) names.add(p);
  }
  const done = new Set();
  const order = [];
  while (order.length < names.size) {
    const ready = [...names]
      .filter((t) => !done.has(t) && (deps[t] || []).every((p) => done.has(p)))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (!ready.length) return null;
    done.add(ready[0]);
    order.push(ready[0]);
  }
  return order;
}
