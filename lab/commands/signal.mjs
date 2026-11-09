// node lab signal <experiment.yaml> [--json] [--harness h] [--models a,b] [--cases x,y] [--repeats n]
// Before you spend calls: can this run give a trustable signal? An estimate from stored runs.
// It calls no model and writes nothing.

import path from 'node:path';
import { ALPHA, NEEDED, signalReport } from '../lib/signal.mjs';

const number = (value) => (value == null ? 'unknown' : value.toLocaleString('en-US'));

export function formatSignal(report) {
  const { experiment: e } = report;
  const lines = [
    `Signal check: ${e.id} (suite ${e.suite} ${e.version}, prompt ${e.prompt})`,
    report.note,
    '',
    `Planned calls: ${report.planned_calls} (${e.setups} setups x ${e.tasks} tasks x ${e.repeats} tries)`,
    `Tasks by what history says: ${report.tasks.no_history} no history, ${report.tasks.all_solved} all solved, ${report.tasks.all_unsolved} all unsolved, ${report.tasks.disagree} disagree`,
    `Calls with little chance of new information: ${report.calls_low_information == null ? 'unknown (no history)' : `${report.calls_low_information} (tasks every setup already solved)`}`,
    '',
    'Estimated output tokens (stored median per call x planned calls):',
  ];
  const labelOf = new Map(report.setups.map((setup) => [setup.config_id, setup.label]));
  for (const item of report.output_tokens) lines.push(`  ${labelOf.get(item.config_id)}: ${number(item.estimate)}`);
  lines.push('', `Pairs. Two setups need at least ${NEEDED} disagreements, all one way, to reach p below ${ALPHA} (two-sided exact sign test).`);
  if (!report.pairs.length) lines.push('  none: one setup is planned');
  for (const pair of report.pairs) {
    lines.push(`  ${pair.a_label} against ${pair.b_label}: predicted ${pair.predicted_disagreements ?? 'unknown'} of ${pair.needed} needed${pair.shared ? ` (${pair.a_only} and ${pair.b_only}, over ${pair.shared} shared tasks)` : ''}, ${pair.status}`);
  }
  lines.push('', `Check quality: ${report.checks.state}${report.checks.kill_rate == null ? '' : `, kill rate ${report.checks.kill_rate}`}`);
  lines.push('Setup state:');
  for (const setup of report.setups) lines.push(`  ${setup.label}: ${setup.setup_state}${setup.history ? '' : ', no history'}`);
  lines.push('', `Result: ${report.result}`, 'Reasons:');
  for (const reason of report.reasons) lines.push(`  - ${reason}`);
  return lines.join('\n');
}

export async function signalCommand(root, positionals = [], values = {}) {
  if (positionals.length !== 1) throw new Error('Usage: node lab signal <experiment.yaml> [--json] [--harness <name>] [--models a,b] [--cases x,y] [--repeats <n>]');
  const list = (value) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined);
  const report = signalReport(root, path.resolve(positionals[0]), {
    harness: values.harness,
    models: list(values.models),
    cases: list(values.cases),
    repeats: values.repeats != null ? Number(values.repeats) : undefined,
  });
  console.log(values.json ? JSON.stringify(report, null, 2) : formatSignal(report));
  return 0;
}
