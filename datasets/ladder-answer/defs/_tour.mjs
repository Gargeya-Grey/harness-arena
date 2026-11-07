// Family "tour": the cheapest route through a small road network that visits every
// town exactly once, from a given first town to a given last town, with two side
// rules: some towns must be visited before others, and only a few toll roads may be
// used. The instance is
//   { towns: [names], roads: [[a, b, length, toll]], from, to, before: [[x, y]], maxTolls }
//
// Two exact methods that share no code:
//   routeSearch  walks every route, cutting a branch that is already too long
//   routeDp      dynamic programming over (towns visited, current town, toll roads used)
// The shortcuts are the nearest-neighbour rule (always drive the shortest allowed
// road to a town not yet visited; null when it gets stuck) and the best route when
// the toll limit is ignored.

import { WORDS, TOWNS, list } from './_rng.mjs';

function adjacency(instance) {
  const adj = instance.towns.map(() => []);
  for (const [a, b, w, toll] of instance.roads) {
    adj[a].push([b, w, toll]);
    adj[b].push([a, w, toll]);
  }
  return adj;
}

const predecessors = (instance) => instance.towns.map((_, y) => instance.before.filter(([, q]) => q === y).map(([x]) => x));

export function routeSearch(instance, { ignoreTolls = false, ignoreOrder = false } = {}) {
  const adj = adjacency(instance);
  const n = instance.towns.length;
  const need = ignoreOrder ? instance.towns.map(() => []) : predecessors(instance);
  const seen = new Array(n).fill(false);
  let best = Infinity;
  const walk = (town, length, visited, tolls) => {
    if (length >= best) return;
    if (visited === n) {
      if (town === instance.to) best = length;
      return;
    }
    if (town === instance.to) return;
    for (const [next, w, toll] of adj[town]) {
      if (seen[next] || !need[next].every((x) => seen[x])) continue;
      const t = tolls + (toll ? 1 : 0);
      if (!ignoreTolls && t > instance.maxTolls) continue;
      seen[next] = true;
      walk(next, length + w, visited + 1, t);
      seen[next] = false;
    }
  };
  seen[instance.from] = true;
  walk(instance.from, 0, 1, 0);
  return best === Infinity ? null : best;
}

export function routeDp(instance, { ignoreTolls = false } = {}) {
  const n = instance.towns.length;
  const adj = adjacency(instance);
  const need = predecessors(instance).map((list_) => list_.reduce((m, x) => m | (1 << x), 0));
  const cap = ignoreTolls ? n : instance.maxTolls;
  const cost = new Map();
  const key = (mask, last, tolls) => (mask * n + last) * (cap + 1) + tolls;
  cost.set(key(1 << instance.from, instance.from, 0), 0);
  // Masks in increasing order reach every state after the states it grows from.
  for (let mask = 1; mask < 1 << n; mask += 1) {
    for (let last = 0; last < n; last += 1) {
      for (let tolls = 0; tolls <= cap; tolls += 1) {
        const here = cost.get(key(mask, last, tolls));
        if (here === undefined || last === instance.to && mask !== (1 << n) - 1) continue;
        for (const [next, w, toll] of adj[last]) {
          if (mask & (1 << next) || (need[next] & mask) !== need[next]) continue;
          const t = tolls + (toll ? 1 : 0);
          if (t > cap) continue;
          const k = key(mask | (1 << next), next, t);
          if (!cost.has(k) || here + w < cost.get(k)) cost.set(k, here + w);
        }
      }
    }
  }
  let best = Infinity;
  for (let tolls = 0; tolls <= cap; tolls += 1) best = Math.min(best, cost.get(key((1 << n) - 1, instance.to, tolls)) ?? Infinity);
  return best === Infinity ? null : best;
}

/** Nearest neighbour: from the current town take the shortest allowed road to an unvisited town. */
export function nearestNeighbour(instance) {
  const adj = adjacency(instance);
  const n = instance.towns.length;
  const need = predecessors(instance);
  const seen = new Array(n).fill(false);
  seen[instance.from] = true;
  let town = instance.from;
  let length = 0;
  let tolls = 0;
  for (let step = 1; step < n; step += 1) {
    const options = adj[town]
      .filter(([next, , toll]) => !seen[next] && need[next].every((x) => seen[x]) && tolls + (toll ? 1 : 0) <= instance.maxTolls && (next !== instance.to || step === n - 1))
      .sort((p, q) => p[1] - q[1] || p[0] - q[0]);
    if (!options.length) return null;
    const [next, w, toll] = options[0];
    seen[next] = true;
    length += w;
    tolls += toll ? 1 : 0;
    town = next;
  }
  return town === instance.to ? length : null;
}

export function solve(instance) {
  return { answer: routeDp(instance) };
}

export function solveProved(instance) {
  const answer = routeDp(instance);
  if (routeSearch(instance) !== answer) throw new Error('tour: the two methods disagree');
  return { answer };
}

export function shortcuts(instance) {
  return [
    { name: 'nearest neighbour', answer: nearestNeighbour(instance) },
    { name: 'ignore the toll limit', answer: routeDp(instance, { ignoreTolls: true }) },
  ];
}

export function build(rng, cfg) {
  const { size, roads: roadCount, tolls, maxTolls, precedences } = cfg;
  return rng.attempt(() => {
    const towns = rng.sample(TOWNS, size).sort();
    const pairs = [];
    for (let a = 0; a < size; a += 1) for (let b = a + 1; b < size; b += 1) pairs.push([a, b]);
    const chosen = rng.sample(pairs, roadCount);
    const tollIndexes = new Set(rng.sample([...chosen.keys()], tolls));
    const roads = chosen.map(([a, b], i) => [a, b, rng.int(5, 45), tollIndexes.has(i) ? 1 : 0]);
    const [from, to] = rng.sample([...Array(size).keys()], 2);
    const middle = [...Array(size).keys()].filter((i) => i !== from && i !== to);
    const before = [];
    for (const [x, y] of Array.from({ length: precedences }, () => rng.sample(middle, 2))) {
      if (!before.some((p) => p[0] === x || p[1] === y || p[0] === y || p[1] === x)) before.push([x, y]);
    }
    if (before.length < precedences) return null;
    const instance = { towns, roads, from, to, before, maxTolls };
    const answer = routeDp(instance);
    if (answer === null) return null;
    const checks = shortcuts(instance);
    // Each shortcut must fail, and each side rule must matter.
    if (checks.some((c) => c.answer === answer)) return null;
    if (routeSearch(instance, { ignoreOrder: true }) === answer) return null;
    return instance;
  }, 20000);
}

export function render(instance) {
  const { towns, roads, from, to, before, maxTolls } = instance;
  const roadText = ([a, b, w, toll]) => `${towns[a]} to ${towns[b]}: ${w}${toll ? ' (toll)' : ''}`;
  const lines = [
    `${WORDS[towns.length][0].toUpperCase() + WORDS[towns.length].slice(1)} towns (${list(towns)}) are joined by these roads, with their length in kilometres. Every road can be driven in both directions:`,
    '',
    roads.map(roadText).join('; ') + '.',
    '',
    `A courier starts in ${towns[from]} and must visit every other town exactly once, ending in ${towns[to]}. The courier never enters a town twice and may use a road only to go from one town to the next. These rules also hold:`,
    '',
    ...before.map(([x, y], i) => `${i + 1}. ${towns[x]} must be visited before ${towns[y]}.`),
    `${before.length + 1}. The roads marked toll are toll roads. The courier can afford ${maxTolls === 1 ? 'only one toll road' : `at most ${WORDS[maxTolls]} toll roads`} in total.`,
    '',
    'What is the smallest possible total length, in kilometres, of the whole trip?',
    'Answer format: a whole number, with no units.',
  ];
  return lines.join('\n');
}
