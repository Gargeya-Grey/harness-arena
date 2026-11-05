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

`node lab dashboard` opens the control page at `http://127.0.0.1:4317`. From there you run everything without a terminal:

- **Run**: pick an experiment, then a harness, models, cases and repeats. Preview shows the plan and calls nothing. Start asks once (`Start N calls?`), then runs and shows the live output. Stop lets the current call finish and keeps the run.
- **Runs**: every stored run. Score again makes no model calls.
- **Compare**: the comparison views, on their own page at `/compare.html`.
- **Appearance**: theme colour, light or dark, and motion, for both pages.
- **Harnesses**, **Checks**, **Activity**: `doctor`; `validate`, `report`, `runs`; the output of every job.

The page runs the same `node lab` commands you would type, one at a time, on this machine only. It accepts no other command.

A smaller first run is one case and one repeat:

```bash
node lab run experiments/smoke-harness-sweep.yaml --repeats 1 --cases smoke-001
```

### First test with OpenCode

Three experiments compare two free OpenCode models (`beam-free`, `pulse-alpha-free`) on the three real suites. Only the model differs. Start with one case each, then run the full experiment:

```bash
node lab run experiments/opencode-reasoning.yaml --repeats 1 --cases reasoning-bat-ball
node lab run experiments/opencode-coding.yaml    --repeats 1 --cases coding-roman
node lab run experiments/opencode-agentic.yaml   --repeats 1 --cases agentic-slugify-bug
node lab run experiments/opencode-reasoning.yaml # 90 calls
node lab run experiments/opencode-coding.yaml    # 48 calls
node lab run experiments/opencode-agentic.yaml   # 18 calls, up to 15 minutes each
node lab dashboard
```

To add any other model that OpenCode reaches (`opencode models` lists them), add a key to `configs/models.yaml` with `model: <provider>/<model>`, add a target with that key, and run `node lab validate`.

## Commands

| Command | What it does |
|---|---|
| `node lab doctor` | Shows each harness (built-in and declared), its version, whether it is installed, and what isolation it supports. |
| `node lab run <experiment.yaml>` | Runs every target x case x repeat. Writes one run per harness under `results/`, then scores it. |
| `  --harness <name>` / `--models <a,b>` | Runs only the targets that match. |
| `  --repeats <n>` / `--cases <a,b>` | Overrides the experiment. The run records the override. |
| `  --dry-run` | Shows the plan: model id per harness, effort, whether the user setup loads. Calls nothing. |
| `node lab score <run-id> \| --all` | Computes scores again from `raw.jsonl`. Makes no model calls. |
| `node lab validate` | Checks every input and stored record against `schemas/`. |
| `node lab runs` | Lists runs, newest first. |
| `node lab report [--write]` | Prints a Markdown comparison per context, or writes `reports/comparison.md`. |
| `node lab dashboard [--port n]` | Starts the local control page and comparison dashboard. |
| `npm test` | Runs the test suite (`tests/*.test.mjs`). |

## Harnesses

| Harness | CLI | Model id | Effort | Isolation (`user_config: isolated`) |
|---|---|---|---|---|
| `claude-code` | `claude` | `claude-haiku-5-5` | yes (`--effort`) | partial: skips user settings, MCP servers, skills; built-in plugins still load |
| `codex` | `codex` | `gpt-6-luna` | yes (`model_reasoning_effort`) | none |
| `command-code` | `cmdc` | `deepseek/deepseek-v4.1-flash` | yes (`--effort`) | partial: skips skills |
| `gemini-cli` | `gemini` | `gemini-3.8-flash` | no | none |
| `opencode` | `opencode` (2.x) | `<provider>/<model>`, e.g. `opencode/beam-free`, `openai/gpt-6-luna` | yes (`#variant`) | none |

Every harness uses your own sign-in. OpenCode reaches any provider you connect inside OpenCode (`opencode auth login`), so OpenRouter or any other provider needs no change here: name it in the model id. Each OpenCode call runs on a private server (`--standalone`), and the runner deletes the session it made unless the experiment sets `persist_sessions: true`. Each row records whether that worked in `metadata.harness_extra.session_deleted`.

**Connect another CLI** with no code: add it to `configs/harnesses.yaml`. That file documents every field. `node lab doctor` lists it and `node lab validate` checks it.

**User setup.** A CLI harness loads your own global setup: instructions, skills, MCP servers. That changes tokens, time and behaviour, differently for each harness. Set `user_config: isolated` in an experiment to keep it out where the harness has flags for it. The run records the exact flags in `harness.settings.user_config_flags`. A harness without such flags records `user_config: loaded`. A measured example: Claude Code went from 34,525 to 29,316 prompt tokens on a one-word answer.

A CLI harness does not forward `temperature` or `max_tokens`. Each raw row lists those params in `metadata.params_not_applied`.

Each CLI call runs in an empty, isolated folder that is its own git repository. Thus no harness reads this repository, or a git repository above the temp folder, into its prompt. To measure a harness inside this repository, set `workdir: repo` in the experiment.

Cost is optional. With `pricing` in the registry entry, the dashboard shows an API-equivalent cost. Without it, cost is n/a. A subscription bill does not change per call.

## Suites

| Suite | Cases | Prompt | Evaluator | Experiment |
|---|---|---|---|---|
| `smoke` | 4 one-word questions | `qa-single-turn` | `normalized-match@1`, `exact-match@1` | `smoke-harness-sweep`, `smoke-opencode` |
| `reasoning` | 15 word problems, many with a trap answer | `reasoning-final-answer` | `final-answer@1`: the last `Answer:` line; numbers compare as numbers | `reasoning-sweep` |
| `coding` | 8 JavaScript functions with hidden tests | `js-function` | `js-function@1`: share of tests passed | `coding-sweep` |
| `agentic` | 3 agent tasks in small starter projects: fix a bug, add a feature, write a parser with tests | `agent-task` | `workspace-tests@1`: share of hidden tests passed on the agent's final files | `agentic-sweep` |

`js-function@1` runs the model's code in its own Node process with the permission model on. The code can read only the sandbox runner file, and cannot write files, start processes, use workers, load addons or open `node:sqlite` (which gets past the permission model). The process gets none of your environment variables (Windows adds a few system ones, such as `PATH`), a 256 MB heap and a time limit. Each test gets a fresh context and 2 seconds. The expected values never enter the sandbox, and the lab counts only the result line that carries a random nonce, so escaped code cannot fake a score. Node does not limit network access or signals: code in the sandbox can use `fetch` and can send a signal to your other processes. So the sandbox keeps your files safe from that code, but it is not a network jail or an OS sandbox.

**Agent tasks** (`access: edit` in the experiment; `run` and `validate` refuse a workspace case without it). The runner copies the case's starter project (`datasets/<suite>/workspaces/<name>/`) into the call's isolated folder, and the harness gets its edit flags, so the agent can edit files and run commands there. The flags are recorded in `harness.settings.access_flags`. After the call the runner stores every changed or deleted file under `artifacts/.../workspace/` in the run. `workspace-tests@1` rebuilds the final workspace from that evidence alone, and checks it against the hidden check in `datasets/<suite>/checks/<name>/`, which the agent never gets. `probe.mjs` runs in a sandbox like the one of `js-function@1` and only reports what the agent's code returns. `expected.json` holds the answers and file rules (`exists`, `includes`, `same_as_starter`), and only the lab process reads it. So agent code in the sandbox cannot see the answers, and changed globals there can only spoil its own values. You can score a stored run again at any time, with no model call. If the starter project has changed since the run, the row gets no score, and `node lab score` says so, because the rebuild would not be the agent's workspace. The runner stores up to 200 changed files, 1 MB each and 5 MB in all; a file over a limit is listed under `skipped` in the score details, and probes that need it fail. Home paths are removed from stored UTF-8 text files; other files are stored as they are.

An agent is a program with a shell on your machine; the edit flags let it act without asking. Each call starts in its own folder: the runner also sets `PWD`, which OpenCode reads, and removes environment variables that name this repository. Edit access never runs with `workdir: repo`. Two tripwires keep a run honest. If a file anywhere in this repository changes during an agent call (all of it except `.git`, `node_modules` and `.cache`, the current run included), the row gets the error `left_workdir`, the experiment stops, and the run is marked `harness.settings.halted`. `node lab score` skips a stopped run unless you pass `--force`. The message names the file: check it with `git diff`. If you edited that file yourself during the call, it is a false alarm; keep your work and run again. If the agent's tool calls name this repository, in any slash style, where it could read the hidden checks, the row also gets `left_workdir`. A tripwire is not an OS sandbox: a process the agent leaves running, or a path it builds at run time, can get past it. Run agent tasks only with harnesses and models you trust on this machine.

Start with one case before a full sweep. For example, this call costs nothing on the free OpenCode model:

```bash
node lab run experiments/coding-sweep.yaml --harness opencode --repeats 1 --cases coding-roman
node lab run experiments/agentic-sweep.yaml --harness opencode --repeats 1 --cases agentic-slugify-bug
```

## How a comparison works

- **Configuration**: model + harness + harness version + effort + user setup. Its id is `<model_key>__<harness>-<version>__<effort|default>`, plus `__isolated` when the run kept the user setup out.
- **Context**: suite version + prompt version + evaluators + case set + repeats. The dashboard compares configurations only inside one context.
- **Controlled** comparison: exactly one axis differs (model, harness, effort, decoding, or setup). **Descriptive** comparison: more than one axis differs. The dashboard shows which axes differ.

Example: `smoke-harness-sweep` runs Claude Haiku 5.5 through Claude Code and through Command Code. That pair is a controlled harness comparison. The other targets differ in model and harness, so they are descriptive.

## Layout

```
lab/                       The CLI: run, score, validate, doctor, runs, report
  adapters/                One file per built-in harness on one seam (cli.mjs); declared.mjs reads configs/harnesses.yaml
  evaluators/              Versioned scorers (exact-match, normalized-match, final-answer, js-function, svg-structure)
  lib/                     YAML and JSON Schema subsets, metrics, derived state
dashboard/                 Local UI: server.mjs, jobs.mjs (runs lab commands), public/ (control page + compare, static, no build)
configs/models.yaml        Model registry: exact id, params, optional pricing, per-harness ids
configs/harnesses.yaml     Extra CLI harnesses, declared with no code
datasets/<suite>/          suite.yaml + cases.jsonl
prompts/<prompt>/          prompt.yaml + frozen vN.yaml templates
experiments/*.yaml         targets (model x harness), suite, prompt, repeats, evaluators
results/<run_id>/          Immutable run: run.json, raw.jsonl, scores/ (+ harness-events.ndjson, local only)
reports/                   Derived. Write it again; do not edit it
schemas/                   JSON Schema contract for every stored record
tests/                     node:test suite; fixtures/repo is a generated sample data root
docs/strategy.md           Principles, IDs, lifecycle, comparability rules
docs/dashboard-spec.md     Dashboard design, data contract, visual system
```

Set `LAB_ROOT` to point the CLI and dashboard at another data root. The tests use `LAB_ROOT=tests/fixtures/repo`. In PowerShell, set it first: `$env:LAB_ROOT='tests/fixtures/repo'`.

Full rules: [docs/strategy.md](docs/strategy.md). Agent orientation: [AGENTS.md](AGENTS.md).
