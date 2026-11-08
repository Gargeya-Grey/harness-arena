// The process watch on Windows: a Job Object holds every process a harness starts.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../lab/adapters/process.mjs';
import { fork, spawn, spawnSync } from 'node:child_process';
import { escapedChildren, jobWatch, startProcessWatch, treeWatch } from '../lab/lib/procwatch.mjs';

const windowsOnly = { skip: process.platform !== 'win32' && 'Job Objects are Windows only' };

const sleeper = 'setTimeout(() => {}, 60000)';
// A harness that detaches a long sleeper, prints its pid, and exits.
const detach = `const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(sleeper)}], { detached: true, stdio: 'ignore' }); console.log(c.pid); c.unref();`;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('a harness process and the children it detaches are ended with the job', windowsOnly, async () => {
  const watch = await startProcessWatch();
  const result = await runProcess('node', ['-e', detach], { timeoutMs: 30000 });
  const pid = Number(result.stdout.trim());
  assert.ok(pid > 0, result.stderr);
  const report = await watch.finish();
  assert.equal(report.error, null);
  assert.deepEqual(report.survivors, []);
  assert.ok(report.ended.some((item) => item.endsWith(`:${pid}`)), JSON.stringify(report));
  assert.equal(alive(pid), false);
});

test('an agent that ends the watch is caught, and the job still ends its processes', windowsOnly, async () => {
  const watch = await startProcessWatch();
  // The harness ends every PowerShell the runner started (the watch's helper among them).
  const query = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid} and Name='powershell.exe'" | ForEach-Object { $_.ProcessId }`;
  const killer = [
    detach,
    "const { execFileSync } = require('child_process');",
    `const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ${JSON.stringify(query)}], { encoding: 'utf8' });`,
    'for (const id of out.split(/\\s+/).filter(Boolean)) { try { process.kill(Number(id)); } catch {} }',
    'setTimeout(() => {}, 10000);',
  ].join('\n');
  const result = await runProcess('node', ['-e', killer], { timeoutMs: 30000 });
  const pid = Number(result.stdout.trim().split(/\s+/)[0]);
  const report = await watch.finish();
  assert.match(report.error || '', /process watch/, JSON.stringify(report));
  // KILL_ON_JOB_CLOSE: the helper's job handle closed, so the job's processes ended,
  // the harness itself (long before its 10 s timer; Windows reports exit code 0) and the
  // child it detached.
  assert.ok(result.ms < 8000, `the harness ran ${result.ms} ms`);
  assert.ok(pid > 0, result.stdout);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(alive(pid), false);
});

test('outside a guarded call no job holds a spawned process', windowsOnly, async () => {
  const result = await runProcess('node', ['-e', detach], { timeoutMs: 30000 });
  const pid = Number(result.stdout.trim());
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(alive(pid), true);
  process.kill(pid);
});

test('a job assignment that fails after the call ended is still reported by finish', windowsOnly, async () => {
  const gone = Number(spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim());
  const watch = await jobWatch();
  // Not awaited: finish() must wait for it.
  watch.assign(gone).catch(() => {});
  const report = await watch.finish();
  assert.match(report.error || '', /could not be put in the job/, JSON.stringify(report));
});

test('during a guarded call the harness gets its stdin and its exit code through the launcher', windowsOnly, async () => {
  const watch = await startProcessWatch();
  const echo = "let s = ''; process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => { process.stdout.write(s); process.exit(3); });";
  const result = await runProcess('node', ['-e', echo], { input: 'hello\nworld', timeoutMs: 30000 });
  const report = await watch.finish();
  assert.equal(report.error, null);
  assert.equal(result.error, null);
  assert.equal(result.stdout, 'hello\nworld');
  assert.equal(result.code, 3);
});

test('a process older than the new process only shares a reused id, so it is not its child', () => {
  assert.deepEqual(escapedChildren('children 1000 git.exe:34400:999'), []);
  assert.deepEqual(escapedChildren('children 1000 a.exe:1:1000,b.exe:2:1001,git.exe:3:5'), ['a.exe:1', 'b.exe:2']);
  assert.deepEqual(escapedChildren('children 637000000000000001 c.exe:9:637000000000000000'), []);
  assert.deepEqual(escapedChildren('children 637000000000000001 c.exe:9:637000000000000001'), ['c.exe:9']);
});

test('when the start of the new process is not known, every child counts', () => {
  assert.deepEqual(escapedChildren('children 0 git.exe:34400:999'), ['git.exe:34400']);
});

test('a child the process started before the job held it halts the call', windowsOnly, async (t) => {
  const starter = `const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(sleeper)}], { stdio: 'ignore' }); console.log(c.pid); ${sleeper}`;
  const parent = spawn(process.execPath, ['-e', starter], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let childPid = 0;
  t.after(() => {
    for (const pid of [childPid, parent.pid]) {
      try {
        if (pid) process.kill(pid);
      } catch {
        // Already gone.
      }
    }
  });
  childPid = await new Promise((resolve) => parent.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim()))));
  const watch = await jobWatch();
  await assert.rejects(watch.assign(parent.pid), new RegExp(`before the job held it \\(node\\.exe:${childPid}\\)`));
  assert.match((await watch.finish()).error, new RegExp(`node\\.exe:${childPid}`));
});

test('a timeout during a guarded call ends the harness, not only the launcher', windowsOnly, async () => {
  const watch = await startProcessWatch();
  const result = await runProcess('node', ['-e', 'console.log(process.pid); setTimeout(() => {}, 60000);'], { timeoutMs: 2000 });
  const pid = Number(result.stdout.trim());
  await new Promise((resolve) => setTimeout(resolve, 500));
  const before = alive(pid);
  await watch.finish();
  assert.equal(result.error?.type, 'timeout');
  assert.ok(pid > 0, result.stdout);
  assert.equal(before, false, 'the harness ended with the timeout, before the watch finished');
});

test('during a guarded call NODE_OPTIONS, in any spelling, reaches the harness but not the launcher', windowsOnly, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-preload-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'loads.txt');
  const preload = path.join(dir, 'preload.cjs');
  fs.writeFileSync(preload, `require('fs').appendFileSync(${JSON.stringify(log)}, (process.argv[1] ? require('path').basename(process.argv[1]) : 'harness') + '\\n');`);
  const watch = await startProcessWatch();
  const option = `--require "${preload.replaceAll('\\', '/')}"`;
  const result = await runProcess('node', ['-e', 'process.exit(0)'], { timeoutMs: 30000, env: { NODE_OPTIONS: option, node_options: option } });
  await watch.finish();
  assert.equal(result.error, null, result.stderr);
  assert.ok(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).every((line) => line === 'harness'), fs.readFileSync(log, 'utf8'));
});

test('the launcher reports a harness it cannot start on its private channel', async () => {
  const launcher = fileURLToPath(new URL('../lab/adapters/launcher.mjs', import.meta.url));
  const child = fork(launcher, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const messages = [];
  child.on('message', (message) => messages.push(message));
  child.send({ command: path.join(os.tmpdir(), 'lab-no-such-harness.exe'), args: [], env: {} });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 127);
  assert.equal(messages.length, 1);
  assert.equal(typeof messages[0].spawn_error, 'string');
});

test('a harness cannot fake the launcher report: its own exit 127 and stderr stay its own', windowsOnly, async () => {
  const watch = await startProcessWatch();
  const fake = "process.stderr.write('lab-launcher spawn_error: not found\\n'); process.exit(127);";
  const result = await runProcess('node', ['-e', fake], { timeoutMs: 30000 });
  await watch.finish();
  assert.equal(result.error, null);
  assert.equal(result.code, 127);
  assert.match(result.stderr, /spawn_error: not found/);
});

test('the ps watch never counts its own ps processes, and still finds a process left running', async () => {
  // Fake pids far above any real one: a kill of them only fails.
  const rootPid = 2147480000;
  let n = 0;
  let left = false;
  const lister = async (spawned) => {
    n += 1;
    const ps = 2147481000 + n * 4;
    spawned(ps);
    const rows = [{ pid: ps, ppid: rootPid, key: `${ps}|t`, name: 'ps' }];
    if (left) rows.push({ pid: 2147482000, ppid: rootPid, key: '2147482000|t', name: 'left' });
    return rows;
  };
  const watch = await treeWatch({ intervalMs: 60000, settleMs: 1, rootPid, lister });
  left = true;
  const report = await watch.finish();
  assert.equal(report.error, null);
  assert.deepEqual(report.survivors, ['left:2147482000']);
});
