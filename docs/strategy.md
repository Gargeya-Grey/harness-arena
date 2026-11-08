# Model testing strategy

## Scope (phase 1)

- Hosted models, called through a **harness**: a coding CLI (Claude Code, Codex, Command Code, Gemini CLI, OpenCode, or one declared in `configs/harnesses.yaml`) on the owner's own sign-in. No paid API path. The same model through two harnesses is two configurations.
- Deterministic tasks where a correct answer can be checked mechanically.
- One repo holding inputs, runs, and reports so every comparison is auditable.

Non-goals until the basics work: local models, LLM-as-judge, databases.

## Principles

1. **Inputs are versioned; outputs are immutable.** Cases, prompts, model configs, and experiment definitions each have an identity and a version. Once a run is written, nothing in `results/` is edited by hand - a changed input means a new version and a new run.
2. **Every run is self-describing.** `run.json` contains everything needed to reproduce it: exact model snapshots, parameters, prompt version, suite version, content hashes, evaluator versions, harness commit, timestamp.
3. **Raw and derived are separate.** Model responses (`raw.jsonl`) are evidence. Scores (`scores/`) are computed from evidence. Aggregates in `reports/` are computed from scores. Each layer can be regenerated without touching the one below.
4. **One row per observation.** JSONL everywhere: one case per line, one response per line, one score per line. Easy to diff, stream, load into pandas, and append to.
5. **Stable IDs.** The same `case_id`, `model_key`, and prompt version mean the same thing forever. IDs are never reused or renumbered.

## What lives where

| Path | Purpose | Mutability |
|---|---|---|
| `configs/models.yaml` | Registry of models: provider, exact snapshot, params, pricing | versioned in git |
| `datasets/<suite>/suite.yaml` | Suite identity and defaults | bump `version` on change |
| `datasets/<suite>/cases.jsonl` | Test cases, one JSON object per line | bump `version` on change |
| `datasets/ladder-*/defs/`, `generate.mjs` | The ladder suites' definitions, and the generator that writes their `cases.jsonl` | edit a definition, run `generate.mjs --write`, bump `version` |
| `datasets/<suite>/versions/<version>/` | A frozen copy of an earlier suite version: its `suite.yaml` and `cases.jsonl`, and its `workspaces/` and `checks/` when the suite has them | written once by `node lab freeze`, before the version bump; never edited |
| `datasets/archive/<suite>/` | A retired suite, with its cases, workspaces and checks | frozen; bytes never change; an id lives here or in `datasets/`, never both. Its `versions/` may still gain a copy of an older version, which is not part of the hash |
| `configs/ladder.yaml` | The difficulty ladder: five tiers, expert-time ranges, tasks per tier and kind | versioned in git (`docs/difficulty.md`) |
| `prompts/<prompt>/prompt.yaml` | Prompt identity, current version, variables | metadata only |
| `prompts/<prompt>/vN.yaml` | Frozen template for version N | never edited; add `vN+1` |
| `experiments/<name>.yaml` | Declared matrix: suite, prompt, targets (model x harness), repeats, evaluators. The dashboard lists these | new file for new comparison |
| `experiments/archive/<name>.yaml` | A retired experiment; it still runs by path | frozen |
| `results/<run_id>/run.json` | Run manifest | written once; `status` updated |
| `results/<run_id>/raw.jsonl` | Every response with latency, tokens, cost, errors | append-only; a resume appends the missing rows |
| `results/<run_id>/harness-events.ndjson` | Optional raw harness event stream when the harness exposes one. Redacted, and kept out of git (`.gitignore`): it describes the machine | immutable local sidecar |
| `results/<run_id>/scores/<evaluator>@<version>.jsonl` | Evaluator output per response | regenerable |
| `reports/` | Comparison tables/charts | regenerable |
| `schemas/` | JSON Schema contracts for all of the above | versioned in git |

### The ladder and the archive

The comparison suites are the difficulty ladder (`docs/difficulty.md`): 80 tasks in five tiers over three suites, `ladder-answer`, `ladder-code` and `ladder-agent`. Each ladder case records its tier and its expert time in `metadata.tier`; `configs/ladder.yaml` holds the tier table and `lab/lib/ladder.mjs` checks every case against it. `node lab ladder` reads the counted evidence and shows, per configuration, how many tasks of each tier it solved. A pilot (`--repeats 1`) with `node lab ladder --calibrate` shows what each task can tell about the configurations that ran it; a tier is an estimate label, and a score does not move a task. A task that moves keeps its `case_id`; its tier changes in a new suite version.

The earlier suites (`reasoning`, `coding`, `agentic` and their `-hard` forms) are retired into `datasets/archive/`, and their experiments into `experiments/archive/`. A retired suite is unchanged: a run names its suite by id and hash, and the hash covers the suite's bytes, not its folder. So `loadSuite` looks in `datasets/<id>/`, then in `datasets/archive/<id>/`; old runs load, score, resume and show as before. `validate` still checks the archived suites and experiments, and refuses an id found in both places. An archived suite takes no new case. `smoke` stays active as the harness check.

### Frozen suite versions

A run records the suite version and hash it used. A new version must not change how an older run is scored, counted or shown, so the old version stays on disk as a frozen copy in `datasets/<suite>/versions/<version>/`. Before you change a suite, run `node lab freeze <suite>`, then bump its version. The command copies `suite.yaml`, `cases.jsonl`, and `workspaces/` and `checks/` when the suite has them, and checks that the copy has the suite's hash. A copy is complete: it never borrows a folder from a later version. `node lab new-case` freezes before it adds a case. `loadSuite(root, id, { version })` returns the current folder at the current version, the frozen copy at an older one, or null.

- `score` judges a run only against the suite at the version it recorded, and only when the hash matches. Otherwise it skips the run and leaves its score files as they are.
- The state and `node lab ladder` take a run's cases, and a ladder run's tiers, from that version.
- `validate` checks each copy (folder name, files, id, version, cases). It reports a suite that changed after a run without a new version, and a frozen copy whose hash is not the run's. It warns when a run's version has no copy: that run's stored scores still count, but it cannot be scored again.

## Identifiers

- `case_id` - `<suite>-<slug>` (e.g. `smoke-001`). Stable for the life of the suite.
- `model_key` - key in `configs/models.yaml` (e.g. `gpt-6-luna-low`). Maps to one exact provider snapshot.
- `prompt_id` + `version` - e.g. `qa-basic`, `"1"`.
- `run_id` - `YYYYMMDDTHHMMSSZ__<suite>__<experiment>__<rand6>` (e.g. `20261021T143000Z__smoke__smoke-baseline__a1b2c3`). Filesystem-safe on Windows, sorts chronologically.
- `repeat` - 0-based index of repeated execution of the same case/model pair.
- `config_id` - `<model_key>__<harness>-<version>__<effort|default>`, plus a suffix when the experiment asked to keep the user setup out: `__isolated` (kept out), `__isolated-partial` (partly kept out), `__isolated-leaked` (leaked) or `__isolated-unknown` (the flags prove nothing) (e.g. `claude-haiku-5.5__claude-code-2.1.306__default__isolated`). Derived from the run; never written by hand.

Every file loaded from disk is recorded with a SHA-256 in the manifest, so a run identifies the *bytes* it used, not just a label:

- suite: SHA-256 of the `suite.yaml` bytes followed by the `cases.jsonl` bytes;
- prompt: SHA-256 of the frozen `vN.yaml` bytes;
- experiment: SHA-256 of the experiment file, in `run.json` `notes`.

## Storage conventions

- UTF-8, LF line endings. JSONL is one compact JSON object per line, no pretty printing.
- Timestamps are ISO 8601 UTC with a trailing `Z`.
- Responses are stored verbatim; no truncation. Only normalized provider fields are kept (`text`, `finish_reason`), not the full raw payload.
- Costs are computed at run time from usage and the registry pricing active then, so historical numbers stay stable when prices change.

## Run lifecycle

1. **Declare** - write or choose an experiment file naming suite, prompt, targets, repeats, and evaluators. An optional `cases` list runs a subset and records exactly which cases were executed.
2. **Snapshot** - `node lab run` checks every reference before any call, then writes one `run.json` per harness with `status: running`, including verbatim experiment content and content hashes.
3. **Execute** - for each repeat x case x model, call the harness and append one line to `raw.jsonl`. Failures are rows with `error` set, not dropped. The harness's own event stream goes to `harness-events.ndjson`. Before it is written, `lab/lib/redact.mjs` drops the keys that describe the user's setup (connectors, plugins, skills, memory paths, `gitStatus`) and replaces the home folder with `~`; the response text, skill names and error messages in `raw.jsonl` get the same path redaction.
4. **Score** - evaluators read `raw.jsonl` plus case expectations and write `scores/<evaluator>@<version>.jsonl`.
5. **Report** - aggregate scripts read scores and raw timing/usage into `reports/`. Never hand-edit a report.
6. **Close** - set `status` to `completed` or `failed`.

A run that fails partway is still a valid artifact: `status: failed`, partial rows kept. Re-running the experiment creates a new `run_id`.

## Dimensions we compare

| Dimension | Computed from | Metrics |
|---|---|---|
| Quality | scores | mean score, pass rate |
| Reliability | scores across repeats | agreement rate, score variance |
| Latency | raw `latency_ms` | p50, p95, max |
| Cost | usage + registry pricing | USD per case, USD per suite |
| Token usage | raw `usage` | avg input/output tokens |
| Format compliance | format evaluator | % responses matching required shape |
| Error rate | raw `error` | failed calls / total calls |

Quality and reliability are deliberately separate: a model can be right on average but inconsistent across repeats.

## Harnesses

- **One run per harness.** An experiment with targets in three harnesses writes three runs. Each `run.json` records the harness name, version, entry point, access method, platform, and settings.
- **Isolated workdir.** By default each CLI call runs in an empty folder under the OS temp folder, initialised as its own git repository (`workdir_git_fence` in the run settings). Harnesses look upward for a repository root to read `git status`, `AGENTS.md` or `CLAUDE.md`. Without the fence they climb out of the temp folder into any repository above it, for example a home folder under git. `workdir: repo` runs inside this repository on purpose.
- **User setup is a recorded axis.** A CLI harness loads the owner's global settings, instructions, skills and MCP servers. `user_config: isolated` in an experiment adds each harness's isolation flags (`isolation` in its adapter, or `isolation_args` in `configs/harnesses.yaml`). The run records `harness.settings.user_config` (`isolated` only when flags or a temp home were used) and `user_config_flags` (the flags, or env vars such as `CODEX_HOME=<temp home>/.codex`; never a real path or file content). Runs written before this setting count as `loaded`. **Temp home.** A harness with no setup flags (Codex, Gemini CLI, OpenCode) runs each isolated call in a temp home (`isolation.home` in its adapter, `lab/lib/temphome.mjs`). Per call: `fs.mkdtempSync` under the OS temp folder; copy only the sign-in (`.codex/auth.json`, `.gemini/oauth_creds.json`, and for OpenCode 2.x the rows of the `credential` table, because it no longer reads `auth.json`); set `HOME` and `USERPROFILE` plus the CLI's own variable; delete the folder in a `finally` block. A missing sign-in is an `auth` error and never falls back to the real home. **Token refresh:** these CLIs refresh an expired token on use and write it to the copy. Refresh tokens can rotate, so dropping the copy could invalidate the owner's real sign-in. A refreshed copy therefore goes back after the call, only when it changed, still parses as JSON, and the real file or row still holds the value that was copied (otherwise another process refreshed it and wins). Every harness is isolated only in part: built-in prompts, built-in tools and the CLI's own defaults still load. The note in the run says what still loads.
- **Access is a recorded setting.** `access: answer` (default) asks for a text reply. `access: edit` adds each harness's edit flags (`edit` in its adapter, or `edit_args` in `configs/harnesses.yaml`) and records them as `harness.settings.access_flags`. Edit access needs `workdir: isolated`. A harness whose tools stay on unless its config turns them off gets an `answer` part in its adapter: environment variables set on every `access: answer` call, recorded the same way. OpenCode uses it to deny every permission, because without it OpenCode runs shell and write tools in answer mode.
- **Agent tasks are scored from stored files.** A case with `input.workspace` starts from `datasets/<suite>/workspaces/<name>/`, copied into the call's folder. The runner stores the changed and deleted files (`workspace.json` plus `files/`) as a raw artifact of the row, even when the call failed. A hidden check in `datasets/<suite>/checks/<name>/` scores a rebuild of that workspace, so scores stay derived: `probe.mjs` runs in the sandbox and returns observed values, and the lab compares them with `expected.json`, which never enters the sandbox. The manifest records the starter's hash from before the call; a rebuild on a changed starter gives no score. The suite hash covers `workspaces/` and `checks/`, so a changed starter or check shows as a changed suite. A call during which a file of the repository changes, or that names the repository in its tool calls, gets the error `left_workdir`. The first stops the experiment and marks the run `harness.settings.halted`; `node lab score` skips such a run unless `--force`. A workspace case needs `access: edit`.
- **Params that a harness cannot apply are recorded, not hidden.** CLI harnesses do not forward `temperature` or `max_tokens`; each row lists them in `metadata.params_not_applied`. A requested effort that the harness cannot set is recorded as not applied. An effort set on an experiment target (`effort`, or `efforts` for several) overrides the registry's `reasoning_effort`; the plan refuses it for a harness without effort control. Each harness x effort pair is its own run, so two efforts of one model are two configurations in one comparison context.
- **Usage is normalized.** `input_tokens` counts every prompt token, cached ones included. `cache_read_tokens` and `cache_write_tokens` are the parts of it that were read from or written to a cache. Adapters convert each harness's fields to this shape (Anthropic and Claude Code report cache tokens apart from input; the adapter adds them).
- **Cost** = (uncached input x input rate + cache reads x read rate + cache writes x write rate + output x output rate) / 1,000,000. A cache rate missing from the registry defaults to the input rate. For subscription harnesses the cost is API-equivalent, not a bill.
- **Errors are typed and classed.** `error.type` is `rate_limit`, `auth`, `not_installed`, `spawn_error`, `timeout`, `no_result`, `harness_error`, `left_workdir`, or a provider type; the runner stores `rate_limit` or `auth` when the message names a usage limit or a sign-in failure (`lab/lib/checks.mjs`). An error row gets no evaluator score. In the aggregate, a **lost** error (`rate_limit`, `auth`, `not_installed`, `spawn_error`) leaves quality and pass rate and is counted as `lost_n`, because it says nothing about the configuration. Every other error is the configuration's own failure and counts as 0 (`failed_n`), so a configuration that times out on hard cases never ranks higher for it.
- **Intervals are clustered by case.** Quality and pass-rate intervals are a percentile bootstrap that draws cases with replacement, then repeats inside each case, widened to the Wilson interval with n = number of cases so that all-pass cases do not show 100–100% (`clusteredInterval`). Below 3 cases there is no interval. Aggregates carry `counted_n` and `cases_n`. Only finished, scored runs count: a running or guard-halted run adds no 0s from its errors alone.
- **The model is checked.** Each row records `metadata.model_check` (`match`, `mismatch`, `unknown`) from the model the harness reports. A registry entry with `pinned: false` is an alias the provider can change; the dashboard and the report mark both.
- **Runs live in a data folder outside git.** `data_dir` in `lab.local.yaml` (not committed; a worktree uses its main checkout's file) or `LAB_DATA` names it. New runs go to `<data_dir>/results/` and annotations to `<data_dir>/annotations/`; runs committed in `results/` stay readable, and an id in both places is read from the data folder. One lab command writes at a time: `run`, `--resume` and `score` hold a lock on every store folder (the data folder, the checkout's `results/` and the ledger's folder), so during an agent call the workdir guard can watch everything the lab reads from a store with no skip list: rows, scores, folders of any name, links, read-only bits, the store folders' real paths, the lock file and both `lab.local.yaml` files. The store is fixed when the run starts. A change there, or a folder it cannot read after the call, halts the experiment, and the run is not scored. `annotations/` is not watched (the dashboard writes ratings at any time), a planted run is reported but not removed, and the guard's cost grows with the store. A store that is a link is refused at start. No process an agent call starts may outlive it: on Windows a Job Object holds the harness and everything it starts (the harness starts through `lab/adapters/launcher.mjs`, which has a fixed environment and gets the spawn spec on a private IPC channel only after the job holds it; the harness cannot reach that channel; a timeout ends the launcher's whole tree), and the runner ends the job before the second stamp; a survivor, a child started before the job held the harness, or a stopped watch halts the run.
- **The evidence ledger detects what the guard missed.** `lab.ledger.jsonl` at the main checkout (local, not committed; `schemas/ledger.schema.json`) records each run's rows, halt, closing file hashes and scores as they are written; the first `run` or `score` adopts the runs already stored. All or nothing: a run counts in an aggregate only when it is closed, its folder is named after its `run_id`, every file matches its close entry and its scores match its last scores entry exactly; every other run is listed and counts nowhere. An open run is checked as far as it goes (its `run.json` fixed fields, every file each recorded row wrote, every recorded row, the recorded start of its events), so a resume can continue it; a run that does not match is flagged, never scored and never resumed. A score command records exactly the files it wrote, and a resume drops the old scores entry. A closed run counts only when every declared evaluator's score file is recorded: an unscored or partly scored run counts nowhere (cost, latency and errors included) until it is scored, and a run with no declared evaluators counts for cost, latency and errors with no quality; the dashboard client indexes only counted observations, so an excluded run is in no view but the runs table; an adopt always records the scores as they are, none included. Without a ledger no run counts; the fixture store commits its own `lab.ledger.jsonl`, made by `tests/fixtures/make-fixtures.mjs`. A run whose `run.json` still says `running` counts nowhere. Writes into a run folder never go through a link: every one goes through `lab/lib/runwrite.mjs` (a lint test fails on any other), and a read-only file with a second link is refused, not made writable. A halt restores the ledger to its bytes before the call, so entries an agent wrote are dropped (kept aside). A resume records itself before it writes. `node lab adopt` is the owner's way to vouch for a run. The ledger fails closed: a run with no close entry is only open, and a write the ledger cannot make leaves the run untrusted. It is detection, not prevention: the agent has the owner's file permissions, and only OS isolation would prevent a change.
- **Runs show liveness and can resume.** `run.json` holds `runner: { pid, heartbeat_at }`, written for every open run of the experiment before each call, and after each call. A run that says `running` is live while its process is alive; it is stale when the process is gone or the heartbeat is a day old. A call cut off by Ctrl+C is not stored, so the resume runs it again; a torn last line of `raw.jsonl` from a crash is dropped and recorded (`runner.resumes[].dropped_torn_line`). `node lab run --resume <run_id>` continues a stale or user-stopped run in place: it keeps every row, appends the missing ones, and records `runner.resumes`. It refuses a halted run, and a run whose suite, prompt, models, effort or harness version changed.

## Comparability rules

- Pin exact model snapshots where the provider offers them, never moving aliases.
- Within a comparison, hold suite version, prompt version, evaluator versions, and decoding params constant. Changing one means a new experiment and a new run.
- Temperature defaults to 0. Reliability is measured with repeats, not raised temperature, unless temperature itself is the variable.
- Never compare scores produced by different evaluator versions.
- Results are append-only. If a run is wrong, mark it failed and rerun; don't patch JSONL. A resume is not a correction: it only adds rows the run never wrote.
- Partial or aborted runs are excluded from reports unless explicitly flagged. A declared `cases` subset is partial by design; compare it only against runs using the same subset.

## Adding things

- **New suite** - new folder with `suite.yaml` and `cases.jsonl`. Bump `version` whenever cases change.
- **New ladder task** - a definition under `datasets/<suite>/defs/` with its tier, its expert time and a reference; run the suite's `generate.mjs --write` and bump `version` (see AGENTS.md).
- **Retire a suite** - `git mv datasets/<id> datasets/archive/<id>` and its experiments to `experiments/archive/`. Change no byte inside the suite: its hash is in every old run.
- **New model** - add a registry entry with exact snapshot and pricing. Pricing is required for cost metrics.
- **New prompt version** - add `vN.yaml`, point `prompt.yaml` at it, and reference the new version in the next experiment. Old runs keep their version.
- **New evaluator** - give it an `id`, `version`, and `dimension`; write scores to `scores/<id>@<version>.jsonl`. An evaluator that runs model-written code runs it through `runJsTests` (version 1) or `runJsTestsV2` (version 2) in `lab/evaluators/index.mjs`: a separate Node process with the permission model, an empty environment and a time limit. Version 1 limits wall-clock time; version 2 limits CPU time (2000 ms per test, 30000 ms per case) so a busy machine does not change a verdict, with a wall-clock backstop that follows the load. `workspace-tests@2` does the same for an agent check (60000 ms of CPU). A change to what an evaluator computes is a new version; `js-function@1` and `workspace-tests@1` stay for old runs. Never `eval` model output in the lab process.

## Deliberately postponed

Retries/backoff, request caching, parallel execution, multi-turn cases, LLM-as-judge evaluators, DB storage, and local/self-hosted models. Start with JSONL + git; add infrastructure only when volume forces it.
