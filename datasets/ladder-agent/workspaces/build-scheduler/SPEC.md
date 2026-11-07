# Incremental build scheduler

`build(graph, options)` takes a graph of targets, decides which targets are out of date, and
plays the build on a simulated clock with a fixed number of parallel slots. It never uses
real time, real files or real processes: the caller supplies `run`, which does the work of one
target. The simulation must be deterministic. Every rule below is part of the contract.

## Input

```js
const graph = {
  'config':  { source: 'mode=fast' },                          // a source target
  'parse':   { recipe: 'parse v1', deps: ['config'], cost: 40 }, // a built target
  'bundle':  { recipe: 'bundle v1', deps: ['parse'], cost: 25, retries: 1 },
};
```

* The graph is a plain object. Its keys are target names. Names are compared by UTF-16 code
  units (the default `<` and `Array.prototype.sort()` order). "Name order" means that order.
* A **source** target is `{ source: <string> }` and nothing else. Its output is that string. It has
  no deps, never runs, takes no time and uses no slot.
* A **built** target is `{ recipe: <string>, deps?: <string[]>, cost?: <integer >= 0>, retries?: <integer >= 0> }`.
  `deps` defaults to `[]`, `cost` to `1`, `retries` to `0`. The order of `deps` matters.
* `options`:
  * `slots`: positive integer, default `1`. Anything else throws `RangeError`.
  * `run`: required function, otherwise `TypeError`. (Checked after `slots`.)
  * `cache`: the object a previous build returned, default `{}`.
  * `goals`: array of target names to build, default: every target.
  * `keepGoing`: boolean, default `true`.

## Validation

Validation covers the whole graph, also targets outside `goals`. It throws `GraphError`
(exported from `src/index.mjs`; it has the properties `code`, and `target`, `dep` or `path`
where named below). It reports the first problem in this order:

1. Targets in name order; for each target, in this order:
   * `bad-target`: the definition is not an object; a source with any other key than `source`,
     or with a non-string `source`; a built target whose `recipe` is not a string, whose `deps`
     is present but not an array of strings, or whose `cost` or `retries` is present but not an
     integer >= 0. Properties: `target`.
   * `dup-dep`: a dependency listed twice. Properties: `target`, `dep`.
   * `unknown-dep`: a dependency that is not a key of the graph (the first one in `deps`
     order). Properties: `target`, `dep`.
2. `cycle`: the graph has a dependency cycle. Properties: `path`, an array of names that starts and
   ends with the same name and follows dependency edges (each name is followed by one of its
   deps). Choose it like this: take the smallest name that lies on any cycle (a target that can
   reach itself through deps). The path is a shortest cycle through that name. If several cycles
   are equally short, take the one whose sequence of names is smallest when compared name by
   name from the start. A target that depends on itself gives `[a, a]`.
3. `no-goal`: a name in `goals` is not a key of the graph (first one in `goals` order).
   Properties: `target`. A `goals` value that is not an array of strings throws `bad-target`
   with `target: undefined`.

## Staleness and the cache

The **closure** is the goals and everything they depend on, directly or not (the whole graph
without `goals`). Only the closure is built.

A built target has a **cache entry**
`{ recipe: <contentHash of its recipe>, deps: [[depName, depOutputHash], ...], output: <string> }`
where `deps` follows the order of its `deps` and `depOutputHash` is `contentHash(output of that
dep)`. `contentHash` is in `src/hash.mjs`. A source's output is its `source` string.

A target is **up to date** when its cache entry exists and nothing changed. Otherwise it is
stale and has a `reason`. Check in this order:

| reason | when |
|---|---|
| `new` | no entry, or an entry that is not an object of that shape (string `recipe`, array `deps` of `[string, string]` pairs, string `output`) |
| `recipe` | the entry's `recipe` differs from `contentHash(recipe)` |
| `deps` | the names in the entry's `deps` differ from the target's `deps` (other names, other order, other length) |
| `dep:<name>` | the first dep, in `deps` order, whose output hash differs from the entry's. Example: `dep:parse` |

A rebuilt target whose new output equals its old output leaves its dependents up to date
(early cutoff), because they compare output hashes.

## The simulation

Time `t` starts at 0 and counts milliseconds. There are `slots` slots, numbered from 0.

A target is **decided** when all its deps are decided (a target without deps is decided at
once). When it is decided:

* If any dep failed or was skipped, the target is `skipped`. Its `cause` is the cause of its
  first such dep in `deps` order, where the cause of a failed dep is that dep itself and the
  cause of a skipped dep is the cause it has.
* Else a source is `source`.
* Else an up-to-date target is `cached`: it takes no time, uses no slot, and its output is the
  `output` in its entry.
* Else it is **ready**.

At each instant `t` repeat the following steps until nothing changes, then move `t` to the
smallest end time of a running job (stop when no job runs):

1. **Complete** every running job whose end time is `<= t`, in name order. An attempt that
   failed while `attempt <= retries` is retried: `run` is called again at once with
   `attempt + 1`, and the job keeps its slot and ends `cost` later. Any other job is finished
   (`built` on success, `failed` on failure); its slot is free from now on.
   A zero-cost job that starts at `t` ends at `t` and is completed in the next repetition.
2. **Decide** the targets that are now decidable, repeatedly (a cached target can make its
   dependents decidable). Deciding is the same for any order.
3. **Start** jobs: while a slot is free and a target is ready, start the ready target with the
   greatest **weight**; on equal weight the smaller name. It takes the lowest free slot. Starting
   calls `run(name, { attempt: 1, recipe, deps })` at once; `deps` maps each dep name, in `deps`
   order, to its output string. The job ends at `t + cost`.

**Weight** of a target = its cost (0 for a source) + the greatest weight among the targets that
depend on it inside the closure (0 if none). Weights use the declared costs only.

The result of `run` for one attempt: `{ ok: true, output: <string> }` is a success. `{ ok: false,
error: <string> }` is a failure (`error` is `'failed'` if it is not a string). A thrown error is a
failure with its `message` as the error. Anything else is a failure with the error `'bad result'`.

### keepGoing: false

When, in one run of step 1, jobs finish with a failure (after their retries), look at all jobs
that finish in that run of step 1 first, then stop: the first such failed target in name order is the
**stop cause**. From then on no target starts. Every target in the closure that is not finished
and not running (ready, waiting, or decided later) is `skipped` with the stop cause as its
`cause`, even a cached one that was not yet decided. Jobs that are already running go on to their end,
including their retries. A target that finishes after the stop keeps its own status.

## Result

```js
{
  ok,          // true when no target failed or was skipped
  makespan,    // largest end time of any job, 0 if no job ran
  startOrder,  // names in the order their first attempt started
  targets: {   // one entry per target of the closure
    config: { status: 'source' },
    parse:  { status: 'cached' },
    bundle: { status: 'built', reason: 'new', attempts: 1, start: 40, end: 65, slot: 0 },
    lint:   { status: 'failed', reason: 'new', attempts: 2, start: 0, end: 20, slot: 1, error: 'boom' },
    pack:   { status: 'skipped', cause: 'lint' },
  },
  cache,       // see below
  stats,       // { source, cached, built, failed, skipped } counts
}
```

`start` is the start of the first attempt, `end` the end of the last one, `slot` the slot of
the job. `reason` is the staleness reason. A `failed` target also has `error`, the error of its last attempt. A
target has no other keys than those shown for its status.

The new `cache` is a new object (the input is never changed) with the keys in name order:
a `built` target gets a fresh entry; a `cached` target keeps its entry; `failed` and `skipped`
targets, and sources, have none; a target outside the closure keeps its old entry if the graph
still has it as a built target; entries of names that are not built targets of the graph are dropped.

## Files

* `src/index.mjs`: the public API (`build`, `GraphError`, `contentHash`, `hashParts`).
* `src/graph.mjs`: validation, closure, weights.
* `src/staleness.mjs`: cache entries and reasons.
* `src/scheduler.mjs`: the simulation.
* `src/hash.mjs`, `src/errors.mjs`: helpers, finished.

The tests in `test/` show the shape of a result. Do not edit them.
