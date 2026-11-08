#!/usr/bin/env node
// Prints the path of a disposable data root for verification: a copy of
// tests/fixtures/repo plus this repository's experiments (archive included), model registry and ladder table.
// Usage: ROOT=$(node .agents/skills/verify-model-lab/scripts/temp-root.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-model-lab-'));
fs.cpSync(path.join(repo, 'tests', 'fixtures', 'repo'), root, { recursive: true });
fs.cpSync(path.join(repo, 'experiments'), path.join(root, 'experiments'), { recursive: true });
// Suites and prompts the fixtures do not have; existing fixture files are kept.
for (const dir of ['datasets', 'prompts']) fs.cpSync(path.join(repo, dir), path.join(root, dir), { recursive: true, force: false });
// The difficulty ladder's tier table, which node lab ladder needs.
fs.copyFileSync(path.join(repo, 'configs', 'ladder.yaml'), path.join(root, 'configs', 'ladder.yaml'));
// The fixture registry lacks the real models; append the real entries it does not have.
const fixtureRegistry = fs.readFileSync(path.join(root, 'configs', 'models.yaml'), 'utf8');
const realRegistry = fs.readFileSync(path.join(repo, 'configs', 'models.yaml'), 'utf8');
const keyOf = (block) => /^ {2}([a-z0-9.-]+):/.exec(block)?.[1];
const have = new Set([...fixtureRegistry.matchAll(/^ {2}([a-z0-9.-]+):$/gm)].map((match) => match[1]));
const blocks = realRegistry
  .split(/\n(?= {2}[a-z0-9.-]+:\n)/)
  .slice(1)
  .filter((block) => keyOf(block) && !have.has(keyOf(block)));
fs.writeFileSync(path.join(root, 'configs', 'models.yaml'), `${fixtureRegistry.trimEnd()}\n\n${blocks.join('\n').trimEnd()}\n`);
console.log(root.split(path.sep).join('/'));
