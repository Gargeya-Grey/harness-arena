#!/usr/bin/env node
// Model Lab command line. Run from the repository root: `node lab <command>`.

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeSuite, labRoot } from './lib/repo.mjs';
import { runCommand } from './commands/run.mjs';
import { scoreCommand } from './commands/score.mjs';
import { validateCommand } from './commands/validate.mjs';
import { newCase } from './commands/new-case.mjs';
import { doctorCommand, reportCommand, runsCommand } from './commands/info.mjs';
import { adoptCommand } from './commands/adopt.mjs';
import { ladderCommand } from './commands/ladder.mjs';

const HELP = `Model Lab: run the same suite through any CLI harness, then compare.

Usage: node lab <command> [options]

Commands
  run <experiment.yaml>   Run every target x case x repeat, write results/<run_id>/, score it
      --harness <name>      Only the targets that use this harness
      --models <a,b>        Only the targets for these model keys
      --effort <level>      Use this verified thinking effort for the selected setups
      --targets <json>      Select explicit setup objects with model, harness and effort
      --repeats <n>         Override the experiment's repeats
      --cases <a,b>         Run only these case ids (recorded in the run)
      --dry-run             Show what would run; call nothing, write nothing
  run --resume <run-id>   Continue a run that stopped before its last row (crashed or stopped);
                          only the missing rows run. --force for a run with no heartbeat
  new-case <suite> <slug> Add a case to a suite with every value to fill marked; --agent adds
                          a starter workspace and a hidden check; --prompt <id> names the fields
  freeze <suite>          Copy the suite's current version to datasets/<suite>/versions/<version>/,
                          so its runs still score and show after you change it; then bump the version
  score <run-id>... | --all   Recompute scores from raw.jsonl (no API calls); --force also scores a stopped run.
                          A run that does not match the evidence ledger is never scored
  adopt <run-id>... | --all   Vouch for runs as they are now in the evidence ledger (lab.ledger.jsonl):
                          runs copied in, committed later, or checked by hand. --all adopts
                          every run the ledger does not trust yet
  delete <run-id> --confirm <run-id>   Deliberately delete that run from every active store
  reset --confirm "DELETE ALL RUNS"   Delete all live run history, ratings, saved views and reports
  validate                Check inputs and every stored record against schemas/
  doctor                  Show which harnesses are installed here (built-in and configs/harnesses.yaml)
  runs                    List runs, newest first
  report [--write]        Markdown comparison per context (to stdout, or reports/comparison.md)
  ladder                  The difficulty ladder per configuration: solved / tasks and mean score per tier
      --calibrate           Per task: information class (no-data, one-config, all-solved, all-unsolved,
                            disagree). Per pair: shared tasks and an exact sign test.
                            Also a flag for negative discrimination: of two configurations that ran
                            the task, the one with the higher mean on the other tasks both ran scored
                            under 0.5 on every repeat, and the other scored 1 on every repeat
      --suite <id>          Only ladder-answer, ladder-code or ladder-agent
      --suite-version <suite>@<version>
                            Use this version of a suite (repeat, or comma-separate, for several).
                            Default: per suite, the newest version that has counted runs. A suite
                            version whose counted runs mix prompt versions is refused (use --runs)
      --runs <id,...>       Only these runs (a run id, or part of one)
      --json                The same data as JSON
  audit checks            Test the hidden checks with mutants of the references
      --suite <id>          The suite to audit
      --suite-version <v>   The exact version to audit
      --max <n>             Mutants per task
      --write               Also store the result under reports/audit/
      --json                The same data as JSON
  audit stability --runs <id,...>
                          Score stored answers again and list every disagreement; writes nothing to a run
  trace [--suite <id>] [--suite-version <v>] [--json]
                          What the stored attempts did: tools, tests, tokens per solved task
  signal <experiment.yaml> [--json]
                          Before you spend calls: can this run give a trustable signal?
  instrument --suite <id> [--power] [--json]
                          Where each configuration breaks on one generated task family
  dashboard [--port n]    Start the local dashboard (default http://127.0.0.1:4317)

Environment
  LAB_ROOT                Data root (default: this repository). Tests use tests/fixtures/repo.
`;

async function loadCommand(name) {
  const file = new URL(`./commands/${name}.mjs`, import.meta.url);
  if (!fs.existsSync(fileURLToPath(file))) throw new Error(`"${name}" is not built in this checkout`);
  const module = await import(file.href);
  return module[`${name}Command`];
}

async function main(argv) {
  const [command, ...rest] = argv;
  const root = labRoot();
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      harness: { type: 'string' },
      models: { type: 'string' },
      effort: { type: 'string' },
      targets: { type: 'string' },
      confirm: { type: 'string' },
      repeats: { type: 'string' },
      cases: { type: 'string' },
      'dry-run': { type: 'boolean' },
      resume: { type: 'string' },
      agent: { type: 'boolean' },
      prompt: { type: 'string' },
      all: { type: 'boolean' },
      force: { type: 'boolean' },
      write: { type: 'boolean' },
      port: { type: 'string' },
      calibrate: { type: 'boolean' },
      json: { type: 'boolean' },
      suite: { type: 'string' },
      runs: { type: 'string' },
      'suite-version': { type: 'string', multiple: true },
      max: { type: 'string' },
      power: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (!command || command === 'help' || command === '--help' || command === '-h' || values.help) {
    console.log(HELP);
    return 0;
  }
  switch (command) {
    case 'run': {
      if (!positionals[0] && !values.resume) throw new Error('Name an experiment file: node lab run experiments/<name>.yaml, or resume a run: node lab run --resume <run-id>');
      if (positionals[0] && values.resume) throw new Error('Give an experiment file or --resume <run-id>, not both');
      if (values.resume && (values.harness || values.models || values.repeats || values.cases || values.effort || values.targets !== undefined)) throw new Error('--resume continues the run as it was planned; run selection overrides do not apply');
      const results = await runCommand(root, positionals[0] ? path.resolve(positionals[0]) : null, {
        resume: values.resume,
        force: values.force,
        harness: values.harness,
        effort: values.effort,
        targets: values.targets === undefined ? undefined : JSON.parse(values.targets),
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
    case 'new-case':
      newCase(root, positionals[0], positionals[1], { agent: values.agent, prompt: values.prompt });
      return 0;
    case 'freeze': {
      if (positionals.length !== 1) throw new Error('Usage: node lab freeze <suite>');
      const frozen = freezeSuite(root, positionals[0]);
      console.log(`${path.relative(root, frozen.dir).replace(/\\/g, '/')}/: ${frozen.created ? 'frozen' : 'already frozen, same content'}. Now bump the version in suite.yaml before you change the suite.`);
      return 0;
    }
    case 'adopt':
      adoptCommand(root, positionals, { all: values.all });
      return 0;
    case 'delete':
    case 'reset': {
      const { deleteRun, resetHistory } = await import('./lib/storage.mjs');
      if (command === 'delete' && positionals.length !== 1) throw new Error('Usage: node lab delete <run-id> --confirm <run-id>');
      if (command === 'reset' && positionals.length) throw new Error('Usage: node lab reset --confirm "DELETE ALL RUNS"');
      const result = command === 'delete' ? deleteRun(root, positionals[0], { confirm: values.confirm }) : resetHistory(root, { confirm: values.confirm });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
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
    case 'ladder':
      ladderCommand(root, { calibrate: values.calibrate, json: values.json, suite: values.suite, suiteVersions: values['suite-version']?.flatMap((item) => item.split(',')).map((item) => item.trim()).filter(Boolean), runs: values.runs ? values.runs.split(',').map((item) => item.trim()).filter(Boolean) : null });
      return 0;
    case 'audit':
    case 'trace':
    case 'signal':
    case 'instrument':
      return (await loadCommand(command))(root, positionals, values);
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
    if (/\bcancel\b/.test(text)) process.emit('SIGINT', 'cancel');
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
