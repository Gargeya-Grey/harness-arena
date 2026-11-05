// Starts a harness only when the process watch holds it. During a guarded call the runner
// spawns this launcher with a fixed environment and a private IPC channel, puts it in the
// call's Job Object (lab/lib/procwatch.mjs), and only then sends the spawn spec
// { command, args, env } on that channel. So no harness code, and no code an environment
// variable would load, runs before the job holds the launcher. The harness gets its full
// environment from the spec and only stdin, stdout and stderr: it cannot reach the
// channel, so it cannot fake the launcher's report. No shell is involved.

import { spawn } from 'node:child_process';

let child = null;

// The runner ends the launcher on a timeout; outside Windows it ends the harness too.
process.on('SIGTERM', () => {
  child?.kill('SIGKILL');
  process.exit(143);
});

process.once('message', (spec) => {
  child = spawn(spec.command, spec.args, { stdio: 'inherit', windowsHide: true, env: spec.env });
  child.on('error', (error) => {
    process.send({ spawn_error: error.message }, () => process.exit(127));
  });
  // A harness that never started has no pid: its error above is the report.
  child.on('exit', (code, signal) => {
    if (child.pid) process.exit(code ?? (signal ? 1 : 0));
  });
});

process.on('disconnect', () => {
  if (!child) process.exit(126);
});
