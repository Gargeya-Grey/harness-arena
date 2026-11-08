// Family "steiner": connect some depots with cable through a network of towns. Cable between
// two towns has a price, and cable may pass through any town, but a town that is not a depot
// charges a one-time junction fee when the cable meets there. The cheapest connecting network
// is the answer (a Steiner tree with fees on the nodes). The instance is
//   { towns: [names], depots: [indexes], fee: [per town; 0 for depots], edges: [[a, b, price]] }
//
// Two exact methods that share no code:
//   steinerDp    Dreyfus-Wagner over subsets of depots: cost of the cheapest tree that joins a
//                subset of depots and a given town, by merging two trees at a town or by growing
//                one tree along an edge (shortest-path relaxation)
//   steinerEnum  tries every set of extra towns, builds the cheapest cable network (minimum
//                spanning tree) on depots plus that set, and adds the fees of the extra towns
// The shortcuts are four constructions that build a good network without a proof.

import { TOWNS } from './_rng.mjs';
import { pop } from './_opt-util.mjs';

const range = (n) => [...Array(n).keys()];

function adjacency(instance) {
  const adj = instance.towns.map(() => []);
  for (const [a, b, w] of instance.edges) {
    adj[a].push([b, w]);
    adj[b].push([a, w]);
  }
  return adj;
}

export function steinerDp(instance) {
  const n = instance.towns.length;
  const adj = adjacency(instance);
  const k = instance.depots.length;
  const full = (1 << k) - 1;
  const dp = Array.from({ length: full + 1 }, () => new Array(n).fill(Infinity));
  instance.depots.forEach((town, i) => (dp[1 << i][town] = 0));
  for (let s = 1; s <= full; s += 1) {
    if (pop(s) > 1) {
      for (let v = 0; v < n; v += 1) {
        for (let sub = (s - 1) & s; sub > 0; sub = (sub - 1) & s) {
          const v2 = dp[sub][v] + dp[s ^ sub][v] - instance.fee[v];
          if (v2 < dp[s][v]) dp[s][v] = v2;
        }
      }
    }
    // Relax along edges (Dijkstra with node fees; n is small).
    const done = new Array(n).fill(false);
    for (let round = 0; round < n; round += 1) {
      let u = -1;
      for (let v = 0; v < n; v += 1) if (!done[v] && (u < 0 || dp[s][v] < dp[s][u])) u = v;
      if (u < 0 || dp[s][u] === Infinity) break;
      done[u] = true;
      for (const [v, w] of adj[u]) {
        const c = dp[s][u] + w + instance.fee[v];
        if (c < dp[s][v]) dp[s][v] = c;
      }
    }
  }
  return dp[full][instance.depots[0]];
}

function mstCost(instance, nodes) {
  const members = nodes.slice();
  const index = new Map(members.map((v, i) => [v, i]));
  const parent = members.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  let total = 0;
  let joined = 1;
  for (const [a, b, w] of instance.edges.slice().sort((p, q) => p[2] - q[2])) {
    if (!index.has(a) || !index.has(b)) continue;
    const ra = find(index.get(a));
    const rb = find(index.get(b));
    if (ra === rb) continue;
    parent[ra] = rb;
    total += w;
    joined += 1;
  }
  return joined === members.length ? total : Infinity;
}

export function steinerEnum(instance) {
  const extra = range(instance.towns.length).filter((v) => !instance.depots.includes(v));
  let best = Infinity;
  for (let mask = 0; mask < 1 << extra.length; mask += 1) {
    const chosen = extra.filter((_, i) => mask & (1 << i));
    const fees = chosen.reduce((s, v) => s + instance.fee[v], 0);
    if (fees >= best) continue;
    const c = mstCost(instance, [...instance.depots, ...chosen]) + fees;
    if (c < best) best = c;
  }
  return best;
}

// ---- shortcuts -----------------------------------------------------------------------------

/** Cheapest way to reach every town from the set `tree`: entering a new town costs edge + fee. */
function reach(instance, adj, tree) {
  const n = instance.towns.length;
  const dist = new Array(n).fill(Infinity);
  const from = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  for (const v of tree) dist[v] = 0;
  for (let round = 0; round < n; round += 1) {
    let u = -1;
    for (let v = 0; v < n; v += 1) if (!done[v] && (u < 0 || dist[v] < dist[u])) u = v;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (const [v, w] of adj[u]) {
      const c = dist[u] + w + (tree.has(v) ? 0 : instance.fee[v]);
      if (!tree.has(v) && c < dist[v]) {
        dist[v] = c;
        from[v] = u;
      }
    }
  }
  return { dist, from };
}

function nearestDepot(instance, start) {
  const adj = adjacency(instance);
  const tree = new Set([start]);
  let cost = 0;
  const left = new Set(instance.depots.filter((d) => d !== start));
  while (left.size) {
    const { dist, from } = reach(instance, adj, tree);
    let pick = -1;
    for (const d of left) if (pick < 0 || dist[d] < dist[pick]) pick = d;
    cost += dist[pick];
    for (let v = pick; !tree.has(v); v = from[v]) tree.add(v);
    left.delete(pick);
  }
  return { cost, nodes: [...tree] };
}

const withFees = (instance, nodes) => {
  const m = mstCost(instance, nodes);
  return m === Infinity ? Infinity : m + nodes.reduce((s, v) => s + instance.fee[v], 0);
};

function closureTree(instance) {
  const adj = adjacency(instance);
  const k = instance.depots.length;
  const paths = [];
  for (let i = 0; i < k; i += 1) {
    const { dist, from } = reach(instance, adj, new Set([instance.depots[i]]));
    for (let j = i + 1; j < k; j += 1) {
      const nodes = [];
      for (let v = instance.depots[j]; v !== -1; v = from[v]) nodes.push(v);
      paths.push({ i, j, cost: dist[instance.depots[j]], nodes });
    }
  }
  paths.sort((a, b) => a.cost - b.cost || a.i - b.i || a.j - b.j);
  const parent = range(k);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const nodes = new Set(instance.depots);
  for (const p of paths) {
    if (find(p.i) === find(p.j)) continue;
    parent[find(p.i)] = find(p.j);
    p.nodes.forEach((v) => nodes.add(v));
  }
  return [...nodes];
}

function prunedSpanningTree(instance) {
  const n = instance.towns.length;
  const parent = range(n);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const chosen = [];
  for (const e of instance.edges.slice().sort((p, q) => p[2] - q[2])) {
    const ra = find(e[0]);
    const rb = find(e[1]);
    if (ra === rb) continue;
    parent[ra] = rb;
    chosen.push(e);
  }
  const degree = new Array(n).fill(0);
  chosen.forEach(([a, b]) => {
    degree[a] += 1;
    degree[b] += 1;
  });
  let edges = chosen;
  for (let changed = true; changed; ) {
    changed = false;
    for (let v = 0; v < n; v += 1) {
      if (degree[v] === 1 && !instance.depots.includes(v)) {
        edges = edges.filter(([a, b]) => {
          if (a !== v && b !== v) return true;
          degree[a] -= 1;
          degree[b] -= 1;
          return false;
        });
        changed = true;
      }
    }
  }
  const used = new Set(edges.flat().length ? edges.flatMap(([a, b]) => [a, b]) : []);
  return edges.reduce((s, e) => s + e[2], 0) + [...used].reduce((s, v) => s + instance.fee[v], 0);
}

export function shortcuts(instance) {
  const first = nearestDepot(instance, instance.depots[0]);
  const starts = instance.depots.map((d) => nearestDepot(instance, d));
  const bestStart = starts.reduce((a, b) => (b.cost < a.cost ? b : a));
  return [
    { name: 'join the nearest unconnected depot, starting from the first depot', answer: first.cost },
    { name: 'the same from every depot, then the cheapest network on the towns used', answer: withFees(instance, bestStart.nodes) },
    { name: 'shortest routes between depots, join the two nearest first, then the cheapest network on the towns used', answer: withFees(instance, closureTree(instance)) },
    { name: 'cheapest cable network over all towns, then cut every dead end that is not a depot', answer: prunedSpanningTree(instance) },
  ];
}

export function solveProved(instance) {
  const answer = steinerDp(instance);
  if (steinerEnum(instance) !== answer) throw new Error('steiner: the two methods disagree');
  return { answer };
}

export const solve = (instance) => ({ answer: steinerDp(instance) });

export function build(rng, cfg) {
  const { size, depotCount, edges: edgeCount } = cfg;
  return rng.attempt(() => {
    const towns = rng.sample(TOWNS, size).sort();
    const pairs = [];
    for (let a = 0; a < size; a += 1) for (let b = a + 1; b < size; b += 1) pairs.push([a, b]);
    const edges = rng.sample(pairs, edgeCount).map(([a, b]) => [a, b, rng.int(3, 16)]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const depots = rng.sample(range(size), depotCount).sort((a, b) => a - b);
    const fee = towns.map((_, v) => (depots.includes(v) ? 0 : rng.int(0, 9)));
    const instance = { towns, depots, fee, edges };
    const answer = steinerDp(instance);
    if (answer === Infinity) return null;
    const list = shortcuts(instance);
    if (list.some((s) => !Number.isFinite(s.answer))) return null;
    const misses = list.filter((s) => s.answer !== answer).length;
    if (misses < list.length) return null; // every shortcut misses (the suite test asks for it)
    if (Math.min(...list.map((s) => s.answer)) > answer * 1.15) return null;
    return instance;
  }, 6000);
}

export function render(instance) {
  const { towns, depots, fee, edges } = instance;
  const extras = towns.map((t, v) => [t, fee[v], v]).filter(([, , v]) => !depots.includes(v));
  return [
    `A utility company must link ${depots.length} depots with underground cable. The ${towns.length} towns are ${towns.join(', ')}. The depots are in ${depots.map((v) => towns[v]).join(', ')}. Cable can be laid only along these routes, each with its price for the whole route:`,
    '',
    edges.map(([a, b, w]) => `${towns[a]} to ${towns[b]}: ${w}`).join('; ') + '.',
    '',
    'Rules:',
    '1. The finished network must connect all depots: from any depot a person can walk to any other depot along laid cable. Cable may pass through any town, and a route is laid in full or not at all.',
    `2. Every town that is not a depot charges a one-time junction fee if the network uses the town at all (that is, if any laid route starts or ends in it). Cable never passes through a town without a junction there. The fees are: ${extras.map(([t, f]) => `${t} ${f}`).join(', ')}. The depots charge no fee.`,
    '3. The cost of a network is the sum of the prices of the routes laid plus the junction fees of the towns it uses.',
    '',
    'What is the smallest possible total cost?',
    'Answer format: a whole number, with no units.',
  ].join('\n');
}
