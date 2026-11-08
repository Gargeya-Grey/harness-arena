// Family "sched": jobs with durations and prerequisites on three identical workers;
// find the smallest finishing time. The instance is
//   { workers, jobs: [{ name, hours, needs: [job indexes] }] }
//
// Two exact methods that share no code:
//   scheduleSearch  a search over states (finished jobs, running jobs with the hours
//                   they still need); at every event it tries every choice of jobs to start
//   scheduleOrders  every precedence-feasible order of the jobs, each job placed at the earliest
//                   feasible time that is not before the previous job's start (an optimal schedule is
//                   reached by the order of its start times), cut at a bound
// The shortcuts are three list-scheduling rules (longest remaining path first, longest
// job first, most followers first). A case is kept only when the best of them is wrong.

import { WORDS, list } from './_rng.mjs';

// ---- method 1: search over event states -----------------------------------------

export function scheduleSearch(instance) {
  const { jobs, workers } = instance;
  const n = jobs.length;
  const all = (1 << n) - 1;
  const memo = new Map();
  // done: bit mask of finished jobs; running: [[job, hours still needed]] sorted by job.
  const more = (done, running) => {
    if (done === all) return 0;
    const key = `${done}|${running.map((r) => `${r[0]}:${r[1]}`).join(',')}`;
    if (memo.has(key)) return memo.get(key);
    const startedMask = running.reduce((m, r) => m | (1 << r[0]), done);
    const ready = [];
    for (let i = 0; i < n; i += 1) if (!(startedMask & (1 << i)) && jobs[i].needs.every((p) => done & (1 << p))) ready.push(i);
    const free = workers - running.length;
    let best = Infinity;
    const advance = (chosen) => {
      const now = running.concat(chosen.map((i) => [i, jobs[i].hours]));
      if (!now.length) return;
      const step = Math.min(...now.map((r) => r[1]));
      let nextDone = done;
      const rest = [];
      for (const [job, left] of now) {
        if (left === step) nextDone |= 1 << job;
        else rest.push([job, left - step]);
      }
      rest.sort((x, y) => x[0] - y[0]);
      best = Math.min(best, step + more(nextDone, rest));
    };
    const choose = (from, chosen) => {
      advance(chosen);
      if (chosen.length === free) return;
      for (let i = from; i < ready.length; i += 1) choose(i + 1, chosen.concat(ready[i]));
    };
    choose(0, []);
    memo.set(key, best);
    return best;
  };
  return more(0, []);
}

// ---- method 2: orders ------------------------------------------------------------

// Smallest finishing time found by trying every precedence-feasible order, cutting
// every branch that cannot finish before `cut`. Returns Infinity when no schedule
// finishes before `cut`. scheduleOrders(inst, answer) === Infinity proves nothing
// beats `answer - 1`; scheduleOrders(inst, answer + 1) === answer proves it is reached.
export function scheduleOrders(instance, cut) {
  const { jobs, workers } = instance;
  const n = jobs.length;
  const horizon = jobs.reduce((s, j) => s + j.hours, 0) + 1;
  let best = cut;
  let found = Infinity;
  const placed = new Array(n).fill(false);
  const finish = new Array(n).fill(0);
  const usage = new Array(horizon).fill(0);
  const tail = jobs.map((_, i) => longestPath(jobs, i));
  const rec = (count, makespan, previousStart) => {
    if (count === n) {
      if (makespan < best) {
        best = makespan;
        found = makespan;
      }
      return;
    }
    for (let i = 0; i < n; i += 1) {
      if (placed[i] || !jobs[i].needs.every((p) => placed[p])) continue;
      let t = Math.max(previousStart, ...jobs[i].needs.map((p) => finish[p]));
      for (;;) {
        let blocked = -1;
        for (let u = t; u < t + jobs[i].hours; u += 1) if (usage[u] >= workers) blocked = u;
        if (blocked < 0) break;
        t = blocked + 1;
      }
      if (t + tail[i] >= best) continue;
      placed[i] = true;
      finish[i] = t + jobs[i].hours;
      for (let u = t; u < finish[i]; u += 1) usage[u] += 1;
      rec(count + 1, Math.max(makespan, finish[i]), t);
      for (let u = t; u < finish[i]; u += 1) usage[u] -= 1;
      placed[i] = false;
      finish[i] = 0;
    }
  };
  rec(0, 0, 0);
  return found;
}

// ---- bounds and shortcuts ------------------------------------------------------------

function followers(jobs) {
  return jobs.map((_, i) => jobs.map((__, k) => k).filter((k) => jobs[k].needs.includes(i)));
}

// Hours on the longest chain that starts with job i (job i included).
function longestPath(jobs, i, memo = new Map(), after = followers(jobs)) {
  if (!memo.has(i)) memo.set(i, jobs[i].hours + Math.max(0, ...after[i].map((k) => longestPath(jobs, k, memo, after))));
  return memo.get(i);
}

export function lowerBound(instance) {
  const { jobs, workers } = instance;
  const total = jobs.reduce((s, j) => s + j.hours, 0);
  const memo = new Map();
  const after = followers(jobs);
  return Math.max(Math.ceil(total / workers), ...jobs.map((_, i) => longestPath(jobs, i, memo, after)));
}

function descendants(jobs) {
  const after = followers(jobs);
  const out = jobs.map(() => new Set());
  const walk = (i, root) => {
    for (const k of after[i]) {
      if (!out[root].has(k)) {
        out[root].add(k);
        walk(k, root);
      }
    }
  };
  jobs.forEach((_, i) => walk(i, i));
  return out.map((s) => s.size);
}

/** Finishing time of the list-scheduling rule: whenever a worker is free, start the ready job with the best score. */
export function listSchedule(instance, rule) {
  const { jobs, workers } = instance;
  const n = jobs.length;
  const memo = new Map();
  const after = followers(jobs);
  const score = jobs.map((job, i) => ({ path: longestPath(jobs, i, memo, after), long: job.hours, many: descendants(jobs)[i] }[rule]));
  const done = new Array(n).fill(false);
  const started = new Array(n).fill(false);
  let running = [];
  let time = 0;
  let count = 0;
  while (count < n) {
    const ready = [...Array(n).keys()].filter((i) => !started[i] && jobs[i].needs.every((p) => done[p]));
    ready.sort((x, y) => score[y] - score[x] || x - y);
    while (running.length < workers && ready.length) {
      const i = ready.shift();
      started[i] = true;
      running.push([time + jobs[i].hours, i]);
    }
    time = Math.min(...running.map((r) => r[0]));
    for (const [end, i] of running) {
      if (end === time) {
        done[i] = true;
        count += 1;
      }
    }
    running = running.filter((r) => r[0] !== time);
  }
  return time;
}

export const RULES = ['path', 'long', 'many'];
export const bestShortcut = (instance) => Math.min(...RULES.map((rule) => listSchedule(instance, rule)));

export function solve(instance) {
  const answer = scheduleSearch(instance);
  return { answer };
}

/** Both exact methods; throws when they disagree. */
export function solveProved(instance) {
  const answer = scheduleSearch(instance);
  if (scheduleOrders(instance, answer) !== Infinity) throw new Error('a schedule beats the search answer');
  if (scheduleOrders(instance, answer + 1) !== answer) throw new Error('the orders method does not reach the search answer');
  return { answer };
}

// ---- generator -----------------------------------------------------------------------

export function build(rng, cfg) {
  const { size, workers, minEdges, maxEdges } = cfg;
  return rng.attempt(() => {
    const hours = [...Array(size)].map(() => rng.int(1, 9));
    const needs = hours.map((_, i) => (i === 0 ? [] : rng.sample([...Array(i).keys()], Math.min(i, rng.pick([0, 1, 1, 2, 2, 3]))).sort((a, b) => a - b)));
    const edges = needs.reduce((s, l) => s + l.length, 0);
    if (edges < minEdges || edges > maxEdges || needs.filter((l) => l.length === 0).length < 3) return null;
    const position = rng.shuffle([...Array(size).keys()]);
    const jobs = [];
    hours.forEach((h, i) => {
      jobs[position[i]] = { name: String.fromCharCode(65 + position[i]), hours: h, needs: needs[i].map((p) => position[p]).sort((a, b) => a - b) };
    });
    const instance = { workers, jobs };
    const bound = lowerBound(instance);
    const shortcut = bestShortcut(instance);
    if (shortcut <= bound + 1) return null;
    const answer = scheduleSearch(instance);
    return answer > bound && answer < shortcut ? instance : null;
  }, 20000);
}

export function render(instance) {
  const { jobs, workers } = instance;
  return [
    `A workshop has ${WORDS[workers]} identical workers and ${WORDS[jobs.length]} jobs, A to ${jobs.at(-1).name}. Each job is done by one worker without a break, and a worker does one job at a time. A job can start only when every job it needs is finished. A worker may wait. All workers start at hour 0.`,
    '',
    ...jobs.map((j) => `Job ${j.name}: ${j.hours} ${j.hours === 1 ? 'hour' : 'hours'}; needs ${j.needs.length ? list(j.needs.map((p) => jobs[p].name)) : 'nothing'}.`),
    '',
    'What is the smallest number of hours, counted from hour 0, after which all the jobs can be finished?',
    'Answer format: a whole number, with no units.',
  ].join('\n');
}

export const shortcuts = (instance) => [{ name: 'best list-scheduling rule', answer: bestShortcut(instance) }];
