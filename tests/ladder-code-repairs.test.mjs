import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildCases } from '../datasets/ladder-code/generate.mjs';
import { getEvaluator } from '../lab/evaluators/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const solutions = path.join(root, 'tests/fixtures/ladder-code-solutions');
const cases = await buildCases();
const source = (folder, slug) => fs.readFileSync(path.join(solutions, folder, `ladder-code-${slug}.mjs`), 'utf8');
const invoke = (folder, slug, name, args) => {
  const context = vm.createContext({ args: JSON.stringify(args) });
  return JSON.parse(vm.runInContext(`${source(folder, slug)}\nJSON.stringify(${name}(...JSON.parse(args)))`, context, { timeout: 1500 }));
};
const scoreMutant = (slug, from, to) => {
  const original = source('supreme-b', slug);
  assert(original.includes(from));
  const mutant = original.replace(from, to);
  const testCase = cases.find(value => value.case_id === `ladder-code-${slug}`);
  return getEvaluator('js-function', '2').score({ raw: { response: { text: `\x60\x60\x60js\n${mutant}\n\x60\x60\x60` } }, testCase }).value;
};

test('palindrome retains Unicode letters and decimal digits and compares code points', () => {
  assert.equal(invoke('core', 'palindrome', 'isPalindrome', ['éa']), false);
  assert.equal(invoke('core', 'palindrome', 'isPalindrome', ['É,é']), true);
  assert.equal(invoke('core', 'palindrome', 'isPalindrome', ['٣a']), false);
  assert.equal(invoke('core', 'palindrome', 'isPalindrome', ['𐐀a']), false);
});

test('palindrome hidden tests distinguish code points and Decimal_Number from all numbers', () => {
  const item = cases.find(value => value.case_id === 'ladder-code-palindrome');
  for (const variant of ['function isPalindrome(s){const t=s.toLowerCase().replace(/[^\\p{L}\\p{Nd}]/gu,"");return t===t.split("").reverse().join("");}', 'function isPalindrome(s){const t=[...s.toLowerCase()].filter(c=>/[\\p{L}\\p{N}]/u.test(c));return t.join("")===t.reverse().join("");}']) {
    const result = getEvaluator('js-function', '3').score({ raw: { response: { text: variant } }, testCase: item });
    assert.equal(result.passed, false, JSON.stringify(result));
  }
});

test('LCS explicitly uses UTF-16 units and tests a supplementary character', () => {
  const current = cases.find(value => value.case_id === 'ladder-code-lcs');
  assert.match(current.input.task, /UTF-16/);
  assert.equal(invoke('core', 'lcs', 'lcsLength', ['😀', '😀']), 2);
  assert(current.expected.tests.some(value => value.args[0] === '😀' && value.returns === 2));
});

test('bipartite generator pins the advanced first draw with a complete tiny trace', () => {
  const current = cases.find(value => value.case_id === 'ladder-code-bipartite-timeline');
  assert.match(current.input.task, /Each draw returns the new x/);
  assert.match(current.input.task, /48282/);
  assert.match(current.input.task, /419638497/);
  assert.equal(invoke('extra-hard-b', 'bipartite-timeline', 'bipartiteTimeline', [2, 2, 1]), 3);
  assert.equal(invoke('extra-hard-b', 'bipartite-timeline', 'bipartiteTimeline', [10, 400, 17]), 56629);
  assert(current.expected.tests.some(value => JSON.stringify(value.args) === '[2,2,1]' && value.returns === 3));
});

test('league special-name teams terminate and deduction/card maps use only own names', () => {
  const rules = { win: 3, draw: 1, goals: 3, bonus: 0 };
  assert.deepEqual(invoke('extra-hard-b', 'league-standings', 'standings', [rules, ['__proto__'], []]), [['__proto__', 0, 0, 0, 0]]);
  assert.deepEqual(invoke('extra-hard-b', 'league-standings', 'standings', [rules, ['__proto__', 'constructor', 'toString'], [['match', 'm', '__proto__', 'constructor', 2, 0], ['deduct', '__proto__', 1], ['card', 'constructor', 2], ['deduct', 'valueOf', 100]]]), [['__proto__', 1, 2, 2, 2], ['toString', 0, 0, 0, 0], ['constructor', 1, 0, -2, 0]]);
});

test('Cairn hidden checks reject whitespace normalization outside its action grammar', () => {
  assert(scoreMutant('cairn-rules', "const tokens = text.split(' ');", "const tokens = text.trim().split(/\\s+/);") < 1);
});

test('Tabula explicit same-name aliases are removed while unaliased picks retain them', () => {
  const blocks = ['@t\nx:int\n1'];
  assert.deepEqual(invoke('supreme-b', 'tabula-query', 'runTabula', [blocks, 'from t | pick x as x | derive y = t.x']), { error: 'unknown-column' });
  assert.deepEqual(invoke('supreme-b', 'tabula-query', 'runTabula', [blocks, 'from t | pick x | derive y = t.x']), { columns: ['x', 'y'], rows: [[1, 1]] });
});

test('Tabula distinct and grouping keep different text tuples despite embedded separators', () => {
  const block = '@t\nx:text|y:text\n"a\u0001text:b"|"c"\n"a"|"b\u0001text:c"';
  const rows = [['a\u0001text:b', 'c'], ['a', 'b\u0001text:c']];
  assert.deepEqual(invoke('supreme-b', 'tabula-query', 'runTabula', [[block], 'from t | distinct']), { columns: ['x', 'y'], rows });
  assert.deepEqual(invoke('supreme-b', 'tabula-query', 'runTabula', [[block], 'from t | group x, y : n = count()']), { columns: ['x', 'y', 'n'], rows: rows.map(row => [...row, 1]) });
});

test('Tabula completes syntax and name checks before numeric value errors', () => {
  const blocks = ['@t\nx:int\n1'];
  assert.deepEqual(invoke('supreme-b', 'tabula-query', 'runTabula', [blocks, 'from t | derive y = 9007199254740992 +']), { error: 'syntax' });
  assert.deepEqual(invoke('supreme-b', 'tabula-query', 'runTabula', [blocks, 'from t | derive y = 9007199254740992']), { error: 'overflow' });
  assert.deepEqual(invoke('supreme-b', 'tabula-query', 'runTabula', [blocks, 'from t | derive y = iif(yes, 1, 9007199254740992)']), { columns: ['x', 'y'], rows: [[1, 1]] });
  assert.deepEqual(invoke('supreme-b', 'tabula-query', 'runTabula', [blocks, 'from t | derive y = constructor()']), { error: 'unknown-function' });
});

test('Tabula hidden checks reject classifying every overflow as syntax', () => {
  assert(scoreMutant('tabula-query', 'throw new Fail(code);', "throw new Fail(code === 'overflow' ? 'syntax' : code);") < 1);
});

test('Tessen slides beyond 1000 contiguous blockers until there is no overlap', () => {
  const events = Array.from({ length: 1001 }, (_, i) => ({ id: `b${i}`, zone: 'u', start: `3.1.1 ${Math.floor(i / 60)}:${i % 60}`, duration: 1, priority: 1, rule: { freq: 'day', count: 1 } }));
  events.push({ id: 'slider', zone: 'u', start: '3.1.1 0:0', duration: 1, priority: 0, onClash: 'slide', rule: { freq: 'day', count: 1 } });
  const result = invoke('supreme-b', 'tessen-calendar', 'tessenSchedule', [{ zones: { u: { offset: 0 } }, view: 'u', from: '3.1.1 0:0', to: '3.1.2 0:0', events }]);
  assert.deepEqual(result.filter(row => row.includes('slider')), ['0003.01.01 16:41 sol slider moved']);
});

test('Tessen hidden checks reject treating leap years as ordinary years', () => {
  assert(scoreMutant('tessen-calendar', 'return (year % 5 === 0 && year % 100 !== 0) || year % 500 === 0;', 'return false;') < 1);
});

test('all repaired case references pass the complete hidden checks', () => {
  const folders = { palindrome: 'core', lcs: 'core', 'bipartite-timeline': 'extra-hard-b', 'league-standings': 'extra-hard-b', 'cairn-rules': 'supreme-b', 'tabula-query': 'supreme-b', 'tessen-calendar': 'supreme-b' };
  for (const [slug, folder] of Object.entries(folders)) {
    const testCase = cases.find(value => value.case_id === `ladder-code-${slug}`);
    const score = getEvaluator('js-function', '2').score({ raw: { response: { text: `\x60\x60\x60js\n${source(folder, slug)}\n\x60\x60\x60` } }, testCase });
    assert.equal(score.value, 1, `${slug}: ${JSON.stringify(score.details)}`);
  }
});
