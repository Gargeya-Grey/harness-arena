function weightedClique(weights, incompatible) {
  let best = 0;
  function visit(available, value) {
    if (value + available.reduce((sum, index) => sum + weights[index], 0) <= best) return;
    best = Math.max(best, value);
    for (let at = 0; at < available.length; at += 1) {
      const index = available[at];
      visit(available.slice(at + 1).filter(other => incompatible(index, other)), value + weights[index]);
    }
  }
  visit(weights.map((_, index) => index), 0);
  return best;
}

function packingBounds(instance) {
  const total = instance.size.reduce((sum, value) => sum + value, 0);
  const maximum = Math.max(...instance.boxes.map(box => box.cap));
  const prices = new Float64Array(total + maximum).fill(Infinity);
  prices[0] = 0;
  for (let capacity = 0; capacity < prices.length; capacity += 1) {
    for (const box of instance.boxes) {
      if (capacity + box.cap < prices.length) prices[capacity + box.cap] = Math.min(prices[capacity + box.cap], prices[capacity] + box.price);
    }
  }
  const conflict = instance.items.map(() => new Set());
  for (const [a, b] of instance.conflicts) { conflict[a].add(b); conflict[b].add(a); }
  const minimumPrices = instance.size.map(size => Math.min(...instance.boxes.filter(box => box.cap >= size).map(box => box.price)));
  // Ignoring parcel indivisibility and conflicts can only reduce the minimum price.
  return {
    capacity_price: Math.min(...prices.subarray(total)),
    separate_boxes: weightedClique(minimumPrices, (a, b) => conflict[a].has(b) || instance.size[a] + instance.size[b] > maximum),
  };
}

function schedulingBounds(instance) {
  const finish = new Map();
  const earliest = index => {
    if (finish.has(index)) return finish.get(index);
    const value = instance.dur[index] + Math.max(0, ...instance.preds[index].map(earliest));
    finish.set(index, value);
    return value;
  };
  const bounds = { critical_path: Math.max(...instance.names.map((_, index) => earliest(index))) };
  instance.cap.forEach((capacity, resource) => {
    bounds[`resource_${resource}`] = Math.ceil(instance.dur.reduce((sum, duration, index) => sum + duration * instance.need[index][resource], 0) / capacity);
  });
  // Every member of a pairwise-incompatible set occupies disjoint time.
  bounds.incompatible_tasks = weightedClique(instance.dur, (a, b) => instance.cap.some((capacity, resource) => instance.need[a][resource] + instance.need[b][resource] > capacity));
  return bounds;
}

export function certificateReview(family, instance, answer) {
  const bounds = family === 'binpack' ? packingBounds(instance) : family === 'rcpsp' ? schedulingBounds(instance) : null;
  if (!bounds) throw new Error(`No certificate review for ${family}`);
  const strongest_bound = Math.max(...Object.values(bounds));
  if (!Number.isFinite(strongest_bound) || strongest_bound > answer) throw new Error(`${family}: invalid lower bound ${strongest_bound} above ${answer}`);
  return { bounds, strongest_bound, gap: answer - strongest_bound, timing: 'unmeasured', scope: 'These tested lower bounds only. A positive gap does not rule out other shortcuts or measure human solving time.' };
}
