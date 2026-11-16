// Render-level tests for the Ladder page, on the fixture repo and on hand-built state.ladder objects
// of the shapes lab/lib/ladder.mjs documents. The page reads state.ladder only. Layout is proved in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../lab/lib/state.mjs';
import { ladderCommand, pairLine } from '../lab/commands/ladder.mjs';
import { createServer } from '../dashboard/server.mjs';
import {
  ALPHA, INFORMATION, allTasks, cleanUi, defaultUi, hashFor, headline, minutesText, pairOf, parseHash, pText, rangeText,
  renderEmpty, renderNotices, renderPage, renderPairCard, renderPairs, renderSetups, renderTasks, selectDefs, visibleTasks,
} from '../dashboard/public/ladder.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/repo/', import.meta.url));
const data = buildState(FIXTURES);
const clone = () => structuredClone(data);
const text = (markup) => String(markup).replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const rowOf = (markup, caseId) => String(markup).split('<tr ').find((chunk) => chunk.startsWith(`data-case="${caseId}"`)) ?? '';
const ids = (ladder) => ladder.configs.map((config) => config.config_id);

const CLEAN = 'claude-haiku__claude-code-2.1.306__default__isolated';
const LEAKED = 'claude-haiku__claude-code-2.1.306__default__isolated-leaked';

test('the fixture opens with the answer sentence, built from the server counts', () => {
  const h = headline(data.ladder);
  assert.equal(h.say, '4 of 12 tasks show a real disagreement. 1 has only one setup.');
  assert.equal(h.pairs, 'The runs cannot tell any of the 6 pairs of setups apart (sign test, p below 0.05).');
  assert.deepEqual(h.more, [
    'Some setups solved them and some did not. Only these tasks separate setups.',
    '3 were solved by every setup that ran them, so they do not separate the setups.',
    '2 were solved by none. Check them for a defect first.',
    '2 have no data yet.',
  ]);
});

test('a gap between setups that were not kept out equally is never read as telling them apart', () => {
  const ladder = clone().ladder;
  for (const config of ladder.configs) config.setup_state = 'kept out';
  ladder.pairs = ladder.pairs.map((pair) => ({ ...pair, sign_p: 0.5 }));
  const [first, second] = ladder.pairs;
  Object.assign(first, { sign_p: 0.001 });
  Object.assign(second, { sign_p: 0.002 });
  ladder.configs.find((config) => config.config_id === second.b).setup_state = 'partly kept out';
  assert.match(headline(ladder).pairs, /^The runs can tell 1 of 6 pairs of setups apart \(sign test, p below 0\.05\)\. They are .+ and .+\. 1 more pair differs, but its setups were not kept out of your own setup equally, so the difference may come from that\.$/);
  const rows = text(renderPairs(ladder));
  assert.equal((rows.match(/Differ, not a clean comparison/g) || []).length, 1);
  assert.equal((rows.match(/Can tell apart/g) || []).length, 1);
  assert.match(text(renderPairCard(ladder, { ...defaultUi(), a: second.a, b: second.b })), /Their scores differ \(sign test p < 0\.01\), but the two setups were not kept out of your own setup equally/);

  ladder.configs.find((config) => config.config_id === first.a).setup_state = 'leaked';
  assert.match(headline(ladder).pairs, /^The runs cannot cleanly tell any of the 6 pairs of setups apart/, 'a leaked setup is not clean, even next to another of the same state');
});

test('the answer names the pairs the sign test separates, and the setup they share', () => {
  const ladder = clone().ladder;
  for (const config of ladder.configs) config.setup_state = 'kept out';
  ladder.pairs = ladder.pairs.map((pair) => ({ ...pair, sign_p: 0.5 }));
  const [first, second] = ladder.pairs;
  Object.assign(first, { a_only: 28, b_only: 0, sign_p: 7.45e-9 });
  Object.assign(second, { a: first.a, a_label: first.a_label, sign_p: 0.00006 });
  assert.match(headline(ladder).pairs, /^The runs can tell 2 of 6 pairs of setups apart \(sign test, p below 0\.05\)\. All 2 include Claude Haiku 4\.5 · claude-code · isolated\.$/);
  ladder.pairs[5].sign_p = 0.01;
  assert.match(headline(ladder).pairs, /^The runs can tell 3 of 6 pairs of setups apart \(sign test, p below 0\.05\)\. They are .+ and .+; .+ and .+; .+ and .+\.$/);
});

test('a task with no counted result reads "no data" and "no result", never 0', () => {
  const markup = renderTasks(data.ladder, data.cases, defaultUi());
  const row = rowOf(markup, 'ladder-answer-fx-e2');
  assert.ok(row, 'the unrun task is listed');
  assert.match(text(row), /No counted result/);
  assert.match(text(row), /No setup has a counted result/);
  assert.equal((row.match(/no result/g) || []).length, 4, 'every setup cell says no result');
  assert.doesNotMatch(row, /data-solved/, 'no setup cell carries a score');
  assert.doesNotMatch(row, /ld-mk/, 'no mark of solved or not solved');
  assert.doesNotMatch(text(row), /(^|\s)0(\s|$)/, 'no bare zero in the row text');
});

test('a task only one setup ran says so and shows that one result', () => {
  const row = rowOf(renderTasks(data.ladder, data.cases, defaultUi()), 'ladder-answer-fx-e1');
  assert.match(text(row), /One setup only/);
  assert.match(text(row), /1 of 4 setups with a counted result/);
  assert.equal((row.match(/data-solved="/g) || []).length, 1);
  assert.equal((row.match(/no result/g) || []).length, 3);
});

test('a setup with results for fewer tasks than the tier holds says so in words', () => {
  const markup = renderSetups(data.ladder);
  const row = String(markup).split('<tr ').find((chunk) => chunk.includes(`data-config="${CLEAN}"`));
  assert.match(text(row), /10 of 12/, 'tasks run');
  assert.match(text(row), /Fewer than the ladder holds/);
  assert.match(text(row), /1 of 1 mean 1\.00 · ran 1 of 3 tasks/, 'the supreme tier: one task counted of three');
  assert.match(text(row), /2 of 2 mean 1\.00/, 'a tier the setup completed has no warning');
  const full = String(markup).split('<tr ').find((chunk) => chunk.includes('deepseek-v4.1-flash-max'));
  assert.match(text(full), /9 of 12/);
});

test('a tier a setup has no result for reads "no data", not "0 of 0"', () => {
  const ladder = clone().ladder;
  ladder.configs[0].tiers['5'] = { tasks: 3, counted: 0, solved: 0, mean: null };
  const row = String(renderSetups(ladder)).split('<tr ').find((chunk) => chunk.includes(`data-config="${ladder.configs[0].config_id}"`));
  assert.match(text(row), /no data/);
  assert.doesNotMatch(text(row), /0 of 0/);
  assert.doesNotMatch(text(row), /n\/a/);
});

test('no ladder run at all: every task reads no data, with a clear empty state for the rest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-ladder-empty-'));
  try {
    fs.cpSync(FIXTURES, root, { recursive: true, filter: (source) => !source.includes(`${path.sep}results`) });
    const state = buildState(root);
    assert.equal(state.ladder.configs.length, 0);
    const page = renderPage(state, defaultUi());
    assert.equal(text(page.answer).startsWith('No stored run counts for the ladder yet. All 12 tasks have no data.'), true);
    assert.match(text(page.setups), /No setup has counted results for the ladder yet\./);
    assert.equal(text(page.pairs), 'No pair exists: no setup has results yet.');
    assert.equal(page.pairPick, '', 'no select for a pair that cannot exist');
    assert.equal((page.tasks.match(/<tr data-case=/g) || []).length, 12);
    assert.equal((page.tasks.match(/class="ld-info" data-info="no-data"/g) || []).length, 12);
    assert.doesNotMatch(page.tasks, /data-solved/);
    assert.match(page.tasksNote, /^All 12 tasks$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a root with no ladder and a failed load each give one clear empty state', () => {
  const none = { ladder: { suites: [], tiers: [], configs: [], information: {}, pairs: [], versions: [], warnings: [], problems: [] }, cases: {} };
  assert.match(text(renderEmpty(none)), /^No ladder in this lab/);
  assert.equal(renderPage(none).answer, '');
  assert.equal(renderPage(none).tasks, '');
  assert.match(text(renderEmpty(null, 'HTTP 500')), /^The ladder did not load HTTP 500\./);
  assert.equal(renderEmpty(data), '', 'a ladder with tasks needs no empty page');
  const failed = { ...none, ladder: { ...none.ladder, error: 'configs/ladder.yaml is broken' } };
  assert.match(text(renderNotices(failed.ladder)), /The ladder report could not be built\. configs\/ladder\.yaml is broken/);
  assert.match(text(renderEmpty(failed)), /^The ladder could not be read/);
});

test('a refused suite shows why it cannot be compared and no number', () => {
  const state = clone();
  const reason = 'ladder-code@1.0.0 has counted runs with different prompt versions (js-function@1, js-function@2); scores of different prompts are not comparable. Choose the runs with --runs.';
  state.ladder.suites[1] = { id: 'ladder-code', version: '1.0.0', refused: reason, cases: [] };
  const notice = text(renderNotices(state.ladder));
  assert.ok(notice.includes(`ladder-code 1.0.0 cannot be compared. ${reason} No number from this suite is shown.`));
  const page = renderPage(state, defaultUi());
  assert.doesNotMatch(page.tasks, /ladder-code-/, 'no task of the refused suite');
  assert.match(page.meta, /12 tasks in 1 suite/);
});

test('when every suite is refused the page says so and shows no table', () => {
  const state = clone();
  const reason = 'ladder-answer@2.0.0 has counted runs scored with different quality evaluator versions (final-answer@1, final-answer@2); scores of different evaluator versions are not comparable. Choose the runs with --runs.';
  state.ladder = { suites: [{ id: 'ladder-answer', version: '2.0.0', refused: reason, cases: [] }], tiers: state.ladder.tiers, configs: [], information: { disagree: 0, 'one-config': 0, 'all-solved': 0, 'all-unsolved': 0, 'no-data': 0 }, pairs: [], versions: [], warnings: [], problems: [] };
  const page = renderPage(state, defaultUi());
  assert.match(text(page.notices), /ladder-answer 2\.0\.0 cannot be compared\./);
  assert.match(text(page.empty), /^No ladder suite can be compared right now/);
  assert.equal(page.answer, '');
  assert.equal(page.setups, '');
  assert.equal(page.tasks, '');
  assert.equal(page.pairs, '');
});

test('a leaked setup stands on its own row next to the clean one, with a notice and its own pair', () => {
  assert.deepEqual(ids(data.ladder).filter((id) => id.startsWith('claude-haiku')).sort(), [CLEAN, LEAKED].sort());
  const rows = String(renderSetups(data.ladder)).split('<tr ').filter((chunk) => chunk.startsWith('data-config="claude-haiku'));
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.includes('data-setup-state="leaked"') && text(row).includes('user setup leaked in')));
  assert.ok(rows.some((row) => row.includes('data-setup-state="kept out"') && text(row).includes('user setup kept out')));
  const notice = text(renderNotices(data.ladder));
  assert.match(notice, /1 setup loaded your own instructions although the test asked to keep them out\. Claude Haiku 4\.5 · claude-code · isolated \(leaked\)\./);
  assert.match(notice, /never mixed with a clean run of the same model/);
  const pair = data.ladder.pairs.find((item) => [item.a, item.b].includes(CLEAN) && [item.a, item.b].includes(LEAKED));
  assert.ok(pair, 'the two Haiku setups are compared as a pair, not pooled');
});

test('a partly kept out setup gets its own notice, and a clean ladder gets none', () => {
  const ladder = clone().ladder;
  ladder.configs = ladder.configs.filter((config) => config.setup_state !== 'leaked');
  const notice = text(renderNotices(ladder));
  assert.match(notice, /1 setup did not keep your own setup fully out\./);
  ladder.configs = ladder.configs.filter((config) => ['loaded', 'kept out'].includes(config.setup_state));
  assert.equal(renderNotices(ladder), '');
});

test('very long and hostile model and harness names stay inside the markup', () => {
  const state = clone();
  const evil = `Model<script>alert(1)</script>${'x'.repeat(240)} · harness-${'y'.repeat(180)}`;
  state.ladder.configs[0].label = evil;
  for (const pair of state.ladder.pairs) {
    if (pair.a === state.ladder.configs[0].config_id) pair.a_label = evil;
    if (pair.b === state.ladder.configs[0].config_id) pair.b_label = evil;
  }
  const page = renderPage(state, { ...defaultUi(), a: state.ladder.configs[0].config_id, b: state.ladder.configs[1].config_id });
  for (const block of [page.setups, page.pairs, page.tasks, page.pairCard, page.pairPick]) {
    assert.doesNotMatch(block, /<script/);
    assert.ok(block.includes('&lt;script&gt;'), 'the name is escaped where it shows');
  }
  assert.ok(page.pairCard.includes('x'.repeat(240)), 'the name is not cut in the markup; the style wraps it');
});

test('the pair card shows what only each setup solved and the p value, as the CLI prints them', () => {
  const ladder = clone().ladder;
  const [pair] = ladder.pairs;
  Object.assign(pair, { shared: 52, a_only: 5, b_only: 1, sign_p: 0.21875, mean_diff: 0.04 });
  const card = text(renderPairCard(ladder, { ...defaultUi(), a: pair.a, b: pair.b }));
  assert.ok(card.includes(`${pair.a_label} solved 5 tasks that ${pair.b_label} did not. ${pair.b_label} solved 1 that ${pair.a_label} did not.`));
  assert.ok(card.includes('They both ran 52 tasks. The runs cannot tell them apart: sign test p 0.22.'));
  assert.ok(card.includes(`Mean score gap over those tasks: +0.04 (${pair.a_label} minus ${pair.b_label})`));
  assert.ok(pairLine(pair).endsWith('52 shared, 5 and 1, p 0.22'), 'the same figures the CLI prints');
  assert.match(text(renderPairCard(ladder, { ...defaultUi(), a: pair.a, b: pair.b, split: true })), /Show only the 6 tasks that tell them apart/);
});

test('choosing the pair the other way round swaps the counts and the sign of the gap', () => {
  const ladder = clone().ladder;
  const [pair] = ladder.pairs;
  Object.assign(pair, { a_only: 5, b_only: 1, mean_diff: 0.04 });
  const turned = pairOf(ladder, pair.b, pair.a);
  assert.deepEqual([turned.a_only, turned.b_only, turned.mean_diff, turned.a_label], [1, 5, -0.04, pair.b_label]);
  assert.equal(pairOf(ladder, pair.a, 'no-such-setup'), null);
});

test('two chosen setups that share no task say the runs cannot compare them', () => {
  const ladder = clone().ladder;
  ladder.pairs = ladder.pairs.filter((pair) => !(pair.a === CLEAN && pair.b === LEAKED));
  const card = text(renderPairCard(ladder, { ...defaultUi(), a: CLEAN, b: LEAKED }));
  assert.match(card, /ran no task in common, so the runs cannot compare them\./);
});

test('one setup only: the page says that no pair exists, and shows no select or row', () => {
  const state = clone();
  state.ladder.configs = state.ladder.configs.slice(0, 1);
  state.ladder.pairs = [];
  for (const suite of state.ladder.suites) {
    for (const task of suite.cases) {
      task.per_config = task.per_config.filter((entry) => entry.config_id === state.ladder.configs[0].config_id);
      task.configs_n = task.per_config.length;
      task.information = task.per_config.length ? 'one-config' : 'no-data';
    }
  }
  state.ladder.information = { disagree: 0, 'one-config': 10, 'all-solved': 0, 'all-unsolved': 0, 'no-data': 2 };
  const page = renderPage(state, defaultUi());
  assert.match(text(page.pairs), /No pair exists: only one setup has results, so nothing can be compared\./);
  assert.match(text(page.answer), /No pair exists: only one setup has results/);
  assert.equal(page.pairPick, '');
  assert.equal(page.pairCard, '');
  assert.doesNotMatch(page.pairs, /<table/);
  assert.match(text(page.answer), /^0 of 12 tasks show a real disagreement\. 10 have only one setup\./);
});

test('sorting by what the runs show puts the disagreements first', () => {
  const sorted = visibleTasks(data.ladder, { ...defaultUi(), sort: 'info' });
  assert.deepEqual(sorted.map((task) => task.information), [
    'disagree', 'disagree', 'disagree', 'disagree', 'one-config', 'all-solved', 'all-solved', 'all-solved', 'all-unsolved', 'all-unsolved', 'no-data', 'no-data',
  ]);
  assert.deepEqual(INFORMATION, ['disagree', 'one-config', 'all-solved', 'all-unsolved', 'no-data']);
  const byTier = visibleTasks(data.ladder, defaultUi()).map((task) => task.tier);
  assert.deepEqual(byTier, [1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5]);
  const byTime = visibleTasks(data.ladder, { ...defaultUi(), sort: 'time' }).map((task) => task.human_minutes);
  assert.deepEqual(byTime, [1, 1, 5, 5, 15, 15, 15, 60, 60, 200, 200, 200]);
});

test('the kind filter keeps one kind, and a filter with no match says so', () => {
  const ladder = clone().ladder;
  const cases = ladder.suites[0].cases;
  cases.slice(0, 5).forEach((task) => { task.kind = 'code'; });
  const kept = visibleTasks(ladder, { ...defaultUi(), kind: 'code' });
  assert.equal(kept.length, 5);
  assert.ok(kept.every((task) => task.kind === 'code'));
  assert.equal(visibleTasks(ladder, { ...defaultUi(), kind: 'answer' }).length, 7);
  assert.equal(visibleTasks(ladder, { ...defaultUi(), kind: 'agent' }).length, 0);
  assert.match(text(renderTasks(ladder, {}, { ...defaultUi(), kind: 'agent' })), /No task matches these filters\. Clear the filters/);
  assert.deepEqual(selectDefs(ladder, defaultUi()).find((def) => def.id === 'sel-kind').options.map((option) => option.text), ['All kinds', 'Answer', 'Code']);
});

test('the pair switch keeps exactly the tasks only one of the two solved, as many as the server counted', () => {
  const ladder = data.ladder;
  for (const pair of ladder.pairs) {
    const kept = visibleTasks(ladder, { ...defaultUi(), a: pair.a, b: pair.b, split: true });
    assert.equal(kept.length, pair.a_only + pair.b_only, `${pair.a_label} against ${pair.b_label}`);
  }
});

test('every tier value on the page carries the word estimate', () => {
  const page = renderPage(data, { ...defaultUi(), a: CLEAN, b: LEAKED });
  const whole = [page.setups, page.tasks, page.pairs, page.tools].join('');
  const values = whole.match(/<span class="ld-tierv" data-tier="[^"]*">.*?<\/span><\/span>/g) || [];
  assert.ok(values.length >= 5 + 12, 'five tier headings and one tier value per task');
  for (const value of values) assert.match(text(value), /estimate/, value);
  const tierSelect = selectDefs(data.ladder, defaultUi()).find((def) => def.id === 'sel-tier');
  assert.deepEqual(tierSelect.options.map((option) => option.text), ['All tiers', 'Easy (estimate)', 'Medium (estimate)', 'Hard (estimate)', 'Extra-hard (estimate)', 'Supreme (estimate)']);
  assert.match(text(page.answer), /A tier is an estimate of expert time, not a measured difficulty/);
});

test('expert time and tier ranges read in words', () => {
  assert.deepEqual([minutesText(1), minutesText(6), minutesText(90), minutesText(200), minutesText(null)], ['1 min', '6 min', '1.5 h', '3.3 h', 'no estimate']);
  assert.deepEqual(data.ladder.tiers.map((tier) => rangeText(tier.minutes)), ['up to 2 min', '2 to 8 min', '8 to 30 min', '30 min to 2 h', '2 to 16 h']);
  assert.deepEqual([pText(0.21875), pText(7.45e-9), pText(1), pText(0.0049), pText(0.005)], ['0.22', '< 0.01', '1.00', '< 0.01', '0.01']);
});

test('the page shows the same numbers as node lab ladder for the same suite versions', () => {
  const report = ladderCommand(FIXTURES, { json: true, calibrate: true, log: () => {} });
  const ladder = data.ladder;
  assert.deepEqual(ladder.information, report.information);
  assert.deepEqual(ladder.configs, report.configs);
  assert.deepEqual(ladder.pairs, report.pairs);
  assert.deepEqual(allTasks(ladder).map((task) => [task.case_id, task.information, task.configs_n]), report.cases.map((task) => [task.case_id, task.information, task.configs_n]));
  const setups = text(renderSetups(ladder));
  for (const config of report.configs) {
    for (const tier of report.tiers) {
      const cell = config.tiers[tier.level];
      if (cell.counted) assert.ok(setups.includes(`${cell.solved} of ${cell.counted} mean ${cell.mean.toFixed(2)}`), `${config.label} ${tier.name}`);
    }
  }
  const pairs = text(renderPairs(ladder));
  for (const pair of report.pairs) assert.ok(pairs.includes(`${pair.shared} ${pair.a_only} ${pair.b_only} ${pText(pair.sign_p)}`), pairLine(pair));
  const tasks = renderTasks(ladder, data.cases, defaultUi());
  for (const task of report.cases) {
    const row = rowOf(tasks, task.case_id);
    assert.equal((row.match(/data-solved="/g) || []).length, task.per_config.length, task.case_id);
    assert.equal((row.match(/data-solved="1"/g) || []).length, task.per_config.filter((entry) => entry.solved).length, task.case_id);
  }
});

test('a pair row marks the pair that tells two setups apart', () => {
  const ladder = clone().ladder;
  for (const config of ladder.configs) config.setup_state = 'kept out';
  ladder.pairs[0].sign_p = 0.0001;
  const markup = renderPairs(ladder, { ...defaultUi(), a: ladder.pairs[1].a, b: ladder.pairs[1].b });
  assert.equal((markup.match(/Can tell apart/g) || []).length, 1);
  assert.equal((markup.match(/Cannot tell apart/g) || []).length, 5);
  assert.equal((markup.match(/class="is-on"/g) || []).length, 1);
  assert.ok(ALPHA === 0.05);
});

test('the basis comes from the ladder row, so a changed current case cannot replace it', () => {
  const ladder = clone().ladder;
  const task = allTasks(ladder).find((item) => item.case_id === 'ladder-answer-fx-a1');
  assert.equal(task.basis, data.cases['ladder-answer-fx-a1'].metadata.tier.basis, 'the server copies the basis of the selected version');
  task.basis = 'Timed solve: about a minute.';
  const cases = structuredClone(data.cases);
  cases['ladder-answer-fx-a1'].metadata.tier.basis = 'A newer basis of the current suite.';
  const row = text(rowOf(renderTasks(ladder, cases, defaultUi()), 'ladder-answer-fx-a1'));
  assert.match(row, /Basis: Timed solve: about a minute\./);
  assert.doesNotMatch(row, /A newer basis/);
  task.basis = null;
  assert.doesNotMatch(text(rowOf(renderTasks(ladder, cases, defaultUi()), 'ladder-answer-fx-a1')), /Basis:/);
});

test('the two setup selects work one after the other', () => {
  assert.deepEqual(cleanUi({ ...defaultUi(), a: CLEAN }, data.ladder), { ...defaultUi(), a: CLEAN });
  assert.deepEqual(cleanUi({ ...defaultUi(), b: LEAKED }, data.ladder), { ...defaultUi(), b: LEAKED });
  assert.deepEqual(cleanUi({ ...defaultUi(), a: CLEAN, b: LEAKED }, data.ladder), { ...defaultUi(), a: CLEAN, b: LEAKED });
});

test('a split filter on a pair with nothing to split is dropped, so it cannot hide every task', () => {
  const ladder = clone().ladder;
  const pair = ladder.pairs.find((item) => (item.a === CLEAN && item.b === LEAKED) || (item.a === LEAKED && item.b === CLEAN));
  Object.assign(pair, { a_only: 0, b_only: 0 });
  assert.equal(cleanUi({ ...defaultUi(), a: CLEAN, b: LEAKED, split: true }, ladder).split, false);
});

test('a failed refresh says the numbers are from the last load and offers a retry', () => {
  const page = renderPage(data, defaultUi(), 'HTTP 500');
  assert.match(text(page.notices), /The page could not refresh \(HTTP 500\)\. The numbers below are from the last load and may be out of date\. Try again/);
  assert.match(page.notices, /data-act="reload"/);
  assert.doesNotMatch(renderPage(data, defaultUi()).notices, /could not refresh/);
});

test('runs of a refused suite are not called runs of other versions', () => {
  const state = clone();
  state.ladder.versions = [{ suite: 'ladder-code', version: '2.0.0', refused: 'mixed prompts', runs: 0, left_out_runs: 2 }, { suite: 'ladder-agent', version: '1.0.0', runs: 3, left_out_runs: 1 }];
  const evidence = text(renderPage(state).evidence);
  assert.match(evidence, /Left out: 1 counted run of other versions\. Not shown: 2 counted runs of suites that cannot be compared\./);
});

test('a flagged task lists each check with the numbers the server gave', () => {
  const row = rowOf(renderTasks(data.ladder, data.cases, defaultUi()), 'ladder-answer-fx-c3');
  assert.match(text(row), /Check this task \(3\)/);
  const flag = data.ladder.suites[0].cases.find((task) => task.case_id === 'ladder-answer-fx-c3').flags[0];
  assert.ok(text(row).includes(`which scores higher on the ${flag.shared_tasks} other shared tasks (${flag.failed_by_mean.toFixed(2)} against ${flag.solved_by_mean.toFixed(2)})`));
});

test('the link keeps the filters, drops what the loaded data lacks, and round-trips', () => {
  const ui = { ...defaultUi(), kind: 'answer', tier: '3', info: 'disagree', sort: 'info', a: CLEAN, b: LEAKED, split: true };
  assert.equal(hashFor(ui), `#kind=answer&tier=3&info=disagree&sort=info&a=${CLEAN}&b=${LEAKED}&split=1`);
  assert.deepEqual(parseHash(hashFor(ui)), ui);
  assert.equal(hashFor(defaultUi()), '');
  const stale = cleanUi({ ...defaultUi(), kind: 'code', tier: '9', info: 'maybe', sort: 'luck', a: 'gone', b: LEAKED, split: true }, data.ladder);
  assert.deepEqual(stale, { ...defaultUi(), b: LEAKED }, 'a setup that is gone drops, the valid one stays');
  assert.deepEqual(cleanUi({ ...defaultUi(), a: CLEAN, b: CLEAN }, data.ladder), { ...defaultUi(), a: CLEAN }, 'one setup against itself is no pair');
});

test('ladder.html and ladder.js are served, the state has the ladder, and the shell links the page', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-ladder-server-'));
  fs.cpSync(FIXTURES, root, { recursive: true });
  const server = createServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const get = (url) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: url, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    }).on('error', reject);
  });
  try {
    const page = await get('/ladder.html');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.body, /<title>Ladder · Model Lab<\/title>/);
    assert.match(page.body, /<script type="module" src="\/ladder\.js">/);
    assert.equal((await get('/ladder.js')).status, 200);
    assert.equal((await get('/ladder.css')).status, 200);
    const state = JSON.parse((await get('/api/state')).body);
    assert.deepEqual(renderPage(state, defaultUi()).answer, renderPage(data, defaultUi()).answer, 'the page renders the same from the served state');
    assert.equal(headline(state.ladder).say, '4 of 12 tasks show a real disagreement. 1 has only one setup.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
  const shell = fs.readFileSync(fileURLToPath(new URL('../dashboard/public/shell.js', import.meta.url)), 'utf8');
  const entries = shell.match(/^\s+\['[a-z]+', '[A-Za-z]+', '[^']+', '[a-z]+'\],$/gm) || [];
  assert.equal(entries.length, 5, 'Home, Run, Results, Ladder, Lab');
  assert.ok(entries.some((entry) => entry.includes("'/ladder.html'")));
});
