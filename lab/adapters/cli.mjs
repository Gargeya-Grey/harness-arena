// The one seam every CLI harness goes through. A harness file gives a spec:
// the binary, how to build its arguments, how to read its output, and which
// flags keep the user's own setup out of the call. `defineCli` adds the shared
// parts: detection, spawning without a shell, and what the run records.

import { cliVersion, flattenMessages, runProcess } from './process.mjs';

/**
 * spec: {
 *   name, bin, versionArgs?,
 *   supportsEffort,                 // the harness can set reasoning effort
 *   stdin?(ctx) -> string,          // text sent on stdin; omit when the prompt is an argument
 *   args(ctx) -> string[],          // ctx: { model, effort, prompt, system, user, cwd, persist, maxTurns }
 *   parse({ stdout, stderr, code }) -> parsed result (see the built-in adapters)
 *   isolation?: { args?: string[], env?: object, note: string },
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
  const edit = spec.edit || null;
  return {
    name: spec.name,
    kind: 'cli',
    bin: spec.bin,
    entrypoint: 'headless',
    access_method: 'subscription',
    supports_effort: Boolean(spec.supportsEffort),
    supports_decoding: false,
    isolation: { args: isolation.args || [], env: isolation.env || {}, note: isolation.note },
    // access: edit (agent tasks) lets the harness edit files and run commands in its folder.
    edit: edit ? { args: edit.args || [], note: edit.note || '' } : null,
    declared: Boolean(spec.declared),

    detect: async () => ({ version: await cliVersion(spec.bin, spec.versionArgs) }),

    args: (ctx) => spec.args(ctx),

    parse: (run) => spec.parse(run),

    async call({ model, messages, effort, cwd, timeoutMs, persist = false, maxTurns = null, isolated = false, access = 'answer', env: callEnv = {} }) {
      const { prompt, system, user } = flattenMessages(messages);
      const ctx = { model, effort, prompt, system, user, cwd, persist, maxTurns, access };
      const extra = [...(isolated ? this.isolation.args : []), ...(access === 'edit' && this.edit ? this.edit.args : [])];
      const args = withExtra(spec.args(ctx), extra);
      const env = { ...callEnv, ...(isolated ? this.isolation.env : {}) };
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
    },

    applied({ effort }) {
      return effort && spec.supportsEffort ? { reasoning_effort: effort } : {};
    },
  };
}
