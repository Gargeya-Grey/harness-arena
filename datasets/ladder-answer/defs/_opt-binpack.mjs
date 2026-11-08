// Family "binpack": pack parcels into boxes of three sizes with three prices, where some
// pairs of parcels may not share a box, at the least total price. The instance is
//   { items: [names], size: [..], conflicts: [[i, j]], boxes: [{ name, cap, price }] }
// A box holds parcels whose total size is at most its capacity. Its price is the price of the
// cheapest box type that is large enough.
//
// Two exact methods that share no code:
//   packDp   dynamic programming over sets of parcels: the cheapest way to pack a set is the
//            cheapest legal first box (the one with the lowest-numbered parcel) plus the rest
//   packDfs  depth-first search that puts each parcel (largest first) into an open box or a
//            new box, cutting every branch whose price so far plus a bound is too high
// The shortcuts are first-fit and best-fit rules, a local search, and the exact answer when
// the conflict pairs are ignored.

import { lowBit } from './_opt-util.mjs';

const range = (n) => [...Array(n).keys()];

function priceFor(instance, total) {
  let best = Infinity;
  for (const box of instance.boxes) if (box.cap >= total && box.price < best) best = box.price;
  return best;
}

const maxCap = (instance) => Math.max(...instance.boxes.map((b) => b.cap));

export function packDp(instance, { ignoreConflicts = false } = {}) {
  const n = instance.items.length;
  const adj = instance.items.map(() => 0);
  if (!ignoreConflicts) {
    for (const [a, b] of instance.conflicts) {
      adj[a] |= 1 << b;
      adj[b] |= 1 << a;
    }
  }
  const full = (1 << n) - 1;
  const total = new Int32Array(1 << n);
  const bad = new Uint8Array(1 << n);
  const price = new Float64Array(1 << n);
  for (let s = 1; s <= full; s += 1) {
    const b = lowBit(s);
    const rest = s & (s - 1);
    total[s] = total[rest] + instance.size[b];
    bad[s] = bad[rest] || adj[b] & rest ? 1 : 0;
    price[s] = bad[s] ? Infinity : priceFor(instance, total[s]);
  }
  const dp = new Float64Array(1 << n).fill(Infinity);
  dp[0] = 0;
  for (let mask = 1; mask <= full; mask += 1) {
    const low = mask & -mask;
    const rest = mask ^ low;
    let best = Infinity;
    // Every box that contains the lowest parcel: low plus a subset of the others.
    for (let sub = rest; ; sub = (sub - 1) & rest) {
      const s = sub | low;
      if (price[s] !== Infinity) {
        const v = price[s] + dp[mask ^ s];
        if (v < best) best = v;
      }
      if (sub === 0) break;
    }
    dp[mask] = best;
  }
  return dp[full];
}

/** `upper` is the price of any real packing; the search then only looks for a cheaper one. */
export function packDfs(instance, upper = Infinity) {
  const n = instance.items.length;
  const order = range(n).sort((a, b) => instance.size[b] - instance.size[a] || a - b);
  const conflict = instance.items.map(() => new Set());
  for (const [a, b] of instance.conflicts) {
    conflict[a].add(b);
    conflict[b].add(a);
  }
  const cap = maxCap(instance);
  const rate = Math.min(...instance.boxes.map((b) => b.price / b.cap));
  const suffix = new Array(n + 1).fill(0);
  for (let k = n - 1; k >= 0; k -= 1) suffix[k] = suffix[k + 1] + instance.size[order[k]];
  const groups = [];
  let best = upper;
  const dfs = (k, current) => {
    if (current >= best) return;
    if (k === n) {
      best = current;
      return;
    }
    let slack = 0;
    for (const g of groups) slack += cap - g.sum;
    const extra = Math.max(0, suffix[k] - slack);
    if (current + Math.ceil(rate * extra - 1e-9) >= best) return;
    const i = order[k];
    const tried = [];
    for (let gi = 0; gi < groups.length; gi += 1) {
      const g = groups[gi];
      if (g.sum + instance.size[i] > cap) continue;
      if (g.members.some((m) => conflict[i].has(m))) continue;
      tried.push(gi);
    }
    tried.sort((a, b) => cap - groups[a].sum - (cap - groups[b].sum));
    for (const gi of tried) {
      const g = groups[gi];
      const before = priceFor(instance, g.sum);
      g.sum += instance.size[i];
      g.members.push(i);
      dfs(k + 1, current - before + priceFor(instance, g.sum));
      g.members.pop();
      g.sum -= instance.size[i];
    }
    groups.push({ sum: instance.size[i], members: [i] });
    dfs(k + 1, current + priceFor(instance, instance.size[i]));
    groups.pop();
  };
  dfs(0, 0);
  return best;
}

// ---- shortcuts -----------------------------------------------------------------------------

/** Pack in the given order into boxes of the largest capacity; first-fit or best-fit; return the groups. */
function fit(instance, order, rule) {
  const conflict = instance.items.map(() => new Set());
  for (const [a, b] of instance.conflicts) {
    conflict[a].add(b);
    conflict[b].add(a);
  }
  const cap = maxCap(instance);
  const groups = [];
  for (const i of order) {
    let pick = -1;
    for (let gi = 0; gi < groups.length; gi += 1) {
      const g = groups[gi];
      if (g.sum + instance.size[i] > cap || g.members.some((m) => conflict[i].has(m))) continue;
      if (rule === 'first') {
        pick = gi;
        break;
      }
      if (pick < 0 || g.sum > groups[pick].sum) pick = gi;
    }
    if (pick < 0) groups.push({ sum: instance.size[i], members: [i] });
    else {
      groups[pick].sum += instance.size[i];
      groups[pick].members.push(i);
    }
  }
  return groups;
}

const groupsPrice = (instance, groups) => groups.reduce((s, g) => s + priceFor(instance, g.sum), 0);

function relocate(instance, groups) {
  const conflict = instance.items.map(() => new Set());
  for (const [a, b] of instance.conflicts) {
    conflict[a].add(b);
    conflict[b].add(a);
  }
  const cap = maxCap(instance);
  let cur = groups.map((g) => ({ sum: g.sum, members: g.members.slice() }));
  let price = groupsPrice(instance, cur);
  for (let improved = true; improved; ) {
    improved = false;
    const moves = [];
    for (let a = 0; a < cur.length; a += 1) {
      for (const i of cur[a].members) {
        for (let b = 0; b < cur.length; b += 1) {
          if (a !== b) moves.push({ i, a, b });
        }
      }
    }
    for (const { i, a, b } of moves) {
      const to = cur[b];
      if (to.sum + instance.size[i] > cap || to.members.some((m) => conflict[i].has(m))) continue;
      const next = cur.map((g) => ({ sum: g.sum, members: g.members.slice() }));
      next[a].sum -= instance.size[i];
      next[a].members = next[a].members.filter((m) => m !== i);
      next[b].sum += instance.size[i];
      next[b].members.push(i);
      const kept = next.filter((g) => g.members.length);
      const p = groupsPrice(instance, kept);
      if (p < price) {
        cur = kept;
        price = p;
        improved = true;
        break;
      }
    }
  }
  return price;
}

/** The four packing rules (cheap); each gives a real packing, so its price is an upper bound. */
export function packingRules(instance) {
  const n = instance.items.length;
  const dec = range(n).sort((a, b) => instance.size[b] - instance.size[a] || a - b);
  const ffd = fit(instance, dec, 'first');
  return [
    { name: 'first-fit decreasing into the largest boxes, then the cheapest box that fits each', answer: groupsPrice(instance, ffd) },
    { name: 'best-fit decreasing into the largest boxes, then the cheapest box that fits each', answer: groupsPrice(instance, fit(instance, dec, 'best')) },
    { name: 'first-fit in the listed order, then the cheapest box that fits each', answer: groupsPrice(instance, fit(instance, range(n), 'first')) },
    { name: 'first-fit decreasing, then move single parcels while the price falls', answer: relocate(instance, ffd) },
  ];
}

export function shortcuts(instance) {
  const n = instance.items.length;
  const dec = range(n).sort((a, b) => instance.size[b] - instance.size[a] || a - b);
  const free = { ...instance, conflicts: [] };
  return [...packingRules(instance), { name: 'ignore the conflict pairs (first-fit decreasing, then the cheapest box that fits each)', answer: groupsPrice(instance, fit(free, dec, 'first')) }];
}

export function solveProved(instance) {
  const answer = packDp(instance);
  if (packDfs(instance) !== answer) throw new Error('binpack: the two methods disagree');
  return { answer };
}

export const solve = (instance) => ({ answer: packDp(instance) });

export function build(rng, cfg) {
  const { size, conflicts, boxes } = cfg;
  return rng.attempt(() => {
    const sizes = Array.from({ length: size }, () => rng.int(2, 11));
    const pairs = [];
    for (let a = 0; a < size; a += 1) for (let b = a + 1; b < size; b += 1) pairs.push([a, b]);
    const picked = rng.sample(pairs, conflicts).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const instance = {
      items: Array.from({ length: size }, (_, i) => `P${i + 1}`),
      size: sizes,
      conflicts: picked,
      boxes,
    };
    // The rules give real packings, so the best of them is a valid upper bound for the search.
    const rules = packingRules(instance);
    const answer = packDfs(instance, Math.min(...rules.map((s) => s.answer)));
    if (rules.some((s) => s.answer === answer)) return null;
    const list = shortcuts(instance);
    const misses = list.filter((s) => s.answer !== answer).length;
    if (misses < list.length) return null; // every shortcut misses (the suite test asks for it)
    if (Math.min(...list.map((s) => s.answer)) > answer * 1.12) return null;
    return instance;
  }, 4000);
}

export function render(instance) {
  const { items, size, conflicts, boxes } = instance;
  return [
    `A warehouse must ship ${items.length} parcels. Each parcel has a size, and boxes come in ${boxes.length} types:`,
    '',
    `Parcels: ${items.map((x, i) => `${x} (size ${size[i]})`).join(', ')}.`,
    `Boxes: ${boxes.map((b) => `${b.name} holds a total size of at most ${b.cap} and costs ${b.price}`).join('; ')}. Any number of boxes of each type is available.`,
    '',
    'Rules:',
    '1. Every parcel goes into exactly one box, and the sizes of the parcels in a box add up to at most the capacity of that box.',
    `2. These pairs of parcels must not share a box: ${conflicts.map(([a, b]) => `${items[a]} and ${items[b]}`).join('; ')}.`,
    '3. The cost of a shipment is the sum of the prices of the boxes used. Boxes are chosen freely, so a box of a cheaper type may be used wherever its capacity is enough.',
    '',
    'What is the smallest possible total cost?',
    'Answer format: a whole number, with no units.',
  ].join('\n');
}
