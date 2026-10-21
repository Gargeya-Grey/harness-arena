// Read-only commands: doctor (which harnesses are usable here), runs (the run
// ledger) and report (a Markdown comparison per context, from stored evidence).

import fs from 'node:fs';
import path from 'node:path';
import { ADAPTERS } from '../adapters/index.mjs';
import { resolveCommand } from '../adapters/process.mjs';
import { buildState } from '../lib/state.mjs';
import { paths } from '../lib/repo.mjs';

const pad = (value, width) => String(value).padEnd(width);

export async function doctorCommand({ log = console.log } = {}) {
  log(`Node ${process.version} on ${process.platform}\n`);
  log(`${pad('harness', 16)}${pad('kind', 6)}${pad('status', 14)}detail`);
  const rows = await Promise.all(
    Object.values(ADAPTERS).map(async (adapter) => {
      const detected = await adapter.detect();
      if (adapter.kind === 'cli') {
        const where = resolveCommand({ 'claude-code': 'claude', codex: 'codex', 'command-code': 'cmdc', 'gemini-cli': 'gemini' }[adapter.name]);
        return [adapter, detected.version ? 'ready' : 'not found', detected.version ? `v${detected.version} · ${where ? (where.prefix[0] || where.command) : ''}` : 'install the CLI and sign in'];
      }
      return [adapter, detected.credentials ? 'ready' : 'no key', detected.credentials ? `${adapter.key_env} set` : `set ${adapter.key_env}`];
    }),
  );
  for (const [adapter, status, detail] of rows) log(`${pad(adapter.name, 16)}${pad(adapter.kind, 6)}${pad(status, 14)}${detail}`);
  log('\nCLI harnesses use your own sign-in (subscription). Run each once interactively if a call fails with an auth error.');
}

export function runsCommand(root, { log = console.log } = {}) {
  const state = buildState(root, { validate: false });
  if (!state.runs.length) {
    log('No runs yet. Try: node lab run experiments/smoke-harness-sweep.yaml');
    return;
  }
  for (const run of state.runs) {
    const harness = run.harness ? `${run.harness.name} ${run.harness.version}` : 'unknown harness';
    log(`${run.created_at.slice(0, 19).replace('T', ' ')}  ${pad(run.status, 10)}${pad(`${run.rows}/${run.expected_rows} rows`, 12)}${pad(`${run.errors} err`, 8)}${pad(harness, 24)}${run.models.join(', ')}`);
    log(`  ${run.run_id}`);
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
  lines.push('| Configuration | Quality (95% CI) | Pass rate | n | Errors | p50 latency | p95 latency | Cost total | Cost / pass | Mean in / out tokens |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  const rows = context.config_ids.map((id) => ({ config: state.configs[id], agg: context.aggregates[id] }));
  rows.sort((a, b) => (b.agg.mean_quality ?? -1) - (a.agg.mean_quality ?? -1));
  for (const { config, agg } of rows) {
    const ci = agg.quality_ci ? ` (${num(agg.quality_ci[0])}–${num(agg.quality_ci[1])})` : '';
    lines.push(`| ${config.label} | ${num(agg.mean_quality)}${ci} | ${pct(agg.pass_rate)} | ${agg.n} | ${agg.errors_n} | ${ms(agg.p50_latency_ms)} | ${ms(agg.p95_latency_ms)} | ${usd(agg.total_cost_usd)} | ${usd(agg.cost_per_passed_case)} | ${num(agg.mean_input_tokens, 0)} / ${num(agg.mean_output_tokens, 0)} |`);
  }
  lines.push('');
  lines.push(`Runs: ${context.runs.join(', ')}. Cost is API-equivalent from registry pricing and not billed for subscription harnesses.`);
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
