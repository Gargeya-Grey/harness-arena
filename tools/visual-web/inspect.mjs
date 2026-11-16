import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { labRoot, loadSuite, isInside, paths } from '../../lab/lib/repo.mjs';
import { readJson, readJsonl } from '../../lab/lib/fsutil.mjs';
import { resolveRunDir } from '../../lab/commands/score.mjs';
import { ledgerPath, loadLedger, trustRun } from '../../lab/lib/ledger.mjs';
import { rebuildWorkspace, treeHash, listTree } from '../../lab/lib/workspace.mjs';
import { SchemaSet } from '../../lab/lib/schema.mjs';
import { launchBrowser, serve } from './browser.mjs';
import { inspectPage, waitForScene } from './checks.mjs';
import { inspectApartment, waitForApartment } from '../foldaway-apartment/checks.mjs';

const SUITES = {
  'visual-web': { inspect: inspectPage, ready: waitForScene, checker: new URL('./checks.mjs', import.meta.url) },
  'foldaway-apartment': { inspect: inspectApartment, ready: waitForApartment, checker: new URL('../foldaway-apartment/checks.mjs', import.meta.url) },
};

export function reportDestination(root, out) {
  const suffix = [];
  let parent = path.resolve(out);
  while (!fs.existsSync(parent)) { suffix.unshift(path.basename(parent)); parent = path.dirname(parent); }
  const output = path.join(fs.realpathSync(parent), ...suffix);
  if (paths(root).resultsDirs.some((dir) => isInside(output, fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir)))) throw new Error('Derived browser reports must stay outside every immutable run store');
  return output;
}

export const observationKey = (row) => `${row.run_id}__${row.model_key}__${row.case_id}__r${row.repeat}`;

export function browserObservationProblems(report) {
  const schemas = new SchemaSet(fileURLToPath(new URL('../../schemas/', import.meta.url)));
  const problems = schemas.validate('browser-observation.schema.json', report);
  if (!Array.isArray(report?.observations)) return problems;
  for (const [index, observation] of report.observations.entries()) for (const check of Array.isArray(observation?.checks) ? observation.checks : []) {
    if (!check || typeof check !== 'object') continue;
    const at = `observations[${index}].${check.name}`;
    if (check.passed === null) {
      if (!['blocked', 'incomplete'].includes(check.status)) problems.push(`${at}: null passed needs blocked or incomplete status`);
      if (check.status === 'incomplete' && (typeof check.reason !== 'string' || !check.reason.trim())) problems.push(`${at}: incomplete needs a reason`);
      if (check.status === 'blocked') {
        const prerequisites = Array.isArray(check.blocked_by) ? check.blocked_by : [];
        if (!prerequisites.length) problems.push(`${at}: blocked needs prerequisites`);
        for (const name of prerequisites) {
          const required = observation.checks.find(value => value?.name === name);
          if (!required || required.passed === true) problems.push(`${at}: prerequisite ${name} is absent or passed`);
        }
      }
    } else if (['blocked', 'incomplete'].includes(check.status) || check.blocked_by || check.reason) problems.push(`${at}: an unjudged check cannot carry a boolean passed value`);
    if (check.passed === true && check.error) problems.push(`${at}: a passed check cannot carry an error`);
  }
  return problems;
}

export async function inspectRuns({ root = labRoot(), runs, out }) {
  const output = reportDestination(root, out);
  if (fs.existsSync(path.join(output, 'report.json'))) throw new Error('report.json already exists; choose a fresh output directory');
  const ledger = loadLedger(ledgerPath(root));
  const sources = runs.map((ref) => {
    const dir = resolveRunDir(root, ref);
    if (isInside(output, dir)) throw new Error('Derived browser reports must stay outside immutable run folders');
    const manifest = readJson(path.join(dir, 'run.json'));
    const trust = trustRun(ledger, manifest.run_id, dir);
    if (trust.state !== 'trusted' || !['completed', 'failed'].includes(manifest.status)) throw new Error(`${manifest.run_id}: closed ledger-matched evidence required (${trust.state})`);
    const driver = SUITES[manifest.suite.id];
    if (!driver) throw new Error(`${manifest.run_id}: no browser inspector for suite ${manifest.suite.id}`);
    const suite = loadSuite(root, manifest.suite.id, { version: manifest.suite.version });
    if (!suite || suite.sha256 !== manifest.suite.sha256) throw new Error(`${manifest.run_id}: exact suite version/hash unavailable`);
    const raw = readJsonl(path.join(dir, 'raw.jsonl'));
    if (raw.problems.length) throw new Error(`${manifest.run_id}: invalid raw JSONL`);
    return { dir, manifest, suite, rows: raw.rows, trust, driver };
  });
  fs.mkdirSync(output, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-visual-rebuild-'));
  const report = {
    kind: 'visual-web-browser-observation', version: '2', created_at: new Date().toISOString(),
    limits: ['One pilot repeat does not establish reliability or model ranking.', 'Browser assertions measure stated behavior and render readiness. Design quality requires screenshot review.', 'Headless software WebGL does not establish physical GPU performance.', 'Checks blocked by a failed setup action or an unfinished observed transition are unjudged, not independent functional failures. Sampled animation checks do not prove continuous collision freedom.'],
    checker_sha256: crypto.createHash('sha256').update(fs.readFileSync(new URL('./checks.mjs', import.meta.url))).digest('hex'),
    suite_checkers: Object.fromEntries([...new Set(sources.map(({ manifest }) => manifest.suite.id))].map((id) => [id, { sha256: crypto.createHash('sha256').update(fs.readFileSync(SUITES[id].checker)).digest('hex') }])),
    runs: sources.map(({ manifest, dir, trust }) => ({ run_id: manifest.run_id, path: dir, suite: manifest.suite, harness: manifest.harness, trust: trust.state })),
    observations: [], cleanup: {},
  };
  let browser;
  try {
    browser = await launchBrowser();
    report.browser = browser.version;
    for (const source of sources) for (const row of source.rows) {
      const observation = { run_id: row.run_id, case_id: row.case_id, model_key: row.model_key, repeat: row.repeat, latency_ms: row.latency_ms, error: row.error || null, checks: [], screenshots: [] };
      report.observations.push(observation);
      if (row.error) { console.log(`${row.model_key} ${row.case_id}: call error ${row.error.type}`); continue; }
      const testCase = source.suite.cases.find((c) => c.case_id === row.case_id);
      const artifact = row.artifacts?.find((a) => a.path.endsWith('/workspace.json'));
      if (!testCase || !artifact) { observation.error = { type: 'missing_workspace', message: 'No case or workspace evidence' }; continue; }
      const fixtureDir = path.join(source.suite.workspacesDir, testCase.input.workspace);
      const stored = readJson(path.join(source.dir, artifact.path));
      if (stored.fixture_sha256 !== treeHash(fixtureDir)) throw new Error(`${row.case_id}: starter workspace changed`);
      const key = observationKey(row);
      const dest = path.join(scratch, key);
      fs.mkdirSync(dest);
      rebuildWorkspace({ fixtureDir, runDir: source.dir, manifestPath: artifact.path, dest });
      if (!fs.existsSync(path.join(dest, 'index.html'))) { observation.error = { type: 'delivery_missing', message: 'No index.html was saved by this attempt' }; continue; }
      observation.workspace_sha256 = treeHash(dest);
      observation.manifest_sha256 = artifact.sha256;
      const server = await serve(dest);
      let page;
      try {
        page = await browser.page();
        await page.send('Storage.clearDataForOrigin', { origin: server.url, storageTypes: 'all' });
        await page.viewport(1440, 900);
        await page.navigate(`${server.url}/index.html`);
        if (source.suite.meta.id === 'foldaway-apartment' || row.case_id.includes('three-')) {
          try { await source.driver.ready(page); } catch (error) { observation.scene_load_error = error.message; }
        }
        for (const [label, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
          await page.viewport(width, height);
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const name = `${key}__${label}.png`;
          await page.screenshot(path.join(output, name), true);
          observation.screenshots.push({ viewport: { width, height }, path: name });
        }
        observation.checks = await source.driver.inspect(page, testCase, { onState: async (state) => {
          const name = `${key}__${state}.png`;
          await page.screenshot(path.join(output, name));
          observation.screenshots.push({ state, path: name });
        } });
        observation.console_errors = [...page.errors];
        const changed = `${key}__interaction.png`;
        await page.screenshot(path.join(output, changed));
        observation.screenshots.push({ state: 'after browser interactions', path: changed });
      } catch (error) { observation.error = { type: 'browser_check', message: error.message }; }
      finally { try { await page?.close(); } finally { await server.close(); } }
      const blocked = observation.checks.filter((check) => check.status === 'blocked').length;
      const incomplete = observation.checks.filter((check) => check.status === 'incomplete').length;
      console.log(`${row.model_key} ${row.case_id}: ${observation.checks.filter((c) => c.passed).length}/${observation.checks.length - blocked - incomplete} judged browser checks${blocked ? `; ${blocked} blocked` : ''}${incomplete ? `; ${incomplete} incomplete` : ''}${observation.error ? `; ${observation.error.message}` : ''}`);
    }
  } finally {
    let browserClosed = !browser;
    let cleanupError;
    let browserCleanup;
    try { browserCleanup = await browser?.close(); browserClosed = browserCleanup?.browser_closed ?? true; } catch (error) { cleanupError = error.message; }
    const bytes = listTree(scratch).reduce((n, rel) => n + fs.statSync(path.join(scratch, rel)).size, 0);
    fs.rmSync(scratch, { recursive: true, force: true });
    report.cleanup = { browser_closed: browserClosed, ...browserCleanup, servers_closed: true, rebuild_removed: scratch, rebuild_bytes_freed: bytes, ...(cleanupError ? { error: cleanupError } : {}) };
    const problems = browserObservationProblems(report);
    if (problems.length) report.validation_problems = problems;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    if (cleanupError) console.error(`Retained browser cleanup evidence: ${cleanupError}`);
  }
  if (report.validation_problems?.length) throw new Error(`Invalid browser observation: ${report.validation_problems.join('; ')}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  if (!args.includes('--runs') || !args.includes('--out')) {
    console.error('Usage: node tools/visual-web/inspect.mjs --runs <run-id,run-id> --out <new-evidence-directory>');
    process.exitCode = 1;
  } else {
    try { await inspectRuns({ runs: value('--runs').split(','), out: value('--out') }); }
    catch (error) { console.error(error.stack); process.exitCode = 1; }
  }
}
