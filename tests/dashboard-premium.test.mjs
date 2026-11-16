import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildState } from '../lab/lib/state.mjs';
import { allTasks, defaultUi, hashFor, headline, parseHash, renderPage, renderTasks, selectDefs, visibleTasks } from '../dashboard/public/ladder.js';

const data = buildState(fileURLToPath(new URL('./fixtures/repo/', import.meta.url)));
const ladder = data.ladder;
const plain = html => String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('task search finds names, exact ids and estimation basis while intersecting other filters', () => {
  const query = { ...defaultUi(), q: 'fx-b' };
  const matches = visibleTasks(ladder, query);
  assert(matches.length > 0);
  assert(matches.every(task => task.case_id.includes('fx-b')));
  assert.deepEqual(visibleTasks(ladder, { ...query, info: 'disagree' }), matches.filter(task => task.information === 'disagree'));
  const first = allTasks(ladder)[0];
  assert(visibleTasks(ladder, { ...defaultUi(), q: first.case_id }).some(task => task.case_id === first.case_id));
  assert(visibleTasks(ladder, { ...defaultUi(), q: 'label measurement' }).length > 0);
});

test('task search survives shared links and escapes markup in the labelled input', () => {
  const ui = { ...defaultUi(), q: 'Fx b1 & <one>', kind: 'answer' };
  assert.equal(parseHash(hashFor(ui)).q, ui.q);
  const page = renderPage(data, { ...ui, q: '\"><img src=x onerror=alert(1)>' });
  assert(page.tools.includes('&lt;img'));
  assert(!page.tools.includes('<img'));
  assert.match(page.tools, /label for="ld-search"/);
  assert.match(page.tasks, /No task matches these filters/);
});

test('default task evidence explicitly retains every no-counted-result task in a named closed disclosure', () => {
  const html = renderTasks(ladder, data.cases, defaultUi());
  const pending = allTasks(ladder).filter(task => task.information === 'no-data');
  assert(pending.length > 0);
  assert.match(html, /<details class="ld-no-counted" id="ld-no-counted">/);
  assert.match(html, /No counted result/);
  assert.match(html, /Attempts may be absent, unfinished or excluded/);
  for (const task of allTasks(ladder)) assert(html.includes(`data-case="${task.case_id}"`));
  for (const task of pending) assert(html.indexOf(`data-case="${task.case_id}"`) > html.indexOf('id="ld-no-counted"'));
});

test('explicit no-result and search filters reveal matching rows directly', () => {
  const missing = renderTasks(ladder, data.cases, { ...defaultUi(), info: 'no-data' });
  assert(!missing.includes('id="ld-no-counted"'));
  const task = allTasks(ladder).find(task => task.information === 'no-data');
  const found = renderTasks(ladder, data.cases, { ...defaultUi(), q: task.case_id });
  assert(found.includes(`data-case="${task.case_id}"`));
  assert(!found.includes('id="ld-no-counted"'));
});

test('compact task rows retain kind, estimated time, task flags and accessible table identity', () => {
  const html = renderTasks(ladder, data.cases, defaultUi());
  assert.match(html, /class="ld-kind">Answer task/);
  assert.match(html, /estimate:/);
  assert.match(html, /<summary class="disclose">Task details<\/summary>/);
  assert.match(html, /<caption class="sr">Tasks with counted results/);
  assert.match(html, /scope="row"/);
});

test('row filtering leaves headline statistics and input evidence unchanged, with honest coverage nearby', () => {
  const before = structuredClone(data);
  const page = renderPage(data, { ...defaultUi(), q: 'there is no matching task' });
  assert.match(plain(page.tasks), /No task matches/);
  assert.equal(page.answer, renderPage(data).answer);
  assert.deepEqual(headline(ladder), headline(before.ladder));
  assert.deepEqual(data, before);
  assert.match(plain(page.coverage), /10 of 12 tasks have counted results/);
  assert.match(plain(page.coverage), /2 have no counted result/);
  assert.match(plain(page.coverage), /Suite versions:/);
});

test('pair slot order does not reuse global setup letters', () => {
  const defs = selectDefs(ladder, defaultUi());
  assert.equal(defs.find(def => def.id === 'sel-a').label, 'First setup');
  assert.equal(defs.find(def => def.id === 'sel-b').label, 'Second setup');
  assert.match(defs.find(def => def.id === 'sel-a').options[1].text, /^A /);
});
