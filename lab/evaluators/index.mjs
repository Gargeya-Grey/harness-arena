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
import { rebuildWorkspace, treeHash } from '../lib/workspace.mjs';
import { isDeepStrictEqual } from 'node:util';

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

const WORKSPACE_CHECK = fileURLToPath(new URL('./workspace-check.mjs', import.meta.url));

/**
 * The hidden check of an agent task: datasets/<suite>/checks/<name>/ holds
 * probe.mjs (runs in the sandbox, returns observed values) and expected.json
 * (read here only): { probes: { <name>: <value> }, files: { <path>: { exists?,
 * includes?, same_as_starter? } } }. Each probe and each file rule is one test.
 */
export function loadCheck(checksDir, name) {
  const dir = path.join(checksDir, name);
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  return { probeFile: path.join(dir, 'probe.mjs'), probes: expected.probes || {}, files: expected.files || {} };
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
    fs.copyFileSync(check.probeFile, path.join(workspace, probe));
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function workspaceTests({ raw, testCase, suite, runDir }) {
  const checkName = testCase.expected?.check;
  if (!checkName || testCase.input?.workspace == null || !suite?.dir || !runDir) return null;
  const manifest = (raw.artifacts || []).find((item) => String(item.path || '').endsWith('/workspace.json'));
  if (!manifest) return { value: 0, passed: false, details: { check: checkName, error: 'no workspace was stored for this row' } };
  const fixtureDir = path.join(suite.dir, 'workspaces', testCase.input.workspace);
  let run;
  try {
    const stored = JSON.parse(fs.readFileSync(path.join(runDir, ...String(manifest.path).split('/')), 'utf8'));
    // The rebuild adds the agent's changes to today's starter. If the starter has
    // changed since the run, the rebuild would be a different workspace: no score.
    if (stored.fixture_sha256 !== treeHash(fixtureDir)) return null;
    run = runWorkspaceCheck({ fixtureDir, check: loadCheck(path.join(suite.dir, 'checks'), checkName), runDir, manifestPath: manifest.path });
  } catch (error) {
    run = { error: `check could not run: ${String(error?.message ?? error).slice(0, 300)}`, skipped: [], results: [] };
  }
  const passedTests = run.results.filter((item) => item.ok).length;
  const total = run.results.length;
  const value = total ? Number((passedTests / total).toFixed(4)) : 0;
  return {
    value,
    passed: total > 0 && passedTests === total && !run.error,
    details: { check: checkName, passed_tests: passedTests, total_tests: total, ...(run.error ? { error: run.error } : {}), ...(run.skipped.length ? { skipped: run.skipped } : {}), results: run.results },
  };
}

function jsFunction({ text, testCase }) {
  const tests = testCase.expected?.tests;
  const name = testCase.input?.name;
  if (!Array.isArray(tests) || !tests.length || !name) return null;
  const run = runJsTests({ sources: extractCodeBlocks(text), name, tests });
  const passedTests = run.results.filter((item) => item.ok).length;
  const value = Number((passedTests / tests.length).toFixed(4));
  return { value, passed: passedTests === tests.length, details: { function: name, loaded: run.loaded, passed_tests: passedTests, total_tests: tests.length, ...(run.error ? { error: run.error } : {}), results: run.results } };
}

export const EVALUATORS = {
  'exact-match@1': { id: 'exact-match', version: '1', dimension: 'quality', score: ({ raw, testCase }) => (testCase.expected == null ? null : exactMatch({ text: raw.response?.text, expected: testCase.expected })) },
  'normalized-match@1': { id: 'normalized-match', version: '1', dimension: 'quality', score: ({ raw, testCase }) => (testCase.expected == null ? null : normalizedMatch({ text: raw.response?.text, expected: testCase.expected })) },
  'svg-structure@1': { id: 'svg-structure', version: '1', dimension: 'format', score: ({ raw, testCase }) => svgStructure({ text: raw.response?.text, input: testCase.input }) },
  'final-answer@1': { id: 'final-answer', version: '1', dimension: 'quality', score: ({ raw, testCase }) => (testCase.expected == null ? null : finalAnswer({ text: raw.response?.text, expected: testCase.expected })) },
  'js-function@1': { id: 'js-function', version: '1', dimension: 'quality', score: ({ raw, testCase }) => jsFunction({ text: raw.response?.text, testCase }) },
  'workspace-tests@1': { id: 'workspace-tests', version: '1', dimension: 'quality', score: ({ raw, testCase, suite, runDir }) => workspaceTests({ raw, testCase, suite, runDir }) },
};

export function getEvaluator(id, version) {
  return EVALUATORS[`${id}@${version}`] || null;
}
