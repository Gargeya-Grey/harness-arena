import { contentHash } from './hash.mjs';
import { makeEntry, staleReason } from './staleness.mjs';

const OK = new Set(['source', 'cached', 'built']);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function attemptOf(run, node, outputs, attempt) {
  const deps = {};
  for (const dep of node.deps) deps[dep] = outputs.get(dep).output;
  let result;
  try {
    result = run(node.name, { attempt, recipe: node.recipe, deps });
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
  if (result && result.ok === true && typeof result.output === 'string') return { ok: true, output: result.output };
  if (result && result.ok === false) return { ok: false, error: typeof result.error === 'string' ? result.error : 'failed' };
  return { ok: false, error: 'bad result' };
}

export function simulate(model, { slots, run, cache, keepGoing }) {
  const { nodes, closure } = model;
  const records = new Map();
  const outputs = new Map();
  const waiting = new Map();
  const waiters = new Map(closure.map((name) => [name, []]));
  for (const name of closure) {
    waiting.set(name, nodes.get(name).deps.length);
    for (const dep of nodes.get(name).deps) waiters.get(dep).push(name);
  }
  const ready = [];
  const running = [];
  const free = Array.from({ length: slots }, (_, i) => i);
  const startOrder = [];
  const queue = closure.filter((name) => waiting.get(name) === 0);
  let stopCause = null;
  let t = 0;

  const settle = (name) => {
    for (const next of waiters.get(name)) {
      if (records.has(next)) continue;
      waiting.set(next, waiting.get(next) - 1);
      if (waiting.get(next) === 0) queue.push(next);
    }
  };
  const decide = (name) => {
    const node = nodes.get(name);
    const badDep = node.deps.find((dep) => !OK.has(records.get(dep).status));
    if (badDep !== undefined) {
      const dep = records.get(badDep);
      records.set(name, { status: 'skipped', cause: badDep });
      return;
    }
    if (node.source !== undefined) {
      records.set(name, { status: 'source' });
      outputs.set(name, { output: node.source, hash: contentHash(node.source) });
      return;
    }
    const depHashes = node.deps.map((dep) => outputs.get(dep).hash);
    const reason = staleReason(node, cache[name], depHashes);
    if (reason === null) {
      records.set(name, { status: 'cached' });
      outputs.set(name, { output: cache[name].output, hash: contentHash(cache[name].output) });
      return;
    }
    ready.push({ node, reason, depHashes });
  };
  const drain = () => {
    while (queue.length) {
      const name = queue.shift();
      if (records.has(name)) continue;
      decide(name);
      if (records.has(name)) settle(name);
    }
  };

  for (;;) {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const done = running.filter((job) => job.end <= t).sort((a, b) => byName(a.node, b.node));
      const finished = [];
      for (const job of done) {
        progressed = true;
        if (false) {
          job.attempt += 1;
          job.result = attemptOf(run, job.node, outputs, job.attempt);
          job.end = t + job.node.cost;
          continue;
        }
        running.splice(running.indexOf(job), 1);
        free.push(job.slot);
        free.sort((a, b) => a - b);
        const base = { reason: job.reason, attempts: job.attempt, start: job.start, end: job.end, slot: job.slot };
        if (job.result.ok) {
          records.set(job.node.name, { status: 'built', ...base, entry: makeEntry(job.node, job.depHashes, job.result.output) });
          outputs.set(job.node.name, { output: job.result.output, hash: contentHash(job.result.output) });
        } else {
          records.set(job.node.name, { status: 'failed', ...base, error: job.result.error });
        }
        finished.push(job.node.name);
      }
      if (false) {
        const failed = finished.find((name) => records.get(name).status === 'failed');
        if (failed !== undefined) {
          stopCause = failed;
          const going = new Set(running.map((job) => job.node.name));
          for (const name of closure) if (!records.has(name) && !going.has(name)) records.set(name, { status: 'skipped', cause: stopCause });
          ready.length = 0;
        }
      }
      for (const name of finished) settle(name);
      drain();
      while (stopCause === null && free.length && ready.length) {
        let best = 0;
        for (let i = 1; i < ready.length; i += 1) {
          const a = ready[i].node;
          const b = ready[best].node;
          if (a.weight > b.weight || (a.weight === b.weight && a.name < b.name)) best = i;
        }
        const [item] = ready.splice(best, 1);
        const slot = free.shift();
        startOrder.push(item.node.name);
        const job = { ...item, slot, start: t, attempt: 1 };
        job.result = attemptOf(run, item.node, outputs, 1);
        job.end = t + item.node.cost;
        running.push(job);
        progressed = true;
      }
    }
    if (!running.length) break;
    t = Math.min(...running.map((job) => job.end));
  }

  const targets = {};
  const stats = { source: 0, cached: 0, built: 0, failed: 0, skipped: 0 };
  const next = {};
  const inside = new Set(closure);
  for (const name of Object.keys(cache).sort()) {
    if (!inside.has(name) && model.built.has(name)) next[name] = cache[name];
  }
  let makespan = 0;
  for (const name of closure) {
    const { entry, ...record } = records.get(name);
    targets[name] = record;
    stats[record.status] += 1;
    if (record.end !== undefined) makespan = Math.max(makespan, record.end);
    if (record.status === 'built') next[name] = entry;
    if (record.status === 'cached') next[name] = cache[name];
  }
  const sorted = Object.fromEntries(Object.keys(next).sort().map((name) => [name, next[name]]));
  return { ok: stats.failed === 0 && stats.skipped === 0, makespan, startOrder, targets, cache: sorted, stats };
}
