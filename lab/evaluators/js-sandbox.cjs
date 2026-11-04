// Runs one model-written JavaScript function against test cases. The evaluator
// starts this file in its own Node process under the permission model: no file
// writes, no reads outside this file, no child processes, no workers, no addons.
// Input on stdin: { nonce, sources: [code block, ...], name, tests: [{ args }] }.
// Output: one line `{ nonce, loaded, error?, results: [{ actual?, error? }] }`.
// The evaluator trusts only the line that carries its nonce, and it compares the
// results with the expected values itself: code that escapes the vm context can
// reach `process`, but it never sees the nonce, which lives only in this closure.
'use strict';

const vm = require('node:vm');

const TEST_TIMEOUT_MS = 2000;
const MAX_ACTUAL_CHARS = 4000;
const write = process.stdout.write.bind(process.stdout);

function clean(source) {
  return String(source)
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+[A-Za-z_$][\w$]*\s*;?\s*$/gm, '')
    .replace(/^(\s*)export\s+(default\s+)?(?=(async\s+)?(function|const|let|var|class)\b)/gm, '$1');
}

// A fresh context per test, so state or memory from one test never reaches the next.
function load(sources, name) {
  const module = { exports: {} };
  const context = vm.createContext({ console: { log() {}, error() {}, warn() {}, info() {} }, module, exports: module.exports });
  const errors = [];
  for (const source of sources) {
    try {
      vm.runInContext(clean(source), context, { timeout: TEST_TIMEOUT_MS });
    } catch (error) {
      errors.push(String(error && error.message).slice(0, 300));
    }
  }
  let fn;
  try {
    fn = vm.runInContext(
      `typeof ${name} === 'function' ? ${name} : typeof module.exports === 'function' ? module.exports : module.exports && typeof module.exports.${name} === 'function' ? module.exports.${name} : undefined`,
      context,
      { timeout: TEST_TIMEOUT_MS },
    );
  } catch {
    fn = undefined;
  }
  return { context, fn: typeof fn === 'function' ? fn : null, errors };
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const { nonce, sources, name, tests } = JSON.parse(input);
  input = '';
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    write(`\n${JSON.stringify({ nonce, loaded: false, error: 'bad function name', results: [] })}\n`);
    return;
  }
  const first = load(sources, name);
  const out = { nonce, loaded: Boolean(first.fn), results: [] };
  if (!first.fn) {
    out.error = first.errors.length ? `load failed: ${first.errors[0]}` : `no function named ${name}`;
  } else {
    for (const test of tests) {
      const { context, fn } = test === tests[0] ? first : load(sources, name);
      context.__fn = fn;
      context.__args = JSON.stringify(test.args);
      try {
        // Serialise inside the time limit: a hostile getter cannot hang the process.
        const text = vm.runInContext('JSON.stringify(__fn(...JSON.parse(__args)))', context, { timeout: TEST_TIMEOUT_MS });
        out.results.push(text === undefined ? { actual: null, undefined: true } : { actual_json: String(text).slice(0, MAX_ACTUAL_CHARS * 4) });
      } catch (error) {
        out.results.push({ error: String(error && error.message).slice(0, 200) });
      }
    }
  }
  write(`\n${JSON.stringify(out)}\n`);
});
