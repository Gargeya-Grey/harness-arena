#!/usr/bin/env node
// Model Lab command line. Run from the repository root: `node lab <command>`.

import { parseArgs } from 'node:util';
import path from 'node:path';
import { labRoot } from './lib/repo.mjs';
import { runCommand } from './commands/run.mjs';
import { scoreCommand } from './commands/score.mjs';
import { validateCommand } from './commands/validate.mjs';
import { doctorCommand, reportCommand, runsCommand } from './commands/info.mjs';

const HELP = `Model Lab: run the same suite through any CLI harness, then compare.

Usage: node lab <command> [options]

Commands
  run <experiment.yaml>   Run every target x case x repeat, write results/<run_id>/, score it
      --harness <name>      Only the targets that use this harness
      --models <a,b>        Only the targets for these model keys
      --repeats <n>         Override the experiment's repeats
      --cases <a,b>         Run only these case ids (recorded in the run)
      --dry-run             Show what would run; call nothing, write nothing
  score <run-id>... | --all   Recompute scores from raw.jsonl (no API calls); --force also scores a stopped run
  validate                Check inputs and every stored record against schemas/
  doctor                  Show which harnesses are installed here (built-in and configs/harnesses.yaml)
  runs                    List runs, newest first
  report [--write]        Markdown comparison per context (to stdout, or reports/comparison.md)
  dashboard [--port n]    Start the local dashboard (default http://127.0.0.1:4317)

Environment
  LAB_ROOT                Data root (default: this repository). Tests use tests/fixtures/repo.
`;

async function main(argv) {
  const [command, ...rest] = argv;
  const root = labRoot();
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      harness: { type: 'string' },
      models: { type: 'string' },
      repeats: { type: 'string' },
      cases: { type: 'string' },
      'dry-run': { type: 'boolean' },
      all: { type: 'boolean' },
      force: { type: 'boolean' },
      write: { type: 'boolean' },
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (!command || command === 'help' || command === '--help' || command === '-h' || values.help) {
    console.log(HELP);
    return 0;
  }
  switch (command) {
    case 'run': {
      if (!positionals[0]) throw new Error('Name an experiment file: node lab run experiments/<name>.yaml');
      const results = await runCommand(root, path.resolve(positionals[0]), {
        harness: values.harness,
        models: values.models ? values.models.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
        repeats: values.repeats != null ? Number(values.repeats) : undefined,
        cases: values.cases ? values.cases.split(',').map((item) => item.trim()).filter(Boolean) : undefined,
        dryRun: values['dry-run'],
      });
      if (results.length) {
        console.log('\nNext: node lab report   or   node lab dashboard');
      }
      return results.some((item) => item.status !== 'completed') ? 1 : 0;
    }
    case 'score':
      scoreCommand(root, positionals, { all: values.all, force: values.force });
      return 0;
    case 'validate':
      return validateCommand(root);
    case 'doctor':
      await doctorCommand({ root });
      return 0;
    case 'runs':
      runsCommand(root);
      return 0;
    case 'report':
      reportCommand(root, { write: values.write });
      return 0;
    case 'dashboard': {
      const { startServer } = await import('../dashboard/server.mjs');
      startServer({ root, port: Number(values.port || process.env.PORT || 4317) });
      return null;
    }
    default:
      throw new Error(`Unknown command "${command}". Run: node lab help`);
  }
}

// Under the dashboard (LAB_JOB=1) a "cancel" line on stdin acts as Ctrl+C: a run stops
// after its current call and keeps what it wrote. Windows has no SIGINT for a child process.
if (process.env.LAB_JOB === '1') {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (text) => {
    if (/\bcancel\b/.test(text)) process.emit('SIGINT', 'SIGINT');
  });
  process.stdin.on('error', () => {});
  process.stdin.unref();
}

main(process.argv.slice(2))
  .then((code) => {
    if (code != null) process.exitCode = code;
  })
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
