// Family "cover": build relay masts so that every district is served by enough masts, at the
// least total cost, when some pairs of sites are too close to be both built. The instance is
//   { sites: [names], cost: [..], covers: [[district indexes]], districts: [names],
//     need: [masts needed per district], conflicts: [[i, j]] }
// A district d is served when at least need[d] of the built sites cover it.
//
// Two exact methods that share no code:
//   coverEnum  walks all 2^n sets of sites (half-tables for the cost) and keeps the cheapest legal set
//   coverBb    depth-first search: pick the district that is hardest to serve, branch on which
//              covering site is the first one built (the earlier candidates are then banned)
// The shortcuts are greedy rules, a cheapest-first rule and a drop-and-swap search.

import { LETTERS, lowBit, pop, subsetSums } from './_opt-util.mjs';

const range = (n) => [...Array(n).keys()];

function masks(instance) {
  const nd = instance.districts.length;
  const cover = Array.from({ length: nd }, () => 0);
  instance.covers.forEach((ds, s) => ds.forEach((d) => (cover[d] |= 1 << s)));
  const adj = instance.sites.map(() => 0);
  for (const [a, b] of instance.conflicts) {
    adj[a] |= 1 << b;
    adj[b] |= 1 << a;
  }
  return { cover, adj };
}

export function coverEnum(instance) {
  const n = instance.sites.length;
  const { cover, adj } = masks(instance);
  const lo = n >> 1;
  const hi = n - lo;
  const cL = subsetSums(instance.cost, 0, lo);
  const cH = subsetSums(instance.cost, lo, hi);
  let best = Infinity;
  for (let h = 0; h < 1 << hi; h += 1) {
    for (let l = 0; l < 1 << lo; l += 1) {
      const cost = cL[l] + cH[h];
      if (cost >= best) continue;
      const mask = l | (h << lo);
      let ok = true;
      for (let m = mask; m && ok; m &= m - 1) if (adj[lowBit(m)] & mask) ok = false;
      for (let d = 0; ok && d < cover.length; d += 1) if (pop(mask & cover[d]) < instance.need[d]) ok = false;
      if (ok) best = cost;
    }
  }
  return best === Infinity ? null : best;
}

export function coverBb(instance) {
  const n = instance.sites.length;
  const nd = instance.districts.length;
  const { cover, adj } = masks(instance);
  let best = Infinity;
  const dfs = (built, banned, cost) => {
    if (cost >= best) return;
    // Hardest unserved district: the smallest number of spare candidates beyond what it still needs.
    let pick = -1;
    let pickSlack = Infinity;
    let bound = cost;
    for (let d = 0; d < nd; d += 1) {
      const deficit = instance.need[d] - pop(built & cover[d]);
      if (deficit <= 0) continue;
      const avail = cover[d] & ~built & ~banned;
      const count = pop(avail);
      if (count < deficit) return;
      const costs = [];
      for (let m = avail; m; m &= m - 1) costs.push(instance.cost[lowBit(m)]);
      costs.sort((a, b) => a - b);
      let need = 0;
      for (let k = 0; k < deficit; k += 1) need += costs[k];
      bound = Math.max(bound, cost + need);
      if (count - deficit < pickSlack) {
        pick = d;
        pickSlack = count - deficit;
      }
    }
    if (bound >= best) return;
    if (pick < 0) {
      best = cost;
      return;
    }
    const candidates = [];
    for (let m = cover[pick] & ~built & ~banned; m; m &= m - 1) candidates.push(lowBit(m));
    candidates.sort((a, b) => instance.cost[a] - instance.cost[b] || a - b);
    let ban = banned;
    for (const s of candidates) {
      dfs(built | (1 << s), ban | adj[s], cost + instance.cost[s]);
      ban |= 1 << s;
    }
  };
  void n;
  dfs(0, 0, 0);
  return best === Infinity ? null : best;
}

// ---- shortcuts -----------------------------------------------------------------------------

const served = (instance, cover, mask) => cover.every((c, d) => pop(mask & c) >= instance.need[d]);
const totalCost = (instance, mask) => range(instance.sites.length).reduce((s, i) => s + (mask & (1 << i) ? instance.cost[i] : 0), 0);

function dropRedundant(instance, cover, mask) {
  let cur = mask;
  const order = range(instance.sites.length).filter((i) => cur & (1 << i)).sort((a, b) => instance.cost[b] - instance.cost[a] || a - b);
  for (const i of order) if (served(instance, cover, cur & ~(1 << i))) cur &= ~(1 << i);
  return cur;
}

function greedyCover(instance, score) {
  const { cover, adj } = masks(instance);
  const n = instance.sites.length;
  let built = 0;
  let banned = 0;
  while (!served(instance, cover, built)) {
    let pick = -1;
    let pickScore = Infinity;
    for (let s = 0; s < n; s += 1) {
      if ((built | banned) & (1 << s)) continue;
      const gain = instance.covers[s].reduce((g, d) => g + (pop(built & cover[d]) < instance.need[d] ? 1 : 0), 0);
      if (gain === 0) continue;
      const sc = score(s, gain);
      if (sc < pickScore) {
        pick = s;
        pickScore = sc;
      }
    }
    if (pick < 0) return null;
    built |= 1 << pick;
    banned |= adj[pick];
  }
  return built;
}

function cheapestFirst(instance) {
  const { cover, adj } = masks(instance);
  const order = range(instance.sites.length).sort((a, b) => instance.cost[a] - instance.cost[b] || a - b);
  let built = 0;
  let banned = 0;
  for (const s of order) {
    if (served(instance, cover, built)) break;
    if ((banned >> s) & 1) continue;
    built |= 1 << s;
    banned |= adj[s];
  }
  return served(instance, cover, built) ? built : null;
}

function swapSearch(instance, start) {
  const { cover, adj } = masks(instance);
  const n = instance.sites.length;
  const legal = (mask) => {
    for (let m = mask; m; m &= m - 1) if (adj[lowBit(m)] & mask) return false;
    return served(instance, cover, mask);
  };
  let mask = start;
  let cost = totalCost(instance, mask);
  for (let improved = true; improved; ) {
    improved = false;
    for (let a = 0; a < n && !improved; a += 1) {
      if (!(mask & (1 << a))) continue;
      const without = mask & ~(1 << a);
      const options = [without];
      for (let b = 0; b < n; b += 1) if (!(mask & (1 << b))) options.push(without | (1 << b));
      for (const c of options) {
        if (totalCost(instance, c) < cost && legal(c)) {
          mask = c;
          cost = totalCost(instance, c);
          improved = true;
          break;
        }
      }
    }
  }
  return cost;
}

export function shortcuts(instance) {
  const { cover } = masks(instance);
  const g1 = greedyCover(instance, (s, gain) => instance.cost[s] / gain);
  const cf = cheapestFirst(instance);
  const pruned = g1 === null ? null : dropRedundant(instance, cover, g1);
  const answerOf = (mask) => (mask === null ? null : totalCost(instance, mask));
  return [
    { name: 'greedy: lowest cost per district still short of masts', answer: answerOf(g1) },
    { name: 'greedy, then remove every mast that is not needed (dearest first)', answer: answerOf(pruned) },
    { name: 'build the cheapest sites first until every district is served, then remove unneeded masts', answer: cf === null ? null : answerOf(dropRedundant(instance, cover, cf)) },
    { name: 'greedy and prune, then drop-or-swap one site while it helps', answer: pruned === null ? null : swapSearch(instance, pruned) },
  ];
}

export function solveProved(instance) {
  const answer = coverBb(instance);
  if (coverEnum(instance) !== answer) throw new Error('cover: the two methods disagree');
  if (answer === null) throw new Error('cover: no legal plan');
  return { answer };
}

export const solve = (instance) => ({ answer: coverBb(instance) });

export function build(rng, cfg) {
  const { sites: n, districts: nd, conflicts, doubleShare } = cfg;
  return rng.attempt(() => {
    const cost = Array.from({ length: n }, () => rng.int(4, 18));
    const covers = Array.from({ length: n }, () => rng.sample(range(nd), rng.int(3, 6)).sort((a, b) => a - b));
    const need = Array.from({ length: nd }, () => (rng.next() < doubleShare ? 2 : 1));
    const pairs = [];
    for (let a = 0; a < n; a += 1) for (let b = a + 1; b < n; b += 1) pairs.push([a, b]);
    const picked = rng.sample(pairs, conflicts).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const instance = {
      sites: LETTERS.slice(0, n).split('').map((x) => `${x}`),
      cost,
      covers,
      districts: Array.from({ length: nd }, (_, d) => `D${d + 1}`),
      need,
      conflicts: picked,
    };
    const answer = coverBb(instance);
    if (answer === null) return null;
    const list = shortcuts(instance);
    if (list.some((x) => x.answer === null)) return null;
    const misses = list.filter((s) => s.answer !== answer).length;
    if (misses < list.length) return null; // every shortcut misses (the suite test asks for it)
    if (Math.min(...list.map((s) => (s.answer === null ? Infinity : s.answer))) > answer * 1.15) return null;
    return instance;
  }, 4000);
}

export function render(instance) {
  const { sites, cost, covers, districts, need, conflicts } = instance;
  const lines = sites.map((name, s) => `Site ${name}: cost ${cost[s]}, covers ${covers[s].map((d) => districts[d]).join(', ')}`);
  const needLines = districts.map((name, d) => `${name} needs ${need[d]}`).join('; ');
  return [
    `A telecom company wants to build relay masts on some of ${sites.length} candidate sites. There are ${districts.length} districts. Each site has a building cost and covers a fixed set of districts:`,
    '',
    ...lines,
    '',
    'Rules for a legal plan:',
    `1. Each district needs a number of masts that cover it: ${needLines}. A mast covers a district when the district appears in the list of its site.`,
    `2. These pairs of sites are too close and must not both be built: ${conflicts.map(([a, b]) => `${sites[a]} and ${sites[b]}`).join('; ')}.`,
    '3. A site is built once or not at all, and the cost of a plan is the sum of the costs of the sites built.',
    '',
    'What is the smallest possible total cost of a legal plan?',
    'Answer format: a whole number, with no units.',
  ].join('\n');
}
