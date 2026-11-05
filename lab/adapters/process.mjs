// Spawns harness CLIs without a shell, so prompts with quotes, newlines or
// percent signs reach the harness byte for byte on every platform. On Windows
// an npm `.cmd` shim is resolved to the script it wraps and run with node.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cache = new Map();

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
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let pending = '';
    let settled = false;
    const child = spawn(resolved.command, [...resolved.prefix, ...args], {
      cwd,
      // spawn sets the real working folder but not PWD, and some CLIs (OpenCode on
      // Windows) start their tools from PWD. Point it at cwd so the agent starts there.
      env: { ...process.env, ...env, ...(cwd ? { PWD: path.resolve(cwd), INIT_CWD: path.resolve(cwd) } : {}) },
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
      child.kill();
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
      finish({ code, error: null });
    });
    child.stdin.on('error', () => {});
    const holds = !child.pid ? [] : [...spawnWatchers].map((watcher) => Promise.resolve().then(() => watcher(child.pid)));
    if (!holds.length) {
      child.stdin.end(input ?? '');
      return;
    }
    Promise.all(holds).then(
      () => child.stdin.end(input ?? ''),
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
