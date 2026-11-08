// Family "jobs": one machine, jobs with release times and weights, and a setup time that
// depends on which job ran just before. The cost is the weighted sum of the finish times.
// The instance is
//   { names: [..], p: [time], w: [weight], r: [release], setup: [[s(i then j)]] }
// A job j that follows job i starts at max(finish of i + setup[i][j], r[j]); the first job
// starts at max(0, r[j]) with no setup. (The machine may set up while it waits for a release.)
//
// Two exact methods that share no code:
//   jobsDp   dynamic programming over (set of jobs done, last job) that keeps, for every state,
//            every non-dominated pair (finish time, cost so far)
//   jobsBb   depth-first search over orders with a lower bound (each job still to do finishes
//            no earlier than max(now, release) + its time)
// The shortcuts are five dispatch rules and a local search.

import { LETTERS } from './_opt-util.mjs';

export function orderCost(instance, order) {
  let t = 0;
  let total = 0;
  let prev = -1;
  for (const j of order) {
    const s = prev < 0 ? 0 : instance.setup[prev][j];
    t = Math.max(t + s, instance.r[j]) + instance.p[j];
    total += instance.w[j] * t;
    prev = j;
  }
  return total;
}

export function jobsDp(instance) {
  const n = instance.p.length;
  const states = new Array((1 << n) * n);
  const add = (index, t, cost) => {
    const cell = states[index] || (states[index] = []);
    for (const [t2, c2] of cell) if (t2 <= t && c2 <= cost) return;
    states[index] = cell.filter(([t2, c2]) => !(t <= t2 && cost <= c2));
    states[index].push([t, cost]);
  };
  for (let j = 0; j < n; j += 1) {
    const t = Math.max(0, instance.r[j]) + instance.p[j];
    add((1 << j) * n + j, t, instance.w[j] * t);
  }
  for (let mask = 1; mask < 1 << n; mask += 1) {
    for (let last = 0; last < n; last += 1) {
      const cell = states[mask * n + last];
      if (!cell) continue;
      for (let j = 0; j < n; j += 1) {
        if (mask & (1 << j)) continue;
        for (const [t, c] of cell) {
          const t2 = Math.max(t + instance.setup[last][j], instance.r[j]) + instance.p[j];
          add((mask | (1 << j)) * n + j, t2, c + instance.w[j] * t2);
        }
      }
    }
  }
  let best = Infinity;
  for (let last = 0; last < n; last += 1) for (const [, c] of states[((1 << n) - 1) * n + last] || []) best = Math.min(best, c);
  return best;
}

export function jobsBb(instance) {
  const n = instance.p.length;
  const done = new Array(n).fill(false);
  let best = Infinity;
  const dfs = (count, last, t, cost) => {
    if (count === n) {
      if (cost < best) best = cost;
      return;
    }
    let bound = cost;
    for (let j = 0; j < n; j += 1) if (!done[j]) bound += instance.w[j] * (Math.max(t, instance.r[j]) + instance.p[j]);
    if (bound >= best) return;
    const next = [];
    for (let j = 0; j < n; j += 1) {
      if (done[j]) continue;
      const t2 = Math.max(t + (last < 0 ? 0 : instance.setup[last][j]), instance.r[j]) + instance.p[j];
      next.push([j, t2]);
    }
    next.sort((a, b) => a[1] * instance.w[b[0]] - b[1] * instance.w[a[0]]);
    for (const [j, t2] of next) {
      done[j] = true;
      dfs(count + 1, j, t2, cost + instance.w[j] * t2);
      done[j] = false;
    }
  };
  dfs(0, -1, 0, 0);
  return best;
}

const range = (n) => [...Array(n).keys()];

function dispatch(instance, score) {
  const n = instance.p.length;
  const left = new Set(range(n));
  const order = [];
  let t = 0;
  let last = -1;
  while (left.size) {
    let pick = -1;
    let pickScore = Infinity;
    for (const j of [...left].sort((a, b) => a - b)) {
      const finish = Math.max(t + (last < 0 ? 0 : instance.setup[last][j]), instance.r[j]) + instance.p[j];
      const s = score(j, finish);
      if (s < pickScore) {
        pick = j;
        pickScore = s;
      }
    }
    t = Math.max(t + (last < 0 ? 0 : instance.setup[last][pick]), instance.r[pick]) + instance.p[pick];
    order.push(pick);
    left.delete(pick);
    last = pick;
  }
  return order;
}

function adjacentSwaps(instance, order) {
  let cur = order.slice();
  let cost = orderCost(instance, cur);
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i + 1 < cur.length; i += 1) {
      const trial = cur.slice();
      [trial[i], trial[i + 1]] = [trial[i + 1], trial[i]];
      const c = orderCost(instance, trial);
      if (c < cost) {
        cur = trial;
        cost = c;
        improved = true;
      }
    }
  }
  return cost;
}

export function shortcuts(instance) {
  const n = instance.p.length;
  const wspt = range(n).sort((a, b) => instance.p[a] * instance.w[b] - instance.p[b] * instance.w[a] || a - b);
  const erd = range(n).sort((a, b) => instance.r[a] - instance.r[b] || instance.p[a] * instance.w[b] - instance.p[b] * instance.w[a] || a - b);
  return [
    { name: 'shortest time per weight first (ignore releases and setups)', answer: orderCost(instance, wspt) },
    { name: 'earliest release first', answer: orderCost(instance, erd) },
    { name: 'always the job that would finish soonest', answer: orderCost(instance, dispatch(instance, (j, f) => f)) },
    { name: 'always the smallest finish time per weight', answer: orderCost(instance, dispatch(instance, (j, f) => f / instance.w[j])) },
    { name: 'shortest-per-weight order, then swap neighbours while it helps', answer: adjacentSwaps(instance, wspt) },
  ];
}

export function solveProved(instance) {
  const answer = jobsDp(instance);
  if (jobsBb(instance) !== answer) throw new Error('jobs: the two methods disagree');
  return { answer };
}

export const solve = (instance) => ({ answer: jobsDp(instance) });

export function build(rng, cfg) {
  const { size, maxRelease } = cfg;
  return rng.attempt(() => {
    const p = Array.from({ length: size }, () => rng.int(2, 9));
    const w = Array.from({ length: size }, () => rng.int(1, 9));
    const r = Array.from({ length: size }, () => (rng.int(0, 3) === 0 ? 0 : rng.int(1, maxRelease)));
    const setup = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (__, j) => (i === j ? 0 : rng.int(0, 7))));
    const instance = { names: LETTERS.slice(0, size).split(''), p, w, r, setup };
    const answer = jobsDp(instance);
    const list = shortcuts(instance);
    const misses = list.filter((s) => s.answer !== answer).length;
    if (misses < list.length) return null; // every shortcut misses (the suite test asks for it)
    // A near optimum is easy: the best shortcut is within 12 percent.
    if (Math.min(...list.map((s) => s.answer)) > answer * 1.12) return null;
    return instance;
  }, 4000);
}

export function render(instance) {
  const { names, p, w, r, setup } = instance;
  const n = names.length;
  const jobLines = names.map((name, i) => `Job ${name}: processing time ${p[i]}, release time ${r[i]}, weight ${w[i]}`);
  const header = `from \\ to   ${names.map((x) => x.padStart(3)).join('')}`;
  const rows = names.map((x, i) => `${x}${' '.repeat(11)}${setup[i].map((s, j) => (i === j ? '  -' : String(s).padStart(3))).join('')}`);
  return [
    `A single machine must process ${n} jobs, one at a time and without interruption. Time is counted in whole minutes, starting at 0.`,
    '',
    ...jobLines,
    '',
    'Rules:',
    '1. A job cannot start before its release time.',
    '2. When job Y runs directly after job X, the machine needs a setup of s(X,Y) minutes after X finishes, and only then can Y start. The setup may happen while the machine waits for Y to be released, so Y starts at the later of (finish of X + s(X,Y)) and the release time of Y.',
    '3. The first job needs no setup. The machine is idle only when it waits for a release or a setup.',
    '4. The cost of a plan is the sum, over all jobs, of (weight x finish time).',
    '',
    'The setup times s(X,Y), with the job just finished in the row and the next job in the column:',
    '',
    header,
    ...rows,
    '',
    'What is the smallest possible cost over all orders of the jobs?',
    'Answer format: a whole number, with no units.',
  ].join('\n');
}
