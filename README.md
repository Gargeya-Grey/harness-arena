# Harness Arena

Run the same test cases through different harnesses and models, then compare them side by side in **Model Lab**, a local dashboard.

Claude Code, Codex, Command Code, Gemini CLI, OpenCode, and any other CLI you connect answer the same prompts, through your own sign-ins. No paid API key is needed. Every call is stored as evidence. Configurations get letters A–H, and the dashboard shows quality, cost, latency, tokens, reliability and errors for each one, with the full answer one click away. Zero dependencies: Node and nothing else.

A **harness** is the program that calls the model: a coding CLI such as Claude Code, Codex, Command Code, Gemini CLI or OpenCode. One **configuration** is one model through one harness at one effort, with or without your own harness setup. Every call is stored as evidence in `results/`, and the dashboard and the report read only that evidence.

The lab needs Node 20 or later. It has no dependencies, so there is no install step.

## Quick start

```bash
node lab doctor                                   # which harnesses work on this machine
node lab run experiments/smoke-harness-sweep.yaml --dry-run
node lab run experiments/smoke-harness-sweep.yaml # calls every target; writes results/
node lab dashboard                                # http://127.0.0.1:4317
```

### Run from the browser

`node lab dashboard` opens Model Lab at `http://127.0.0.1:4317`. From there you run everything without a terminal:

- **Home**: the job that runs now, the latest results with their answer in one sentence, and anything that needs attention.
- **Run**: pick an experiment. Under "Narrow it down", choose a harness, models, cases and tries per case. Preview shows the plan and calls nothing. Start asks once (`Start N calls?`), then shows the progress. Stop lets the current call finish and keeps the run. When it ends, See results opens the result.
- **Results** (`/results.html`): one test at a time. One sentence says which setup did better, by how much, and how sure the data lets us be. Below it: the setups table, every try case by case, the charts that carry a result, your ratings with their notes, and the runs it is built from (Score again makes no model calls; Resume continues a run that stopped without finishing; a run that counts nowhere says why). Share copies a link or a Markdown table, downloads CSV or JSON, saves a picture, or saves the view.
- **Ladder** (`/ladder.html`): the difficulty ladder and what the stored runs show about it. One sentence says how many tasks show a real disagreement between setups and how many only one setup ran; below it are the setups per tier, the pairs of setups with their sign test, and every task with its tier (an estimate of expert time, never a result) and the score of each setup. It reads the same numbers as `node lab ladder --calibrate`.
- **Lab**: harness checks (`doctor`), records that fail their schema, Validate, Score all, Report, recent jobs, and Appearance (theme colour, light or dark, motion).

Old links to `/compare.html` open Results.

The page runs the same `node lab` commands you would type, one at a time, on this machine only. It accepts no other command.

A smaller first run is one case and one repeat:

```bash
node lab run experiments/smoke-harness-sweep.yaml --repeats 1 --cases smoke-001
```

### The difficulty ladder

The comparison suites are one **difficulty ladder**: 80 tasks in five tiers (easy 5, medium 10, hard 15, extra-hard 20, supreme 30), so strong configurations all pass the low tiers and the high tiers decide the comparison. [docs/difficulty.md](docs/difficulty.md) explains the scale (expert time, in the style of METR time horizons) and how a pilot calibrates it. Three experiments run it, one per suite, through four harnesses with one model each (the user setup kept out where the harness allows it). Start with a preview and one task, then the pilot (one repeat per task, 80 tasks times 4 targets is 320 calls), then read it:

```bash
node lab run experiments/ladder-code.yaml --dry-run
node lab run experiments/ladder-code.yaml --repeats 1 --cases ladder-code-palindrome
node lab run experiments/ladder-answer.yaml --repeats 1
node lab run experiments/ladder-code.yaml --repeats 1
node lab run experiments/ladder-agent.yaml --repeats 1     # up to an hour per call at the top tier
node lab ladder
node lab ladder --calibrate
node lab dashboard
```

`node lab ladder` puts configurations in rows and tiers in columns. Each cell is `solved/counted` tasks and the mean score; a task is solved when its mean score is 1. This is the table that shows where configurations separate. `--calibrate` adds one line per task with its information class (`no-data`, `one-config`, `all-solved`, `all-unsolved`, `disagree`), and one line per pair of configurations with the tasks both ran, the tasks only one of them solved, and an exact sign test. A tier is an estimate label, so the report gives no verdict on a task. It flags a task that one configuration solves while a stronger one (higher mean on the other tasks both ran) scores under 0.5 on every repeat. Per suite it uses the newest suite version that has counted runs; `--suite-version <suite>@<version>` picks another. `--suite`, `--runs` and `--json` filter or print the data.

The older suites (`reasoning`, `coding`, `agentic` and their `-hard` forms) are retired. They sit in `datasets/archive/`, their experiments in `experiments/archive/`. Old runs still open and score, and an archived experiment still runs by path: `node lab run experiments/archive/coding-sweep.yaml --dry-run`.

To add any other model that OpenCode reaches (`opencode models` lists them), add a key to `configs/models.yaml` with `model: <provider>/<model>`, add a target with that key, and run `node lab validate`.

## Commands

| Command | What it does |
|---|---|
| `node lab doctor` | Shows each harness (built-in and declared), its version, whether it is installed, and what isolation it supports. |
| `node lab run <experiment.yaml>` | Runs every target x case x repeat. Writes one run per harness and effort under the data folder's `results/` (see [Where runs live](#where-runs-live)), then scores it. |
| `  --harness <name>` / `--models <a,b>` | Runs only the targets that match. |
| `  --repeats <n>` / `--cases <a,b>` | Overrides the experiment. The run records the override. |
| `  --dry-run` | Shows the plan: model id per harness, effort, whether the user setup loads. Calls nothing. |
| `node lab run --resume <run-id>` | Continues a run that stopped before its last row: it crashed (`node lab runs` shows `stale`) or you stopped it. Only the missing rows run. It refuses when the suite, prompt, models or harness version changed. With `--dry-run` it lists what it would run and calls nothing. `--force` resumes a run written before the heartbeat existed. |
| `node lab new-case <suite> <slug>` | Adds a case with every value to write marked `<<FILL IN>>`, and bumps the suite version. `--agent` also makes the starter workspace and the hidden check. `validate` fails until no marker is left. |
| `node lab freeze <suite>` | Copies the suite's current version to `datasets/<suite>/versions/<version>/`. Run it before you change a suite and bump its version, so old runs still score and show. `new-case` does it for you. |
| `node lab score <run-id> \| --all` | Computes scores again from `raw.jsonl`, against the exact suite version the run used. Makes no model calls. |
| `node lab validate` | Checks every input and stored record against `schemas/`. |
| `node lab runs` | Lists runs, newest first. |
| `node lab ladder [--calibrate] [--suite <id>] [--suite-version <suite>@<version>] [--runs <id,...>] [--json]` | Prints the difficulty ladder per configuration: solved/tasks and mean score per tier, from one suite version per suite (the newest with counted runs, unless `--suite-version` says otherwise). `--calibrate` adds the information class for each task and the evidence for each pair. Reads counted evidence only; makes no model calls. |
| `node lab signal <experiment.yaml> [--json] [--models a,b] [--cases x,y] [--repeats n]` | Before you spend calls: says whether the planned run can give a trustable signal (`worth running`, `low signal` or `unknown`), with the planned calls, the calls that repeat solved tasks, an output token estimate, the check quality and the reasons. An estimate from stored runs of the same suite version; makes no model call and writes nothing. The Run page shows the same result. |
| `node lab report [--write]` | Prints a Markdown comparison per context, or writes `reports/comparison.md`. |
| `node lab dashboard [--port n]` | Starts the local control page and comparison dashboard. |
| `npm test` | Runs the test suite (`tests/*.test.mjs`). |

## Harnesses

| Harness | CLI | Model id | Effort | Isolation (`user_config: isolated`) |
|---|---|---|---|---|
| `claude-code` | `claude` | `claude-haiku-5-5` | yes (`--effort`) | partial: skips user settings, MCP servers, skills; built-in plugins still load |
| `codex` | `codex` | `gpt-6-luna` | yes (`model_reasoning_effort`) | temp home: empty `CODEX_HOME`, copy of `auth.json` only |
| `command-code` | `cmdc` | `deepseek/deepseek-v4.1-flash` | yes (`--effort`) | partial: skips skills |
| `gemini-cli` | `gemini` | `gemini-3.8-flash` | no | temp home: `GEMINI_CLI_HOME`, copy of `oauth_creds.json` only |
| `opencode` | `opencode` (2.x) | `<provider>/<model>`, e.g. `opencode/beam-free`, `openai/gpt-6-luna` | yes (`#variant`) | temp home: new config, data and cache folders, copy of the provider sign-in rows only |

Every harness uses your own sign-in. OpenCode reaches any provider you connect inside OpenCode (`opencode auth login`), so OpenRouter or any other provider needs no change here: name it in the model id. Each OpenCode call runs on a private server (`--standalone`), and the runner deletes the session it made unless the experiment sets `persist_sessions: true`. Each row records whether that worked in `metadata.harness_extra.session_deleted`.

**Connect another CLI** with no code: add it to `configs/harnesses.yaml`. That file documents every field. `node lab doctor` lists it and `node lab validate` checks it.

**User setup.** A CLI harness loads your own global setup: instructions, skills, MCP servers. That changes tokens, time and behaviour, differently for each harness. Set `user_config: isolated` in an experiment to keep it out. There are two mechanisms. Claude Code and Command Code have flags. Codex, Gemini CLI and OpenCode have none, so each isolated call gets a **temp home**: a new folder under the OS temp folder that holds a copy of the sign-in and nothing else (no config, instructions, skills, MCP servers or sessions). The CLI is pointed at it with env vars (`HOME`, `USERPROFILE`, plus `CODEX_HOME`, `GEMINI_CLI_HOME` or `XDG_*`). The folder is deleted after the call, also when the call fails. A missing sign-in is an `auth` error; the call never falls back to your real home. A token that the CLI refreshes in the copy goes back to your real sign-in, only when it changed, is still valid, and the original did not change meanwhile, because some providers rotate refresh tokens. The run records the flags or env vars in `harness.settings.user_config_flags` (for example `CODEX_HOME=<temp home>/.codex`, never a real path), and each row records `harness_extra.temp_home` (`removed`, `written_back`). OpenCode 2.x keeps its sign-in in the `credential` table of its database, so only those rows are copied; this needs Node 22.13 or newer. A harness with neither flags nor a temp home records `user_config: loaded`. `node lab doctor` lists the mechanism for each harness and whether its sign-in is found. A measured example: Claude Code went from 34,525 to 29,316 prompt tokens on a one-word answer.

A CLI harness does not forward `temperature` or `max_tokens`. Each raw row lists those params in `metadata.params_not_applied`.

Each CLI call runs in a new, empty folder directly under the temp folder, and that folder is its own git repository. Thus no harness reads this repository, or a git repository above the temp folder, into its prompt. The runner deletes the folder after it stores the evidence, so no call can read the finished work of an earlier repeat or of another model; each row records `metadata.workdir_removed`. To measure a harness inside this repository, set `workdir: repo` in the experiment.

Cost is optional. With `pricing` in the registry entry, the dashboard shows an API-equivalent cost. Without it, cost is n/a. A subscription bill does not change per call.

## Suites

| Suite | Cases | Prompt | Evaluator | Experiment |
|---|---|---|---|---|
| `smoke` | 4 one-word questions: the harness check | `qa-single-turn` | `normalized-match@1`, `exact-match@1` | `smoke-harness-sweep` |
| `ladder-answer` | 24 problems with one exact answer, tiers 1 to 5 | `reasoning-final-answer` | `final-answer@1`: the last `Answer:` line; numbers compare as numbers | `ladder-answer` |
| `ladder-code` | 28 JavaScript functions with hidden tests, tiers 1 to 5 | `js-function` | `js-function@2`: share of tests passed, CPU-time limits | `ladder-code` |
| `ladder-agent` | 28 agent tasks in starter projects, tiers 1 to 5 | `agent-task` | `workspace-tests@2`: share of hidden tests passed on the agent's final files, CPU-time limits | `ladder-agent` |

Retired suites, kept in `datasets/archive/` because old runs name them: `reasoning`, `reasoning-hard`, `coding`, `coding-hard`, `agentic`, `agentic-hard`. They load by id, validate and score as before; they take no new case.

`js-function@1` runs the model's code in its own Node process with the permission model on. The code can read only the sandbox runner file, and cannot write files, start processes, use workers, load addons or open `node:sqlite` (which gets past the permission model). The process gets none of your environment variables (Windows adds a few system ones, such as `PATH`), a 256 MB heap and a time limit. Each test gets a fresh context and 2 seconds. The expected values never enter the sandbox, and the lab counts only the result line that carries a random nonce, so escaped code cannot fake a score. Node does not limit network access or signals: code in the sandbox can use `fetch` and can send a signal to your other processes. So the sandbox keeps your files safe from that code, but it is not a network jail or an OS sandbox. `js-function@2` and `workspace-tests@2` use the same sandboxes but judge time by the CPU time of the process, so a busy machine does not change a verdict; the limits are in `docs/difficulty.md`. Version 1 stays for old runs.

**Agent tasks** (`access: edit` in the experiment; `run` and `validate` refuse a workspace case without it). The runner copies the case's starter project (`datasets/<suite>/workspaces/<name>/`) into the call's isolated folder, and the harness gets its edit flags, so the agent can edit files and run commands there. The flags are recorded in `harness.settings.access_flags`. After the call the runner stores every changed or deleted file under `artifacts/.../workspace/` in the run. `workspace-tests@1` rebuilds the final workspace from that evidence alone, and checks it against the hidden check in `datasets/<suite>/checks/<name>/`, which the agent never gets. `probe.mjs` runs in a sandbox like the one of `js-function@1` and only reports what the agent's code returns. `expected.json` holds the answers and file rules (`exists`, `includes`, `same_as_starter`), and only the lab process reads it. So agent code in the sandbox cannot see the answers, and changed globals there can only spoil its own values. You can score a stored run again at any time, with no model call. If the starter project has changed since the run, the row gets no score, and `node lab score` says so, because the rebuild would not be the agent's workspace. The runner stores up to 200 changed files, 1 MB each and 5 MB in all; a file over a limit is listed under `skipped` in the score details, and probes that need it fail. Home paths are removed from stored UTF-8 text files; other files are stored as they are.

An agent is a program with a shell on your machine; the edit flags let it act without asking. Each call starts in its own folder: the runner also sets `PWD`, which OpenCode reads, and removes environment variables that name this repository. Edit access never runs with `workdir: repo`. Two tripwires keep a run honest. If a file anywhere in this repository changes during an agent call (all of it except `.git`, `node_modules`, `.cache` and the dashboard's `boards/`, `annotations/` and `reports/`, the current run included), the row gets the error `left_workdir`, the experiment stops, and the run is marked `harness.settings.halted`. `node lab score` skips a stopped run unless you pass `--force`. The message names the file: check it with `git diff`. If you edited that file yourself during the call, it is a false alarm; keep your work and run again. If the agent's tool calls name this repository, in any slash style, where it could read the hidden checks, the row also gets `left_workdir`. No process an agent call starts may outlive the call. On Windows each call gets a Job Object: every harness process the runner spawns goes into it, and so does every process that harness starts, however it detaches. After the call the runner ends the job (the log names what it ended), then takes the guard's second stamp, so whatever those processes wrote before they ended is seen. The harness starts through a small launcher that waits until the job holds it, so it cannot start a child first. The launcher has a fixed environment and gets its orders on a private channel the harness cannot reach. The run halts when a process survives that, when a harness process could not be put in the job, or when the job's helper (a PowerShell process) stopped during the call; if the helper is killed, Windows ends the job's processes anyway. A watch that cannot start makes no call, and the run resumes later. Outside Windows the runner lists processes a few times a second instead, and a fast double fork can get past that list. A tripwire is not an OS sandbox: a process started through a system service (Task Scheduler, WMI, a COM server) is not in the job, and a path the agent builds at run time can get past the folder check. Run agent tasks only with harnesses and models you trust on this machine.

Start with one case before a full sweep. For example, these calls cost nothing on the free OpenCode model:

```bash
node lab run experiments/ladder-code.yaml --harness opencode --repeats 1 --cases ladder-code-palindrome
node lab run experiments/ladder-agent.yaml --harness opencode --repeats 1 --cases ladder-agent-slugify-bug
```

## Where runs live

Runs are evidence, so they live outside git, where `git clean`, a removed worktree or a fresh clone cannot delete them. Name the data folder once per machine in `lab.local.yaml` at the repository root (the file is not committed):

```yaml
data_dir: ../Model-Lab-Data   # relative to this file, or an absolute path
```

- New runs go to `<data_dir>/results/`, and human annotations to `<data_dir>/annotations/`.
- Every git worktree of the repository uses the main checkout's `lab.local.yaml`, so all worktrees write to one store.
- The runner, `validate`, `score`, the report and the dashboard read the data folder and the runs committed in `results/` together. A run id found in both places is read from the data folder.
- `LAB_DATA=<folder>` overrides the file for one command. `LAB_ROOT` (fixtures, UI work) and the tests ignore `lab.local.yaml`.
- `node lab doctor` prints where runs are written.
- One runner at a time. `node lab run`, `--resume` and `node lab score` take a lock, `.lab-run.lock`, in each folder they write to: the data folder, the checkout's `results/`, and the folder of the evidence ledger (the main checkout). A second command is refused while the first one runs, from any worktree. A lock left by a crashed process is taken over, by one process only. If Windows gave the dead runner's process id to another program, the refusal names the lock file to delete. A dry run takes no lock.
- During an agent call the workdir guard watches everything the lab reads from a store, with no skip list: every run, row, score, folder (of any name) and link in each `results/`, the read-only bit, the real path of each store folder, the lock file, and both `lab.local.yaml` files. The data folder is fixed when the run starts. An agent that changes, adds or deletes anything there halts the experiment, and that run is not scored. A folder the guard cannot read after the call halts it too; before the call, no call is made and the run can be resumed.
- The data folder and `results/` must be plain folders: a store that is a junction or a symbolic link is refused before any call, because the guard cannot watch through it.
- Limits: the guard does not watch `annotations/`, because the dashboard saves ratings at any time. It reports a planted run and never deletes it, so that run stays visible until you remove it. It reads every stored file before and after each agent call, so that cost grows with the store.

### The evidence ledger

The guard only sees what changes while it watches. The ledger catches a run edited between commands later, whenever it is read. It detects; it does not prevent. The process watch ends what a call leaves running before the guard's second stamp, so a process of the call cannot write to the ledger later; a process started through a system service can.

- `lab.ledger.jsonl` at the main checkout (shared by every worktree, not committed) records each run as it is written: when it opens (with a hash of `run.json`'s fixed fields), each row with every file its call wrote and the size and hash of the events so far, a halt, a resume (before the resume writes anything), the sha256 of every file when it closes, and the scores files each score command wrote.
- **All or nothing.** A run counts in an aggregate (its rows and its scores) only when it is closed, every file matches its close entry, and every declared evaluator's scores are recorded and match its last scores entry exactly. Without a ledger no run counts (the fixture store has its own committed ledger). Every other run is listed in the dashboard and counts nowhere: a run still open or crashed, a halted run, a changed run, and a run whose scores do not match (a pill in the runs table says which).
- The first `node lab run`, `node lab score` or `node lab adopt` creates it and records every run already stored, as it is then (the main checkout's `results/` included).
- `validate`, `score`, `--resume` and the dashboard check each run against it. A run whose files do not match, that is not in it, or whose folder is not named after its `run_id` is flagged in the dashboard ("not in ledger" or "changed"), reported by `validate`, never scored and never resumed. An open run is checked as far as it goes (its `run.json` fixed fields, its recorded files, rows and events), so a resume can continue it. A run the ledger halted stays halted, whatever its `run.json` says, until you adopt it by name.
- When the guard halts a call, the runner puts the ledger back to the bytes it held before that call, plus the halt entry. Anything the agent wrote to the ledger is dropped and kept aside as `lab.ledger.halted-<run>-<id>.jsonl` for you to read.
- Scores are derived data. `node lab score <run>` recomputes them and records exactly the files it wrote. A score file of an evaluator this checkout cannot run is not rewritten and not recorded, so that run counts nowhere until you adopt it. A resume drops the run's old scores entry: they count again only after the run is scored. A closed run that was never scored counts nowhere until it is. Only the files of the run's own evaluators are read; any other file in `scores/` is reported by `validate` and never counted.
- Writes into a run folder never go through a link: a whole file is written to a new file and renamed into place, an appended file with a second link is copied first, and a folder on the way that is a link is refused.
- A ledger that exists but cannot be read trusts no run. A torn line (a crash during a write) loses only its own entry; `validate` shows it as a warning.
- A row that cannot be stored after a call the guard passed (a busy file, a full disk) stops the experiment. The run gets no close entry, so it stays open in the ledger and counts nowhere; a resume drops the half-stored row and its events and calls it again.
- A crash between a row and its ledger entry leaves one unrecorded last row; a resume drops it and calls it again.
- `node lab adopt <run-id>...` vouches for runs as they are now: a run copied from another clone, committed later, or checked by hand after a halt. `--all` adopts every run the ledger does not trust, but never a halted one: name a halted run to adopt it.
- The ledger has its own lock (`.lab-run.lock` beside it), so a command with another data folder cannot write to it during an agent call.
- It detects tampering; it does not prevent it. An agent runs with your file permissions. Real prevention needs OS isolation (a separate user or a sandbox), which the lab does not do.
- Without a ledger file (a fresh clone, the fixtures), every run reads as before.

Without `lab.local.yaml`, runs go to `results/` in the checkout, as before.

## How a comparison works

- **Quality** counts every call. A call that failed through the configuration (timeout, no answer, harness crash, `left_workdir`) scores 0. A call that was **lost** (a usage limit or rate limit, a failed sign-in, a missing CLI) says nothing about the configuration: it leaves the score and shows in the Lost column. `answered_quality` in `/api/state` is the mean over answered calls only.
- **Intervals** resample cases, then the repeats inside each case, and are never narrower than the Wilson interval on the number of cases. Repeats of one case are not independent, so three cases with three repeats count as three tasks. Below 3 cases there is no interval.
- **Model check.** Each row records `metadata.model_check`: `match`, `mismatch` (the harness reports another model, for example a fallback under load) or `unknown` (the harness reports none). The dashboard marks a configuration with a mismatch, and a model key with `pinned: false` (a free alias the provider can change).
- **Harnesses interleave.** One experiment runs repeat by repeat and case by case across every harness, so a slow hour or a usage limit hits all of them alike. The runner reads each harness version again at the end; a CLI that updated itself during the run gets `harness.settings.version_end`.

- **Configuration**: model + harness + harness version + effort + user setup. Its id is `<model_key>__<harness>-<version>__<effort|default>`, plus a suffix when the experiment asked to keep the user setup out: `__isolated` (kept out), `__isolated-partial` (partly kept out), `__isolated-leaked` (leaked) or `__isolated-unknown` (the flags prove nothing).
- **Context**: suite version + prompt version + evaluators + case set + repeats. The dashboard compares configurations only inside one context.
- **Controlled** comparison: exactly one axis differs (model, harness, effort, decoding, or setup). **Descriptive** comparison: more than one axis differs. The dashboard shows which axes differ.

Example: `smoke-harness-sweep` runs Claude Haiku 5.5 through Claude Code and through Command Code. That pair is a controlled harness comparison. The other targets differ in model and harness, so they are descriptive.

**Effort per target.** To compare efforts of one model, list them on the target:

```yaml
targets:
  - model: claude-haiku-5.5
    harness: claude-code
    efforts: [low, medium, high]   # or effort: high; "default" is the harness default
```

Each effort runs as its own run, and the three are a controlled effort comparison. A target without an effort uses the model's `reasoning_effort` from `configs/models.yaml`. The plan refuses an effort on a harness that has no effort control (see the table above).

## Layout

```
lab/                       The CLI: run, score, validate, doctor, runs, report, ladder
  adapters/                One file per built-in harness on one seam (cli.mjs); declared.mjs reads configs/harnesses.yaml
  evaluators/              Versioned scorers (exact-match, normalized-match, final-answer, js-function, svg-structure)
  lib/                     YAML and JSON Schema subsets, metrics, derived state
dashboard/                 Local UI: server.mjs, jobs.mjs (runs lab commands), public/ (Home, Run, Lab and Results; static, no build)
configs/models.yaml        Model registry: exact id, params, optional pricing, per-harness ids
configs/harnesses.yaml     Extra CLI harnesses, declared with no code
datasets/<suite>/          suite.yaml + cases.jsonl (ladder suites: also generate.mjs and defs/)
datasets/archive/<suite>/  Retired suites, unchanged, still loaded by old runs
configs/ladder.yaml        The difficulty ladder: tiers, expert time, tasks per tier and kind
prompts/<prompt>/          prompt.yaml + frozen vN.yaml templates
experiments/*.yaml         targets (model x harness), suite, prompt, repeats, evaluators (the Run page lists these)
experiments/archive/       Retired experiments; they still run by path
results/<run_id>/          Immutable run: run.json, raw.jsonl, scores/ (+ harness-events.ndjson, local only)
reports/                   Derived. Write it again; do not edit it
schemas/                   JSON Schema contract for every stored record
tests/                     node:test suite; fixtures/repo is a generated sample data root
docs/strategy.md           Principles, IDs, lifecycle, comparability rules
docs/dashboard-spec.md     Dashboard design, data contract, visual system
docs/difficulty.md         The ladder: tiers, expert time, calibration
```

Set `LAB_ROOT` to point the CLI and dashboard at another data root. The tests use `LAB_ROOT=tests/fixtures/repo`. In PowerShell, set it first: `$env:LAB_ROOT='tests/fixtures/repo'`.

Full rules: [docs/strategy.md](docs/strategy.md). Agent orientation: [AGENTS.md](AGENTS.md).
