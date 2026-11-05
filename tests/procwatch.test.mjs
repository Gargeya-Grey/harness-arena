// The process watch on Windows: a Job Object holds every process a harness starts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../lab/adapters/process.mjs';
import { startProcessWatch } from '../lab/lib/procwatch.mjs';

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
