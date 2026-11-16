// Isolation through a temp home. No live calls: a small Node script plays the CLI
// and reports what it can see. A fake home holds fake sign-in and config files; the
// real home of the person running the tests is never read.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineCli } from '../lab/adapters/cli.mjs';
import { ADAPTERS } from '../lab/adapters/index.mjs';
import { jsonLines } from '../lab/adapters/process.mjs';
import { describeEnv, missingSignIn, runInTempHome, scrubTempHome } from '../lab/lib/temphome.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-iso-test-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// The fake CLI. argv: <mode>. It prints one JSON result line with what it saw.
// It lists files only when CODEX_HOME is set (an isolated call), so a non-isolated
// call never walks the real home.
const script = path.join(scratch, 'fake-cli.mjs');
fs.writeFileSync(
  script,
  `
import fs from 'node:fs';
import path from 'node:path';
const mode = process.argv[2];
const home = process.env.USERPROFILE;
const list = (dir, base = dir) => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? list(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).replace(/\\\\/g, '/')]);
const auth = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'auth.json');
if (mode === 'refresh') fs.writeFileSync(auth, JSON.stringify({ token: 'refreshed' }));
if (mode === 'corrupt') fs.writeFileSync(auth, '{ not json');
if (mode === 'race') { fs.writeFileSync(auth, JSON.stringify({ token: 'refreshed' })); fs.writeFileSync(process.env.REAL_AUTH, JSON.stringify({ token: 'other-process' })); }
if (mode === 'fail') { console.error('Error: could not open ' + home + path.sep + 'x'); process.exit(3); }
console.log(JSON.stringify({ type: 'result', text: 'ok', files: process.env.CODEX_HOME ? list(home) : [], env: { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CODEX_HOME: process.env.CODEX_HOME || null } }));
`,
);

const AUTH = '.codex/auth.json';
const messages = [{ role: 'user', content: 'q' }];

function fakeHome(extra = {}) {
  const home = fs.mkdtempSync(path.join(scratch, 'home-'));
  const files = {
    [AUTH]: JSON.stringify({ token: 'original' }),
    '.codex/config.toml': 'model = "x"',
    '.codex/AGENTS.md': 'global instructions',
    '.codex/skills/one/SKILL.md': 'skill',
    '.gemini/settings.json': '{"mcpServers":{}}',
    '.gemini/GEMINI.md': 'gemini instructions',
    '.gemini/oauth_creds.json': '{"access_token":"a"}',
    ...extra,
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), text);
  }
  return home;
}

// An adapter built like the real ones: a spec with isolation.home.
function fakeAdapter({ files = [AUTH], writeBack, seen = {}, parseOverride } = {}) {
  return defineCli({
    name: 'fake',
    bin: 'node',
    supportsEffort: false,
    isolation: {
      note: 'Fake.',
      home: { files, writeBack, env: (home) => ({ CODEX_HOME: path.join(home, '.codex') }) },
    },
    args: (ctx) => {
      seen.calls = (seen.calls || 0) + 1;
      seen.tempHome = ctx.tempHome;
      return [script, ctx.prompt];
    },
    parse({ stdout, stderr, code }) {
      if (parseOverride) return parseOverride();
      const result = jsonLines(stdout).find((event) => event.type === 'result');
      const error = result ? null : { type: 'no_result', message: stderr.trim() || `exit ${code}` };
      return {
        text: result?.text ?? null,
        usage: { input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null },
        tool_calls: 0,
        skills_used: [],
        events: result ? [result] : [],
        error,
        extra: { seen: result ?? null },
      };
    },
  });
}

const call = (adapter, prompt, homeDir, extra = {}) => adapter.call({ model: 'm', messages: [{ role: 'user', content: prompt }], cwd: scratch, timeoutMs: 30000, isolated: true, homeDir, ...extra });
const tempFolders = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('lab-home-'));

test('the temp home holds only the listed sign-in files', async () => {
  const home = fakeHome();
  const seen = {};
  const result = await call(fakeAdapter({ seen }), 'ok', home);
  assert.equal(result.error, null);
  assert.deepEqual(result.extra.seen.files, [AUTH]);
  // The fake home really had config, instructions, skills and MCP settings to copy.
  assert.ok(fs.existsSync(path.join(home, '.codex', 'config.toml')));
  assert.ok(fs.existsSync(path.join(home, '.gemini', 'GEMINI.md')));
});

test('the temp home is deleted after a success, a failed call and a throwing adapter', async () => {
  const home = fakeHome();
  const before = tempFolders();
  const okSeen = {};
  const ok = await call(fakeAdapter({ seen: okSeen }), 'ok', home);
  assert.equal(ok.error, null);
  assert.ok(okSeen.tempHome, 'the call used a temp home');
  assert.equal(fs.existsSync(okSeen.tempHome), false);
  assert.equal(ok.extra.temp_home.removed, true);

  const failSeen = {};
  const failed = await call(fakeAdapter({ seen: failSeen }), 'fail', home);
  assert.ok(failed.error);
  assert.equal(fs.existsSync(failSeen.tempHome), false);
  assert.equal(failed.extra.temp_home.removed, true);

  const throwSeen = {};
  const bad = fakeAdapter({ seen: throwSeen, parseOverride: () => { throw new Error('parser blew up'); } });
  await assert.rejects(call(bad, 'ok', home), /parser blew up/);
  assert.ok(throwSeen.tempHome);
  assert.equal(fs.existsSync(throwSeen.tempHome), false);
  assert.deepEqual(tempFolders(), before);
});

test('the temp home is deleted when the call times out', async () => {
  const home = fakeHome();
  const seen = {};
  const slow = path.join(scratch, 'slow.mjs');
  fs.writeFileSync(slow, 'setTimeout(() => {}, 60000);');
  const adapter = defineCli({
    name: 'slow',
    bin: 'node',
    supportsEffort: false,
    isolation: { note: 'Fake.', home: { files: [AUTH], env: (h) => ({ CODEX_HOME: path.join(h, '.codex') }) } },
    args: (ctx) => {
      seen.tempHome = ctx.tempHome;
      return [slow];
    },
    parse: () => ({ text: null, usage: {}, events: [], error: { type: 'no_result', message: 'none' } }),
  });
  const result = await call(adapter, 'x', home, { timeoutMs: 700 });
  assert.equal(result.error.type, 'timeout');
  assert.equal(fs.existsSync(seen.tempHome), false);
});

test('a missing sign-in file is an auth error and the real home is never used', async () => {
  const home = fakeHome();
  fs.rmSync(path.join(home, AUTH));
  const seen = {};
  const before = tempFolders();
  const result = await call(fakeAdapter({ seen }), 'ok', home);
  assert.equal(result.error.type, 'auth');
  assert.match(result.error.message, /\.codex\/auth\.json/);
  assert.equal(seen.calls, undefined, 'the CLI did not start');
  assert.deepEqual(tempFolders(), before, 'no temp home was made');
  assert.equal(result.error.message.includes(home), false, 'the message holds no real path');
  assert.deepEqual(missingSignIn([AUTH, '.gemini/oauth_creds.json'], home), [AUTH]);
});

test('the process env points at the temp home, never at the real home', async () => {
  const home = fakeHome();
  const result = await call(fakeAdapter(), 'ok', home);
  const { env } = result.extra.seen;
  const forms = (value) => [value, value.replace(/\\/g, '/')];
  for (const key of ['HOME', 'USERPROFILE', 'CODEX_HOME']) {
    assert.ok(env[key], `${key} is set`);
    assert.ok(env[key].includes('lab-home-'), `${key} points into a temp home`);
    for (const form of forms(home)) assert.equal(env[key].includes(form), false, `${key} is not the real home`);
  }
  assert.equal(env.CODEX_HOME, path.join(env.HOME, '.codex'));
});

test('a call that is not isolated uses no temp home and changes no env', async () => {
  const home = fakeHome();
  const before = tempFolders();
  const result = await call(fakeAdapter(), 'ok', home, { isolated: false });
  assert.equal(result.error, null);
  assert.equal(result.extra.temp_home, undefined);
  assert.equal(result.extra.seen.env.CODEX_HOME, null);
  assert.deepEqual(tempFolders(), before);
});

test('records show how isolation is done without a real path or file content', async () => {
  const home = fakeHome({ '.gemini/oauth_creds.json': '{"access_token":"SECRET-CONTENT"}' });
  for (const name of ['codex', 'gemini-cli', 'opencode']) {
    const { isolation } = ADAPTERS[name];
    assert.ok(isolation.args.length > 0, `${name}: run.mjs needs a non-empty isolation.args to turn isolation on`);
    const record = JSON.stringify(isolation);
    if (name === 'codex' && process.platform === 'win32') assert.match(record, /global AGENTS/i);
    else assert.match(record, /<temp home>/);
    for (const secret of [os.homedir(), os.homedir().replace(/\\/g, '/'), os.tmpdir(), home, 'SECRET-CONTENT', 'original']) {
      assert.equal(record.includes(secret), false, `${name}: record holds ${secret}`);
    }
  }
  if (process.platform === 'win32') {
    assert.equal(ADAPTERS.codex.isolation.home,null,'the installed Windows sandbox home is retained');
    assert.ok(ADAPTERS.codex.isolation.args.includes('--ignore-user-config'));
    assert.ok(ADAPTERS.codex.isolation.args.includes('features.memories=false'));
  } else assert.ok(ADAPTERS.codex.isolation.args.includes('CODEX_HOME=<temp home>/.codex'));
  assert.ok(ADAPTERS['gemini-cli'].isolation.args.includes('GEMINI_CLI_HOME=<temp home>'));
  assert.ok(ADAPTERS.opencode.isolation.args.some((arg) => arg.startsWith('XDG_DATA_HOME=<temp home>/')));
  // The env record never goes on the command line.
  if (process.platform === 'win32') assert.ok(ADAPTERS.codex.isolation.flags.includes('--ignore-user-config'));
  else assert.deepEqual(ADAPTERS.codex.isolation.flags, []);
  assert.deepEqual(ADAPTERS['claude-code'].isolation.flags, ['--setting-sources', 'project,local', '--strict-mcp-config', '--disable-slash-commands']);
  assert.deepEqual(ADAPTERS['claude-code'].isolation.args, [...ADAPTERS['claude-code'].isolation.flags, 'CLAUDE_CODE_DISABLE_CLAUDE_MDS=1', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=1']);

  // A failing call puts the temp path in stderr; the returned error and stderr hold a label instead.
  const failed = await call(fakeAdapter(), 'fail', home);
  assert.match(failed.error.message, /<temp home>/);
  assert.equal(failed.error.message.includes('lab-home-'), false);
  assert.deepEqual(failed.extra.temp_home.written_back, []);
  assert.equal(scrubTempHome('a C:\\x\\h\\y and C:/x/h/y', 'C:\\x\\h'), 'a <temp home>\\y and <temp home>/y');
  assert.deepEqual(describeEnv((h) => ({ A: `${h}\\b` })), ['A=<temp home>/b']);
});

test('real adapters list sign-in files only, never config or instructions', () => {
  // OpenCode 2.x keeps its sign-in in database rows (the store), not in a file.
  const allowed = new Set(['.codex/auth.json', '.gemini/oauth_creds.json']);
  for (const name of ['codex', 'gemini-cli', 'opencode']) {
    if (name === 'codex' && process.platform === 'win32') { assert.equal(ADAPTERS[name].isolation.home,null); continue; }
    const { files, store } = ADAPTERS[name].isolation.home;
    assert.ok(files.length > 0 || store, `${name} has a sign-in source`);
    for (const file of files) {
      assert.ok(allowed.has(file), `${name} copies ${file}`);
      assert.doesNotMatch(file, /config|settings|AGENTS|GEMINI\.md|skills|opencode\.json|plugins/i);
    }
  }
  // The env record always names HOME and USERPROFILE, so no real home folder is visible.
  for (const name of ['codex', 'gemini-cli', 'opencode']) {
    if (name === 'codex' && process.platform === 'win32') continue;
    const record = ADAPTERS[name].isolation.args;
    assert.ok(record.includes('HOME=<temp home>') && record.includes('USERPROFILE=<temp home>'), name);
  }
});

test('token write-back: a changed valid file goes back, an invalid one does not', async () => {
  const read = (home) => fs.readFileSync(path.join(home, AUTH), 'utf8');

  const refreshed = fakeHome();
  const a = await call(fakeAdapter(), 'refresh', refreshed);
  assert.deepEqual(a.extra.temp_home.written_back, [AUTH]);
  assert.equal(JSON.parse(read(refreshed)).token, 'refreshed');
  assert.deepEqual(fs.readdirSync(path.join(refreshed, '.codex')).filter((n) => n.endsWith('.tmp')), [], 'no staging file is left');

  const corrupt = fakeHome();
  const b = await call(fakeAdapter(), 'corrupt', corrupt);
  assert.deepEqual(b.extra.temp_home.written_back, []);
  assert.match(b.extra.temp_home.kept[0], /not valid JSON/);
  assert.equal(JSON.parse(read(corrupt)).token, 'original');

  const untouched = fakeHome();
  const c = await call(fakeAdapter(), 'ok', untouched);
  assert.deepEqual(c.extra.temp_home.written_back, []);
  assert.deepEqual(c.extra.temp_home.kept, []);

  const off = fakeHome();
  const d = await call(fakeAdapter({ writeBack: false }), 'refresh', off);
  assert.deepEqual(d.extra.temp_home.written_back, []);
  assert.equal(JSON.parse(read(off)).token, 'original');

  // The real file changed while the call ran (another process refreshed it): keep that one.
  const raced = fakeHome();
  process.env.REAL_AUTH = path.join(raced, AUTH);
  const e = await call(fakeAdapter(), 'race', raced);
  delete process.env.REAL_AUTH;
  assert.deepEqual(e.extra.temp_home.written_back, []);
  assert.match(e.extra.temp_home.kept[0], /real file changed/);
  assert.equal(JSON.parse(read(raced)).token, 'other-process');
});

test('runInTempHome deletes the folder when the function throws and reports a missing file as auth', async () => {
  const home = fakeHome();
  let dir;
  await assert.rejects(
    runInTempHome({ files: [AUTH], homeDir: home }, (made) => {
      dir = made;
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(fs.existsSync(dir), false);
  const none = await runInTempHome({ files: ['.nothing/here.json'], homeDir: home }, () => assert.fail('must not run'));
  assert.equal(none.error.type, 'auth');
});

// OpenCode 2.x keeps its sign-in in database rows, not in a file.
const { createRequire } = await import('node:module');
let DatabaseSync = null;
try {
  DatabaseSync = createRequire(import.meta.url)('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = null;
}
const { createOpenCodeSignIn, DB_PARTS } = await import('../lab/adapters/opencode-signin.mjs');

function openDb(root) {
  const file = path.join(root, ...DB_PARTS);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return new DatabaseSync(file);
}
const SCHEMA = 'CREATE TABLE IF NOT EXISTS credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT, value TEXT, active INTEGER, time_created INTEGER, time_updated INTEGER); CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, title TEXT);';

function realOpenCodeHome() {
  const home = fs.mkdtempSync(path.join(scratch, 'oc-home-'));
  const db = openDb(home);
  db.exec(SCHEMA);
  db.prepare('INSERT INTO credential VALUES (?, ?, ?, ?, ?, ?, ?)').run('c1', 'openai', 'oauth', JSON.stringify({ refresh: 'r0' }), 1, 1, 1);
  db.prepare('INSERT INTO credential VALUES (?, ?, ?, ?, ?, ?, ?)').run('c2', 'opencode', 'key', 'plain-key', 1, 1, 1);
  db.prepare('INSERT INTO session VALUES (?, ?)').run('s1', 'PRIVATE SESSION TITLE');
  db.close();
  return home;
}
const rowsOf = (root, sql) => {
  const db = new DatabaseSync(path.join(root, ...DB_PARTS), { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
};
// `init` plays OpenCode making its empty database in the temp home.
const signIn = (log = {}) =>
  createOpenCodeSignIn({
    init: ({ dir }) => {
      log.inits = (log.inits || 0) + 1;
      const db = openDb(dir);
      db.exec(SCHEMA);
      db.close();
      return null;
    },
  });
const run = (home, store, fn, options = {}) => runInTempHome({ files: [], store, homeDir: home, ...options }, fn);

test('OpenCode sign-in: only the credential rows reach the temp home', { skip: !DatabaseSync }, async () => {
  const home = realOpenCodeHome();
  let seen;
  const out = await run(home, signIn(), (dir) => {
    seen = { credentials: rowsOf(dir, 'SELECT id FROM credential ORDER BY id').map((r) => r.id), sessions: rowsOf(dir, 'SELECT * FROM session').length, files: fs.readdirSync(path.join(dir, ...DB_PARTS.slice(0, -1))) };
    return 'done';
  });
  assert.equal(out.value, 'done');
  assert.deepEqual(seen.credentials, ['c1', 'c2']);
  assert.equal(seen.sessions, 0, 'no session was copied');
  assert.equal(out.home.removed, true);
});

test('OpenCode sign-in: no database or no rows is an auth error and OpenCode never starts', { skip: !DatabaseSync }, async () => {
  const log = {};
  const none = fs.mkdtempSync(path.join(scratch, 'oc-empty-'));
  const a = await run(none, signIn(log), () => assert.fail('must not run'));
  assert.equal(a.error.type, 'auth');
  const noRows = fs.mkdtempSync(path.join(scratch, 'oc-norows-'));
  const db = openDb(noRows);
  db.exec(SCHEMA);
  db.close();
  const b = await run(noRows, signIn(log), () => assert.fail('must not run'));
  assert.equal(b.error.type, 'auth');
  assert.equal(log.inits, undefined, 'OpenCode was not started');
  assert.equal(b.error.message.includes(noRows), false);
});

test('OpenCode sign-in write-back: a changed valid row goes back, others do not', { skip: !DatabaseSync }, async () => {
  // c1 is refreshed, c2 is changed to nothing useful, nothing else changes.
  const home = realOpenCodeHome();
  const out = await run(home, signIn(), (dir) => {
    const db = new DatabaseSync(path.join(dir, ...DB_PARTS));
    db.prepare('UPDATE credential SET value = ?, time_updated = 99 WHERE id = ?').run(JSON.stringify({ refresh: 'r1' }), 'c1');
    db.close();
  });
  assert.equal(out.home.written_back.length, 1);
  assert.match(out.home.written_back[0], /credential c1/);
  const [c1] = rowsOf(home, "SELECT value, time_updated FROM credential WHERE id = 'c1'");
  assert.equal(JSON.parse(c1.value).refresh, 'r1');
  assert.equal(c1.time_updated, 99);
  assert.equal(rowsOf(home, "SELECT value FROM credential WHERE id = 'c2'")[0].value, 'plain-key');
  assert.equal(rowsOf(home, 'SELECT * FROM session').length, 1, 'the real sessions are untouched');

  const corrupt = realOpenCodeHome();
  const bad = await run(corrupt, signIn(), (dir) => {
    const db = new DatabaseSync(path.join(dir, ...DB_PARTS));
    db.prepare("UPDATE credential SET value = '{ not json' WHERE id = 'c1'").run();
    db.close();
  });
  assert.deepEqual(bad.home.written_back, []);
  assert.match(bad.home.kept[0], /not valid JSON/);
  assert.equal(JSON.parse(rowsOf(corrupt, "SELECT value FROM credential WHERE id = 'c1'")[0].value).refresh, 'r0');

  const raced = realOpenCodeHome();
  const lost = await run(raced, signIn(), (dir) => {
    const db = new DatabaseSync(path.join(dir, ...DB_PARTS));
    db.prepare('UPDATE credential SET value = ? WHERE id = ?').run(JSON.stringify({ refresh: 'r1' }), 'c1');
    db.close();
    const real = new DatabaseSync(path.join(raced, ...DB_PARTS));
    real.prepare('UPDATE credential SET value = ? WHERE id = ?').run(JSON.stringify({ refresh: 'other-process' }), 'c1');
    real.close();
  });
  assert.deepEqual(lost.home.written_back, []);
  assert.match(lost.home.kept[0], /real row changed/);
  assert.equal(JSON.parse(rowsOf(raced, "SELECT value FROM credential WHERE id = 'c1'")[0].value).refresh, 'other-process');
});

test('OpenCode sign-in: the temp home is deleted when the call throws', { skip: !DatabaseSync }, async () => {
  const home = realOpenCodeHome();
  let dir;
  await assert.rejects(
    run(home, signIn(), (made) => {
      dir = made;
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(fs.existsSync(dir), false);
});

test('a token the CLI refreshed is written back even when the call throws afterwards', async () => {
  const home = fakeHome();
  await assert.rejects(
    runInTempHome({ files: [AUTH], homeDir: home }, (made) => {
      fs.writeFileSync(path.join(made, AUTH), JSON.stringify({ token: 'rotated' }));
      throw new Error('parser failed after the refresh');
    }),
    /parser failed/,
  );
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, AUTH), 'utf8')).token, 'rotated');
});

function captureStderr(t) {
  const lines = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => (lines.push(String(chunk)), true);
  t.after(() => (process.stderr.write = original));
  return lines;
}

test('a temp home that cannot be deleted is reported: a warning with its path, removed false, session_deleted false', async (t) => {
  const home = fakeHome();
  const lines = captureStderr(t);
  const leftovers = [];
  t.after(() => leftovers.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
  const adapter = defineCli({
    name: 'fake-stuck',
    bin: 'node',
    supportsEffort: false,
    isolation: { note: 'Fake.', home: { files: [AUTH], env: (dir) => ({ CODEX_HOME: path.join(dir, '.codex') }), remove: (dir) => (leftovers.push(dir), false) } },
    args: (ctx) => [script, ctx.prompt],
    parse: () => ({ text: 'x', usage: {}, tool_calls: 0, skills_used: [], events: [], error: null, session_id: 's1', extra: {} }),
    async after(parsed, { tempHome }) {
      if (tempHome) parsed.extra = { ...parsed.extra, session_deleted: true };
    },
  });
  const result = await call(adapter, 'ok', home);
  assert.equal(result.extra.temp_home.removed, false);
  assert.equal(result.extra.session_deleted, false, 'the session lives in the folder that is still there');
  assert.match(lines.join(''), /could not delete the temp home .+ holds a copy of your sign-in/);
});

test('a failed write-back is recorded and said out loud', async (t) => {
  const home = fakeHome();
  const lines = captureStderr(t);
  const store = {
    label: 'fake store',
    missing: () => [],
    seed: async () => ({}),
    writeBack: async () => {
      throw new Error('database is locked');
    },
  };
  const out = await runInTempHome({ files: [AUTH], homeDir: home, store }, () => 'value');
  assert.equal(out.value, 'value');
  assert.match(out.home.kept.join('\n'), /write back failed: database is locked/);
  assert.match(lines.join(''), /could not be written back \(write back failed: database is locked\)/);
  assert.equal(out.home.removed, true);
});

test('a real sign-in file that cannot be replaced gives the warning even when the call throws', async (t) => {
  const home = fakeHome();
  const lines = captureStderr(t);
  const real = path.join(home, AUTH);
  fs.chmodSync(real, 0o444);
  t.after(() => fs.chmodSync(real, 0o644));
  await assert.rejects(
    runInTempHome({ files: [AUTH], homeDir: home }, (made) => {
      fs.writeFileSync(path.join(made, AUTH), JSON.stringify({ token: 'rotated' }));
      throw new Error('parser failed');
    }),
    /parser failed/,
  );
  assert.equal(JSON.parse(fs.readFileSync(real, 'utf8')).token, 'original');
  assert.match(lines.join(''), /could not be written back \(\.codex\/auth\.json \(write back failed\)\)/);
});
