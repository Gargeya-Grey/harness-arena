import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, RegexSyntaxError } from '../src/index.mjs';

test('a literal is found at its leftmost place', () => {
  assert.deepEqual(compile('cat').exec('hot cat, cool cat'), { start: 4, end: 7, spans: [[4, 7]] });
  assert.equal(compile('cat').exec('dog'), null);
  assert.deepEqual(compile('cat').exec('hot cat, cool cat', 5), { start: 14, end: 17, spans: [[14, 17]] });
});

test('classes, escapes and counted repeats', () => {
  const re = compile('[a-c]+\\d{2,3}');
  assert.deepEqual(re.exec('xx abc1234 y').spans, [[3, 9]]);
  assert.equal(compile('\\w+\\s\\w+').exec('one two').end, 7);
});

test('greedy and lazy repeats', () => {
  assert.equal(compile('<.+>').exec('<a><b>').end, 6);
  assert.equal(compile('<.+?>').exec('<a><b>').end, 3);
});

test('groups report their spans, and groups that took no part are null', () => {
  const re = compile('(a)|(b)(c)?');
  assert.deepEqual(re.exec('bd').spans, [[0, 1], null, [0, 1], null]);
  assert.equal(re.groupCount, 3);
});

test('alternation takes the first branch that leads to a match', () => {
  assert.deepEqual(compile('a|ab').exec('abc').spans, [[0, 1]]);
});

test('named groups', () => {
  const re = compile('(?<h>\\d+):(?<m>\\d+)');
  assert.deepEqual(re.names, { h: 1, m: 2 });
  assert.deepEqual(re.exec('at 09:45').spans, [[3, 8], [3, 5], [6, 8]]);
});

test('anchors and flags', () => {
  assert.equal(compile('^b').exec('a\nb'), null);
  assert.equal(compile('^b', 'm').exec('a\nb').start, 2);
  assert.equal(compile('HELLO', 'i').exec('say hello').start, 4);
});

test('syntax errors carry a code', () => {
  assert.throws(() => compile('(a'), (error) => error instanceof RegexSyntaxError && error.code === 'unterminated-group');
  assert.throws(() => compile('*a'), (error) => error.code === 'nothing-to-repeat');
});

test('matchAll and replace', () => {
  assert.deepEqual(compile('o').matchAll('foo boo').map((m) => m.start), [1, 2, 5, 6]);
  assert.equal(compile('(\\w)(\\d)').replace('a1 b2', '$2$1', true), '1a 2b');
});
