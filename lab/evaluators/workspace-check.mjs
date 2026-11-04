// Runs the probes of a hidden check against an agent's rebuilt workspace. The
// evaluator starts this file in its own Node process under the permission model:
// it may read only this file and the rebuilt workspace, and cannot write files,
// start processes, use workers or load addons.
//
// Input on stdin: { nonce, workspace, probe }. `probe` is a file inside the
// workspace that exports `probes`: [{ name, run({ load }) }]. `load(rel)` imports
// a module of the workspace. Each probe returns a value; this process reports the
// value as JSON and never judges it. The expected values stay in the parent
// process, so agent code that runs here cannot see them, and a changed global
// (JSON, Promise, toJSON) can only spoil its own values, never make a pass.
// Output: one line {"nonce":…,"results":[{"name":…,"json":…} or {"name":…,"error":…}]}.
// The evaluator trusts only the line that carries its nonce.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Captured before any workspace code runs.
const write = process.stdout.write.bind(process.stdout);
const stringify = JSON.stringify;
const toString = String;
const exit = process.exit.bind(process);
const setTimer = setTimeout;
const clearTimer = clearTimeout;
const PROBE_TIMEOUT_MS = 5000;

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const { nonce, workspace, probe } = JSON.parse(input);
input = '';

// JSON.stringify of a string primitive never calls a toJSON hook.
const str = (value) => stringify(toString(value));
const parts = [];
let error = null;
try {
  const inside = (rel) => {
    const file = path.resolve(workspace, ...String(rel).split('/'));
    if (file !== workspace && !file.startsWith(workspace + path.sep)) throw new Error(`path outside the workspace: ${rel}`);
    return file;
  };
  let loads = 0;
  const load = (rel) => import(`${pathToFileURL(inside(rel)).href}?load=${(loads += 1)}`);
  const { probes } = await import(pathToFileURL(path.join(workspace, probe)).href);
  for (const item of probes) {
    const name = String(item.name);
    let timer;
    try {
      const value = await new Promise((resolve, reject) => {
        timer = setTimer(() => reject(new Error(`timed out after ${PROBE_TIMEOUT_MS / 1000} s`)), PROBE_TIMEOUT_MS);
        Promise.resolve()
          .then(() => item.run({ load }))
          .then(resolve, reject);
      });
      const json = value === undefined ? 'null' : stringify(value);
      parts.push(`{"name":${str(name)},"json":${str(json)}}`);
    } catch (failure) {
      parts.push(`{"name":${str(name)},"error":${str(String(failure?.message ?? failure).slice(0, 300))}}`);
    } finally {
      clearTimer(timer);
    }
  }
} catch (failure) {
  error = `check failed to load: ${String(failure?.message ?? failure).slice(0, 300)}`;
}
write(`\n{"nonce":${str(nonce)},${error ? `"error":${str(error)},` : ''}"results":[${parts.join(',')}]}\n`);
exit(0);
