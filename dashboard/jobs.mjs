// Jobs: the dashboard starts `node lab <command>` for the owner, one job at a time.
// Only the commands below run. Every argument is checked, then passed as an array
// (no shell). Experiment files must sit in <root>/experiments, run ids in <root>/results.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { paths, findRunDir, loadYamlFile, loadCases, loadRegistry, resolveExperiment } from '../lab/lib/repo.mjs';
import { loadAdapters } from '../lab/adapters/index.mjs';
import { isoNow } from '../lab/lib/fsutil.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lab', 'cli.mjs');
const MAX_LINES = 5000;
const MAX_JOBS = 30;
const ID = /^[A-Za-z0-9][\w.:@/+-]*$/;
const FILE = /^[A-Za-z0-9][\w.-]*\.ya?ml$/;
const RUN_ID = /^[A-Za-z0-9][\w.-]*$/;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

export const COMMANDS = ['run', 'score', 'validate', 'doctor', 'runs', 'report'];

const bad = (message) => Object.assign(new Error(message), { status: 400 });

function idList(value, label) {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const items = list.map((item) => String(item).trim()).filter(Boolean);
  for (const item of items) if (!ID.test(item) || item.length > 200) throw bad(`Not a valid ${label}: "${item.slice(0, 60)}"`);
  return items;
}

// Turns a request body into CLI arguments. Throws a 400 error for anything else.
export function buildArgs(root, body) {
  const p = paths(root);
  const command = body.command;
  if (!COMMANDS.includes(command)) throw bad(`Unknown command. Allowed: ${COMMANDS.join(', ')}`);
  if (command === 'run' && body.resume != null) {
    // Continue a stopped run: only its missing rows run (node lab run --resume).
    const id = String(body.resume);
    if (body.experiment) throw bad('Give an experiment or a run to resume, not both');
    if (!RUN_ID.test(id) || !findRunDir(root, id)) throw bad(`No run with id "${id.slice(0, 80)}"`);
    return ['run', '--resume', id];
  }
  if (command === 'run') {
    const file = String(body.experiment || '');
    if (!FILE.test(file)) throw bad('Name an experiment file in experiments/, for example smoke-opencode.yaml');
    const abs = path.join(p.experiments, file);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw bad(`No experiment named ${file}`);
    const args = ['run', abs];
    if (body.harness) {
      const [harness] = idList([body.harness], 'harness name');
      args.push('--harness', harness);
    }
    const models = idList(body.models, 'model key');
    if (models.length) args.push('--models', models.join(','));
    const cases = idList(body.cases, 'case id');
    if (cases.length) args.push('--cases', cases.join(','));
    if (body.repeats != null && body.repeats !== '') {
      const n = Number(body.repeats);
      if (!Number.isInteger(n) || n < 1 || n > 50) throw bad('Repeats must be a whole number from 1 to 50');
      args.push('--repeats', String(n));
    }
    if (body.dry_run) args.push('--dry-run');
    return args;
  }
  if (command === 'score') {
    const args = ['score'];
    if (body.all) args.push('--all');
    else {
      const ids = Array.isArray(body.run_ids) ? body.run_ids.map(String) : [];
      if (!ids.length) throw bad('Name one or more run ids, or set all');
      for (const id of ids) {
        if (!RUN_ID.test(id) || !findRunDir(root, id)) throw bad(`No run with id "${id.slice(0, 80)}"`);
      }
      args.push(...ids);
    }
    if (body.force) args.push('--force');
    return args;
  }
  return [command];
}

// What the Run page offers: experiments with their targets and case ids, harnesses, model keys.
export function catalog(root) {
  const p = paths(root);
  const experiments = [];
  let registry = {};
  try {
    registry = loadRegistry(root);
  } catch {
    // Reported below.
  }
  const files = fs.existsSync(p.experiments) ? fs.readdirSync(p.experiments).filter((name) => FILE.test(name)).sort() : [];
  for (const file of files) {
    const entry = { file, id: file.replace(/\.ya?ml$/, ''), problems: [] };
    try {
      const doc = loadYamlFile(path.join(p.experiments, file)) || {};
      const resolved = resolveExperiment(doc, registry);
      entry.problems.push(...resolved.problems);
      Object.assign(entry, {
        id: doc.id || entry.id,
        description: doc.description || '',
        suite: doc.suite || null,
        prompt: doc.prompt && typeof doc.prompt === 'object' ? doc.prompt.id ?? null : doc.prompt ?? null,
        repeats: doc.repeats ?? 1,
        access: doc.access || 'answer',
        user_config: doc.user_config || 'loaded',
        targets: resolved.targets.map((t) => ({ model: t.model, harness: t.harness, effort: t.effort ?? null })),
        cases: Array.isArray(doc.cases) ? doc.cases : null,
      });
      try {
        entry.case_ids = doc.suite ? loadCases(root, doc.suite).map((c) => c.case_id) : [];
      } catch (error) {
        entry.case_ids = [];
        entry.problems.push(error.message);
      }
    } catch (error) {
      entry.problems.push(error.message);
    }
    experiments.push(entry);
  }
  let harnesses = [];
  let models = [];
  const problems = [];
  try {
    harnesses = Object.values(loadAdapters(root)).map((a) => ({ name: a.name, declared: Boolean(a.declared) }));
  } catch (error) {
    problems.push(error.message);
  }
  try {
    models = Object.keys(loadRegistry(root));
  } catch (error) {
    problems.push(error.message);
  }
  return { experiments, harnesses, models, problems };
}

function killTree(child) {
  if (child.exitCode != null || child.signalCode != null) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

export function createJobs(root, { cliPath = CLI, env = process.env } = {}) {
  const jobs = new Map();
  let current = null;

  const summary = (job) => ({
    id: job.id,
    command: job.command,
    label: job.label,
    args: job.display,
    dry_run: job.dry_run,
    status: job.status,
    exit_code: job.exit_code,
    started_at: job.started_at,
    ended_at: job.ended_at,
    lines: job.base + job.lines.length,
  });

  function push(job, text) {
    for (const raw of text.split(/\r?\n/)) {
      job.lines.push(raw.replace(ANSI, ''));
      if (job.lines.length > MAX_LINES) {
        job.lines.shift();
        job.base += 1;
      }
    }
  }

  function start(body) {
    if (current) throw Object.assign(new Error('A job is running. Wait for it or stop it first.'), { status: 409, job: summary(current) });
    const args = buildArgs(root, body);
    const id = `${isoNow().replace(/[-:.]/g, '').slice(0, 15)}-${crypto.randomBytes(3).toString('hex')}`;
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: root,
      env: { ...env, LAB_ROOT: root, LAB_JOB: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    const display = ['node', 'lab', ...args.map((arg) => (path.isAbsolute(arg) ? path.relative(root, arg).split(path.sep).join('/') : arg))];
    const job = {
      id,
      command: args[0],
      label: display.slice(2).join(' '),
      display,
      dry_run: args.includes('--dry-run'),
      status: 'running',
      exit_code: null,
      started_at: isoNow(),
      ended_at: null,
      lines: [],
      base: 0,
      partial: { out: '', err: '' },
      child,
      stops: 0,
    };
    job.ended = new Promise((resolve) => {
      job.resolveEnd = resolve;
    });
    const onData = (key) => (chunk) => {
      const text = job.partial[key] + chunk;
      const cut = text.lastIndexOf('\n');
      if (cut === -1) {
        job.partial[key] = text;
        return;
      }
      job.partial[key] = text.slice(cut + 1);
      push(job, text.slice(0, cut));
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData('out'));
    child.stderr.on('data', onData('err'));
    child.stdin.on('error', () => {});
    const done = (code, error) => {
      if (job.ended_at) return;
      for (const key of ['out', 'err']) if (job.partial[key]) push(job, job.partial[key]);
      if (error) push(job, `Error: ${error.message}`);
      job.exit_code = code;
      job.status = job.stops ? 'stopped' : code === 0 ? 'passed' : 'failed';
      job.ended_at = isoNow();
      delete job.child;
      if (current === job) current = null;
      job.resolveEnd();
    };
    child.on('error', (error) => done(null, error));
    child.on('close', (code) => done(code));
    jobs.set(id, job);
    current = job;
    while (jobs.size > MAX_JOBS) {
      const oldest = [...jobs.values()].find((item) => item !== current);
      if (!oldest) break;
      jobs.delete(oldest.id);
    }
    return summary(job);
  }

  // First stop asks a run to finish its current call and keep the run (marked failed).
  // A second stop, or a stop of any other command, ends the process tree now.
  function stop(id) {
    const job = jobs.get(id);
    if (!job) throw Object.assign(new Error('No such job'), { status: 404 });
    if (!job.child) return summary(job);
    job.stops += 1;
    if (job.command === 'run' && !job.dry_run && job.stops === 1) {
      job.status = 'stopping';
      job.child.stdin.write('cancel\n');
    } else {
      push(job, 'Stopped now by the dashboard.');
      killTree(job.child);
    }
    return summary(job);
  }

  function get(id, since = 0) {
    const job = jobs.get(id);
    if (!job) throw Object.assign(new Error('No such job'), { status: 404 });
    const from = Math.max(0, Number(since) - job.base) || 0;
    return { job: summary(job), first: job.base + from, lines: job.lines.slice(from) };
  }

  function list() {
    return { running: current ? current.id : null, jobs: [...jobs.values()].reverse().map(summary) };
  }

  // Asks the running job to stop (a run finishes its current call) and resolves when it
  // has ended. With now = true it ends the process tree at once.
  function shutdown({ now = false } = {}) {
    const live = [...jobs.values()].filter((job) => job.child);
    for (const job of live) {
      if (now) {
        job.stops += 1;
        killTree(job.child);
      } else if (!job.stops) stop(job.id);
    }
    return Promise.all(live.map((job) => job.ended));
  }

  return { start, stop, get, list, shutdown, running: () => (current ? summary(current) : null) };
}
