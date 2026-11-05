// Read-only commands: doctor (which harnesses are usable here), runs (the run
// ledger) and report (a Markdown comparison per context, from stored evidence).

import fs from 'node:fs';
import path from 'node:path';
import { loadAdapters, readDeclared } from '../adapters/index.mjs';
import { resolveCommand } from '../adapters/process.mjs';
import { missingSignIn } from '../lib/temphome.mjs';
import { buildState } from '../lib/state.mjs';
import { paths } from '../lib/repo.mjs';

const pad = (value, width) => String(value).padEnd(width);

export async function doctorCommand({ root, log = console.log } = {}) {
  log(`Node ${process.version} on ${process.platform}\n`);
  log(`${pad('harness', 16)}${pad('source', 10)}${pad('status', 12)}${pad('isolation', 11)}detail`);
  const rows = await Promise.all(
    Object.values(loadAdapters(root)).map(async (adapter) => {
      const detected = await adapter.detect();
      const where = resolveCommand(adapter.bin);
      const detail = detected.version ? `v${detected.version} · ${where ? where.prefix[0] || where.command : ''}` : `install "${adapter.bin}" and sign in`;
      return [adapter, detected.version ? 'ready' : 'not found', adapter.isolation?.args.length ? 'partial' : 'none', detail];
    }),
  );
  for (const [adapter, status, isolation, detail] of rows) {
    log(`${pad(adapter.name, 16)}${pad(adapter.declared ? 'declared' : 'built-in', 10)}${pad(status, 12)}${pad(isolation, 11)}${detail}`);
  }
  // How "user_config: isolated" works for each harness. Names only: no path, no file content.
  log('\nisolation by harness:');
  for (const [adapter] of rows) {
    const { flags = [], home } = adapter.isolation || {};
    if (!flags.length && !home) {
      log(`  ${pad(adapter.name, 14)}not available: ${adapter.isolation?.note || 'no isolation'}`);
      continue;
    }
    const parts = [];
    if (flags.length) parts.push(`flags ${flags.join(' ')}`);
    if (home) {
      const missing = missingSignIn(home.files, undefined, home.store);
      const env = adapter.isolation.args.filter((arg) => !flags.includes(arg));
      parts.push(missing.length ? `temp home NOT available, sign-in file missing: ${missing.join(', ')}` : `temp home available, copies ${[...home.files, ...(home.store ? [home.store.label] : [])].join(', ')} only, env ${env.join(' ')}${home.writeBack ? ', refreshed token written back' : ''}`);
    }
    log(`  ${pad(adapter.name, 14)}${parts.join('; ')}`);
  }
  try {
    for (const problem of readDeclared(root).problems) log(`configs/harnesses.yaml: ${problem}`);
  } catch (error) {
    log(`configs/harnesses.yaml: ${error.message}`);
  }
  log('\nEach harness uses your own sign-in. Run it once by hand if a call fails with an auth error.');
  log('isolation: what "user_config: isolated" can keep out. partial = some of your setup still loads (a temp home keeps config out and may still load built-in defaults). none = all of it loads.');
  log('Connect another CLI: add it to configs/harnesses.yaml.');
}

export function runsCommand(root, { log = console.log } = {}) {
  const state = buildState(root, { validate: false });
  if (!state.runs.length) {
    log('No runs yet. Try: node lab run experiments/smoke-harness-sweep.yaml');
    return;
  }
  for (const run of state.runs) {
    const harness = run.harness ? `${run.harness.name} ${run.harness.version}` : 'unknown harness';
    log(`${run.created_at.slice(0, 19).replace('T', ' ')}  ${pad(run.liveness === 'stale' ? 'stale' : run.status, 10)}${pad(`${run.rows}/${run.expected_rows} rows`, 12)}${pad(`${run.errors} err`, 8)}${pad(harness, 24)}${run.models.join(', ')}`);
    log(`  ${run.run_id}`);
    if (run.liveness === 'stale') log(`  stopped without finishing; continue it with: node lab run --resume ${run.run_id}`);
  }
}

const num = (value, digits = 2) => (value == null ? 'n/a' : Number(value).toFixed(digits));
const pct = (value) => (value == null ? 'n/a' : `${Math.round(value * 100)}%`);
const ms = (value) => (value == null ? 'n/a' : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`);
const usd = (value) => (value == null ? 'n/a' : `$${value < 0.01 ? value.toFixed(5) : value.toFixed(3)}`);

export function reportMarkdown(state, context) {
  const lines = [];
  lines.push(`## ${context.suite.id} ${context.suite.version} · ${context.prompt.id} v${context.prompt.version}`);
  lines.push('');
  lines.push(`${context.cases.length} case(s) · ${context.repeats} repeat(s) · evaluators ${context.evaluators.map((e) => `${e.id}@${e.version}`).join(', ') || 'none'} · comparison ${context.comparison.mode}${context.comparison.axes.length ? ` (${context.comparison.axes.join(' + ')})` : ''}`);
  lines.push('');
  lines.push('| Configuration | Quality (95% CI) | Pass rate | n (cases) | Failed | Lost | p50 latency | p95 latency | Cost total | Cost / pass | Mean in / out tokens |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  const rows = context.config_ids.map((id) => ({ config: state.configs[id], agg: context.aggregates[id] }));
  rows.sort((a, b) => (b.agg.mean_quality ?? -1) - (a.agg.mean_quality ?? -1));
  for (const { config, agg } of rows) {
    const ci = agg.quality_ci ? ` (${num(agg.quality_ci[0])}–${num(agg.quality_ci[1])})` : '';
    const flags = [agg.model_mismatch_n ? `${agg.model_mismatch_n} answered by another model` : '', config.pinned === false ? 'alias, not pinned' : ''].filter(Boolean);
    lines.push(`| ${config.label}${flags.length ? ` (${flags.join('; ')})` : ''} | ${num(agg.mean_quality)}${ci} | ${pct(agg.pass_rate)} | ${agg.counted_n} (${agg.cases_n}) | ${agg.failed_n} | ${agg.lost_n} | ${ms(agg.p50_latency_ms)} | ${ms(agg.p95_latency_ms)} | ${usd(agg.total_cost_usd)} | ${usd(agg.cost_per_passed_case)} | ${num(agg.mean_input_tokens, 0)} / ${num(agg.mean_output_tokens, 0)} |`);
  }
  lines.push('');
  lines.push(`Runs: ${context.runs.join(', ')}. Quality counts a failed call (timeout, no answer, harness error) as 0; a lost call (usage limit, sign-in, CLI missing) is left out and counted under Lost. The interval resamples cases, then repeats. Cost is API-equivalent from registry pricing and not billed for subscription harnesses.`);
  return lines.join('\n');
}

export function reportCommand(root, { write = false, log = console.log } = {}) {
  const state = buildState(root, { validate: false });
  if (!state.contexts.length) {
    log('No runs to report.');
    return;
  }
  const body = [`# Model Lab report`, '', `Generated ${state.generated_at} from results/. Regenerate; do not edit.`, '', ...state.contexts.map((context) => reportMarkdown(state, context) + '\n')].join('\n');
  if (write) {
    const file = path.join(paths(root).reports, 'comparison.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, 'utf8');
    log(`Wrote ${path.relative(root, file)}`);
  } else {
    log(body);
  }
}
