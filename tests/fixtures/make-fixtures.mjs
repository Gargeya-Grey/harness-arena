// Regenerates tests/fixtures/repo: a synthetic data root with six
// configurations across six harnesses, repeats, a failed call, an unscored row,
// wrong answers, an SVG context with artifacts, an annotation and a board.
// Deterministic: same output on every run. Usage: node tests/fixtures/make-fixtures.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { costUsd } from '../../lab/lib/metrics.mjs';
import { sha256 } from '../../lab/lib/fsutil.mjs';
import { redactEvent } from '../../lab/lib/redact.mjs';
import { ensureLedger } from '../../lab/lib/ledger.mjs';
import { loadSuite, loadPrompt, renderMessages, REPO_ROOT } from '../../lab/lib/repo.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'repo');

let seed = 7;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const between = (lo, hi) => lo + (hi - lo) * random();

function write(rel, text) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}
const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
const copy = (rel) => write(rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));

// The event stream of the real fixture run is local only (it is not in a fresh checkout's results/).
// A checkout without it keeps the copy that is committed in the fixture.
const REAL_EVENTS = 'results/20261021T080428Z__smoke__smoke-command-code__900ca7/harness-events.ndjson';
const keptEvents = fs.existsSync(path.join(OUT, REAL_EVENTS)) ? fs.readFileSync(path.join(OUT, REAL_EVENTS), 'utf8') : null;

fs.rmSync(OUT, { recursive: true, force: true });

write('configs/models.yaml', `# Fixture registry. Prices are illustrative, not current.
models:
  claude-haiku:
    provider: anthropic
    model: claude-haiku-4-5-20251001
    display_name: Claude Haiku 4.5
    context_window: 200000
    harness_models:
      claude-code: claude-haiku-4-5-20251001
    params: { temperature: 0, max_tokens: 64 }
    pricing: { input_per_1m: 1.00, output_per_1m: 5.00, cache_read_per_1m: 0.10, cache_write_per_1m: 1.25 }
  gpt-4o-mini:
    provider: openai
    model: gpt-4o-mini-2024-07-18
    display_name: GPT-4o mini
    context_window: 128000
    params: { temperature: 0, max_tokens: 64 }
    pricing: { input_per_1m: 0.15, output_per_1m: 0.60, cache_read_per_1m: 0.075 }
  gpt-5-mini-high:
    provider: openai
    model: gpt-5-mini-2025-08-07
    display_name: GPT-5 mini
    context_window: 400000
    reasoning_effort: high
    params: {}
    pricing: { input_per_1m: 0.25, output_per_1m: 2.00, cache_read_per_1m: 0.025 }
  deepseek-v4.1-flash-max:
    provider: deepseek
    model: deepseek/deepseek-v4.1-flash
    display_name: DeepSeek V4.1 Flash
    context_window: 1000000
    reasoning_effort: max
    params: { temperature: 0, max_tokens: 64 }
    pricing: { input_per_1m: 0.15, output_per_1m: 0.60, cache_read_per_1m: 0.003 }
  gemini-2.5-flash:
    provider: google
    model: gemini-2.5-flash
    display_name: Gemini 2.5 Flash
    context_window: 1048576
    params: {}
    pricing: { input_per_1m: 0.30, output_per_1m: 2.50, cache_read_per_1m: 0.075 }
`);

copy('datasets/smoke/suite.yaml');
copy('datasets/smoke/cases.jsonl');
copy('prompts/qa-single-turn/prompt.yaml');
copy('prompts/qa-single-turn/v1.yaml');

write('datasets/svg-mini/suite.yaml', `id: svg-mini
version: "0.1.0"
description: Two small SVG briefs for the artifact gallery.
`);
write('datasets/svg-mini/cases.jsonl', jsonl([
  { case_id: 'svg-mini-sun', input: { brief: 'A yellow sun: one circle, eight rays.', width: 256, height: 256 }, expected: null, tags: ['svg'] },
  { case_id: 'svg-mini-house', input: { brief: 'A house: beige body, red triangular roof, brown door.', width: 256, height: 256 }, expected: null, tags: ['svg'] },
]));
write('prompts/svg-scene/prompt.yaml', `id: svg-scene
current: "1"
description: Generate one SVG document.
variables: [brief, width, height]
`);
write('prompts/svg-scene/v1.yaml', `version: "1"
messages:
  - role: user
    content: |
      Generate a single SVG file. Return only the SVG markup.
      The root element must have width="{{width}}" height="{{height}}" and viewBox="0 0 {{width}} {{height}}".
      Requirements: {{brief}}
`);

const EXACT = { id: 'exact-match', version: '1', dimension: 'quality' };

const HARNESSES = {
  'claude-code': { name: 'claude-code', version: '2.1.306', entrypoint: 'headless', access_method: 'subscription', platform: 'win32', session_id: null, settings: { max_turns: 1, workdir: 'isolated' } },
  'anthropic-api': { name: 'anthropic-api', version: '2023-06-01', entrypoint: 'api', access_method: 'api_key', platform: 'win32', session_id: null, settings: {} },
  'openai-api': { name: 'openai-api', version: 'v1', entrypoint: 'api', access_method: 'api_key', platform: 'win32', session_id: null, settings: {} },
  codex: { name: 'codex', version: '0.163.0', entrypoint: 'headless', access_method: 'subscription', platform: 'win32', session_id: null, settings: { sandbox: 'read-only', workdir: 'isolated' } },
  'command-code': { name: 'command-code', version: '1.86.3', entrypoint: 'headless', access_method: 'subscription', platform: 'win32', session_id: null, settings: { max_turns: 1, workdir: 'isolated' } },
  'gemini-cli': { name: 'gemini-cli', version: '0.42.0', entrypoint: 'headless', access_method: 'subscription', platform: 'win32', session_id: null, settings: { workdir: 'isolated' } },
};

const REGISTRY = {
  'claude-haiku': { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', context_window: 200000, pricing: { input_per_1m: 1, output_per_1m: 5, cache_read_per_1m: 0.1, cache_write_per_1m: 1.25 } },
  'gpt-4o-mini': { provider: 'openai', model: 'gpt-4o-mini-2024-07-18', context_window: 128000, pricing: { input_per_1m: 0.15, output_per_1m: 0.6, cache_read_per_1m: 0.075 } },
  'gpt-5-mini-high': { provider: 'openai', model: 'gpt-5-mini-2025-08-07', context_window: 400000, reasoning_effort: 'high', pricing: { input_per_1m: 0.25, output_per_1m: 2, cache_read_per_1m: 0.025 } },
  'deepseek-v4.1-flash-max': { provider: 'deepseek', model: 'deepseek/deepseek-v4.1-flash', context_window: 1000000, reasoning_effort: 'max', pricing: { input_per_1m: 0.15, output_per_1m: 0.6, cache_read_per_1m: 0.003 } },
  'gemini-2.5-flash': { provider: 'google', model: 'gemini-2.5-flash', context_window: 1048576, pricing: { input_per_1m: 0.3, output_per_1m: 2.5, cache_read_per_1m: 0.075 } },
};

// Profiles shape the synthetic numbers: harness overhead shows as input tokens and latency.
const PROFILES = [
  { stamp: '20261020T090000Z', rand: 'aa11c1', harness: 'claude-code', model: 'claude-haiku', input: 14200, cacheRead: 12800, latency: [2600, 4200], wrong: {}, applied: {} },
  { stamp: '20261020T091500Z', rand: 'bb22d2', harness: 'anthropic-api', model: 'claude-haiku', input: 38, cacheRead: 0, latency: [450, 900], wrong: { 'smoke-002': 'Paris.' }, applied: { temperature: 0, max_tokens: 64 } },
  { stamp: '20261020T093000Z', rand: 'cc33e3', harness: 'openai-api', model: 'gpt-4o-mini', input: 31, cacheRead: 0, latency: [380, 760], wrong: { 'smoke-004': 'Green' }, applied: { temperature: 0, max_tokens: 64 } },
  { stamp: '20261020T094500Z', rand: 'dd44f4', harness: 'codex', model: 'gpt-5-mini-high', input: 9100, cacheRead: 7400, latency: [5200, 9800], wrong: {}, applied: { reasoning_effort: 'high' }, error: { case: 'smoke-003', repeat: 1 } },
  { stamp: '20261020T100000Z', rand: 'ee55a5', harness: 'command-code', model: 'deepseek-v4.1-flash-max', input: 19010, cacheRead: 5504, latency: [6100, 9200], wrong: { 'smoke-003': '365' }, applied: { reasoning_effort: 'max' }, flaky: true },
  { stamp: '20261020T101500Z', rand: 'ff66b6', harness: 'gemini-cli', model: 'gemini-2.5-flash', input: 7300, cacheRead: 0, latency: [3100, 5400], wrong: {}, applied: {}, unscored: { case: 'smoke-004', repeat: 2 } },
];

const smoke = loadSuite(OUT, 'smoke');
const qaPrompt = loadPrompt(OUT, 'qa-single-turn');

function manifest({ runId, created, finished, suite, prompt, experiment, harness, modelKey, applied, evaluators }) {
  const entry = REGISTRY[modelKey];
  return {
    run_id: runId,
    created_at: created,
    finished_at: finished,
    status: 'completed',
    suite: { id: suite.id, version: suite.version, sha256: suite.sha256 },
    prompt: { id: prompt.id, version: prompt.version, sha256: prompt.sha256 },
    experiment,
    models: [{
      model_key: modelKey,
      provider: entry.provider,
      model: entry.model,
      params: applied,
      context_window: entry.context_window,
      reasoning_effort: applied.reasoning_effort ?? null,
      pricing: entry.pricing,
    }],
    repeats: experiment.repeats,
    evaluators,
    harness,
    notes: 'Synthetic fixture run for tests and UI work. Not evidence.',
  };
}

for (const profile of PROFILES) {
  const runId = `${profile.stamp}__smoke__smoke-sweep__${profile.rand}`;
  const created = `${profile.stamp.slice(0, 4)}-${profile.stamp.slice(4, 6)}-${profile.stamp.slice(6, 8)}T${profile.stamp.slice(9, 11)}:${profile.stamp.slice(11, 13)}:00.000Z`;
  const experiment = {
    id: 'smoke-sweep',
    description: 'Fixture sweep: one smoke suite through six harnesses.',
    suite: 'smoke',
    prompt: 'qa-single-turn',
    repeats: 3,
    targets: PROFILES.map((item) => ({ model: item.model, harness: item.harness })),
    evaluators: [EXACT],
  };
  const raw = [];
  const scores = [];
  let clock = Date.parse(created);
  for (const item of smoke.cases) {
    for (let repeat = 0; repeat < 3; repeat += 1) {
      const latency = Math.round(between(...profile.latency));
      const started = new Date(clock).toISOString();
      clock += latency + 250;
      const isError = profile.error && profile.error.case === item.case_id && profile.error.repeat === repeat;
      let text = profile.wrong[item.case_id] ?? item.expected;
      if (profile.flaky && item.case_id === 'smoke-004' && repeat === 1) text = 'Green.';
      const output = isError ? 0 : Math.max(1, Math.round(String(text).length / 3)) + (profile.applied.reasoning_effort ? Math.round(between(40, 220)) : 0);
      const usage = isError
        ? { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null }
        : { input_tokens: profile.input + Math.round(between(0, 40)), output_tokens: output, cache_read_tokens: profile.cacheRead, cache_write_tokens: 0 };
      const row = {
        run_id: runId,
        case_id: item.case_id,
        model_key: profile.model,
        repeat,
        started_at: started,
        latency_ms: isError ? 120000 : latency,
        tokens_per_second: isError ? null : Number((output / (latency / 1000)).toFixed(3)),
        tool_calls: 0,
        skills_used: [],
        request: { prompt_id: qaPrompt.id, prompt_version: qaPrompt.version, messages: renderMessages(qaPrompt.messages, item.input), system_prompt: null, params: profile.applied },
        response: isError ? { text: null, finish_reason: null } : { text, finish_reason: 'end_turn' },
        usage,
        cost_usd: isError ? null : costUsd(usage, REGISTRY[profile.model].pricing),
        error: isError ? { type: 'timeout', message: 'Harness did not exit within 120 s' } : null,
        metadata: { workdir: 'isolated', model_request_duration_ms: isError ? null : Math.round(latency * 0.7) },
      };
      raw.push(row);
      const unscored = profile.unscored && profile.unscored.case === item.case_id && profile.unscored.repeat === repeat;
      if (!isError && !unscored) {
        const value = String(text).trim() === String(item.expected).trim() ? 1 : 0;
        scores.push({ run_id: runId, case_id: item.case_id, model_key: profile.model, repeat, evaluator_id: 'exact-match', evaluator_version: '1', dimension: 'quality', value, passed: value === 1, details: { expected: item.expected, actual: text, normalization: 'trim' } });
      }
    }
  }
  const finished = new Date(clock).toISOString();
  const dir = `results/${runId}`;
  write(`${dir}/run.json`, `${JSON.stringify(manifest({ runId, created, finished, suite: smoke, prompt: qaPrompt, experiment, harness: HARNESSES[profile.harness], modelKey: profile.model, applied: profile.applied, evaluators: [EXACT] }), null, 2)}\n`);
  write(`${dir}/raw.jsonl`, jsonl(raw));
  write(`${dir}/scores/exact-match@1.jsonl`, jsonl(scores));
}

// SVG context: two configurations, artifacts on disk.
const svgSuite = loadSuite(OUT, 'svg-mini');
const svgPrompt = loadPrompt(OUT, 'svg-scene');
const STRUCT = { id: 'svg-structure', version: '1', dimension: 'format' };
const SVGS = {
  'claude-haiku': {
    'svg-mini-sun': '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><g stroke="#E0A400" stroke-width="10" stroke-linecap="round"><line x1="128" y1="20" x2="128" y2="56"/><line x1="128" y1="200" x2="128" y2="236"/><line x1="20" y1="128" x2="56" y2="128"/><line x1="200" y1="128" x2="236" y2="128"/><line x1="52" y1="52" x2="77" y2="77"/><line x1="179" y1="179" x2="204" y2="204"/><line x1="52" y1="204" x2="77" y2="179"/><line x1="179" y1="77" x2="204" y2="52"/></g><circle cx="128" cy="128" r="52" fill="#F5C400"/></svg>',
    'svg-mini-house': '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="56" y="112" width="144" height="112" fill="#E8D8B8"/><polygon points="40,116 128,40 216,116" fill="#B83A2E"/><rect x="112" y="160" width="36" height="64" fill="#6B4226"/></svg>',
  },
  'gpt-4o-mini': {
    'svg-mini-sun': '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="70" fill="#FFD23F"/></svg>',
    'svg-mini-house': '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="60" y="120" width="136" height="100" fill="#F0E0C0" stroke="#333"/><polygon points="50,120 128,56 206,120" fill="#C0392B"/><rect x="114" y="168" width="28" height="52" fill="#7B4B2A"/><rect x="150" y="140" width="28" height="24" fill="#5DADE2"/></svg>',
  },
};
for (const [index, [modelKey, harnessKey]] of [['claude-haiku', 'claude-code'], ['gpt-4o-mini', 'openai-api']].entries()) {
  const hour = String(9 + index).padStart(2, "0");
  const stamp = `20261021T${hour}0000Z`;
  const runId = `${stamp}__svg-mini__svg-gallery__${index ? 'b7c8d9' : 'a1b2c3'}`;
  const created = `2026-10-21T${hour}:00:00.000Z`;
  const experiment = { id: 'svg-gallery', description: 'Fixture SVG comparison.', suite: 'svg-mini', prompt: 'svg-scene', repeats: 1, targets: [{ model: 'claude-haiku', harness: 'claude-code' }, { model: 'gpt-4o-mini', harness: 'openai-api' }], evaluators: [STRUCT] };
  const applied = harnessKey === 'openai-api' ? { temperature: 0, max_tokens: 2048 } : {};
  const raw = [];
  const scores = [];
  for (const item of svgSuite.cases) {
    const svg = SVGS[modelKey][item.case_id];
    const rel = `artifacts/${item.case_id}/${modelKey}/r0/output.svg`;
    write(`results/${runId}/${rel}`, svg);
    const usage = { input_tokens: harnessKey === 'claude-code' ? 14100 : 96, output_tokens: Math.round(svg.length / 3.4), cache_read_tokens: harnessKey === 'claude-code' ? 12800 : 0, cache_write_tokens: 0 };
    const latency = Math.round(between(1800, 5200));
    raw.push({
      run_id: runId, case_id: item.case_id, model_key: modelKey, repeat: 0, started_at: created, latency_ms: latency,
      tokens_per_second: Number((usage.output_tokens / (latency / 1000)).toFixed(3)), tool_calls: 0, skills_used: [],
      request: { prompt_id: svgPrompt.id, prompt_version: svgPrompt.version, messages: renderMessages(svgPrompt.messages, item.input), system_prompt: null, params: applied },
      response: { text: svg, finish_reason: 'end_turn' }, usage, cost_usd: costUsd(usage, REGISTRY[modelKey].pricing), error: null,
      metadata: { workdir: 'isolated' },
      artifacts: [{ artifact_id: `${item.case_id}__${modelKey}__r0__raw`, role: 'raw', mime: 'image/svg+xml', path: rel, sha256: sha256(svg), derived: false, width: 256, height: 256 }],
    });
    scores.push({ run_id: runId, case_id: item.case_id, model_key: modelKey, repeat: 0, evaluator_id: 'svg-structure', evaluator_version: '1', dimension: 'format', value: 1, passed: true, details: { checks: ['parses', 'root-svg', 'viewbox', 'no-script'] } });
  }
  write(`results/${runId}/run.json`, `${JSON.stringify(manifest({ runId, created, finished: created.replace(':00:00', ':01:30'), suite: svgSuite, prompt: svgPrompt, experiment, harness: HARNESSES[harnessKey], modelKey, applied, evaluators: [STRUCT] }), null, 2)}\n`);
  write(`results/${runId}/raw.jsonl`, jsonl(raw));
  write(`results/${runId}/scores/svg-structure@1.jsonl`, jsonl(scores));
}

// One real run: a partial-case context with a harness event stream. The stream is not
// in git (.gitignore), so it is copied only where it exists, and redacted on the way.
const realRun = '20261021T080428Z__smoke__smoke-command-code__900ca7';
fs.cpSync(path.join(REPO_ROOT, 'results', realRun), path.join(OUT, 'results', realRun), { recursive: true });
const realEvents = path.join(OUT, 'results', realRun, 'harness-events.ndjson');
if (fs.existsSync(realEvents)) {
  const lines = fs.readFileSync(realEvents, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  write(`results/${realRun}/harness-events.ndjson`, jsonl(lines.map((line) => ({ ...line, event: redactEvent(line.event) }))));
} else if (keptEvents !== null) {
  write(REAL_EVENTS, keptEvents);
}

write('annotations/human@1.jsonl', jsonl([
  { annotation_id: 'fixture-annotation-1', run_id: '20261021T090000Z__svg-mini__svg-gallery__a1b2c3', case_id: 'svg-mini-house', config_id: 'claude-haiku__claude-code-2.1.306__default', repeat: 0, reviewer: 'owner', created_at: '2026-10-21T11:00:00.000Z', scale: '1-5', value: 4, notes: 'Clean shapes; no window.', pair_id: null, pair_choice: null, pair_config_id: null, revealed: true, supersedes: null },
]));
write('boards/haiku-harness.json', `${JSON.stringify({
  board_id: 'haiku-harness',
  title: 'Claude Haiku · Claude Code vs API',
  created_at: '2026-10-21T11:05:00.000Z',
  updated_at: '2026-10-21T11:05:00.000Z',
  context: { suite: 'smoke', prompt: 'qa-single-turn', cases: smoke.cases.map((item) => item.case_id), repeats: 3 },
  treatment_axis: 'harness',
  configs: ['claude-haiku__claude-code-2.1.306__default', 'claude-haiku__anthropic-api-2023-06-01__default'],
  view: {},
}, null, 2)}\n`);

// A ladder suite: 12 tasks over five tiers (the tier table is the real one), run by four setups that
// differ in what they kept out of the harness's own setup, and one run that stopped before scoring.
// 10 tasks are declared by the counted runs; the last two are never run (information: no-data).
copy('configs/ladder.yaml');
copy('prompts/reasoning-final-answer/prompt.yaml');
copy('prompts/reasoning-final-answer/v1.yaml');
const TIERS = { 1: ['easy', 1], 2: ['medium', 5], 3: ['hard', 15], 4: ['extra-hard', 60], 5: ['supreme', 200] };
const LADDER_TASKS = [
  ['a1', 1, 12], ['a2', 1, 30], ['b1', 2, 7], ['b2', 2, 21], ['c1', 3, 99], ['c2', 3, 144], ['c3', 3, 8],
  ['d1', 4, 63], ['d2', 4, 25], ['e1', 5, 5], ['e2', 5, 6], ['e3', 5, 7],
];
write('datasets/ladder-answer/suite.yaml', `id: ladder-answer
version: "2.0.0"
description: Fixture ladder suite: 12 answer tasks over five tiers, for the ladder report and the dashboard.
defaults:
  repeats: 1
`);
write('datasets/ladder-answer/cases.jsonl', jsonl(LADDER_TASKS.map(([slug, level, answer]) => ({
  case_id: `ladder-answer-fx-${slug}`,
  input: { question: `Fixture problem ${slug}: what number is the answer?` },
  expected: answer,
  tags: [`tier-${level}-${TIERS[level][0]}`],
  metadata: { tier: { level, name: TIERS[level][0], human_minutes: TIERS[level][1], basis: 'Fixture task. The time is a label, not a measurement.' } },
}))));
const ladderSuite = loadSuite(OUT, 'ladder-answer');
const finalPrompt = loadPrompt(OUT, 'reasoning-final-answer');
const FINAL = { id: 'final-answer', version: '1', dimension: 'quality' };
const CLAUDE_FLAGS = ['--setting-sources', 'project,local', '--strict-mcp-config', '--disable-slash-commands'];
const withSetup = (harness, flags) => ({ ...harness, settings: { ...harness.settings, user_config: 'isolated', user_config_requested: 'isolated', user_config_flags: flags } });
// What each run did on the 10 declared tasks (a1 a2 b1 b2 c1 c2 c3 d1 d2 e1): 1 solved, 0 not,
// 'lost' a call lost to a usage limit (it does not count). The tasks come out as
// 3 all-solved (a1 a2 b1), 4 disagree (b2 c1 c2 c3; c2 only because of a setup split), 2 all-unsolved (d1 d2),
// 1 one-config (e1) and 2 never run (e2 e3).
const LADDER_RUNS = [
  { stamp: '20261022T090000Z', rand: 'c1aa01', model: 'claude-haiku', harness: withSetup(HARNESSES['claude-code'], CLAUDE_FLAGS), applied: {}, results: [1, 1, 1, 1, 1, 0, 0, 0, 0, 'lost'] },
  { stamp: '20261022T091000Z', rand: 'c1bb02', model: 'claude-haiku', harness: withSetup(HARNESSES['claude-code'], [...CLAUDE_FLAGS, 'CLAUDE_CODE_DISABLE_CLAUDE_MDS=1', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=1']), applied: {}, results: [1, 1, 1, 1, 1, 1, 0, 0, 0, 1] },
  { stamp: '20261022T092000Z', rand: 'c1cc03', model: 'deepseek-v4.1-flash-max', harness: withSetup(HARNESSES['command-code'], ['--no-skills']), applied: { reasoning_effort: 'max' }, results: [1, 1, 1, 0, 0, 0, 1, 0, 0, 'lost'] },
  { stamp: '20261022T093000Z', rand: 'c1dd04', model: 'gpt-5-mini-high', harness: HARNESSES.codex, applied: { reasoning_effort: 'high' }, results: [1, 1, 1, 1, 1, 0, 0, 0, 0, 'lost'] },
];
const LADDER_DECLARED = ladderSuite.cases.slice(0, 10).map((item) => item.case_id);
const ladderExperiment = (cases) => ({ id: 'ladder-answer-pilot', description: 'Fixture ladder pilot: one repeat per task.', suite: 'ladder-answer', prompt: 'reasoning-final-answer', repeats: 1, cases, targets: LADDER_RUNS.map((item) => ({ model: item.model, harness: item.harness.name })), evaluators: [FINAL] });
function ladderRows({ runId, model, applied, cases, result }) {
  const raw = [];
  const scores = [];
  cases.forEach((caseId, index) => {
    const item = ladderSuite.cases.find((entry) => entry.case_id === caseId);
    const outcome = result(index);
    const lost = outcome === 'lost';
    const text = lost ? null : `Reasoning.\nAnswer: ${outcome === 1 ? item.expected : item.expected + 1}`;
    raw.push({
      run_id: runId, case_id: caseId, model_key: model, repeat: 0, started_at: '2026-10-22T09:00:00.000Z', latency_ms: lost ? 1000 : 3000 + index * 100,
      tokens_per_second: null, tool_calls: 0, skills_used: [],
      request: { prompt_id: finalPrompt.id, prompt_version: finalPrompt.version, messages: renderMessages(finalPrompt.messages, item.input), system_prompt: null, params: applied },
      response: lost ? { text: null, finish_reason: null } : { text, finish_reason: 'end_turn' },
      usage: lost ? { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null } : { input_tokens: 400, output_tokens: 60, cache_read_tokens: 0, cache_write_tokens: 0 },
      cost_usd: null,
      error: lost ? { type: 'rate_limit', message: 'Usage limit reached' } : null,
      metadata: { workdir: 'isolated' },
    });
    if (!lost) scores.push({ run_id: runId, case_id: caseId, model_key: model, repeat: 0, evaluator_id: 'final-answer', evaluator_version: '1', dimension: 'quality', value: outcome === 1 ? 1 : 0, passed: outcome === 1, details: { expected: item.expected, actual: String(outcome === 1 ? item.expected : item.expected + 1) } });
  });
  return { raw, scores };
}
for (const profile of LADDER_RUNS) {
  const runId = `${profile.stamp}__ladder-answer__ladder-answer-pilot__${profile.rand}`;
  const created = `2026-10-22T${profile.stamp.slice(9, 11)}:${profile.stamp.slice(11, 13)}:00.000Z`;
  const { raw, scores } = ladderRows({ runId, model: profile.model, applied: profile.applied, cases: LADDER_DECLARED, result: (index) => profile.results[index] });
  const dir = `results/${runId}`;
  write(`${dir}/run.json`, `${JSON.stringify(manifest({ runId, created, finished: created.replace(':00.000Z', ':20.000Z'), suite: ladderSuite, prompt: finalPrompt, experiment: ladderExperiment(LADDER_DECLARED), harness: profile.harness, modelKey: profile.model, applied: profile.applied, evaluators: [FINAL] }), null, 2)}\n`);
  write(`${dir}/raw.jsonl`, jsonl(raw));
  write(`${dir}/scores/final-answer@1.jsonl`, jsonl(scores));
}
// A run that stopped (the user ended it) after 6 answers and before any score: its answers count nowhere yet.
{
  const profile = { stamp: '20261022T100000Z', rand: 'c1ee05', model: 'gpt-5-mini-high', harness: HARNESSES.codex, applied: { reasoning_effort: 'high' } };
  const runId = `${profile.stamp}__ladder-answer__ladder-answer-pilot__${profile.rand}`;
  const cases = ladderSuite.cases.slice(0, 6).map((item) => item.case_id);
  const { raw } = ladderRows({ runId, model: profile.model, applied: profile.applied, cases, result: () => 1 });
  const stopped = manifest({ runId, created: '2026-10-22T10:00:00.000Z', finished: null, suite: ladderSuite, prompt: finalPrompt, experiment: ladderExperiment(cases), harness: profile.harness, modelKey: profile.model, applied: profile.applied, evaluators: [FINAL] });
  write(`results/${runId}/run.json`, `${JSON.stringify({ ...stopped, status: 'failed', finished_at: '2026-10-22T10:00:40.000Z', runner: { pid: 1, heartbeat_at: '2026-10-22T10:00:40.000Z', interrupted: true } }, null, 2)}\n`);
  write(`results/${runId}/raw.jsonl`, jsonl(raw));
}
// A rating and a saved view made before the user-setup state split the id of the Claude Code runs:
// both name the old id, which the leaked run and the clean run shared.
const legacyAnnotation = {
  annotation_id: 'fixture-annotation-legacy', run_id: '20261022T090000Z__ladder-answer__ladder-answer-pilot__c1aa01', case_id: 'ladder-answer-fx-a1',
  config_id: 'claude-haiku__claude-code-2.1.306__default__isolated', repeat: 0, reviewer: 'owner', created_at: '2026-10-22T11:00:00.000Z', scale: '1-5', value: 3,
  notes: 'Rated before the setup state split the id.', pair_id: null, pair_choice: null, pair_config_id: null, revealed: true, supersedes: null,
};
write('annotations/human@1.jsonl', jsonl([JSON.parse(fs.readFileSync(path.join(OUT, 'annotations/human@1.jsonl'), 'utf8').trim()), legacyAnnotation]));
write('boards/ladder-legacy.json', `${JSON.stringify({
  board_id: 'ladder-legacy',
  title: 'Haiku through Claude Code (old id)',
  created_at: '2026-10-22T11:05:00.000Z',
  updated_at: '2026-10-22T11:05:00.000Z',
  context: { suite: 'ladder-answer', prompt: 'reasoning-final-answer', cases: LADDER_DECLARED, repeats: 1 },
  treatment_axis: 'none',
  configs: ['claude-haiku__claude-code-2.1.306__default__isolated'],
  view: {},
}, null, 2)}\n`);

// Without a ledger no run counts: the fixture store vouches for its runs as written.
fs.rmSync(path.join(OUT, 'lab.ledger.jsonl'), { force: true });
ensureLedger(OUT);

console.log(`Fixtures written to ${OUT}`);
