// Evaluators turn one raw row plus its case into a score in 0..1. Each has an
// id and a version; changing what one computes means a new version, never an
// edit, because stored scores name the version that produced them.
// `score` returns null when the evaluator does not apply to the case.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeSegment } from '../lib/fsutil.mjs';
import { rebuildWorkspace, treeHash } from '../lib/workspace.mjs';
import { isDeepStrictEqual } from 'node:util';
import { runExecutableTests } from './workspace-test-execution.mjs';

function exactMatch({ text, expected }) {
  const actual = String(text ?? '').trim();
  const want = String(expected ?? '').trim();
  const value = actual === want ? 1 : 0;
  return { value, passed: value === 1, details: { expected, actual, normalization: 'trim' } };
}

export function normalizeAnswer(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’“”"'`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s.,;:!?()[\]{}-]+|[\s.,;:!?()[\]{}-]+$/g, '');
}

function normalizedMatch({ text, expected }) {
  const actual = normalizeAnswer(text);
  const accepted = (Array.isArray(expected) ? expected : [expected]).map(normalizeAnswer);
  const value = accepted.includes(actual) ? 1 : 0;
  return { value, passed: value === 1, details: { expected, actual: text, normalized: actual, normalization: 'nfkc, lowercase, strip quotes, collapse spaces, trim punctuation' } };
}

export function extractSvg(text) {
  const match = /<svg[\s>][\s\S]*<\/svg>/i.exec(String(text ?? ''));
  return match ? match[0] : null;
}

function svgStructure({ text, input }) {
  const svg = extractSvg(text);
  const checks = {};
  checks.has_svg_root = Boolean(svg);
  const source = svg || '';
  const open = /<svg\b([^>]*)>/i.exec(source)?.[1] || '';
  const attr = (name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(open)?.[1] ?? null;
  if (input?.width != null && input?.height != null) {
    checks.size_matches = attr('width') === String(input.width) && attr('height') === String(input.height);
    checks.viewbox_matches = (attr('viewBox') || '').trim().split(/[\s,]+/).join(' ') === `0 0 ${input.width} ${input.height}`;
  }
  checks.no_script = !/<script\b/i.test(source);
  checks.no_foreign_object = !/<foreignObject\b/i.test(source);
  checks.no_event_handlers = !/\son[a-z]+\s*=/i.test(source);
  checks.no_external_refs = !/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(source) && !/url\(\s*["']?\s*https?:/i.test(source);
  const tags = [...source.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)];
  const stack = [];
  let balanced = Boolean(svg);
  for (const [, closing, name, selfClosing] of tags) {
    if (selfClosing) continue;
    if (!closing) stack.push(name);
    else if (stack.pop() !== name) balanced = false;
  }
  checks.tags_balanced = balanced && stack.length === 0;
  checks.only_svg_in_response = Boolean(svg) && String(text).trim() === svg.trim();
  const required = Object.entries(checks).filter(([key]) => key !== 'only_svg_in_response');
  const passedCount = required.filter(([, ok]) => ok).length;
  const value = Number((passedCount / required.length).toFixed(4));
  return { value, passed: passedCount === required.length, details: { checks } };
}

// The last "Answer: ..." line, else the last non-empty line. Agents often explain
// first; the prompt asks them to end with the marker. Accepts **Answer**: and
// **Answer:** as well as Answer:.
export function extractFinalAnswer(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^(?:[*_#>\s-]*)(?:final\s+)?answer[*_\s]*[:：]\s*(.+)$/i.exec(lines[i]);
    if (match) return { answer: match[1].replace(/^[*_`\s]+|[*_`\s]+$/g, ''), marker: true };
  }
  return { answer: lines.at(-1) ?? '', marker: false };
}

const NUMBER = /[-+]?(?:\d{1,3}(?:,\d{3})+(?![\d,])|\d+)(?:\.\d+)?|[-+]?\.\d+/g;

/**
 * The number in an answer. After an "Answer:" marker it is the first number (or a
 * leading fraction such as 15/2); a bare last line is a sentence, so it is the last
 * number there ("300 km / 150 km/h = 2 hours" gives 2).
 */
export function parseNumber(value, { last = false } = {}) {
  const text = String(value ?? '');
  const fraction = /^\s*([-+]?\d+)\s*\/\s*(\d+)\b/.exec(text);
  if (!last && fraction && Number(fraction[2]) !== 0) return Number(fraction[1]) / Number(fraction[2]);
  const all = [...text.matchAll(NUMBER)].map((match) => Number(match[0].replace(/,/g, '')));
  if (!all.length) return null;
  return last ? all.at(-1) : all[0];
}

function finalAnswer({ text, expected }) {
  const { answer, marker } = extractFinalAnswer(text);
  let ok;
  let compared;
  if (typeof expected === 'number') {
    compared = parseNumber(answer, { last: !marker });
    ok = compared !== null && Math.abs(compared - expected) <= 1e-6 * Math.max(1, Math.abs(expected));
  } else {
    compared = normalizeAnswer(answer);
    ok = (Array.isArray(expected) ? expected : [expected]).map(normalizeAnswer).includes(compared);
  }
  const value = ok ? 1 : 0;
  return { value, passed: ok, details: { expected, extracted: answer, compared, marker_found: marker } };
}

function decimalScalar(value) {
  const text = String(value).trim();
  const match = /^([+-]?)(?:(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,4}))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? match[4] ?? '';
  let digits = ((match[2] ?? '0').replace(/,/g, '') + fraction).replace(/^0+/, '');
  if (!digits) return { negative: false, digits: '0', exponent: 0 };
  let exponent = Number(match[5] ?? 0) - fraction.length;
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0;
  if (trailing) { digits = digits.slice(0, -trailing); exponent += trailing; }
  return { negative: match[1] === '-', digits, exponent };
}

function finalAnswerV2({ text, expected }) {
  if (typeof expected !== 'number') return finalAnswer({ text, expected });
  const { answer, marker } = extractFinalAnswer(text);
  const actual = decimalScalar(answer);
  const want = Number.isFinite(expected) ? decimalScalar(expected) : null;
  const ok = actual !== null && want !== null && isDeepStrictEqual(actual, want);
  return { value: ok ? 1 : 0, passed: ok, details: { expected, extracted: answer, compared: actual, marker_found: marker, comparison: 'one exact decimal scalar; no expression, unit or tolerance' } };
}

/**
 * The code to run: every JavaScript block in order (a later block may be a usage
 * example or a fixed version), else the last fenced block, else the whole reply.
 */
export function extractCodeBlocks(text) {
  const blocks = [...String(text ?? '').matchAll(/```[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)```/g)];
  if (!blocks.length) return [String(text ?? '')];
  const js = blocks.filter(([, lang]) => /^(js|javascript|mjs|cjs|node|)$/i.test(lang));
  return js.length ? js.map((block) => block[2]) : [blocks.at(-1)[2]];
}

const SANDBOX = fileURLToPath(new URL('./js-sandbox.cjs', import.meta.url));
const SANDBOX_TIMEOUT_MS = 30000;
// Node 20 to 22.12 name the permission model --experimental-permission.
const PERMISSION_FLAG = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
// node:sqlite opens and creates files past the permission model (Node 22-24), so
// both sandboxes turn it off where this Node knows the flag.
const SANDBOX_FLAGS = [PERMISSION_FLAG, ...(process.allowedNodeEnvironmentFlags.has('--no-experimental-sqlite') ? ['--no-experimental-sqlite'] : [])];
// Before Node 23.5 a folder grant needs a trailing wildcard to cover its files.
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);

/**
 * Runs model-written code in its own Node process: permission model on (it reads
 * only the sandbox file; no writes, child processes, workers or addons), a 256 MB
 * heap, a minimal environment, 2 s per test and a time limit for the process.
 * Node does not limit the network. The expected values never enter the sandbox,
 * and only the output line that carries this call's nonce counts.
 */
export function runJsTests({ sources, name, tests }) {
  const nonce = crypto.randomUUID();
  const env = process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {};
  const result = spawnSync(process.execPath, [...SANDBOX_FLAGS, `--allow-fs-read=${SANDBOX}`, '--max-old-space-size=256', SANDBOX], {
    input: JSON.stringify({ nonce, sources, name, tests: tests.map((test) => ({ args: test.args })) }),
    encoding: 'utf8',
    timeout: SANDBOX_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    env,
    windowsHide: true,
  });
  const fail = (error) => ({ loaded: false, error, results: tests.map((test) => ({ args: test.args, expected: test.returns, ok: false })) });
  if (result.error) return fail(result.error.code === 'ETIMEDOUT' ? `sandbox timed out after ${SANDBOX_TIMEOUT_MS / 1000} s` : result.error.message);
  let out = null;
  for (const line of String(result.stdout).split('\n')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.nonce === nonce) out = parsed;
    } catch {
      // Not the sandbox's line.
    }
  }
  if (!out) return fail(`sandbox gave no result (exit ${result.status}): ${String(result.stderr).trim().split('\n').at(-1)?.slice(0, 200) ?? ''}`);
  const results = tests.map((test, index) => {
    const item = out.results?.[index] || { error: 'no result for this test' };
    const base = { args: test.args, expected: test.returns };
    if (item.error) return { ...base, error: String(item.error).slice(0, 200), ok: false };
    let actual = null;
    try {
      actual = item.undefined ? undefined : JSON.parse(item.actual_json);
    } catch {
      return { ...base, error: 'result is not JSON', ok: false };
    }
    const shown = actual === undefined ? null : JSON.stringify(actual).length > 4000 ? `${JSON.stringify(actual).slice(0, 4000)}…` : actual;
    return { ...base, actual: shown, ok: isDeepStrictEqual(actual, test.returns) };
  });
  return { loaded: Boolean(out.loaded), ...(out.error ? { error: String(out.error).slice(0, 300) } : {}), results };
}

// ---- Version 2: the limits are CPU time, so a busy machine does not change a verdict. ----
// js-function@1 and workspace-tests@1 (above and below) stay as they are: stored scores name
// their version, and scores of different versions are never compared.

/** The limits of js-function@2 and workspace-tests@2, in ms of CPU time. `cap` bounds the wall-clock backstop. */
export const CPU_LIMITS = Object.freeze({ testCpuMs: 2000, caseCpuMs: 30000, checkCpuMs: 60000, probeMs: 5000, cap: 10 });

const SANDBOX_V2 = fileURLToPath(new URL('./js-sandbox-v2.cjs', import.meta.url));
const SANDBOX_V3 = fileURLToPath(new URL('./js-sandbox-v3.cjs', import.meta.url));
const WORKSPACE_CHECK_V2 = fileURLToPath(new URL('./workspace-check-v2.mjs', import.meta.url));
const WORKSPACE_CHECK_V3 = fileURLToPath(new URL('./workspace-check-v3.mjs', import.meta.url));

let spinSink = 0;
/**
 * Wall time per CPU time that this process gets right now (1 to `cap`): a busy loop of about
 * 60 ms of CPU (the clock ticks every 15.6 ms on Windows), or 700 ms of wall time when the
 * machine is very busy. It only runs after a backstop has fired, so an idle run never pays for it.
 */
export function wallPerCpu(cap = CPU_LIMITS.cap) {
  const cpuNow = () => {
    const { user, system } = process.cpuUsage();
    return (user + system) / 1000;
  };
  const wall0 = performance.now();
  const cpu0 = cpuNow();
  for (;;) {
    for (let i = 0; i < 20000; i += 1) spinSink += Math.sqrt(i);
    const cpu = cpuNow() - cpu0;
    const wall = performance.now() - wall0;
    if (cpu >= 62 || wall >= 700) {
      const seen = cpu > 1 ? wall / cpu : cap;
      return seen < 1.1 ? 1 : Math.min(cap, seen);
    }
  }
}

/**
 * Runs a child process with a wall-clock backstop that follows the load. The first try gets
 * `baseMs`. If the backstop stops it, the machine is measured: when the process was starved
 * (ratio over 1.2) it runs again with `baseMs x ratio`, at most `cap` times the base.
 */
function withBackstop(run, baseMs, cap) {
  let result = run(baseMs);
  if (result.error?.code === 'ETIMEDOUT') {
    const ratio = wallPerCpu(cap);
    if (ratio > 1.2) result = run(Math.round(baseMs * ratio));
  }
  return result;
}

const limitsOf = (limits) => ({ ...CPU_LIMITS, ...(limits || {}) });

/** One sandbox process: { out } with its result line, or { error, died } (died: it ended without one). */
function sandboxV2({ sources, name, tests, lim, caseCpuMs, sandbox = SANDBOX_V2 }) {
  const nonce = crypto.randomUUID();
  const env = process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {};
  const input = JSON.stringify({ nonce, sources, name, tests: tests.map((test) => ({ args: test.args })), limits: { testCpuMs: lim.testCpuMs, caseCpuMs, cap: lim.cap } });
  const result = spawnSync(process.execPath, [...SANDBOX_FLAGS, `--allow-fs-read=${sandbox}`, '--max-old-space-size=256', sandbox], {
    input,
    encoding: 'utf8',
    timeout: lim.wallMs ?? caseCpuMs * lim.cap,
    maxBuffer: 8 * 1024 * 1024,
    env,
    windowsHide: true,
  });
  if (result.error) return { error: result.error.code === 'ETIMEDOUT' ? 'sandbox stopped by its wall-clock backstop' : result.error.message, ...(sandbox === SANDBOX_V3 ? { outcome: result.error.code === 'ETIMEDOUT' ? 'wall-backstop' : 'runtime-error' } : {}) };
  let out = null;
  for (const line of String(result.stdout).split('\n')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.nonce === nonce) out = parsed;
    } catch {
      // Not the sandbox's line.
    }
  }
  if (out) return { out };
  const stderr = String(result.stderr);
  const why = /FATAL ERROR:[^\r\n]*/.exec(stderr)?.[0] ?? stderr.trim().split('\n').at(-1) ?? '';
  return { error: `sandbox gave no result (exit ${result.status}): ${why.slice(0, 200)}`, died: true, ...(sandbox === SANDBOX_V3 ? { outcome: /heap out of memory|Reached heap limit/i.test(stderr) ? 'heap-limit' : 'runtime-error' } : {}) };
}

/** Every test in its own process, sharing the CPU budget of the case. A test whose process dies is charged its full CPU limit. */
function oneProcessEach(run, tests, lim, v3 = false) {
  const results = [];
  let spent = 0;
  let loaded = false;
  let firstError = null;
  for (const test of tests) {
    if (spent >= lim.caseCpuMs) {
      results.push({ error: `the CPU budget of ${lim.caseCpuMs} ms for the case was spent before this test`, ...(v3 ? { outcome: 'case-cpu-limit' } : {}) });
      continue;
    }
    const one = run([test], lim.caseCpuMs - spent);
    if (one.out) {
      spent += Number.isFinite(one.out.cpu_ms) ? one.out.cpu_ms : 0;
      loaded ||= Boolean(one.out.loaded);
      firstError ??= one.out.error ?? null;
      results.push(one.out.results?.[0] ?? { error: 'no result for this test' });
    } else {
      spent += lim.testCpuMs;
      firstError ??= one.error;
      results.push({ error: `this test stopped the sandbox process. ${one.error}`, ...(v3 ? { outcome: one.outcome ?? 'runtime-error' } : {}) });
    }
  }
  return loaded || v3 ? { out: { loaded, cpu_ms: Math.round(spent), results, ...(v3 && firstError ? { error: firstError } : {}) } } : { error: firstError };
}

/**
 * js-function@2: the same sandbox idea as runJsTests, judged by CPU time (js-sandbox-v2.cjs).
 * A test fails over `testCpuMs` of CPU; the tests of a case share `caseCpuMs`. The sandbox
 * always ends by itself (every step has a CPU-based backstop and the case has a CPU budget),
 * so the process wall limit only stops a sandbox that hangs. It must be longer than any
 * honest case on the busiest machine: caseCpuMs x cap (300 s). `limits.wallMs` replaces it
 * (for tests that need a short one).
 *
 * Code that fills the heap aborts the whole process (V8 exit 134), and whether the heap limit or
 * the CPU limit comes first varies from run to run. So a process that dies gives no verdict: the
 * tests run again, one process each. The test that kills its process fails alone.
 */
export function runJsTestsV2({ sources, name, tests, limits }) {
  return runJsTestsVersion({ sources, name, tests, limits }, SANDBOX_V2);
}

export function runJsTestsV3({ sources, name, tests, limits }) {
  return runJsTestsVersion({ sources, name, tests, limits }, SANDBOX_V3);
}

function runJsTestsVersion({ sources, name, tests, limits }, sandbox) {
  const lim = limitsOf(limits);
  const v3 = sandbox === SANDBOX_V3;
  const fail = (error, outcome = 'runtime-error') => ({ loaded: false, error, results: tests.map((test) => ({ args: test.args, expected: test.returns, ok: false, ...(v3 ? { outcome, ...(outcome === 'wall-backstop' ? { unjudged: true } : {}) } : {}) })) });
  const run = (some, caseCpuMs) => sandboxV2({ sources, name, tests: some, lim, caseCpuMs, sandbox });
  let done = run(tests, lim.caseCpuMs);
  if (done.died && tests.length > 1) done = oneProcessEach(run, tests, lim, v3);
  if (!done.out) return fail(done.error, done.outcome);
  const { out } = done;
  const results = tests.map((test, index) => {
    const item = out.results?.[index] || { error: 'no result for this test' };
    const base = { args: test.args, expected: test.returns, ...(v3 ? { outcome: item.outcome ?? 'returned', ...(item.outcome === 'wall-backstop' ? { unjudged: true } : {}), ...(Number.isFinite(item.cpu_ms) ? { cpu_ms: item.cpu_ms } : {}), ...(Number.isFinite(item.wall_ms) ? { wall_ms: item.wall_ms } : {}) } : {}) };
    if (item.error) return { ...base, error: String(item.error).slice(0, 200), ok: false };
    let actual = null;
    try {
      actual = item.undefined ? undefined : JSON.parse(item.actual_json);
    } catch {
      return { ...base, error: 'result is not JSON', ok: false };
    }
    const shown = actual === undefined ? null : JSON.stringify(actual).length > 4000 ? `${JSON.stringify(actual).slice(0, 4000)}…` : actual;
    return { ...base, actual: shown, ok: isDeepStrictEqual(actual, test.returns) };
  });
  return { loaded: Boolean(out.loaded), ...(out.error ? { error: String(out.error).slice(0, 300) } : {}), ...(Number.isFinite(out.cpu_ms) ? { cpu_ms: out.cpu_ms } : {}), results };
}

const WORKSPACE_CHECK = fileURLToPath(new URL('./workspace-check.mjs', import.meta.url));

/**
 * The hidden check of an agent task: datasets/<suite>/checks/<name>/ holds
 * probe.mjs (runs in the sandbox, returns observed values) and expected.json
 * (read here only): { probes: { <name>: <value> }, files: { <path>: { exists?,
 * includes?, same_as_starter? } } }. Each probe and each file rule is one test.
 */
export function loadCheck(checksDir, name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error(`expected.check must be a plain folder name, got ${JSON.stringify(name)}`);
  const dir = path.join(checksDir, name);
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  return { probeFile: path.join(dir, 'probe.mjs'), probes: expected.probes || {}, files: expected.files || {}, ...(expected.tests != null ? { tests: expected.tests } : {}) };
}

function fileRule(rule, text, starterText) {
  if (rule.exists === false) return text == null ? null : 'file should not exist';
  if (text == null) return 'file is missing';
  for (const part of rule.includes || []) if (!text.includes(part)) return `file lacks ${JSON.stringify(part).slice(0, 80)}`;
  if (rule.same_as_starter && text !== starterText) return 'file differs from the starter';
  return null;
}

const readOrNull = (file) => (fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, 'utf8') : null);

/**
 * Rebuilds an agent's final workspace from the run's stored evidence, adds the
 * probe file under a random name, runs it in the sandbox (permission model, read
 * access to that folder and the runner only), and judges the values here.
 */
export function runWorkspaceCheck({ fixtureDir, check, runDir, manifestPath }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-check-'));
  try {
    const workspace = path.join(dir, 'ws');
    const manifest = rebuildWorkspace({ fixtureDir, runDir, manifestPath, dest: workspace });
    const results = [];
    for (const [rel, rule] of Object.entries(check.files)) {
      const problem = fileRule(rule, readOrNull(path.join(workspace, ...rel.split('/'))), readOrNull(path.join(fixtureDir, ...rel.split('/'))));
      results.push({ name: `file ${rel}`, ok: !problem, ...(problem ? { error: problem } : {}) });
    }
    const probe = `.lab-probe-${crypto.randomUUID()}.mjs`;
    fs.copyFileSync(check.probeFile, path.join(workspace, probe)); // not a run folder: the scratch rebuild
    const nonce = crypto.randomUUID();
    const env = process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {};
    const reads = [workspace, ...(NODE_MAJOR < 23 ? [path.join(workspace, '*')] : []), WORKSPACE_CHECK].map((item) => `--allow-fs-read=${item}`);
    const run = spawnSync(process.execPath, [...SANDBOX_FLAGS, ...reads, '--max-old-space-size=256', WORKSPACE_CHECK], {
      input: JSON.stringify({ nonce, workspace, probe }),
      cwd: workspace,
      encoding: 'utf8',
      timeout: SANDBOX_TIMEOUT_MS * 2,
      maxBuffer: 8 * 1024 * 1024,
      env,
      windowsHide: true,
    });
    let out = null;
    for (const line of String(run.stdout ?? '').split('\n')) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && parsed.nonce === nonce) out = parsed;
      } catch {
        // Not the runner's line.
      }
    }
    let error = null;
    if (run.error) error = run.error.code === 'ETIMEDOUT' ? `check timed out after ${(SANDBOX_TIMEOUT_MS * 2) / 1000} s` : run.error.message;
    else if (!out) error = `check gave no result (exit ${run.status}): ${String(run.stderr).trim().split('\n').at(-1)?.slice(0, 200) ?? ''}`;
    else if (out.error) error = String(out.error).slice(0, 300);
    const observed = new Map((Array.isArray(out?.results) ? out.results : []).map((item) => [String(item?.name), item]));
    for (const [name, want] of Object.entries(check.probes)) {
      const got = observed.get(name);
      if (!got) results.push({ name, ok: false, error: 'no result for this probe' });
      else if (got.error != null) results.push({ name, ok: false, error: String(got.error).slice(0, 300) });
      else {
        let value;
        try {
          value = JSON.parse(String(got.json));
        } catch {
          value = undefined;
        }
        const ok = value !== undefined && isDeepStrictEqual(value, want);
        results.push({ name, ok, ...(ok ? {} : { error: `expected ${JSON.stringify(want)}, got ${String(got.json).slice(0, 200)}` }) });
      }
    }
    return { ...(error ? { error } : {}), skipped: manifest.skipped || [], results };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // not a run folder: the scratch rebuild
  }
}

/**
 * workspace-tests@2: the same rebuild, probes and comparison as runWorkspaceCheck, judged by
 * CPU time (workspace-check-v2.mjs). The check has `checkCpuMs` of CPU, tested between probes;
 * past it, the probes that have not started have no result and say why. The process wall
 * limit is a backstop (2 x checkCpuMs, longer on a busy machine, `cap` x at most). When it
 * stops the process, the probes that had finished keep their results.
 * `limits.wallMs` replaces the backstop base (for tests that need a short one).
 */
export function runWorkspaceCheckV2({ fixtureDir, check, runDir, manifestPath, limits }) {
  return runWorkspaceCheckVersion({ fixtureDir, check, runDir, manifestPath, limits }, false);
}

export function runWorkspaceCheckV3({ fixtureDir, check, runDir, manifestPath, limits }) {
  return runWorkspaceCheckVersion({ fixtureDir, check, runDir, manifestPath, limits }, true);
}

function runWorkspaceCheckVersion({ fixtureDir, check, runDir, manifestPath, limits }, v3) {
  const lim = limitsOf(limits);
  const script = v3 ? WORKSPACE_CHECK_V3 : WORKSPACE_CHECK_V2;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-check-'));
  try {
    const workspace = path.join(dir, 'ws');
    const manifest = rebuildWorkspace({ fixtureDir, runDir, manifestPath, dest: workspace });
    const results = [];
    for (const [rel, rule] of Object.entries(check.files)) {
      const problem = fileRule(rule, readOrNull(path.join(workspace, ...rel.split('/'))), readOrNull(path.join(fixtureDir, ...rel.split('/'))));
      results.push({ name: `file ${rel}`, ok: !problem, ...(problem ? { error: problem } : {}) });
    }
    const probe = `.lab-probe-${crypto.randomUUID()}.mjs`;
    fs.copyFileSync(check.probeFile, path.join(workspace, probe)); // not a run folder: the scratch rebuild
    const nonce = crypto.randomUUID();
    const env = process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {};
    const reads = [workspace, ...(NODE_MAJOR < 23 ? [path.join(workspace, '*')] : []), script].map((item) => `--allow-fs-read=${item}`);
    const input = JSON.stringify({ nonce, workspace, probe, limits: { cpuMs: lim.checkCpuMs, probeMs: lim.probeMs, cap: lim.cap } });
    const baseMs = lim.wallMs ?? 2 * lim.checkCpuMs;
    const run = withBackstop(
      (timeout) =>
        spawnSync(process.execPath, [...SANDBOX_FLAGS, ...reads, '--max-old-space-size=256', script], {
          input,
          cwd: workspace,
          encoding: 'utf8',
          timeout,
          maxBuffer: 8 * 1024 * 1024,
          env,
          windowsHide: true,
        }),
      baseMs,
      lim.cap,
    );
    // The final line, or else the probe lines written before the process stopped.
    let out = null;
    const early = [];
    for (const line of String(run.stdout ?? '').split('\n')) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && parsed.nonce === nonce) {
          if (parsed.probe) early.push(parsed.probe);
          else out = parsed;
        }
      } catch {
        // Not the runner's line.
      }
    }
    let error = null;
    if (run.error) error = run.error.code === 'ETIMEDOUT' ? 'check stopped by its wall-clock backstop' : run.error.message;
    else if (!out) error = `check gave no result (exit ${run.status}): ${String(run.stderr).trim().split('\n').at(-1)?.slice(0, 200) ?? ''}`;
    else if (out.error) error = String(out.error).slice(0, 300);
    const observed = new Map((Array.isArray(out?.results) ? out.results : early).map((item) => [String(item?.name), item]));
    for (const [name, want] of Object.entries(check.probes)) {
      const got = observed.get(name);
      if (!got) results.push({ name, ok: false, error: 'no result for this probe', ...(v3 && run.error?.code === 'ETIMEDOUT' ? { outcome: 'wall-backstop', unjudged: true } : {}) });
      else if (got.error != null) results.push({ name, ok: false, error: String(got.error).slice(0, 300), ...(v3 ? { outcome: got.outcome ?? 'runtime-error', ...(got.outcome === 'wall-backstop' ? { unjudged: true } : {}) } : {}) });
      else {
        let value;
        try {
          value = JSON.parse(String(got.json));
        } catch {
          value = undefined;
        }
        const ok = value !== undefined && isDeepStrictEqual(value, want);
        results.push({ name, ok, ...(ok ? {} : { error: `expected ${JSON.stringify(want)}, got ${String(got.json).slice(0, 200)}` }) });
      }
    }
    let unjudged = v3 && (run.error?.code === 'ETIMEDOUT' || results.some((item) => item.outcome === 'wall-backstop'));
    if (v3 && check.tests) {
      const execution = runExecutableTests({ workspace, rule: check.tests });
      results.push({ name: 'executable tests', ok: execution.ok, ...(execution.unjudged ? { unjudged: true } : {}), ...(execution.definite_failure ? { definite_failure: true } : {}), ...(execution.error ? { error: execution.error } : {}), ...(execution.details ? { details: execution.details } : {}) });
      unjudged ||= Boolean(execution.unjudged);
    }
    return { ...(error ? { error } : {}), ...(Number.isFinite(out?.cpu_ms) ? { cpu_ms: out.cpu_ms } : {}), skipped: manifest.skipped || [], results, ...(v3 ? { unjudged } : {}) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // not a run folder: the scratch rebuild
  }
}

function workspaceTests({ raw, testCase, suite, runDir }, runner = runWorkspaceCheck) {
  const checkName = testCase.expected?.check;
  if (!checkName || testCase.input?.workspace == null || !suite?.dir || !runDir) return null;
  const manifest = (raw.artifacts || []).find((item) => String(item.path || '').endsWith('/workspace.json'));
  if (!manifest) return { value: 0, passed: false, details: { check: checkName, error: 'no workspace was stored for this row' } };
  // A frozen suite version may keep its own workspaces/ and checks/ (lab/lib/repo.mjs loadSuite).
  const fixtureDir = path.join(suite.workspacesDir ?? path.join(suite.dir, 'workspaces'), safeSegment(String(testCase.input.workspace)));
  let run;
  try {
    const stored = JSON.parse(fs.readFileSync(path.join(runDir, ...String(manifest.path).split('/')), 'utf8'));
    // The rebuild adds the agent's changes to today's starter. If the starter has
    // changed since the run, the rebuild would be a different workspace: no score.
    if (stored.fixture_sha256 !== treeHash(fixtureDir)) return { skip: 'its starter project changed since the run, so the rebuild would not be the workspace the agent left' };
    run = runner({ fixtureDir, check: loadCheck(suite.checksDir ?? path.join(suite.dir, 'checks'), checkName), runDir, manifestPath: manifest.path });
  } catch (error) {
    run = { error: `check could not run: ${String(error?.message ?? error).slice(0, 300)}`, skipped: [], results: [] };
  }
  if (run.unjudged) return mixedVerification(run.results, 'workspace verification reached an operational backstop or unsupported observation capability; correctness is unjudged', run.error);
  const passedTests = run.results.filter((item) => item.ok).length;
  const total = run.results.length;
  const value = total ? Number((passedTests / total).toFixed(4)) : 0;
  return {
    value,
    passed: total > 0 && passedTests === total && !run.error,
    details: { check: checkName, passed_tests: passedTests, total_tests: total, ...(run.error ? { error: run.error } : {}), ...(run.skipped.length ? { skipped: run.skipped } : {}), results: run.results },
  };
}

function jsFunction({ text, testCase }, runner = runJsTests) {
  const tests = testCase.expected?.tests;
  const name = testCase.input?.name;
  if (!Array.isArray(tests) || !tests.length || !name) return null;
  const run = runner({ sources: extractCodeBlocks(text), name, tests });
  const passedTests = run.results.filter((item) => item.ok).length;
  const value = Number((passedTests / tests.length).toFixed(4));
  return { value, passed: passedTests === tests.length, details: { function: name, loaded: run.loaded, passed_tests: passedTests, total_tests: tests.length, ...(run.error ? { error: run.error } : {}), results: run.results } };
}

export const hasDefiniteFailure = results => results.some(item => item.definite_failure || (!item.ok && !item.unjudged));

function mixedVerification(results, reason, error) {
  const definiteFailure = hasDefiniteFailure(results);
  const details = { results, ...(error ? { error } : {}), unjudged_tests: results.filter(item => item.unjudged).length, quality_scope: definiteFailure ? 'case failure established by a judged check; unfinished checks are not imputed as wrong' : 'no complete case verdict; unfinished checks remain unjudged' };
  return definiteFailure ? { value: 0, passed: false, details } : { skip: reason, details };
}

function jsFunctionV3({ text, testCase }) {
  const tests = testCase.expected?.tests;
  const name = testCase.input?.name;
  if (!Array.isArray(tests) || !tests.length || !name) return null;
  const run = runJsTestsV3({ sources: extractCodeBlocks(text), name, tests, limits: testCase.expected.limits });
  if (run.results.some((item) => item.unjudged)) return mixedVerification(run.results, 'execution stopped by an operational wall-clock backstop; correctness is unjudged', run.error);
  const passed = run.results.filter((item) => item.ok).length;
  return { value: Number((passed / tests.length).toFixed(4)), passed: passed === tests.length, details: { function: name, loaded: run.loaded, passed_tests: passed, total_tests: tests.length, ...(run.error ? { error: run.error } : {}), results: run.results, runtime_policy: 'declared CPU/heap compliance is distinct from semantic output; wall-backstop outcomes are unjudged' } };
}

export const EVALUATORS = {
  'exact-match@1': { id: 'exact-match', version: '1', dimension: 'quality', score: ({ raw, testCase }) => (testCase.expected == null ? null : exactMatch({ text: raw.response?.text, expected: testCase.expected })) },
  'normalized-match@1': { id: 'normalized-match', version: '1', dimension: 'quality', score: ({ raw, testCase }) => (testCase.expected == null ? null : normalizedMatch({ text: raw.response?.text, expected: testCase.expected })) },
  'svg-structure@1': { id: 'svg-structure', version: '1', dimension: 'format', score: ({ raw, testCase }) => svgStructure({ text: raw.response?.text, input: testCase.input }) },
  'final-answer@1': { id: 'final-answer', version: '1', dimension: 'quality', score: ({ raw, testCase }) => (testCase.expected == null ? null : finalAnswer({ text: raw.response?.text, expected: testCase.expected })) },
  'final-answer@2': { id: 'final-answer', version: '2', dimension: 'quality', score: ({ raw, testCase }) => (testCase.expected == null ? null : finalAnswerV2({ text: raw.response?.text, expected: testCase.expected })) },
  'js-function@1': { id: 'js-function', version: '1', dimension: 'quality', score: ({ raw, testCase }) => jsFunction({ text: raw.response?.text, testCase }) },
  'js-function@2': { id: 'js-function', version: '2', dimension: 'quality', score: ({ raw, testCase }) => jsFunction({ text: raw.response?.text, testCase }, runJsTestsV2) },
  'js-function@3': { id: 'js-function', version: '3', dimension: 'quality', score: ({ raw, testCase }) => jsFunctionV3({ text: raw.response?.text, testCase }) },
  'workspace-tests@1': { id: 'workspace-tests', version: '1', dimension: 'quality', score: ({ raw, testCase, suite, runDir }) => workspaceTests({ raw, testCase, suite, runDir }) },
  'workspace-tests@2': { id: 'workspace-tests', version: '2', dimension: 'quality', score: ({ raw, testCase, suite, runDir }) => workspaceTests({ raw, testCase, suite, runDir }, runWorkspaceCheckV2) },
  'workspace-tests@3': { id: 'workspace-tests', version: '3', dimension: 'quality', score: ({ raw, testCase, suite, runDir }) => workspaceTests({ raw, testCase, suite, runDir }, (args) => runWorkspaceCheckV3({ ...args, limits: testCase.expected?.limits })) },
};

export function getEvaluator(id, version) {
  return EVALUATORS[`${id}@${version}`] || null;
}
