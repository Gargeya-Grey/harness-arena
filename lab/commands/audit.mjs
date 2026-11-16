// node lab audit: how far the hidden checks and the scores can be trusted. No model call.
//
//   audit checks --suite <id> --suite-version <v> [--max n] [--cases a,b] [--write] [--json]
//       Plants small bugs (mutants) in the reference solution of each task and runs the hidden
//       check on them. A mutant that fails the check is killed; one that passes survives, and
//       a survivor is a gap in the check (or an equivalent change that cannot be told apart).
//       It audits the exact suite version named, and only a reference that passes every test of
//       that version: the report records the reference's hash.
//   audit stability --runs <id,...|all> [--json]
//       Scores each stored answer again, three times, and lists every answer whose scores
//       differ. It reads run folders and writes nothing into them.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CPU_LIMITS, getEvaluator, hasDefiniteFailure, loadCheck, runJsTestsV2, runWorkspaceCheckV2, runWorkspaceCheckV3 } from '../evaluators/index.mjs';
import { REPO_ROOT, loadSuite, paths, runDirs, suiteDir } from '../lib/repo.mjs';
import { isoNow, readJson, readJsonl, safeSegment, sha256 } from '../lib/fsutil.mjs';
import { applyMutation, mutationSites, pickSites } from '../lib/mutate.mjs';
import { copyTree, listTree, snapshotWorkspace, treeHash } from '../lib/workspace.mjs';
import { runCounts } from '../lib/ledger.mjs';
import { buildState } from '../lib/state.mjs';
import { resolveRunDir } from './score.mjs';

export const DEFAULT_MAX = 12;
export const STABILITY_TIMES = 3;
export const MISMATCH = 'reference does not match this version';
export const NOT_DETERMINISTIC = 'reference not deterministic';
export const NO_VERDICT = 'no mutant gave a verdict';

const USAGE = `Usage: node lab audit checks --suite <id> --suite-version <v> [--max <n>] [--cases a,b] [--write] [--json]
       node lab audit stability --runs <id,...|all> [--json]`;

const round = (value, digits = 3) => (value == null ? null : Number(value.toFixed(digits)));
const share = (part, whole) => (whole ? round(part / whole) : null);
const meanOf = (list) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null);
const posix = (file) => file.split(path.sep).join('/');
const isCode = (item) => Array.isArray(item.expected?.tests) && item.expected.tests.length > 0 && Boolean(item.input?.name);
const isAgent = (item) => typeof item.expected?.check === 'string' && item.input?.workspace != null;

// ---- references -------------------------------------------------------------------------------

/** Folders to look in for a reference outside the suite: the data root, then this checkout. */
const lookIn = (root) => [...new Set([root, REPO_ROOT])];

/** The suite's `audit` block, checked: references must stay under the suite's checks/ folder. */
function auditBlock(suite) {
  const block = suite.meta.audit;
  if (block == null) return null;
  const refs = typeof block.references === 'string' ? block.references.replace(/\\/g, '/').replace(/\/+$/, '') : '';
  if (!refs || refs.split('/')[0] !== 'checks' || refs.split('/').includes('..') || path.isAbsolute(refs)) {
    throw new Error(`suite ${suite.id} ${suite.version}: audit.references must be a folder under checks/, got ${JSON.stringify(block.references)}`);
  }
  const file = block.file == null ? '<case_id>.mjs' : String(block.file);
  if (!file.includes('<case_id>') || file.includes('/') || file.includes('\\') || file.includes('..')) {
    throw new Error(`suite ${suite.id} ${suite.version}: audit.file must be a plain file name that holds "<case_id>", got ${JSON.stringify(block.file)}`);
  }
  return { dir: path.join(suite.dir, ...refs.split('/')), file };
}

/** The reference of a code task: a file. Null when there is none. */
function codeReference({ root, suite, block, item }) {
  if (block) {
    const file = path.join(block.dir, block.file.replace('<case_id>', item.case_id));
    return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
  }
  if (!suite.id.startsWith('ladder-')) return null;
  for (const base of lookIn(root)) {
    const solutions = path.join(base, 'tests', 'fixtures', 'ladder-code-solutions');
    if (!fs.existsSync(solutions)) continue;
    for (const sub of fs.readdirSync(solutions, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const file = path.join(solutions, sub.name, `${item.case_id}.mjs`);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

/** The reference of an agent task: a folder laid over the starter project. Null when there is none. */
function agentReference({ root, suite, block, item }) {
  const slug = safeSegment(String(item.input.workspace));
  if (block) {
    const dir = path.join(block.dir, slug);
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null;
  }
  if (!suite.id.startsWith('ladder-')) return null;
  for (const base of lookIn(root)) {
    const solutions = path.join(base, 'tests', 'fixtures', 'ladder-agent-solutions');
    if (!fs.existsSync(solutions)) continue;
    for (const sub of fs.readdirSync(solutions, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const dir = path.join(solutions, sub.name, slug);
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    }
  }
  return null;
}

/** A path for the report: relative to the folder it was found in, never a home path. */
function shownPath(root, file) {
  for (const base of lookIn(root)) {
    const rel = path.relative(base, file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return posix(rel);
  }
  return posix(path.basename(file));
}

// ---- one task ---------------------------------------------------------------------------------

const baseRecord = (item, kind) => ({
  case_id: item.case_id,
  kind,
  tier: item.metadata?.tier?.level ?? null,
  tests: kind === 'code' ? item.expected.tests.length : null,
});

const excludedCase = (item, kind, reason, extra = {}) => ({ ...baseRecord(item, kind), status: 'excluded', reason, ...extra });

// A failed test says something about the code only when it ran and judged the code's answer. These
// are the other ways one fails: the time limit (a real check would reject such a solution too) and
// the ways a test never ran, or its process died, so no test judged the mutant.
const TIMED_OUT = /wall-clock backstop|timed out after|ms of CPU.*over the \d+ ms limit/;
const NOT_RUN = /^(the CPU budget of \d+ ms for the (case|check) was spent before this (test|probe)|no result for this (test|probe)|this test stopped the sandbox process|sandbox gave no result)/;

/**
 * What the results of one run of the check say about a mutant: `survived`; `killed` by a test that
 * judged it ('check') or only by the time limit ('timeout'); or `excluded`, when the only failures
 * are tests that never ran.
 */
export function judgeResults(results) {
  const failed = results.filter((result) => !result.ok);
  if (!failed.length) return { outcome: 'survived' };
  const error = (result) => String(result.error ?? '');
  if (failed.some((result) => !NOT_RUN.test(error(result)) && !TIMED_OUT.test(error(result)))) return { outcome: 'killed', killed_by: 'check' };
  if (failed.some((result) => TIMED_OUT.test(error(result)))) return { outcome: 'killed', killed_by: 'timeout' };
  return { outcome: 'excluded', reason: `no test judged this mutant: ${error(failed[0]).slice(0, 160)}` };
}

const signature = (run) => JSON.stringify([run.loaded ?? null, Boolean(run.error), run.results.map((result) => result.ok)]);
const passed = (run) => run.results.filter((result) => result.ok).length;

function summarize(record, mutants) {
  const valid = mutants.filter((mutant) => mutant.outcome !== 'excluded');
  const killed = valid.filter((mutant) => mutant.outcome === 'killed');
  const kept = killed.map((mutant) => mutant.pass / mutant.total);
  const stats = {
    mutants: valid.length,
    killed: killed.length,
    killed_by_check: killed.filter((mutant) => mutant.killed_by === 'check').length,
    killed_by_timeout: killed.filter((mutant) => mutant.killed_by === 'timeout').length,
    survived: valid.length - killed.length,
    excluded_mutants: mutants.length - valid.length,
    kill_rate: share(killed.length, valid.length),
    mean_score_of_killed: round(meanOf(kept)),
    results: mutants,
  };
  if (!valid.length) return { ...record, status: 'excluded', reason: NO_VERDICT, detail: `all ${mutants.length} mutants were excluded; the first: ${String(mutants[0].reason).slice(0, 120)}`, ...stats };
  return { ...record, status: 'audited', ...stats };
}

const LOAD_MARK = '__lab_audit_loaded__';
const LOAD_PROBE = '__lab_audit_probe__';
const THROWS_ON_LOAD = 'the mutant throws while it loads, so its tests did not judge the code that was planted';

/** Does the source run to its end? A hoisted function survives a throw above it, and the sandbox still loads it. */
function finishesLoading(source, limits) {
  const run = runJsTestsV2({
    sources: [`${source}\n;var ${LOAD_MARK} = true;\n`, `function ${LOAD_PROBE}() { return typeof ${LOAD_MARK} !== 'undefined'; }`],
    name: LOAD_PROBE,
    tests: [{ args: [], returns: true }],
    limits,
  });
  return run.results[0]?.ok === true;
}

function auditCodeCase({ root, suite, block, item, max }) {
  const reference = codeReference({ root, suite, block, item });
  if (!reference) return excludedCase(item, 'code', 'no reference solution');
  const bytes = fs.readFileSync(reference);
  const source = bytes.toString('utf8');
  const record = { ...baseRecord(item, 'code'), reference: { path: shownPath(root, reference), sha256: sha256(bytes) } };
  const { name } = item.input;
  const tests = item.expected.tests;
  const base = runJsTestsV2({ sources: [source], name, tests });
  const again = runJsTestsV2({ sources: [source], name, tests });
  if (signature(base) !== signature(again)) {
    return { ...record, status: 'excluded', reason: NOT_DETERMINISTIC, detail: `two runs of the reference passed ${passed(base)} and ${passed(again)} of ${tests.length} tests` };
  }
  const passes = passed(base);
  if (!base.loaded || passes !== tests.length) {
    return { ...record, status: 'excluded', reason: MISMATCH, detail: base.loaded ? `the reference passes ${passes} of ${tests.length} tests` : `the reference does not load: ${base.error ?? 'no error given'}` };
  }
  const sites = mutationSites(source);
  if (!sites.length) return { ...record, status: 'excluded', reason: 'no mutation site in the reference', sites: 0 };
  const caseCpuMs = Math.max(2 * CPU_LIMITS.testCpuMs, Math.ceil(Math.max(base.cpu_ms ?? 0, again.cpu_ms ?? 0) * 3) + CPU_LIMITS.testCpuMs);
  const limits = { caseCpuMs, wallMs: 60000 };
  const mutants = pickSites(sites, max).map((site) => {
    const mutated = applyMutation(source, site);
    const run = runJsTestsV2({ sources: [mutated], name, tests, limits });
    const shown = { line: site.line, operator: site.operator, code: site.code };
    if (!run.loaded) return { ...shown, outcome: 'excluded', reason: run.error ?? 'the mutant did not load', pass: null, total: tests.length };
    const verdict = judgeResults(run.results);
    if (verdict.outcome === 'excluded') return { ...shown, ...verdict, pass: null, total: tests.length };
    if (verdict.outcome === 'killed' && !finishesLoading(mutated, limits)) return { ...shown, outcome: 'excluded', reason: THROWS_ON_LOAD, pass: null, total: tests.length };
    return { ...shown, ...verdict, pass: passed(run), total: tests.length };
  });
  return summarize({ ...record, sites: sites.length }, mutants);
}

const SOURCE_FILE = /\.(mjs|cjs|js)$/;
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?js$/;

/** The starter plus the reference overlay (and one mutation), run through the real check in a scratch folder. */
function checkWorkspace({ fixtureDir, check, overlay, mutation, limits }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-audit-'));
  try {
    const work = path.join(scratch, 'work');
    copyTree(fixtureDir, work);
    fs.cpSync(overlay, work, { recursive: true }); // not a run folder: a scratch folder
    if (mutation) {
      const file = path.join(work, ...mutation.file.split('/'));
      fs.writeFileSync(file, applyMutation(fs.readFileSync(file, 'utf8'), mutation.site), 'utf8'); // not a run folder: a scratch folder
    }
    const runDir = path.join(scratch, 'run');
    fs.mkdirSync(runDir); // not a run folder: a scratch folder
    const artifact = snapshotWorkspace({ fixtureDir, workDir: work, runDir, base: 'w', artifactId: 'audit', createdAt: isoNow() });
    const runner = check.tests ? runWorkspaceCheckV3 : runWorkspaceCheckV2;
    return runner({ fixtureDir, check, runDir, manifestPath: artifact.path, limits });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true }); // not a run folder: a scratch folder
  }
}

function auditAgentCase({ root, suite, block, item, max }) {
  const overlay = agentReference({ root, suite, block, item });
  if (!overlay) return excludedCase(item, 'agent', 'no reference solution');
  const fixtureDir = path.join(suite.workspacesDir, safeSegment(String(item.input.workspace)));
  let check;
  try {
    check = loadCheck(suite.checksDir, item.expected.check);
  } catch (error) {
    return excludedCase(item, 'agent', 'no readable check', { detail: String(error.message).slice(0, 200) });
  }
  const record = { ...baseRecord(item, 'agent'), reference: { path: shownPath(root, overlay), sha256: treeHash(overlay) } };
  const total = Object.keys(check.probes).length + Object.keys(check.files).length + (check.tests ? 1 : 0);
  record.tests = total;
  const base = checkWorkspace({ fixtureDir, check, overlay });
  const again = checkWorkspace({ fixtureDir, check, overlay });
  if ((base.unjudged && !hasDefiniteFailure(base.results)) || (again.unjudged && !hasDefiniteFailure(again.results))) return { ...record, status: 'excluded', reason: 'reference verification was unjudged' };
  if (signature(base) !== signature(again)) {
    return { ...record, status: 'excluded', reason: NOT_DETERMINISTIC, detail: `two runs of the reference passed ${passed(base)} and ${passed(again)} of ${base.results.length} tests` };
  }
  const passes = passed(base);
  if (base.error || !base.results.length || passes !== base.results.length) {
    return { ...record, status: 'excluded', reason: MISMATCH, detail: base.error ? `the check could not run: ${base.error}` : `the reference passes ${passes} of ${base.results.length} tests` };
  }
  const sites = listTree(overlay)
    .filter((rel) => SOURCE_FILE.test(rel) && !TEST_FILE.test(rel))
    .flatMap((file) => mutationSites(fs.readFileSync(path.join(overlay, ...file.split('/')), 'utf8')).map((site) => ({ file, site })));
  if (!sites.length) return { ...record, status: 'excluded', reason: 'no mutation site in the reference', sites: 0 };
  const limits = { checkCpuMs: Math.max(10000, Math.ceil(Math.max(base.cpu_ms ?? 0, again.cpu_ms ?? 0) * 3) + 5000) };
  const mutants = pickSites(sites, max).map((mutation) => {
    const run = checkWorkspace({ fixtureDir, check, overlay, mutation, limits });
    const shown = { file: mutation.file, line: mutation.site.line, operator: mutation.site.operator, code: mutation.site.code };
    const total = run.results.length;
    if (run.unjudged && !hasDefiniteFailure(run.results)) return { ...shown, outcome: 'excluded', reason: 'mutant verification was unjudged', pass: null, total };
    // A file the snapshot left out (over its size limit) never reached the check, so the check did not see the bug.
    const left = (run.skipped ?? []).find((entry) => entry.path === mutation.file);
    if (left) return { ...shown, outcome: 'excluded', reason: `${mutation.file} was not in the snapshot (${left.reason}), so the check never saw the planted bug`, pass: null, total };
    const probes = run.results.filter((result) => !result.name.startsWith('file '));
    const broken = probes.length > 0 && probes.every((result) => !result.ok && /SyntaxError/.test(result.error ?? ''));
    if ((run.error && !(run.unjudged && hasDefiniteFailure(run.results))) || broken) return { ...shown, outcome: 'excluded', reason: run.error ?? probes[0].error.slice(0, 160), pass: null, total };
    const verdict = judgeResults(run.results.filter(item => !item.unjudged || item.definite_failure));
    if (verdict.outcome === 'excluded') return { ...shown, ...verdict, pass: null, total };
    return { ...shown, ...verdict, pass: passed(run), total };
  });
  return summarize({ ...record, sites: sites.length }, mutants);
}

// ---- the report -------------------------------------------------------------------------------

/** The suite loaded must be the one asked for: the frozen copy says its own version, and it hashes like the runs of that version did. */
function verifySuite(root, suite, version) {
  if (suite.version !== String(version)) {
    throw new Error(`The frozen copy of ${suite.id} ${version} says it is version ${suite.version} (${posix(path.relative(root, suite.dir))}); it is not audited`);
  }
  const recorded = new Set();
  for (const { dir } of runDirs(root)) {
    let manifest = null;
    try {
      manifest = readJson(path.join(dir, 'run.json'));
    } catch {
      continue; // not a readable run: it recorded nothing
    }
    if (manifest?.suite?.id === suite.id && String(manifest.suite.version) === suite.version && manifest.suite.sha256) recorded.add(manifest.suite.sha256);
  }
  if (recorded.size > 1 || (recorded.size === 1 && !recorded.has(suite.sha256))) {
    throw new Error(`Runs recorded ${suite.id} ${suite.version} with hash ${[...recorded].join(', ')}, but ${suite.frozen ? 'the copy' : 'the suite'} has hash ${suite.sha256}; the suite changed without a new version, or the copy is broken, so it is not audited`);
  }
}

/**
 * Audit the hidden checks of one exact suite version. Returns the report (see formatChecks for
 * the text form). Throws, before it reads or writes anything else, when the suite or version is unknown.
 */
export function auditChecks(root, { suite: suiteId, version, max = DEFAULT_MAX, cases = null, log = () => {} } = {}) {
  if (!suiteId) throw new Error('Name the suite: --suite <id>');
  if (!Number.isInteger(max) || max < 1) throw new Error(`--max must be a whole number of 1 or more, got ${max}`);
  if (!suiteDir(root, suiteId)) throw new Error(`No suite "${suiteId}" in datasets/ or datasets/archive/`);
  const head = loadSuite(root, suiteId);
  if (version == null || version === '') throw new Error(`Name the exact version to audit: --suite-version <v> (the current version of ${suiteId} is ${head.version})`);
  const suite = loadSuite(root, suiteId, { version });
  if (!suite) throw new Error(`Suite ${suiteId} has no version ${version}: the current version is ${head.version}, and its frozen copies are ${fs.existsSync(path.join(head.dir, 'versions')) ? fs.readdirSync(path.join(head.dir, 'versions')).join(', ') || 'none' : 'none'}`);
  verifySuite(root, suite, version);
  const wanted = cases ? new Set(cases) : null;
  if (wanted) {
    const unknown = [...wanted].filter((id) => !suite.cases.some((item) => item.case_id === id));
    if (unknown.length) throw new Error(`${suiteId}@${suite.version} has no case ${unknown.join(', ')}`);
  }
  const block = auditBlock(suite);
  const started = Date.now();
  const records = [];
  for (const item of suite.cases.filter((one) => !wanted || wanted.has(one.case_id))) {
    log(`  ${item.case_id}`);
    if (isCode(item)) records.push(auditCodeCase({ root, suite, block, item, max }));
    else if (isAgent(item)) records.push(auditAgentCase({ root, suite, block, item, max }));
    else records.push(excludedCase(item, 'other', 'not a task with a code or workspace check'));
  }

  const audited = records.filter((record) => record.status === 'audited');
  const mutants = records.filter((record) => record.results).flatMap((record) => record.results.map((mutant) => ({ ...mutant, case_id: record.case_id })));
  const valid = mutants.filter((mutant) => mutant.outcome !== 'excluded');
  const killed = valid.filter((mutant) => mutant.outcome === 'killed');
  const operators = [...new Set(valid.map((mutant) => mutant.operator))].sort().map((operator) => {
    const own = valid.filter((mutant) => mutant.operator === operator);
    const dead = own.filter((mutant) => mutant.outcome === 'killed').length;
    return { operator, mutants: own.length, killed: dead, survived: own.length - dead, kill_rate: share(dead, own.length) };
  });
  return {
    kind: 'checks',
    suite: { id: suite.id, version: suite.version, sha256: suite.sha256, frozen: suite.frozen },
    generated_at: isoNow(),
    max_per_task: max,
    elapsed_ms: Date.now() - started,
    totals: {
      tasks: records.length,
      audited: audited.length,
      excluded: records.length - audited.length,
      mutants: valid.length,
      killed: killed.length,
      killed_by_check: killed.filter((mutant) => mutant.killed_by === 'check').length,
      killed_by_timeout: killed.filter((mutant) => mutant.killed_by === 'timeout').length,
      survived: valid.length - killed.length,
      excluded_mutants: mutants.length - valid.length,
      kill_rate: share(killed.length, valid.length),
      mean_score_of_killed: round(meanOf(killed.map((mutant) => mutant.pass / mutant.total))),
    },
    operators,
    exclusions: [
      ...records.filter((record) => record.status === 'excluded').map((record) => ({ scope: 'task', case_id: record.case_id, reason: record.reason, ...(record.detail ? { detail: record.detail } : {}) })),
      ...mutants.filter((mutant) => mutant.outcome === 'excluded').map((mutant) => ({ scope: 'mutant', case_id: mutant.case_id, line: mutant.line, operator: mutant.operator, reason: mutant.reason })),
    ],
    survivors: valid.filter((mutant) => mutant.outcome === 'survived').map((mutant) => ({ case_id: mutant.case_id, ...(mutant.file ? { file: mutant.file } : {}), line: mutant.line, operator: mutant.operator, code: mutant.code })),
    tasks: records,
  };
}

const pct = (value) => (value == null ? '-' : value.toFixed(3));

export function formatChecks(report) {
  const { totals, suite } = report;
  const lines = [];
  lines.push(`Audit of the hidden checks: ${suite.id}@${suite.version}${suite.frozen ? ' (frozen copy)' : ''}, suite hash ${suite.sha256.slice(0, 12)}`);
  lines.push(`up to ${report.max_per_task} mutants per task; ${Math.round(report.elapsed_ms / 1000)} s`);
  lines.push('');
  lines.push(`${totals.audited} of ${totals.tasks} tasks audited, ${totals.excluded} excluded`);
  lines.push(`mutants: ${totals.mutants} valid, ${totals.killed} killed (${totals.killed_by_check} by a test that judged them, ${totals.killed_by_timeout} by the time limit), ${totals.survived} survived; kill rate ${pct(totals.kill_rate)}`);
  lines.push(`${totals.excluded_mutants} mutants excluded (they did not load or no test judged them); an excluded mutant is never a kill`);
  lines.push(`a killed mutant still keeps ${pct(totals.mean_score_of_killed)} of the score on average`);
  lines.push('');
  lines.push('operator'.padEnd(18) + 'mutants'.padStart(8) + 'killed'.padStart(8) + 'survived'.padStart(10) + 'kill rate'.padStart(11));
  for (const row of report.operators) lines.push(row.operator.padEnd(18) + String(row.mutants).padStart(8) + String(row.killed).padStart(8) + String(row.survived).padStart(10) + pct(row.kill_rate).padStart(11));
  lines.push('');
  lines.push('task'.padEnd(46) + 'tier'.padStart(5) + 'tests'.padStart(6) + 'sites'.padStart(6) + 'mutants'.padStart(8) + 'killed'.padStart(7) + 'left'.padStart(6) + 'rate'.padStart(7) + 'kept'.padStart(7));
  for (const task of report.tasks) {
    if (task.status === 'excluded') {
      lines.push(`${task.case_id.padEnd(46)}${String(task.tier ?? '-').padStart(5)}${String(task.tests ?? '-').padStart(6)}  excluded: ${task.reason}${task.detail ? ` (${task.detail})` : ''}`);
      continue;
    }
    lines.push(task.case_id.padEnd(46) + String(task.tier ?? '-').padStart(5) + String(task.tests).padStart(6) + String(task.sites).padStart(6) + String(task.mutants).padStart(8) + String(task.killed).padStart(7) + String(task.survived).padStart(6) + pct(task.kill_rate).padStart(7) + pct(task.mean_score_of_killed).padStart(7));
  }
  if (report.exclusions.some((item) => item.scope === 'mutant')) {
    lines.push('', 'excluded mutants:');
    for (const item of report.exclusions.filter((one) => one.scope === 'mutant')) lines.push(`  ${item.case_id} line ${item.line} ${item.operator}: ${String(item.reason).slice(0, 120)}`);
  }
  lines.push('', report.survivors.length ? 'survivors (a gap in the check, or a change that does not alter behaviour):' : 'no mutant survived');
  for (const item of report.survivors) lines.push(`  ${item.case_id}${item.file ? ` ${item.file}` : ''} line ${item.line} ${item.operator}  ${item.code}`);
  return lines.join('\n');
}

// ---- stability --------------------------------------------------------------------------------

/** Why a run does not count (closed, ledger-matched, scored), or null when it does. The ladder uses the same rule. */
function whyNotCounted(run) {
  if (run.trust.state === 'legacy') return 'there is no evidence ledger yet, so no run counts';
  if (run.trust.state !== 'trusted') return run.trust.reason ?? `its ledger state is ${run.trust.state}`;
  if (run.trust.scores !== 'match') return run.trust.scores_reason ?? 'its scores do not match the ledger';
  if (run.status === 'running') return 'run.json still says it is running';
  if (run.harness?.settings?.halted) return `the guard stopped it (${run.harness.settings.halted})`;
  return null;
}

/** The run folders to look at: every run that counts, or the ids named, each of which must count. */
function stabilityRuns(root, refs) {
  const { runs } = buildState(root, { validate: false });
  if (refs.length === 1 && refs[0] === 'all') {
    return runs.filter((run) => whyNotCounted(run) === null).map((run) => resolveRunDir(root, run.run_id));
  }
  const dirs = refs.map((ref) => resolveRunDir(root, ref));
  for (const dir of dirs) {
    const runId = readJson(path.join(dir, 'run.json')).run_id;
    const run = runs.find((one) => one.run_id === runId);
    // A copied folder can hold a trusted run's id; only the store's own folder for that id was checked.
    const own = run && path.resolve(resolveRunDir(root, runId)) === path.resolve(dir);
    const why = !run ? 'it is not a run of this store' : !own ? 'this folder is not where the store keeps that run' : whyNotCounted(run);
    if (why) throw new Error(`Run ${runId} does not count: ${why}. Stability reads only runs that count (closed, ledger-matched, scored).`);
  }
  return [...new Set(dirs)];
}

/** One stored score per answer and evaluator, keyed like the runner keys them. Only the score file of each declared evaluator is read. */
function storedScores(runDir, manifest) {
  const stored = new Map();
  for (const spec of manifest.evaluators || []) {
    const name = `${spec.id}@${spec.version}`;
    if (/[\\/]|\.\./.test(name)) continue;
    const file = path.join(runDir, 'scores', `${name}.jsonl`);
    if (!fs.existsSync(file)) continue;
    for (const score of readJsonl(file).rows) stored.set(`${score.case_id}|${score.model_key}|${score.repeat}|${name}`, score.value);
  }
  return stored;
}

/**
 * Score every stored answer of the runs `times` times with the evaluators the run declared, the
 * way `node lab score` does, and report each answer whose scores differ. Writes nothing.
 */
export function auditStability(root, { runs: refs, times = STABILITY_TIMES, log = () => {} } = {}) {
  if (!refs?.length) throw new Error('Name the runs: --runs <run-id,...> (or --runs all for every run that counts)');
  const dirs = stabilityRuns(root, refs);
  // An answer is one stored reply (run, case, model, repeat); it is scored once per evaluator, and each of those is a pair.
  const report = { kind: 'stability', generated_at: isoNow(), times, runs: [], answers: 0, answer_evaluator_pairs: 0, unstable: 0, unstable_pairs: 0, differs_from_stored: 0, disagreements: [] };
  for (const runDir of dirs) {
    const manifest = readJson(path.join(runDir, 'run.json'));
    const entry = { run_id: manifest.run_id, suite: `${manifest.suite.id}@${manifest.suite.version}`, answers: 0, answer_evaluator_pairs: 0, unstable: 0, unstable_pairs: 0 };
    report.runs.push(entry);
    const seen = new Set();
    const seenUnstable = new Set();
    const suite = loadSuite(root, manifest.suite.id, { version: manifest.suite.version });
    if (!suite || suite.sha256 !== manifest.suite.sha256) {
      entry.skipped = suite ? 'the suite is not the content this run used' : 'the suite version is gone and has no frozen copy';
      continue;
    }
    log(`  ${manifest.run_id}`);
    const cases = new Map(suite.cases.map((item) => [item.case_id, item]));
    const stored = storedScores(runDir, manifest);
    const { rows } = readJsonl(path.join(runDir, 'raw.jsonl'));
    for (const spec of manifest.evaluators || []) {
      const evaluator = getEvaluator(spec.id, spec.version);
      if (!evaluator) {
        entry.skipped = `no evaluator ${spec.id}@${spec.version}`;
        continue;
      }
      for (const raw of rows) {
        const testCase = cases.get(raw.case_id);
        if (raw.error || !testCase) continue;
        const values = [];
        for (let time = 0; time < times; time += 1) {
          let result;
          try {
            result = evaluator.score({ raw, testCase, suite, runDir });
          } catch (error) {
            result = { value: `error: ${String(error.message).slice(0, 80)}` };
          }
          if (!result || result.skip) break;
          values.push(result.value);
        }
        if (values.length !== times) continue;
        const answer = `${raw.case_id}|${raw.model_key}|${raw.repeat}`;
        if (!seen.has(answer)) {
          seen.add(answer);
          entry.answers += 1;
          report.answers += 1;
        }
        entry.answer_evaluator_pairs += 1;
        report.answer_evaluator_pairs += 1;
        const was = stored.get(`${answer}|${evaluator.id}@${evaluator.version}`) ?? null;
        if (was != null && values.some((value) => value !== was)) report.differs_from_stored += 1;
        if (new Set(values).size > 1) {
          if (!seenUnstable.has(answer)) {
            seenUnstable.add(answer);
            entry.unstable += 1;
            report.unstable += 1;
          }
          entry.unstable_pairs += 1;
          report.unstable_pairs += 1;
          report.disagreements.push({ run_id: manifest.run_id, case_id: raw.case_id, model_key: raw.model_key, repeat: raw.repeat, evaluator: `${evaluator.id}@${evaluator.version}`, scores: values, stored: was });
        }
      }
    }
  }
  return report;
}

export function formatStability(report) {
  const lines = [`Stability: ${report.unstable} unstable of ${report.answers} answers scored (each scored ${report.times} times, in ${report.runs.length} runs)`];
  lines.push(`By answer-evaluator pair: ${report.unstable_pairs} unstable of ${report.answer_evaluator_pairs} pairs`);
  lines.push(`scores that differ from the score stored in the run: ${report.differs_from_stored}`, '');
  for (const run of report.runs) lines.push(`  ${run.run_id}  ${run.suite}  ${run.answers} answers (${run.answer_evaluator_pairs} pairs) scored, ${run.unstable} unstable${run.skipped ? `  (${run.skipped})` : ''}`);
  if (report.disagreements.length) {
    lines.push('', 'unstable answers:');
    for (const item of report.disagreements) lines.push(`  ${item.run_id} ${item.case_id} ${item.model_key} r${item.repeat} ${item.evaluator}: ${item.scores.join(', ')} (stored ${item.stored ?? '-'})`);
  } else lines.push('', 'No answer scored differently on a second look.');
  return lines.join('\n');
}

// ---- command ----------------------------------------------------------------------------------

/** Suite metadata is not validated, and it builds the name of the report: refuse anything that could name another path. */
function checkReportName(id, version) {
  for (const [what, value] of [['suite id', id], ['version', version]]) {
    if (value != null && /[\\/:*?"<>|]|\.\./.test(String(value))) throw new Error(`${what} "${value}" has a path separator or "..", so no report can be stored for it`);
  }
}

/** reports/audit/<suite>@<version>.json, written to a temp file and renamed. Never through a link. */
function writeReport(root, report) {
  checkReportName(report.suite.id, report.suite.version);
  const reports = paths(root).reports;
  const dir = path.join(reports, 'audit');
  const refuseLink = (target) => {
    let stat = null;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (stat?.isSymbolicLink()) throw new Error(`${posix(path.relative(root, target))} is a link; the report is not written through a link`);
  };
  refuseLink(reports);
  refuseLink(dir);
  fs.mkdirSync(dir, { recursive: true }); // not a run folder: reports/audit/
  const file = path.join(dir, `${report.suite.id}@${report.suite.version}.json`);
  refuseLink(file);
  const temp = path.join(dir, `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); // not a run folder: reports/audit/
    fs.renameSync(temp, file); // not a run folder: reports/audit/
  } finally {
    fs.rmSync(temp, { force: true }); // not a run folder: reports/audit/
  }
  return file;
}

export async function auditCommand(root, positionals = [], values = {}) {
  const [what] = positionals;
  const log = (line) => process.stderr.write(`${line}\n`);
  if (what === 'checks') {
    const versions = [values['suite-version']].flat().filter(Boolean);
    if (versions.length > 1) throw new Error(`Name one version to audit, got ${versions.join(', ')}`);
    if (values.write) {
      if (values.cases) throw new Error('--write stores the audit of the whole suite; it cannot be used with --cases');
      checkReportName(values.suite, versions[0]);
    }
    const report = auditChecks(root, {
      suite: values.suite,
      version: versions[0],
      max: values.max == null ? DEFAULT_MAX : Number(values.max),
      cases: values.cases ? String(values.cases).split(',').map((item) => item.trim()).filter(Boolean) : null,
      log: values.json ? () => {} : log,
    });
    let written = null;
    if (values.write) written = writeReport(root, report);
    console.log(values.json ? JSON.stringify(report, null, 2) : formatChecks(report));
    if (written && !values.json) console.log(`\nWritten: ${posix(path.relative(root, written))}`);
    return 0;
  }
  if (what === 'stability') {
    const refs = values.runs ? String(values.runs).split(',').map((item) => item.trim()).filter(Boolean) : [];
    const report = auditStability(root, { runs: refs, log: values.json ? () => {} : log });
    console.log(values.json ? JSON.stringify(report, null, 2) : formatStability(report));
    return 0;
  }
  throw new Error(`Unknown audit "${what ?? ''}".\n${USAGE}`);
}
