import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry, loadSuite, loadPrompt, renderMessages } from '../../lab/lib/repo.mjs';
import { snapshotWorkspace } from '../../lab/lib/workspace.mjs';
import { scoreRun } from '../../lab/commands/score.mjs';
import { ensureLedger } from '../../lab/lib/ledger.mjs';

export const HISTORICAL_RUNS = {
  reasoning: '20260101T000000Z__reasoning__fixture-history__aa0001',
  agentic: '20260101T000000Z__agentic__fixture-history__bb0002',
  smoke: '20260101T000000Z__smoke__fixture-history__cc0003',
};
const SPECS = {
  [HISTORICAL_RUNS.reasoning]: { suite: 'reasoning', version: '1.0.0', prompt: 'reasoning-final-answer', evaluator: 'final-answer', answers: { 'reasoning-bat-ball': '5', 'reasoning-clock-angle': '7.5' } },
  [HISTORICAL_RUNS.agentic]: { suite: 'agentic', prompt: 'agent-task', evaluator: 'workspace-tests', answers: { 'agentic-csv-quotes': 'Synthetic unchanged workspace.' } },
  [HISTORICAL_RUNS.smoke]: { suite: 'smoke', prompt: 'qa-single-turn', evaluator: 'exact-match', answers: { 'smoke-001': '4' } },
};

export function writeHistoricalRuns(root, ids) {
  const created = '2026-01-01T00:00:00.000Z';
  const modelKey = 'deepseek-v4.1-flash-max';
  const entry = loadRegistry(root)[modelKey];
  for (const id of ids) {
    const spec = SPECS[id];
    if (!spec) throw new Error(`Unknown synthetic history fixture ${id}`);
    const suite = loadSuite(root, spec.suite, { version: spec.version });
    const prompt = loadPrompt(root, spec.prompt, '1');
    const dir = path.join(root, 'results', id);
    fs.mkdirSync(dir, { recursive: true });
    const evaluators = [{ id: spec.evaluator, version: '1', dimension: 'quality' }];
    const experiment = { id: 'fixture-history', suite: suite.id, prompt: prompt.id, repeats: 1, cases: Object.keys(spec.answers), targets: [{ model: modelKey, harness: 'command-code', effort: 'max' }], evaluators };
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run_id: id, created_at: created, finished_at: created, status: 'completed', suite: { id: suite.id, version: suite.version, sha256: suite.sha256 }, prompt: { id: prompt.id, version: prompt.version, sha256: prompt.sha256 }, experiment,
      models: [{ model_key: modelKey, provider: entry.provider, model: entry.model, params: {}, reasoning_effort: 'max' }], repeats: 1, evaluators,
      harness: { name: 'command-code', version: '0.0.0-fixture', entrypoint: 'headless', access_method: 'subscription', settings: { workdir: 'isolated' } }, notes: 'Synthetic archived/versioned fixture. No model call or live history.' }, null, 2) + '\n');
    const rows = Object.entries(spec.answers).map(([caseId, text]) => {
      const item = suite.cases.find(testCase => testCase.case_id === caseId);
      const artifacts = [];
      if (item.input.workspace) {
        const starter = path.join(suite.workspacesDir, item.input.workspace);
        artifacts.push(snapshotWorkspace({ fixtureDir: starter, workDir: starter, runDir: dir, base: `artifacts/${caseId}/${modelKey}/r0/workspace`, artifactId: `${caseId}__fixture`, createdAt: created }));
      }
      return { run_id: id, case_id: caseId, model_key: modelKey, repeat: 0, started_at: created, latency_ms: 10, tokens_per_second: 100, tool_calls: 0, skills_used: [], request: { prompt_id: prompt.id, prompt_version: prompt.version, messages: renderMessages(prompt.messages, item.input), params: {} }, response: { text, finish_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 }, cost_usd: null, error: null, ...(artifacts.length ? { artifacts } : {}) };
    });
    fs.writeFileSync(path.join(dir, 'raw.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    scoreRun(root, dir);
  }
  if (ids.length) ensureLedger(root);
}
