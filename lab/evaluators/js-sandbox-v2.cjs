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
const fs = require('node:fs');
const { isProxy } = require('node:util').types;

// Model code can reach this process's own built-ins (a vm context is not a security
// boundary: `this.constructor.constructor` escapes it) and replace them, or hand back
// objects whose getters or toString never return. So the code outside vm.runInContext,
// where no timeout applies, follows two rules: it uses only the built-ins captured here,
// before any model code runs, and it reads model values only as own data properties
// holding primitives. Nothing outside the timeout ever calls a function that model code
// could have made or replaced.
const { min, max, ceil, round } = Math;
const getOwn = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty;
const stringify = JSON.stringify;
const parse = JSON.parse;
const writeSync = fs.writeSync;
const runInContext = vm.runInContext;
const createContext = vm.createContext;
const now = performance.now.bind(performance);
const cpuUsage = process.cpuUsage.bind(process);
const slice = Function.prototype.call.bind(String.prototype.slice);
const matches = Function.prototype.call.bind(RegExp.prototype.test);

const MAX_ACTUAL_CHARS = 4000;
const STARVED_BELOW = 0.95; // a stopped step that used less of its CPU limit than this was starved
const MAX_ATTEMPTS = 3;
const MARGIN = 1.25; // on a busy machine the backstop gets 25% more, so a small change of the load does not stop a test that the CPU clock would pass
const write = (text) => writeSync(1, text);
// Appends without Array.prototype.push or an index assignment, which a setter on Array.prototype could catch.
const append = (list, value) => define(list, list.length, { value, writable: true, enumerable: true, configurable: true });
// The value of an own data property, never a getter and never through a Proxy trap.
const ownValue = (object, key) => {
  if (object === null || (typeof object !== 'object' && typeof object !== 'function') || isProxy(object)) return undefined;
  const descriptor = getOwn(object, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};

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
const backstopMs = (ratioNow) => ceil(min(testCpuMs * cap, testCpuMs * ratioNow * (ratioNow > 1.1 ? MARGIN : 1)));
// displayErrors: false, because with it on Node decorates a thrown value with its source
// line after the timeout window has closed, and reads `stack` from it: a getter or a Proxy
// trap there never returns (found by test, Node 24).
const options = (ms) => ({ timeout: ms, displayErrors: false });
// The vm timeout error is made by Node with `code` as an own data property.
const isTimeout = (error) => ownValue(error, 'code') === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
const messageOf = (error, limit) => {
  const message = typeof error === 'string' ? error : ownValue(error, 'message');
  return typeof message === 'string' ? slice(message, 0, limit) : 'error';
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
  if (wall >= measureFromMs) ratio = min(cap, max(1, cpu > 1 ? wall / cpu : cap));
  return { value, error, failed, stopped: failed && isTimeout(error) && wall >= ms * 0.9, wall, cpu };
}

// A fresh context per test, so state or memory from one test never reaches the next.
function load(sources, name, ms) {
  const module = { exports: {} };
  const context = createContext({ console: { log() {}, error() {}, warn() {}, info() {} }, module, exports: module.exports });
  const errors = [];
  let stopped = null;
  let cpu = 0;
  // `sources` were cleaned before any model code ran; a counted loop needs no array iterator.
  for (let index = 0; index < sources.count; index += 1) {
    const source = sources[index];
    const step = guarded(ms, () => runInContext(source, context, options(ms)));
    cpu += step.cpu;
    if (step.failed) append(errors, messageOf(step.error, 300));
    if (step.stopped) stopped = step;
  }
  const look = guarded(ms, () =>
    runInContext(
      `typeof ${name} === 'function' ? ${name} : typeof module.exports === 'function' ? module.exports : module.exports && typeof module.exports.${name} === 'function' ? module.exports.${name} : undefined`,
      context,
      options(ms),
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
  if (ctx.cpu > testCpuMs) return { used, result: { error: `loading the code used ${round(ctx.cpu)} ms of CPU, over the ${testCpuMs} ms limit` } };
  try {
    define(ctx.context, '__fn', { value: ctx.fn, writable: true, configurable: true });
    define(ctx.context, '__args', { value: stringify(test.args), writable: true, configurable: true });
  } catch {
    return { used, result: { error: 'the code blocked the names the test uses (__fn, __args)' } };
  }
  // Serialise inside the time limit: a hostile getter cannot hang the process.
  const step = guarded(ms, () => runInContext('JSON.stringify(__fn(...JSON.parse(__args)))', ctx.context, options(ms)));
  if (step.stopped) return { used, stopped: step, result: { error: `stopped by the wall-clock backstop after ${ms} ms (${round(step.cpu)} ms of CPU)` } };
  if (step.failed) return { used, result: { error: messageOf(step.error, 200) } };
  // A test is one fresh load and one call, so both count against the one CPU limit of the test.
  if (ctx.cpu + step.cpu > testCpuMs) return { used, result: { error: `used ${round(ctx.cpu + step.cpu)} ms of CPU (loading ${round(ctx.cpu)} ms), over the ${testCpuMs} ms limit` } };
  const text = step.value;
  if (text === undefined) return { used, result: { actual: null, undefined: true } };
  // The context's JSON.stringify can be replaced by model code, so the result may be anything.
  if (typeof text !== 'string') return { used, result: { error: 'the result did not serialise to JSON text' } };
  return { used, result: { actual_json: slice(text, 0, MAX_ACTUAL_CHARS * 4) } };
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
  // Parsed before any model code runs, so these are plain values from the evaluator.
  const { nonce, sources: given, name, tests, limits } = parse(input);
  input = '';
  // Cleaned once, here, before any model code runs: clean() uses String.prototype.replace.
  const sources = { count: given.length };
  for (let index = 0; index < given.length; index += 1) sources[index] = clean(given[index]);
  if (limits) {
    if (Number(limits.testCpuMs) > 0) testCpuMs = Number(limits.testCpuMs);
    if (Number(limits.caseCpuMs) > 0) caseCpuMs = Number(limits.caseCpuMs);
    if (Number(limits.cap) >= 1) cap = Number(limits.cap);
  }
  measureFromMs = min(300, testCpuMs / 2);
  if (!matches(/^[A-Za-z_$][\w$]*$/, name)) {
    write(`\n${stringify({ nonce, loaded: false, error: 'bad function name', results: [] })}\n`);
    return;
  }
  const testCount = tests.length;
  let usedRatio = ratio;
  let first = load(sources, name, backstopMs(usedRatio));
  for (let tries = 1; tries < MAX_ATTEMPTS && starved(first.stopped, usedRatio); tries += 1) {
    spent = 0;
    usedRatio = ratio;
    first = load(sources, name, backstopMs(usedRatio));
  }
  // The output object is made in one literal at the end: an assignment to a property of a
  // finished object could reach a setter that model code put on Object.prototype.
  const results = [];
  let error;
  if (!first.fn) {
    error = first.errors.length ? `load failed: ${first.errors[0]}` : first.stopped ? 'loading the code was stopped by the wall-clock backstop' : `no function named ${name}`;
  } else {
    let spare = first;
    for (let index = 0; index < testCount; index += 1) {
      if (spent >= caseCpuMs) {
        append(results, { error: `the CPU budget of ${caseCpuMs} ms for the case was spent before this test` });
      } else {
        append(results, judge(sources, name, tests[index], spare));
      }
      spare = null;
    }
  }
  const out = error === undefined
    ? { nonce, loaded: true, results, cpu_ms: round(spent) }
    : { nonce, loaded: false, results, error, cpu_ms: round(spent) };
  write(`\n${stringify(out)}\n`);
});
