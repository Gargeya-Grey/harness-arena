// Runs one model-written JavaScript function against test cases, for js-function@2.
// Same job, same input and same output line as js-sandbox.cjs (which js-function@1 still
// uses, unchanged). What differs is the clock behind the verdicts.
//
// The verdict is CPU time of this process, measured with process.cpuUsage():
//   - a test fails when it uses more than `testCpuMs` of CPU (default 2000 ms);
//   - the tests of a case share `caseCpuMs` of CPU (default 30000 ms): once that is spent,
//     every test that has not started fails with a stated reason.
// A busy machine stretches wall time but not CPU time, so it does not change a verdict.
//
// The wall clock only stops a test that never ends. The vm timeout of a test is
// `testCpuMs x ratio` (25% more when ratio is over 1.1, never over `cap` x `testCpuMs`), where
// `ratio` is the wall/CPU ratio this process has seen (1 to `cap`). It starts at 1 and costs
// nothing on an idle machine. When the backstop stops a test
// that had used less than 95% of its CPU limit, the process was starved and the test might have
// finished in time: it runs again (at most twice more) with the backstop at the ratio just
// seen, so the wall clock never decides a test that the CPU clock would pass. A test stopped
// at 95% of its CPU limit or more, or at the cap, fails. After every step of 300 ms or more
// the ratio is measured again, so it follows the load up and down.
//
// Input on stdin: { nonce, sources, name, tests: [{ args }], limits?: { testCpuMs, caseCpuMs, cap } }.
// Output: one line `{ nonce, loaded, error?, cpu_ms, results: [{ actual_json | undefined | error }] }`.
// The evaluator trusts only the line that carries its nonce and compares the values itself.
'use strict';

const vm = require('node:vm');

const MAX_ACTUAL_CHARS = 4000;
const STARVED_BELOW = 0.95; // a stopped step that used less of its CPU limit than this was starved
const MAX_ATTEMPTS = 3;
const MARGIN = 1.25; // on a busy machine the backstop gets 25% more, so a small change of the load does not stop a test that the CPU clock would pass
const write = process.stdout.write.bind(process.stdout);
const now = performance.now.bind(performance);
const cpuUsage = process.cpuUsage.bind(process);

let testCpuMs = 2000;
let caseCpuMs = 30000;
let cap = 10;
let ratio = 1; // wall time per CPU time that this process has seen, 1 to cap
let spent = 0; // CPU ms charged to the case so far
let measureFromMs = 300; // steps shorter than this are too short to measure a ratio

const cpuMs = () => {
  const usage = cpuUsage();
  return (usage.user + usage.system) / 1000;
};
// The wall-clock backstop for one step, in ms: the CPU limit times the ratio, never more than cap times the limit.
const backstopMs = (ratioNow) => Math.ceil(Math.min(testCpuMs * cap, testCpuMs * ratioNow * (ratioNow > 1.1 ? MARGIN : 1)));
const isTimeout = (error) => {
  try {
    return Boolean(error) && error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
  } catch {
    return false;
  }
};
const messageOf = (error, max) => {
  try {
    return String(error && error.message).slice(0, max);
  } catch {
    return 'error';
  }
};

function clean(source) {
  return String(source)
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+[A-Za-z_$][\w$]*\s*;?\s*$/gm, '')
    .replace(/^(\s*)export\s+(default\s+)?(?=(async\s+)?(function|const|let|var|class)\b)/gm, '$1');
}

/** Runs one call, measures wall and CPU, charges the CPU to the case, and says whether the backstop stopped it. */
function guarded(ms, fn) {
  const wall0 = now();
  const cpu0 = cpuMs();
  let value;
  let error;
  let failed = false;
  try {
    value = fn();
  } catch (caught) {
    error = caught;
    failed = true;
  }
  const wall = now() - wall0;
  const cpu = cpuMs() - cpu0;
  spent += cpu;
  if (wall >= measureFromMs) ratio = Math.min(cap, Math.max(1, cpu > 1 ? wall / cpu : cap));
  return { value, error, failed, stopped: failed && isTimeout(error) && wall >= ms * 0.9, wall, cpu };
}

// A fresh context per test, so state or memory from one test never reaches the next.
function load(sources, name, ms) {
  const module = { exports: {} };
  const context = vm.createContext({ console: { log() {}, error() {}, warn() {}, info() {} }, module, exports: module.exports });
  const errors = [];
  let stopped = null;
  let cpu = 0;
  for (const source of sources) {
    const step = guarded(ms, () => vm.runInContext(clean(source), context, { timeout: ms }));
    cpu += step.cpu;
    if (step.failed) errors.push(messageOf(step.error, 300));
    if (step.stopped) stopped = step;
  }
  const look = guarded(ms, () =>
    vm.runInContext(
      `typeof ${name} === 'function' ? ${name} : typeof module.exports === 'function' ? module.exports : module.exports && typeof module.exports.${name} === 'function' ? module.exports.${name} : undefined`,
      context,
      { timeout: ms },
    ),
  );
  cpu += look.cpu;
  if (look.stopped) stopped = look;
  const fn = look.failed ? undefined : look.value;
  return { context, fn: typeof fn === 'function' ? fn : null, errors, stopped, cpu };
}

/** One test, with the load and the call. Returns { result } or { stopped, result } when the backstop stopped a step. */
function attempt(sources, name, test, spare) {
  const used = ratio;
  const ms = backstopMs(used);
  const ctx = spare || load(sources, name, ms);
  if (ctx.stopped) return { used, stopped: ctx.stopped, result: { error: `loading the code was stopped by the wall-clock backstop after ${ms} ms` } };
  if (ctx.cpu > testCpuMs) return { used, result: { error: `loading the code used ${Math.round(ctx.cpu)} ms of CPU, over the ${testCpuMs} ms limit` } };
  ctx.context.__fn = ctx.fn;
  ctx.context.__args = JSON.stringify(test.args);
  // Serialise inside the time limit: a hostile getter cannot hang the process.
  const step = guarded(ms, () => vm.runInContext('JSON.stringify(__fn(...JSON.parse(__args)))', ctx.context, { timeout: ms }));
  if (step.stopped) return { used, stopped: step, result: { error: `stopped by the wall-clock backstop after ${ms} ms (${Math.round(step.cpu)} ms of CPU)` } };
  if (step.failed) return { used, result: { error: messageOf(step.error, 200) } };
  if (step.cpu > testCpuMs) return { used, result: { error: `used ${Math.round(step.cpu)} ms of CPU, over the ${testCpuMs} ms limit` } };
  const text = step.value;
  return { used, result: text === undefined ? { actual: null, undefined: true } : { actual_json: String(text).slice(0, MAX_ACTUAL_CHARS * 4) } };
}

const starved = (stopped, used) => Boolean(stopped) && stopped.cpu < testCpuMs * STARVED_BELOW && ratio > used * 1.02;

/** The attempt, again with a longer backstop while the process was starved of CPU when it was stopped. */
function judge(sources, name, test, spare) {
  // The case pays for the attempt that decided, not for one that the backstop cut short.
  const before = spent - (spare ? spare.cpu : 0);
  let done = attempt(sources, name, test, spare);
  for (let tries = 1; tries < MAX_ATTEMPTS && starved(done.stopped, done.used); tries += 1) {
    spent = before;
    done = attempt(sources, name, test, null);
  }
  return done.result;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const { nonce, sources, name, tests, limits } = JSON.parse(input);
  input = '';
  if (limits) {
    if (Number(limits.testCpuMs) > 0) testCpuMs = Number(limits.testCpuMs);
    if (Number(limits.caseCpuMs) > 0) caseCpuMs = Number(limits.caseCpuMs);
    if (Number(limits.cap) >= 1) cap = Number(limits.cap);
  }
  measureFromMs = Math.min(300, testCpuMs / 2);
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    write(`\n${JSON.stringify({ nonce, loaded: false, error: 'bad function name', results: [] })}\n`);
    return;
  }
  let usedRatio = ratio;
  let first = load(sources, name, backstopMs(usedRatio));
  for (let tries = 1; tries < MAX_ATTEMPTS && starved(first.stopped, usedRatio); tries += 1) {
    spent = 0;
    usedRatio = ratio;
    first = load(sources, name, backstopMs(usedRatio));
  }
  const out = { nonce, loaded: Boolean(first.fn), results: [] };
  if (!first.fn) {
    out.error = first.errors.length ? `load failed: ${first.errors[0]}` : first.stopped ? 'loading the code was stopped by the wall-clock backstop' : `no function named ${name}`;
  } else {
    let spare = first;
    for (const test of tests) {
      if (spent >= caseCpuMs) {
        out.results.push({ error: `the CPU budget of ${caseCpuMs} ms for the case was spent before this test` });
      } else {
        out.results.push(judge(sources, name, test, spare));
      }
      spare = null;
    }
  }
  out.cpu_ms = Math.round(spent);
  write(`\n${JSON.stringify(out)}\n`);
});
