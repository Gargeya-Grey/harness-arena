// npm test: every tests/*.test.mjs file in one parallel pass, except the heavy ladder
// proofs (ladder-answer, ladder-code-*, ladder-agent-*), which run after it two files at
// a time. The heavy proofs saturate the CPU for minutes; run beside the wall-clock
// tests (process watch, jobs, the js-function sandbox's 2 s limit) they made those flaky.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HEAVY = /^ladder-(answer|code-|agent-)/;
const files = fs.readdirSync(HERE).filter((name) => name.endsWith('.test.mjs')).sort();
const heavy = files.filter((name) => HEAVY.test(name));
const main = files.filter((name) => !HEAVY.test(name));

const run = (names, extra) => spawnSync(process.execPath, ['--test', ...extra, ...names.map((name) => path.join('tests', name))], { stdio: 'inherit', cwd: path.join(HERE, '..') }).status;

const first = run(main, []);
const second = run(heavy, ['--test-concurrency=2']);
process.exit(first || second ? 1 : 0);
