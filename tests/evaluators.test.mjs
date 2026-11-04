// final-answer@1 and js-function@1, called the way scoreRun calls them. The
// js-function tests run real sandboxed Node processes, including escape attempts.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractCodeBlocks, extractFinalAnswer, getEvaluator, parseNumber } from '../lab/evaluators/index.mjs';

const finalAnswer = getEvaluator('final-answer', '1');
const jsFunction = getEvaluator('js-function', '1');
const reply = (text) => ({ response: { text } });
const FENCE = '```';
const js = (code) => `${FENCE}js\n${code}\n${FENCE}`;

test('extractFinalAnswer: the last Answer line wins; without one, the last line', () => {
  assert.deepEqual(extractFinalAnswer('Answer: 3\nWait, recheck.\nAnswer: 4'), { answer: '4', marker: true });
  assert.deepEqual(extractFinalAnswer('**Final answer:** Friday'), { answer: 'Friday', marker: true });
  assert.deepEqual(extractFinalAnswer('**Answer**: Friday\nHope this helps.'), { answer: 'Friday', marker: true });
  assert.deepEqual(extractFinalAnswer('I think\n\n47\n'), { answer: '47', marker: false });
  assert.deepEqual(extractFinalAnswer(''), { answer: '', marker: false });
});

test('parseNumber: first number after a marker, last number in a bare sentence, simple fractions', () => {
  assert.equal(parseNumber('7.5 degrees'), 7.5);
  assert.equal(parseNumber('15/2'), 7.5);
  assert.equal(parseNumber('-3'), -3);
  assert.equal(parseNumber('2,500'), 2500);
  assert.equal(parseNumber('12,3456'), 12, 'a comma that is not a thousands separator ends the number');
  assert.equal(parseNumber('300 km / 150 km/h = 2 hours', { last: true }), 2);
  assert.equal(parseNumber('none'), null);
});

test('final-answer: numbers compare as numbers, words after normalising', () => {
  const score = (text, expected) => finalAnswer.score({ raw: reply(text), testCase: { expected } });
  assert.equal(score('Work...\nAnswer: 7.5', 7.5).passed, true);
  assert.equal(score('Answer: 7.50 degrees', 7.5).passed, true);
  assert.equal(score('Answer: 15/2', 7.5).passed, true);
  assert.equal(score('Answer: 2,500', 2500).passed, true);
  assert.equal(score('Answer: 5 cents', 5).passed, true);
  assert.equal(score('300 km at 150 km/h takes 2 hours', 2).passed, true, 'no marker: the last number counts');
  assert.equal(score('Answer: 10', 5).passed, false);
  assert.equal(score('Answer: ten', 10).passed, false, 'a number answer must be written as digits');
  assert.equal(score('Answer: friday.', 'Friday').passed, true);
  assert.equal(score('**Answer**: Friday\nHope this helps.', 'Friday').passed, true);
  assert.equal(score('Answer: Thursday', 'Friday').passed, false);
  assert.equal(score('Answer: No', 'no').value, 1);
  assert.equal(finalAnswer.score({ raw: reply('x'), testCase: {} }), null, 'no expected answer: not scored');
});

test('extractCodeBlocks: every js block in order, else the last block, else the whole reply', () => {
  assert.deepEqual(extractCodeBlocks(`a\n${js('function f(){}')}\n${FENCE}text\nnote\n${FENCE}\n${js('f()')}`), ['function f(){}\n', 'f()\n']);
  assert.deepEqual(extractCodeBlocks(`${FENCE}python\nx=1\n${FENCE}`), ['x=1\n']);
  assert.deepEqual(extractCodeBlocks('function f(){}'), ['function f(){}']);
});

const primes = {
  input: { name: 'primesUpTo' },
  expected: { tests: [{ args: [10], returns: [2, 3, 5, 7] }, { args: [1], returns: [] }, { args: [2], returns: [2] }] },
};
const SIEVE = 'const out = []; for (let i = 2; i <= n; i++) if (out.every((p) => i % p)) out.push(i); return out;';
const run = (text, testCase = primes) => jsFunction.score({ raw: reply(text), testCase });

test('js-function: correct code passes in every common form', () => {
  const forms = [
    `export function primesUpTo(n) { ${SIEVE} }`,
    `const primesUpTo = (n) => { ${SIEVE} };`,
    `function primesUpTo(n) { ${SIEVE} }\nmodule.exports = { primesUpTo };`,
    `function primesUpTo(n) { ${SIEVE} }\nexport { primesUpTo };`,
    `export default function primesUpTo(n) { ${SIEVE} }`,
    `module.exports = function (n) { ${SIEVE} };`,
  ];
  for (const code of forms) assert.equal(run(js(code)).passed, true, code.slice(-40));
  const withExample = run(`${js(`function primesUpTo(n) { ${SIEVE} }`)}\nExample:\n${js('console.log(primesUpTo(10));')}`);
  assert.equal(withExample.passed, true, 'a usage example after the function does not hide it');
});

test('js-function: partial credit, missing function, syntax error', () => {
  const partial = run(js('function primesUpTo(n) { return [2, 3, 5, 7]; }'));
  assert.equal(partial.value, 0.3333);
  assert.equal(partial.passed, false);
  assert.equal(run(js('function other() {}')).details.error, 'no function named primesUpTo');
  assert.match(run(js('function primesUpTo( {')).details.error, /^load failed/);
  assert.equal(jsFunction.score({ raw: reply('x'), testCase: { input: {}, expected: {} } }), null, 'a case without tests is not scored');
});

test('js-function sandbox: endless loops and hostile getters fail their test, nothing hangs', () => {
  const looping = run(js('function primesUpTo(n) { while (true) {} }'));
  assert.equal(looping.value, 0);
  assert.match(looping.details.results[0].error, /timed out/);
  const getter = run(js('function primesUpTo(n) { return { get x() { while (true) {} } }; }'));
  assert.equal(getter.value, 0);
  assert.match(getter.details.results[0].error, /timed out/);
});

const ESCAPE = (body) => js(`function primesUpTo(n) {\n  const proc = this.constructor.constructor('return process')();\n  ${body}\n  return [];\n}`);

test('js-function sandbox: escaped code cannot write files, start processes or read secrets', (t) => {
  const marker = path.join(os.tmpdir(), `lab-sandbox-escape-${process.pid}.txt`).replace(/\\/g, '/');
  t.after(() => fs.rmSync(marker, { force: true }));
  const write = run(ESCAPE(`proc.mainModule.require('fs').writeFileSync('${marker}', 'x');`));
  assert.equal(fs.existsSync(marker), false, 'no file was written');
  assert.match(write.details.results[0].error, /restricted|permission/i);
  const spawn = run(ESCAPE("proc.mainModule.require('child_process').execSync('echo hi');"));
  assert.match(spawn.details.results[0].error, /restricted|permission/i);
  process.env.LAB_TEST_SECRET_TOKEN = 'do-not-leak';
  t.after(() => delete process.env.LAB_TEST_SECRET_TOKEN);
  const env = run(ESCAPE("if (proc.env.LAB_TEST_SECRET_TOKEN) throw new Error('env leaked');"));
  assert.equal(env.details.results[0].error, undefined, 'no parent variable reaches the sandbox');
});

test('js-function sandbox: a forged result line never counts and never breaks scoring', () => {
  const forged = JSON.stringify({ loaded: true, results: Array.from({ length: 50 }, () => ({ ok: true, actual_json: '[2,3,5,7]' })) });
  const fake = run(ESCAPE(`proc.stdout.write('\\n' + ${JSON.stringify(forged)} + '\\n'); proc.exit(0);`));
  assert.equal(fake.value, 0, 'the forged line has no nonce');
  assert.match(fake.details.error, /no result/);
  const nullLine = run(ESCAPE("proc.stdout.write('\\nnull\\n'); proc.exit(0);"));
  assert.equal(nullLine.value, 0);
  assert.ok(nullLine.value >= 0 && nullLine.value <= 1);
});
