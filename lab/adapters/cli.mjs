// The one seam every CLI harness goes through. A harness file gives a spec:
// the binary, how to build its arguments, how to read its output, and which
// flags keep the user's own setup out of the call. `defineCli` adds the shared
// parts: detection, spawning without a shell, and what the run records.

import os from 'node:os';
import { describeEnv, runInTempHome, scrubTempHome } from '../lib/temphome.mjs';
import { cliVersion, flattenMessages, runProcess } from './process.mjs';

/**
 * spec: {
 *   name, bin, versionArgs?,
 *   supportsEffort,                 // the harness can set reasoning effort
 *   stdin?(ctx) -> string,          // text sent on stdin; omit when the prompt is an argument
 *   args(ctx) -> string[],          // ctx: { model, effort, prompt, system, user, cwd, persist, maxTurns }
 *   parse({ stdout, stderr, code }) -> parsed result (see the built-in adapters)
 *   isolation?: {
 *     args?: string[],              // flags that keep the user setup out
 *     env?: object,                 // env vars set on an isolated call
 *     home?: {                      // isolate through a temp home folder instead of (or with) flags
 *       files: string[],            // sign-in files to copy, relative to the real home; nothing else is copied
 *       store?: object,             // sign-in that is not a file (see lab/lib/temphome.mjs)
 *       env: (tempHome) => object,  // env vars that point the CLI at the temp home (HOME and USERPROFILE are always set)
 *       writeBack?: boolean,        // copy a refreshed sign-in file back after the call (default true)
 *     },
 *     note: string,
 *   },
 *   after?(parsed, ctx) -> Promise, // cleanup after a call, e.g. delete a stored session
 * }
 */
// Extra flags go before a "--" that ends the options (the prompt follows it) or a
// final "-" (prompt on stdin), else at the end.
export function withExtra(args, extra) {
  if (!extra.length) return args;
  const end = args.indexOf('--') >= 0 ? args.indexOf('--') : args.at(-1) === '-' ? args.length - 1 : -1;
  return end < 0 ? [...args, ...extra] : [...args.slice(0, end), ...extra, ...args.slice(end)];
}

export function defineCli(spec) {
  const isolation = spec.isolation || { args: [], note: 'This harness has no flag to skip the user setup; it always loads it.' };
  const flags = isolation.args || [];
  const home = isolation.home ? { files: isolation.home.files || [], writeBack: isolation.home.writeBack !== false, store: isolation.home.store || null } : null;
  // HOME and USERPROFILE always point at the temp home, so the CLI finds no real home folder at all.
  const homeEnv = (dir) => ({ HOME: dir, USERPROFILE: dir, ...(isolation.home?.env ? isolation.home.env(dir) : {}) });
  const edit = spec.edit || null;
  return {
    name: spec.name,
    kind: 'cli',
    bin: spec.bin,
    entrypoint: 'headless',
    access_method: 'subscription',
    supports_effort: Boolean(spec.supportsEffort),
    supports_decoding: false,
    // `args` is what the run records as user_config_flags and what turns isolation on (a
    // non-empty list). With a temp home it also lists the env vars, as KEY=<temp home>/sub.
    // `flags` is the part that goes on the command line.
    isolation: { args: [...flags, ...(home ? describeEnv(homeEnv) : [])], flags, env: isolation.env || {}, home, note: isolation.note },
    // access: edit (agent tasks) lets the harness edit files and run commands in its folder.
    edit: edit ? { args: edit.args || [], note: edit.note || '' } : null,
    declared: Boolean(spec.declared),

    detect: async () => ({ version: await cliVersion(spec.bin, spec.versionArgs) }),

    args: (ctx) => spec.args(ctx),

    parse: (run) => spec.parse(run),

    async call({ model, messages, effort, cwd, timeoutMs, persist = false, maxTurns = null, isolated = false, access = 'answer', env: callEnv = {}, homeDir }) {
      const { prompt, system, user } = flattenMessages(messages);
      const extra = [...(isolated ? this.isolation.flags : []), ...(access === 'edit' && this.edit ? this.edit.args : [])];
      const baseEnv = { ...callEnv, ...(isolated ? this.isolation.env : {}) };

      // One process call. `tempHome` is the temp home folder of an isolated call, else null.
      const execute = async (env, tempHome) => {
        const ctx = { model, effort, prompt, system, user, cwd, persist, maxTurns, access, tempHome, env };
        const args = withExtra(spec.args(ctx), extra);
        const run = await runProcess(spec.bin, args, { cwd, input: spec.stdin ? spec.stdin(ctx) : '', timeoutMs, env });
        if (run.error) {
          // A timed-out call may still have made a session; clean up what its output names.
          // Its events are kept too, so the runner's guard sees what the agent did.
          let partial = null;
          if (run.stdout) {
            try {
              partial = spec.parse(run);
            } catch {
              partial = null;
            }
          }
          if (spec.after && partial) await spec.after(partial, ctx);
          return { error: run.error, wall_ms: run.ms, events: partial?.events ?? [] };
        }
        const parsed = { ...spec.parse(run), wall_ms: run.ms, stderr: run.stderr };
        if (spec.after) await spec.after(parsed, ctx);
        return parsed;
      };

      if (!(isolated && home)) return execute(baseEnv, null);

      // Isolated through a temp home: only the sign-in files go in; the folder is deleted afterwards.
      const outcome = await runInTempHome({ files: home.files, writeBack: home.writeBack, store: home.store, homeDir: homeDir || os.homedir(), env: (dir) => ({ ...baseEnv, ...homeEnv(dir) }) }, (dir) =>
        execute({ ...baseEnv, ...homeEnv(dir) }, dir).then((result) => ({ result, dir })),
      );
      if (outcome.error) return { error: outcome.error, wall_ms: 0, events: [] };
      const { result, dir } = outcome.value;
      if (result.error) result.error = { ...result.error, message: scrubTempHome(result.error.message, dir) };
      if (typeof result.stderr === 'string') result.stderr = scrubTempHome(result.stderr, dir);
      result.extra = { ...(result.extra || {}), temp_home: outcome.home };
      // A session kept inside the temp home is gone only if the folder is.
      if (result.extra.session_deleted !== undefined) result.extra.session_deleted = outcome.home.removed;
      return result;
    },

    applied({ effort }) {
      return effort && spec.supportsEffort ? { reasoning_effort: effort } : {};
    },
  };
}
