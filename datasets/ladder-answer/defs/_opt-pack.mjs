// Family "pack": choose crates for one hold with two capacity limits (weight and volume),
// pairs of crates that may not travel together, and a limit on how many crates may come from
// each shipper. The most valuable legal load is the answer. The instance is
//   { names: [..], value: [..], weight: [..], volume: [..], capW, capV,
//     conflicts: [[i, j]], shippers: [[crate indexes]], limits: [max crates per shipper] }
//
// Two exact methods that share no code:
//   packBb     depth-first search over take / skip, with an upper bound from a single combined
//              capacity (weight / capW + volume / capV can not exceed 2)
//   packEnum   walks all 2^n loads (two half-tables of sums) and keeps the best legal one
// The shortcuts are greedy rules and a swap search.

import { LETTERS, pop, subsetSums } from './_opt-util.mjs';

const range = (n) => [...Array(n).keys()];

function checker(instance) {
  const n = instance.names.length;
  const confMask = instance.conflicts.map(([a, b]) => (1 << a) | (1 << b));
  const shipMask = instance.shippers.map((g) => g.reduce((m, i) => m | (1 << i), 0));
  const legal = (mask) => {
    for (const c of confMask) if ((mask & c) === c) return false;
    for (let g = 0; g < shipMask.length; g += 1) if (pop(mask & shipMask[g]) > instance.limits[g]) return false;
    return true;
  };
  return { n, legal, confMask, shipMask };
}

export function packEnum(instance) {
  const { n, legal } = checker(instance);
  const lo = n >> 1;
  const hi = n - lo;
  const vL = subsetSums(instance.value, 0, lo);
  const wL = subsetSums(instance.weight, 0, lo);
  const uL = subsetSums(instance.volume, 0, lo);
  const vH = subsetSums(instance.value, lo, hi);
  const wH = subsetSums(instance.weight, lo, hi);
  const uH = subsetSums(instance.volume, lo, hi);
  let best = 0;
  for (let h = 0; h < 1 << hi; h += 1) {
    for (let l = 0; l < 1 << lo; l += 1) {
      if (wL[l] + wH[h] > instance.capW || uL[l] + uH[h] > instance.capV) continue;
      const value = vL[l] + vH[h];
      if (value <= best) continue;
      if (legal(l | (h << lo))) best = value;
    }
  }
  return best;
}

export function packBb(instance) {
  const { n, legal, confMask, shipMask } = checker(instance);
  const cost = instance.names.map((_, i) => instance.weight[i] * instance.capV + instance.volume[i] * instance.capW);
  const room = 2 * instance.capW * instance.capV;
  const order = range(n).sort((a, b) => instance.value[b] * cost[a] - instance.value[a] * cost[b] || a - b);
  const bit = order.map((_, k) => 1 << k);
  let best = 0;
  const dfs = (k, mask, value, w, u, used) => {
    if (value > best) best = value;
    if (k === n) return;
    // Fractional bound on the combined capacity.
    let bound = value;
    let left = room - used;
    for (let m = k; m < n && left > 0; m += 1) {
      const i = order[m];
      if (cost[i] <= left) {
        bound += instance.value[i];
        left -= cost[i];
      } else {
        bound += (instance.value[i] * left) / cost[i];
        left = 0;
      }
    }
    if (bound < best + 1 - 1e-9) return;
    const i = order[k];
    if (w + instance.weight[i] <= instance.capW && u + instance.volume[i] <= instance.capV) {
      const m2 = mask | bit[k];
      let ok = true;
      for (const c of confMask) if ((m2 & c) === c) ok = false;
      for (let g = 0; ok && g < shipMask.length; g += 1) if (pop(m2 & shipMask[g]) > instance.limits[g]) ok = false;
      if (ok) dfs(k + 1, m2, value + instance.value[i], w + instance.weight[i], u + instance.volume[i], used + cost[i]);
    }
    dfs(k + 1, mask, value, w, u, used);
  };
  // `mask` here is over positions in `order`; remap the rules once.
  const pos = new Array(n);
  order.forEach((i, k) => (pos[i] = k));
  confMask.forEach((c, x) => {
    let m = 0;
    for (let i = 0; i < n; i += 1) if (c & (1 << i)) m |= 1 << pos[i];
    confMask[x] = m;
  });
  shipMask.forEach((c, x) => {
    let m = 0;
    for (let i = 0; i < n; i += 1) if (c & (1 << i)) m |= 1 << pos[i];
    shipMask[x] = m;
  });
  void legal;
  dfs(0, 0, 0, 0, 0, 0);
  return best;
}

/** Add crates in the given order while the load stays legal; return the set as a mask. */
function greedyLoad(instance, order) {
  const { legal } = checker(instance);
  let mask = 0;
  let w = 0;
  let u = 0;
  for (const i of order) {
    if (w + instance.weight[i] > instance.capW || u + instance.volume[i] > instance.capV) continue;
    if (!legal(mask | (1 << i))) continue;
    mask |= 1 << i;
    w += instance.weight[i];
    u += instance.volume[i];
  }
  return mask;
}

const loadValue = (instance, mask) => range(instance.names.length).reduce((s, i) => s + (mask & (1 << i) ? instance.value[i] : 0), 0);

function swapSearch(instance, start) {
  const { n, legal } = checker(instance);
  const totals = (mask) => range(n).reduce((a, i) => (mask & (1 << i) ? [a[0] + instance.weight[i], a[1] + instance.volume[i]] : a), [0, 0]);
  const fits = (mask) => {
    const [w, u] = totals(mask);
    return w <= instance.capW && u <= instance.capV && legal(mask);
  };
  let mask = start;
  let value = loadValue(instance, mask);
  for (let improved = true; improved; ) {
    improved = false;
    const candidates = [];
    for (let a = 0; a < n; a += 1) {
      if (!(mask & (1 << a))) candidates.push(mask | (1 << a));
      else {
        candidates.push(mask & ~(1 << a));
        for (let b = 0; b < n; b += 1) if (!(mask & (1 << b))) candidates.push((mask & ~(1 << a)) | (1 << b));
      }
    }
    for (const c of candidates) {
      const v = loadValue(instance, c);
      if (v > value && fits(c)) {
        mask = c;
        value = v;
        improved = true;
        break;
      }
    }
  }
  return value;
}

export function shortcuts(instance) {
  const n = instance.names.length;
  const size = (i) => instance.weight[i] / instance.capW + instance.volume[i] / instance.capV;
  const byWeight = range(n).sort((a, b) => instance.value[b] / instance.weight[b] - instance.value[a] / instance.weight[a] || a - b);
  const bySize = range(n).sort((a, b) => instance.value[b] / size(b) - instance.value[a] / size(a) || a - b);
  const byValue = range(n).sort((a, b) => instance.value[b] - instance.value[a] || a - b);
  const g2 = greedyLoad(instance, bySize);
  return [
    { name: 'best value per kilogram first', answer: loadValue(instance, greedyLoad(instance, byWeight)) },
    { name: 'best value per share of both limits first', answer: loadValue(instance, g2) },
    { name: 'most valuable crate first', answer: loadValue(instance, greedyLoad(instance, byValue)) },
    { name: 'greedy, then add / drop / swap one crate while it helps', answer: swapSearch(instance, g2) },
  ];
}

export function solveProved(instance) {
  const answer = packBb(instance);
  if (packEnum(instance) !== answer) throw new Error('pack: the two methods disagree');
  return { answer };
}

export const solve = (instance) => ({ answer: packBb(instance) });

export function build(rng, cfg) {
  const { size, shippers, conflicts } = cfg;
  return rng.attempt(() => {
    const weight = Array.from({ length: size }, () => rng.int(5, 30));
    const volume = Array.from({ length: size }, () => rng.int(3, 20));
    const value = weight.map((w, i) => Math.round(w * 1.6 + volume[i] * 1.2 + rng.int(0, 18)));
    const capW = Math.round(weight.reduce((a, b) => a + b, 0) * 0.38);
    const capV = Math.round(volume.reduce((a, b) => a + b, 0) * 0.42);
    const owner = rng.shuffle(range(size)).map((i, k) => [i, k % shippers]);
    const groups = Array.from({ length: shippers }, () => []);
    for (const [i, g] of owner) groups[g].push(i);
    groups.forEach((g) => g.sort((a, b) => a - b));
    const limits = groups.map((g) => Math.max(2, Math.floor(g.length / 2)));
    const pairs = [];
    for (let a = 0; a < size; a += 1) for (let b = a + 1; b < size; b += 1) pairs.push([a, b]);
    const picked = rng.sample(pairs, conflicts).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const instance = { names: LETTERS.slice(0, size).split(''), value, weight, volume, capW, capV, conflicts: picked, shippers: groups, limits };
    const answer = packBb(instance);
    const list = shortcuts(instance);
    const misses = list.filter((s) => s.answer !== answer).length;
    if (misses < list.length) return null; // every shortcut misses (the suite test asks for it)
    if (Math.max(...list.map((s) => s.answer)) < answer * 0.88) return null;
    return instance;
  }, 4000);
}

export function render(instance) {
  const { names, value, weight, volume, capW, capV, conflicts, shippers, limits } = instance;
  const crateLines = names.map((name, i) => `Crate ${name}: value ${value[i]}, weight ${weight[i]} kg, volume ${volume[i]} m3`);
  const shipLines = shippers.map((g, k) => `Shipper ${k + 1} sends crates ${g.map((i) => names[i]).join(', ')}; at most ${limits[k]} of them may be loaded.`);
  return [
    `A cargo hold can take at most ${capW} kg and at most ${capV} m3 in total. ${names.length} crates wait on the dock:`,
    '',
    ...crateLines,
    '',
    'Rules for a legal load:',
    '1. The total weight of the loaded crates is at most the weight limit, and the total volume is at most the volume limit (each limit on its own).',
    `2. These pairs of crates must not both be loaded: ${conflicts.map(([a, b]) => `${names[a]} and ${names[b]}`).join('; ')}.`,
    '3. Each shipper has a limit on how many of its crates may be loaded:',
    ...shipLines.map((line) => `   ${line}`),
    '4. A crate is loaded whole or not at all.',
    '',
    'What is the largest possible total value of a legal load?',
    'Answer format: a whole number, with no units.',
  ].join('\n');
}
