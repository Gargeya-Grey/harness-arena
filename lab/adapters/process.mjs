// Spawns harness CLIs without a shell, so prompts with quotes, newlines or
// percent signs reach the harness byte for byte on every platform. On Windows
// an npm `.cmd` shim is resolved to the script it wraps and run with node.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cache = new Map();
const LAUNCHER = fileURLToPath(new URL('./launcher.mjs', import.meta.url));
// What lab/adapters/launcher.mjs prints, with this exit code, when it cannot start the harness.
export const LAUNCH_FAILED = 'lab-launcher spawn_error:';
export const LAUNCH_FAILED_CODE = 127;

// The process watch (lab/lib/procwatch.mjs) puts every harness process in a Job Object
// during a guarded call. A watcher returns a promise; the prompt is sent only once every
// watcher has the process, and a process a watcher cannot hold is ended.
const spawnWatchers = new Set();
export function watchSpawns(watcher) {
  spawnWatchers.add(watcher);
  return () => spawnWatchers.delete(watcher);
}

export function resolveCommand(name) {
  if (cache.has(name)) return cache.get(name);
  let found = null;
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  if (process.platform === 'win32') {
    for (const dir of dirs) {
      const exe = path.join(dir, `${name}.exe`);
      if (fs.existsSync(exe)) {
        found = { command: exe, prefix: [] };
        break;
      }
      const shim = path.join(dir, `${name}.cmd`);
      if (fs.existsSync(shim)) {
        const text = fs.readFileSync(shim, 'utf8');
        const script = /"%dp0%\\([^"]+\.(?:m?js|cjs))"/i.exec(text);
        if (script) {
          found = { command: process.execPath, prefix: [path.join(dir, script[1])] };
          break;
        }
        // A shim around a native binary (OpenCode 2.x). npm shims also name node.exe; skip it.
        const binary = [...text.matchAll(/"%dp0%\\([^"]+\.exe)"/gi)].map((m) => m[1]).find((file) => !/(^|\\)node\.exe$/i.test(file));
        if (binary) {
          found = { command: path.join(dir, binary), prefix: [] };
          break;
        }
      }
    }
  } else {
    for (const dir of dirs) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) {
        found = { command: file, prefix: [] };
        break;
      }
    }
  }
  cache.set(name, found);
  return found;
}

/**
 * Run a command to completion. Never rejects: spawn failures and timeouts come
 * back as `error`. `onLine` sees each stdout line as it arrives.
 */
export function runProcess(name, args, { cwd, input, timeoutMs = 300000, env, onLine } = {}) {
  const resolved = resolveCommand(name);
  const started = Date.now();
  if (!resolved) {
    return Promise.resolve({ code: null, stdout: '', stderr: '', ms: 0, error: { type: 'not_installed', message: `"${name}" was not found on PATH` } });
  }
  // During a guarded call the harness starts through the launcher, which waits until the
  // process watch holds it (lab/adapters/launcher.mjs).
  const gated = spawnWatchers.size > 0;
  const fullEnv = { ...process.env, ...env, ...(cwd ? { PWD: path.resolve(cwd), INIT_CWD: path.resolve(cwd) } : {}) };
  // NODE_OPTIONS could preload code into the launcher before the job holds it: the
  // launcher runs without it and gives it back to the harness.
  const optionKey = Object.keys(fullEnv).find((key) => key.toUpperCase() === 'NODE_OPTIONS');
  const launcherEnv = { ...fullEnv };
  if (optionKey) delete launcherEnv[optionKey];
  const spec = { command: resolved.command, args: [...resolved.prefix, ...args], ...(optionKey ? { node_options: fullEnv[optionKey] } : {}) };
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let pending = '';
    let settled = false;
    const child = spawn(gated ? process.execPath : spec.command, gated ? [LAUNCHER] : spec.args, {
      cwd,
      // spawn sets the real working folder but not PWD, and some CLIs (OpenCode on
      // Windows) start their tools from PWD. Point it at cwd so the agent starts there.
      env: gated ? launcherEnv : fullEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ms: Date.now() - started, ...result });
    };
    const timer = setTimeout(() => {
      // Through the launcher the harness is a child of the launcher: end the whole tree.
      if (gated && process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else child.kill();
      finish({ code: null, error: { type: 'timeout', message: `${name} did not exit within ${Math.round(timeoutMs / 1000)} s` } });
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!onLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      lines.forEach((line) => line.trim() && onLine(line));
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish({ code: null, error: { type: 'spawn_error', message: error.message } }));
    child.on('close', (code) => {
      if (onLine && pending.trim()) onLine(pending);
      const failed = gated && code === LAUNCH_FAILED_CODE ? stderr.split('\n').find((line) => line.startsWith(LAUNCH_FAILED)) : null;
      finish({ code, error: failed ? { type: 'spawn_error', message: failed.slice(LAUNCH_FAILED.length).trim() } : null });
    });
    child.stdin.on('error', () => {});
    if (!gated) {
      child.stdin.end(input ?? '');
      return;
    }
    const holds = !child.pid ? [Promise.reject(new Error('the launcher did not start'))] : [...spawnWatchers].map((watcher) => Promise.resolve().then(() => watcher(child.pid)));
    Promise.all(holds).then(
      () => {
        child.stdin.write(`${JSON.stringify(spec)}\n`);
        child.stdin.end(input ?? '');
      },
      (error) => {
        child.kill('SIGKILL');
        finish({ code: null, error: { type: 'process_watch', message: error.message } });
      },
    );
  });
}

/** Parse JSON lines, skipping anything that is not JSON (banners, warnings). */
export function jsonLines(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Not an event line.
    }
  }
  return events;
}

/** The last JSON object in a text blob, for CLIs that print one result object. */
export function lastJsonObject(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    if (start < 0) return null;
    try {
      return JSON.parse(trimmed.slice(start));
    } catch {
      return null;
    }
  }
}

export async function cliVersion(name, args = ['--version']) {
  const result = await runProcess(name, args, { timeoutMs: 30000 });
  if (result.error || result.code !== 0) return null;
  const match = /\d+\.\d+\.\d+[\w.-]*/.exec(`${result.stdout}\n${result.stderr}`);
  return match ? match[0] : null;
}

/** CLI harnesses take one prompt string. A system message is prepended. */
export function flattenMessages(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const turns = messages.filter((m) => m.role !== 'system');
  if (turns.length !== 1 || turns[0].role !== 'user') {
    throw new Error('CLI harnesses accept exactly one user message (plus optional system text)');
  }
  return {
    prompt: [...system, turns[0].content].join('\n\n'),
    system: system.length ? system.join('\n\n') : null,
    user: turns[0].content,
  };
}

export function stderrTail(stderr, lines = 6) {
  return String(stderr || '').trim().split(/\r?\n/).slice(-lines).join('\n');
}

// The first stderr line that names an error, or null. A stack trace ends in
// noise (`}`), so the tail alone hides the cause.
export function stderrError(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((line) => line.trim());
  const line = lines.find((item) => /^(error|fatal)\b|error:/i.test(item) && !/^at\s/.test(item));
  if (!line) return null;
  const auth = /auth|login|log in|sign in|credential|ineligible|unauthori[sz]ed|forbidden|api key/i.test(line);
  return { type: auth ? 'auth' : 'harness_error', message: line.slice(0, 500) };
}
