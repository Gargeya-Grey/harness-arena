// Starts a harness only when the process watch holds it. During a guarded call the runner
// spawns this launcher, puts it in the call's Job Object (lab/lib/procwatch.mjs), and only
// then writes the first line of stdin: JSON { command, args }. The launcher starts the
// harness from it, so the harness is created inside the job: no harness code runs before
// the job holds it. The rest of stdin goes to the harness; its output and exit code come
// back unchanged. No shell is involved.

import { spawn } from 'node:child_process';

let head = Buffer.alloc(0);
let child = null;

// The runner ends the launcher on a timeout; outside Windows it ends the harness too.
process.on('SIGTERM', () => {
  child?.kill('SIGKILL');
  process.exit(143);
});

function start(spec, rest) {
  // The launcher runs without NODE_OPTIONS (lab/adapters/process.mjs); the harness gets it back.
  const env = spec.node_options == null ? process.env : { ...process.env, NODE_OPTIONS: spec.node_options };
  child = spawn(spec.command, spec.args, { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true, env });
  child.on('error', (error) => {
    // LAUNCH_FAILED and LAUNCH_FAILED_CODE in lab/adapters/process.mjs.
    process.stderr.write(`lab-launcher spawn_error: ${error.message}\n`);
    process.exit(127);
  });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.stdin.on('error', () => {});
  if (rest.length) child.stdin.write(rest);
  process.stdin.on('data', (chunk) => child.stdin.write(chunk));
  process.stdin.on('end', () => child.stdin.end());
}

const onData = (chunk) => {
  head = Buffer.concat([head, chunk]);
  const end = head.indexOf(0x0a);
  if (end < 0) return;
  process.stdin.off('data', onData);
  let spec;
  try {
    spec = JSON.parse(head.subarray(0, end).toString('utf8'));
  } catch {
    process.exit(126);
  }
  start(spec, head.subarray(end + 1));
};
process.stdin.on('data', onData);
process.stdin.on('end', () => {
  if (!child) process.exit(126);
});
