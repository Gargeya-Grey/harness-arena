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

A smaller first run is one case and one repeat:

```bash
node lab run experiments/smoke-harness-sweep.yaml --repeats 1 --cases smoke-001
```

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
| `node lab dashboard [--port n]` | Starts the local dashboard. |
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

## How a comparison works

- **Configuration**: model + harness + harness version + effort + user setup. Its id is `<model_key>__<harness>-<version>__<effort|default>`, plus `__isolated` when the run kept the user setup out.
- **Context**: suite version + prompt version + evaluators + case set + repeats. The dashboard compares configurations only inside one context.
- **Controlled** comparison: exactly one axis differs (model, harness, effort, decoding, or setup). **Descriptive** comparison: more than one axis differs. The dashboard shows which axes differ.

Example: `smoke-harness-sweep` runs Claude Haiku 5.5 through Claude Code and through Command Code. That pair is a controlled harness comparison. The other targets differ in model and harness, so they are descriptive.

## Layout

```
lab/                       The CLI: run, score, validate, doctor, runs, report
  adapters/                One file per built-in harness on one seam (cli.mjs); declared.mjs reads configs/harnesses.yaml
  evaluators/              Versioned scorers (exact-match@1, normalized-match@1, svg-structure@1)
  lib/                     YAML and JSON Schema subsets, metrics, derived state
dashboard/                 Local comparison UI: server.mjs + public/ (static, no build)
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

Set `LAB_ROOT` to point the CLI and dashboard at another data root. The tests use `LAB_ROOT=tests/fixtures/repo`.

Full rules: [docs/strategy.md](docs/strategy.md). Agent orientation: [AGENTS.md](AGENTS.md).
