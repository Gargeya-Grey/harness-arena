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

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { types } from 'node:util';

// Captured before any workspace code runs. Workspace code runs in this process and can
// replace any built-in; after it has run, this file calls only what is captured here, and
// reads a thrown value only through own data properties, never a getter or a Proxy trap.
// One call stays outside these rules on purpose: stringify(value) runs the value's own
// toJSON and getters, because that is how a probe's value is read (as in @1). If it never
// returns, the evaluator's backstop ends this process, and the finished probes keep their
// results.
const writeSync = fs.writeSync; // not a run folder: writes only to stdout (fd 1)
const write = (text) => writeSync(1, text);
const stringify = JSON.stringify;
const parseJson = JSON.parse;
const toString = String;
const exit = process.exit.bind(process);
const setTimer = setTimeout;
const clearTimer = clearTimeout;
const now = performance.now.bind(performance);
const cpuUsage = process.cpuUsage.bind(process);
const { sqrt, min, round } = Math;
const resolvePath = path.resolve;
const joinPath = path.join;
const SEP = path.sep;
const toFileUrl = pathToFileURL;
const isProxy = types.isProxy;
const getOwn = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty;
const call = Function.prototype.call;
const slice = call.bind(String.prototype.slice);
const ErrorCtor = Error;
const startsWith = call.bind(String.prototype.startsWith);
const join = call.bind(Array.prototype.join);
const PromiseCtor = Promise;
const resolved = Promise.resolve.bind(Promise);
const then = call.bind(Promise.prototype.then);
const ownValue = (object, key) => {
  if (object === null || (typeof object !== 'object' && typeof object !== 'function') || isProxy(object)) return undefined;
  const descriptor = getOwn(object, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};
const messageOf = (failure) => {
  const message = typeof failure === 'string' ? failure : ownValue(failure, 'message');
  return typeof message === 'string' ? slice(message, 0, 300) : 'error';
};

const cpuMs = () => {
  const usage = cpuUsage();
  return (usage.user + usage.system) / 1000;
};

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const { nonce, workspace, probe, limits } = parseJson(input);
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
      return seen < 1.1 ? 1 : min(CAP, seen);
    }
  }
}

// JSON.stringify of a string primitive never calls a toJSON hook.
const str = (value) => stringify(toString(value));
const parts = [];
// Appends without Array.prototype.push or an index assignment, which workspace code could catch.
const report = (part) => {
  define(parts, parts.length, { value: part, writable: true, enumerable: true, configurable: true });
  write(`\n{"nonce":${str(nonce)},"probe":${part}}\n`);
};
let error = null;
try {
  const inside = (rel) => {
    // path.resolve reads "/" as a separator on every platform, so no split and no spread (an array iterator).
    const text = toString(rel);
    const file = resolvePath(workspace, text);
    if (file !== workspace && !startsWith(file, workspace + SEP)) throw new ErrorCtor(`path outside the workspace: ${text}`);
    return file;
  };
  let loads = 0;
  const load = (rel) => import(`${toFileUrl(inside(rel)).href}?load=${(loads += 1)}`);
  // The check's own file, read before any workspace code runs: the list and the names are fixed here.
  const { probes: listed } = await import(toFileUrl(joinPath(workspace, probe)).href);
  const probes = [];
  for (const item of listed) define(probes, probes.length, { value: { name: toString(item.name), run: item.run }, writable: true, enumerable: true, configurable: true });
  const count = probes.length;
  for (let index = 0; index < count; index += 1) {
    const item = probes[index];
    const name = item.name;
    if (cpuMs() >= CPU_BUDGET_MS) {
      report(`{"name":${str(name)},"error":${str(`the CPU budget of ${CPU_BUDGET_MS} ms for the check was spent before this probe`)}}`);
      continue;
    }
    let timer;
    try {
      const started = now();
      const value = await new PromiseCtor((resolve, reject) => {
        const fire = () => {
          const allowed = PROBE_TIMEOUT_MS * wallPerCpu();
          const waited = now() - started;
          if (waited < allowed - 50) timer = setTimer(fire, allowed - waited);
          else reject(new ErrorCtor(`timed out after ${round(waited / 100) / 10} s`));
        };
        timer = setTimer(fire, PROBE_TIMEOUT_MS);
        then(then(resolved(), () => item.run({ load })), resolve, reject);
      });
      const json = value === undefined ? 'null' : stringify(value);
      // A replaced JSON.stringify inside the workspace cannot reach `stringify`, but a toJSON can return anything.
      report(typeof json === 'string' ? `{"name":${str(name)},"json":${str(json)}}` : `{"name":${str(name)},"error":${str('the value did not serialise to JSON text')}}`);
    } catch (failure) {
      report(`{"name":${str(name)},"error":${str(messageOf(failure))}}`);
    } finally {
      clearTimer(timer);
    }
  }
} catch (failure) {
  error = `check failed to load: ${messageOf(failure)}`;
}
write(`\n{"nonce":${str(nonce)},${error ? `"error":${str(error)},` : ''}"cpu_ms":${round(cpuMs())},"results":[${join(parts, ',')}]}\n`);
exit(0);
