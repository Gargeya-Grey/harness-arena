import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DRIVER = fileURLToPath(new URL('./workspace-test-driver.mjs', import.meta.url));
const identifier = value => typeof value === 'string' && /^[A-Za-z_$][\w$]*$/.test(value);
const PERMISSION_FLAG = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
const SANDBOX_FLAGS = [PERMISSION_FLAG, '--no-addons', ...(process.allowedNodeEnvironmentFlags.has('--no-experimental-sqlite') ? ['--no-experimental-sqlite'] : [])];

export function runExecutableTests({ workspace, rule }) {
  const fail = error => ({ ok: false, error });
  if (!rule || !Array.isArray(rule.files) || rule.files.length < 1 || rule.files.length > 32 || !Number.isInteger(rule.minimum_tests) || rule.minimum_tests < 1) return fail('invalid executable-test rule');
  if (!Array.isArray(rule.required_calls) || rule.required_calls.length < 1 || rule.required_calls.length > 16) return fail('invalid required-call rule');
  const root = fs.realpathSync(workspace);
  const inside = relative => {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..') || /[:\0]/.test(relative)) throw new Error('test paths must stay inside the workspace');
    const file = fs.realpathSync(path.join(root, relative));
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error('test paths must name workspace files');
    return file;
  };
  try {
    rule.files.forEach(inside);
    for (const required of rule.required_calls) {
      inside(required.module);
      inside(required.test_file);
      if (!rule.files.includes(required.test_file)) return fail('required calls must belong to an allowlisted test file');
      if (!identifier(required.export) || !identifier(required.method) || required.instance !== true) return fail('required calls must name an exported constructor and instance method');
    }
  } catch (error) {
    return fail(error.message);
  }
  const nonce = crypto.randomUUID();
  const bridge = crypto.randomUUID();
  const env = process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT } : {};
  const child = spawnSync(process.execPath, [...SANDBOX_FLAGS, `--allow-fs-read=${root}`, `--allow-fs-read=${DRIVER}`, '--max-old-space-size=256', DRIVER], {
    input: JSON.stringify({ nonce, bridge, workspace: root, rule }),
    cwd: root,
    encoding: 'utf8',
    env,
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  let result;
  let definiteFailure = false;
  for (const line of String(child.stdout ?? '').split('\n')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.nonce === nonce) {
        if (parsed.event === 'definite-test-failure') definiteFailure = true;
        if (parsed.result) result = parsed.result;
      }
    } catch {}
  }
  const known = definiteFailure ? { definite_failure: true } : {};
  if (child.error) return { ok: false, unjudged: true, ...known, error: child.error.code === 'ETIMEDOUT' ? 'executable tests stopped by the operational wall-clock backstop' : child.error.message };
  if (!result || typeof result.ok !== 'boolean') return { ok: false, unjudged: true, ...known, error: 'executable test driver ended without a trusted result' };
  return { ...result, ...known };
}
