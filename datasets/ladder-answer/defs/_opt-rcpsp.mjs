// Family "rcpsp": a building job with tasks that must wait for other tasks and that share
// two limited resources (for example crane drivers and trucks). Tasks start at whole hours,
// run without a break, and need a fixed number of each resource while they run. The shortest
// finish time is the answer. The instance is
//   { names: [..], dur: [..], need: [[r1, r2], ..], cap: [c1, c2], preds: [[task indexes]] }
//
// Two exact methods that share no code:
//   rcpspSerial   tries every precedence-feasible order of the tasks and places each task at its
//                 earliest hour where the resources allow (some order gives an optimal plan)
//   rcpspEvents   walks forward in time: at the hour when something finishes, branch on every
//                 set of ready tasks that can start together (memo on the state, bound by the
//                 longest chain still to run)
// The shortcuts are priority rules for building a plan, and the length of the longest chain.

import { LETTERS } from './_opt-util.mjs';

const range = (n) => [...Array(n).keys()];

function tails(instance) {
  const n = instance.names.length;
  const tail = new Array(n).fill(0);
  const succ = instance.names.map(() => []);
  instance.preds.forEach((ps, j) => ps.forEach((p) => succ[p].push(j)));
  for (let j = n - 1; j >= 0; j -= 1) tail[j] = instance.dur[j] + Math.max(0, ...succ[j].map((s) => tail[s]));
  return { tail, succ };
}

export const chainLength = (instance) => Math.max(...tails(instance).tail);

/** Earliest start >= ready where `need` fits under the capacities given the placed tasks. */
function earliest(instance, placed, ready, j) {
  const horizon = placed.reduce((m, x) => Math.max(m, x.end), 0) + 1;
  for (let t = ready; t <= horizon; t += 1) {
    let ok = true;
    for (let u = t; u < t + instance.dur[j] && ok; u += 1) {
      for (let r = 0; r < instance.cap.length; r += 1) {
        let used = instance.need[j][r];
        for (const x of placed) if (x.start <= u && u < x.end) used += instance.need[x.j][r];
        if (used > instance.cap[r]) ok = false;
      }
    }
    if (ok) return t;
  }
  return horizon;
}

export function rcpspSerial(instance) {
  const n = instance.names.length;
  const { tail } = tails(instance);
  const placed = [];
  const finish = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  // Start from the better of two real plans; the search only has to find a strictly shorter one.
  let best = Math.min(serialPlan(instance, (j) => tail[j]), parallelPlan(instance, (j) => tail[j]));
  const visited = new Set();
  const dfs = (count, makespan) => {
    if (makespan >= best) return;
    // Longest chain bound: a task not placed starts after its placed predecessors end.
    const est = new Array(n).fill(0);
    for (let j = 0; j < n; j += 1) {
      let e = 0;
      for (const p of instance.preds[j]) e = Math.max(e, done[p] ? finish[p] : est[p] + instance.dur[p]);
      est[j] = e;
    }
    let bound = makespan;
    for (let j = 0; j < n; j += 1) if (!done[j]) bound = Math.max(bound, est[j] + tail[j]);
    if (bound >= best) return;
    if (count === n) {
      best = makespan;
      return;
    }
    // Different orders often place the same tasks at the same hours; search each plan once.
    const planKey = placed.map((x) => `${x.j}@${x.start}`).sort().join(',');
    if (visited.has(planKey)) return;
    visited.add(planKey);
    const ready = [];
    for (let j = 0; j < n; j += 1) {
      if (done[j] || !instance.preds[j].every((p) => done[p])) continue;
      const rt = instance.preds[j].reduce((m, p) => Math.max(m, finish[p]), 0);
      ready.push([j, earliest(instance, placed, rt, j)]);
    }
    ready.sort((a, b) => a[1] - b[1] || tail[b[0]] - tail[a[0]]);
    for (const [j, start] of ready) {
      const end = start + instance.dur[j];
      placed.push({ j, start, end });
      done[j] = true;
      finish[j] = end;
      dfs(count + 1, Math.max(makespan, end));
      done[j] = false;
      placed.pop();
    }
  };
  dfs(0, 0);
  return best;
}

export function rcpspEvents(instance) {
  const n = instance.names.length;
  const { tail } = tails(instance);
  const full = (1 << n) - 1;
  const seen = new Map();
  let best = Infinity;
  const dfs = (t, started, running) => {
    // running: array of [task, end] with end > t
    if (started === full) {
      best = Math.min(best, running.reduce((m, [, e]) => Math.max(m, e), t));
      return;
    }
    const endOf = new Map(running);
    const est = new Array(n).fill(0);
    let bound = running.reduce((m, [, e]) => Math.max(m, e), t);
    for (let j = 0; j < n; j += 1) {
      let e = t;
      for (const p of instance.preds[j]) e = Math.max(e, started & (1 << p) ? (endOf.get(p) ?? 0) : est[p] + instance.dur[p]);
      est[j] = e;
      if (!(started & (1 << j))) bound = Math.max(bound, e + tail[j]);
    }
    if (bound >= best) return;
    const key = `${started}|${running.map(([j, e]) => `${j}:${e - t}`).sort().join(',')}`;
    const prior = seen.get(key);
    if (prior !== undefined && prior <= t) return;
    seen.set(key, t);
    const ready = [];
    for (let j = 0; j < n; j += 1) {
      if (started & (1 << j)) continue;
      if (instance.preds[j].every((p) => started & (1 << p) && (endOf.get(p) ?? 0) <= t)) ready.push(j);
    }
    const used = instance.cap.map((_, r) => running.reduce((s, [j]) => s + instance.need[j][r], 0));
    const choose = (idx, chosen, usage) => {
      if (idx === ready.length) {
        if (!chosen.length && !running.length) return;
        const next = [...running, ...chosen.map((j) => [j, t + instance.dur[j]])];
        const t2 = Math.min(...next.map(([, e]) => e));
        const mask = chosen.reduce((m, j) => m | (1 << j), started);
        dfs(t2, mask, next.filter(([, e]) => e > t2));
        return;
      }
      const j = ready[idx];
      if (instance.cap.every((c, r) => usage[r] + instance.need[j][r] <= c)) {
        choose(idx + 1, [...chosen, j], usage.map((u, r) => u + instance.need[j][r]));
      }
      choose(idx + 1, chosen, usage);
    };
    choose(0, [], used);
  };
  dfs(0, 0, []);
  return best;
}

// ---- shortcuts -----------------------------------------------------------------------------

/** Serial plan generation: take tasks in priority order among the ready ones; earliest feasible start. */
function serialPlan(instance, priority) {
  const n = instance.names.length;
  const placed = [];
  const finish = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  for (let k = 0; k < n; k += 1) {
    const ready = range(n).filter((j) => !done[j] && instance.preds[j].every((p) => done[p]));
    ready.sort((a, b) => priority(b) - priority(a) || a - b);
    const j = ready[0];
    const rt = instance.preds[j].reduce((m, p) => Math.max(m, finish[p]), 0);
    const start = earliest(instance, placed, rt, j);
    placed.push({ j, start, end: start + instance.dur[j] });
    finish[j] = start + instance.dur[j];
    done[j] = true;
  }
  return Math.max(...finish);
}

/** Parallel plan generation: at each hour start ready tasks in priority order while resources allow. */
function parallelPlan(instance, priority) {
  const n = instance.names.length;
  const finish = new Array(n).fill(-1);
  const started = new Array(n).fill(false);
  let t = 0;
  let left = n;
  while (left) {
    const running = range(n).filter((j) => started[j] && finish[j] > t);
    const usage = instance.cap.map((_, r) => running.reduce((s, j) => s + instance.need[j][r], 0));
    const ready = range(n).filter((j) => !started[j] && instance.preds[j].every((p) => started[p] && finish[p] <= t));
    ready.sort((a, b) => priority(b) - priority(a) || a - b);
    for (const j of ready) {
      if (instance.cap.every((c, r) => usage[r] + instance.need[j][r] <= c)) {
        started[j] = true;
        finish[j] = t + instance.dur[j];
        usage.forEach((_, r) => (usage[r] += instance.need[j][r]));
        left -= 1;
      }
    }
    t += 1;
  }
  return Math.max(...finish);
}

export function shortcuts(instance) {
  const { tail, succ } = tails(instance);
  const work = (j) => instance.dur[j] * instance.need[j].reduce((s, x) => s + x, 0);
  return [
    { name: 'serial plan, longest remaining chain first', answer: serialPlan(instance, (j) => tail[j]) },
    { name: 'parallel plan, longest remaining chain first', answer: parallelPlan(instance, (j) => tail[j]) },
    { name: 'parallel plan, most work (time x resources) first', answer: parallelPlan(instance, work) },
    { name: 'serial plan, most successors first', answer: serialPlan(instance, (j) => succ[j].length * 100 + tail[j]) },
    { name: 'the longest chain of tasks, ignoring the resource limits', answer: chainLength(instance) },
  ];
}

export function solveProved(instance) {
  const answer = rcpspSerial(instance);
  if (rcpspEvents(instance) !== answer) throw new Error('rcpsp: the two methods disagree');
  return { answer };
}

export const solve = (instance) => ({ answer: rcpspSerial(instance) });

export function build(rng, cfg) {
  const { size, cap, extraEdges } = cfg;
  return rng.attempt(() => {
    const dur = Array.from({ length: size }, () => rng.int(2, 8));
    const need = Array.from({ length: size }, () => cap.map((c) => rng.int(0, Math.ceil(c * 0.7))));
    const preds = range(size).map(() => []);
    for (let j = 1; j < size; j += 1) {
      const lo = Math.max(0, j - 5);
      if (rng.next() < 0.78) preds[j].push(rng.int(lo, j - 1));
    }
    for (let e = 0; e < extraEdges; e += 1) {
      const j = rng.int(2, size - 1);
      const p = rng.int(Math.max(0, j - 6), j - 1);
      if (!preds[j].includes(p)) preds[j].push(p);
    }
    preds.forEach((ps) => ps.sort((a, b) => a - b));
    const instance = { names: LETTERS.slice(0, size).split(''), dur, need, cap, preds };
    const answer = rcpspEvents(instance);
    const list = shortcuts(instance);
    const misses = list.filter((s) => s.answer !== answer).length;
    if (misses < list.length) return null; // every shortcut misses (the suite test asks for it)
    // The resource limits must matter, and a near-optimal plan must be easy.
    if (chainLength(instance) >= answer) return null;
    if (Math.min(...list.filter((s) => s.name.indexOf('ignoring') < 0).map((s) => s.answer)) > answer * 1.12) return null;
    return instance;
  }, 6000);
}

export function render(instance) {
  const { names, dur, need, cap, preds } = instance;
  const lines = names.map((name, j) => `Task ${name}: ${dur[j]} hours, needs ${need[j][0]} driver${need[j][0] === 1 ? '' : 's'} and ${need[j][1]} truck${need[j][1] === 1 ? '' : 's'},${preds[j].length ? `after ${preds[j].map((p) => names[p]).join(', ')}` : 'no predecessor'}`);
  return [
    `A building job has ${names.length} tasks. Time is counted in whole hours, starting at hour 0. A task has a length, a number of crane drivers and a number of trucks that it needs for its whole length, and the tasks that must be finished before it can start:`,
    '',
    ...lines,
    '',
    'Rules:',
    '1. A task starts at a whole hour, once every task listed after "after" has finished (a task that ends at hour 7 lets the next task start at hour 7), and runs without a break for its full length.',
    `2. At any hour, the tasks that are running use at most ${cap[0]} crane drivers in total and at most ${cap[1]} trucks in total.`,
    '3. Any number of tasks may run at the same time as long as rules 1 and 2 hold. A task may wait before it starts.',
    '',
    'What is the smallest hour at which the whole job can be finished (the finish of the last task)?',
    'Answer format: a whole number, with no units.',
  ].join('\n');
}
