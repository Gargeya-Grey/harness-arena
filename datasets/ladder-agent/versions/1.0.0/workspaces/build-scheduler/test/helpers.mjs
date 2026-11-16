export const T = (deps = [], cost = 1, more = {}) => ({ recipe: 'r', deps, cost, ...more });
export const S = (source) => ({ source });

/** A run function that joins the outputs of the deps; `fail` lists names that fail. */
export function runner(fail = []) {
  const calls = [];
  const run = (name, info) => {
    calls.push([name, info.attempt]);
    if (fail.includes(name)) return { ok: false, error: `${name} broke` };
    return { ok: true, output: `${name}(${Object.values(info.deps).join(',')})` };
  };
  return { run, calls };
}
