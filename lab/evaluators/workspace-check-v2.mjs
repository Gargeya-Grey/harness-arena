// Runs the probes of a hidden check against an agent's rebuilt workspace, for
// workspace-tests@2. Same job, same input and same result lines as workspace-check.mjs
// (which workspace-tests@1 still uses, unchanged), with these differences:
//
//   - The whole check has a CPU budget (`cpuMs`, default 60000 ms), measured with
//     process.cpuUsage() between probes. Past it, every probe that has not started gets
//     an error that says so. A busy machine stretches wall time, not CPU time.
//   - The per-probe timer (`probeMs`, default 5000 ms) is a wall-clock backstop for a probe
//     that waits. When it fires, the process measures how much CPU it gets (a short busy
//     loop); on a busy machine it waits longer, up to `cap` times (default 10) the base.
//     Like in @1, a timer cannot interrupt synchronous code: a probe that never returns
//     is stopped by the evaluator, which kills this process (see runWorkspaceCheckV2).
//   - Each probe's result is written as soon as it is known, so when this process is killed
//     the probes that had finished keep their results.
//
// Input on stdin: { nonce, workspace, probe, limits? }. `probe` is a file inside the
// workspace that exports `probes`: [{ name, run({ load }) }]. `load(rel)` imports a module
// of the workspace. Each probe returns a value; this process reports the value as JSON and
// never judges it. The expected values stay in the parent process.
// Output: lines {"nonce":…,"probe":{"name":…,"json":…} or {"name":…,"error":…}} while it
// runs, then one line {"nonce":…,"cpu_ms":…,"results":[…]}. The evaluator trusts only lines
// that carry its nonce.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Captured before any workspace code runs.
const write = process.stdout.write.bind(process.stdout);
const stringify = JSON.stringify;
const toString = String;
const exit = process.exit.bind(process);
const setTimer = setTimeout;
const clearTimer = clearTimeout;
const now = performance.now.bind(performance);
const cpuUsage = process.cpuUsage.bind(process);
const sqrt = Math.sqrt;

const cpuMs = () => {
  const usage = cpuUsage();
  return (usage.user + usage.system) / 1000;
};

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const { nonce, workspace, probe, limits } = JSON.parse(input);
input = '';
const CPU_BUDGET_MS = Number(limits?.cpuMs) > 0 ? Number(limits.cpuMs) : 60000;
const PROBE_TIMEOUT_MS = Number(limits?.probeMs) > 0 ? Number(limits.probeMs) : 5000;
const CAP = Number(limits?.cap) >= 1 ? Number(limits.cap) : 10;

// wall time per CPU time that this process gets right now: a busy loop of about 60 ms of CPU
// (the clock ticks every 15.6 ms on Windows), or 700 ms of wall time on a very busy machine.
let sink = 0;
function wallPerCpu() {
  const wall0 = now();
  const cpu0 = cpuMs();
  for (;;) {
    for (let i = 0; i < 20000; i += 1) sink += sqrt(i);
    const cpu = cpuMs() - cpu0;
    const wall = now() - wall0;
    if (cpu >= 62 || wall >= 700) {
      const seen = cpu > 1 ? wall / cpu : CAP;
      return seen < 1.1 ? 1 : Math.min(CAP, seen);
    }
  }
}

// JSON.stringify of a string primitive never calls a toJSON hook.
const str = (value) => stringify(toString(value));
const parts = [];
const report = (part) => {
  parts.push(part);
  write(`\n{"nonce":${str(nonce)},"probe":${part}}\n`);
};
let error = null;
try {
  const inside = (rel) => {
    const file = path.resolve(workspace, ...String(rel).split('/'));
    if (file !== workspace && !file.startsWith(workspace + path.sep)) throw new Error(`path outside the workspace: ${rel}`);
    return file;
  };
  let loads = 0;
  const load = (rel) => import(`${pathToFileURL(inside(rel)).href}?load=${(loads += 1)}`);
  const { probes } = await import(pathToFileURL(path.join(workspace, probe)).href);
  for (const item of probes) {
    const name = String(item.name);
    if (cpuMs() >= CPU_BUDGET_MS) {
      report(`{"name":${str(name)},"error":${str(`the CPU budget of ${CPU_BUDGET_MS} ms for the check was spent before this probe`)}}`);
      continue;
    }
    let timer;
    try {
      const started = now();
      const value = await new Promise((resolve, reject) => {
        const fire = () => {
          const allowed = PROBE_TIMEOUT_MS * wallPerCpu();
          const waited = now() - started;
          if (waited < allowed - 50) timer = setTimer(fire, allowed - waited);
          else reject(new Error(`timed out after ${Math.round(waited / 100) / 10} s`));
        };
        timer = setTimer(fire, PROBE_TIMEOUT_MS);
        Promise.resolve()
          .then(() => item.run({ load }))
          .then(resolve, reject);
      });
      const json = value === undefined ? 'null' : stringify(value);
      report(`{"name":${str(name)},"json":${str(json)}}`);
    } catch (failure) {
      report(`{"name":${str(name)},"error":${str(String(failure?.message ?? failure).slice(0, 300))}}`);
    } finally {
      clearTimer(timer);
    }
  }
} catch (failure) {
  error = `check failed to load: ${String(failure?.message ?? failure).slice(0, 300)}`;
}
write(`\n{"nonce":${str(nonce)},${error ? `"error":${str(error)},` : ''}"cpu_ms":${Math.round(cpuMs())},"results":[${parts.join(',')}]}\n`);
exit(0);
