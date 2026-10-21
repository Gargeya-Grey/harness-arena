# Harness Arena

Run the same test cases through different harnesses and models, then compare them side by side in **Model Lab**, a local dashboard.

Claude Code, Codex, Gemini CLI, Command Code and direct APIs answer the same prompts. Every call is stored as evidence. Configurations get letters A–H, and the dashboard shows quality, cost, latency, tokens, reliability and errors for each one, with the full answer one click away. Zero dependencies: Node and nothing else.

A **harness** is the program that calls the model: a coding CLI such as Claude Code, Codex, Gemini CLI or Command Code, or a direct API. One **configuration** is one model through one harness at one effort. Every call is stored as evidence in `results/`, and the dashboard and the report read only that evidence.

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
| `node lab doctor` | Shows each harness, its version, and whether it is ready (CLI installed, API key set). |
| `node lab run <experiment.yaml>` | Runs every target x case x repeat. Writes one run per harness under `results/`, then scores it. |
| `  --harness <name>` / `--models <a,b>` | Runs only the targets that match. |
| `  --repeats <n>` / `--cases <a,b>` | Overrides the experiment. The run records the override. |
| `  --dry-run` | Shows the plan: model ids, effort, the params each harness forwards. Calls nothing. |
| `node lab score <run-id> \| --all` | Computes scores again from `raw.jsonl`. Makes no model calls. |
| `node lab validate` | Checks every input and stored record against `schemas/`. |
| `node lab runs` | Lists runs, newest first. |
| `node lab report [--write]` | Prints a Markdown comparison per context, or writes `reports/comparison.md`. |
| `node lab dashboard [--port n]` | Starts the local dashboard. |
| `npm test` | Runs the test suite (`tests/*.test.mjs`). |

## Harnesses

| Harness | Kind | Uses | Effort | Decoding params |
|---|---|---|---|---|
| `claude-code` | CLI | your Claude sign-in | yes (`--effort`) | not forwarded |
| `codex` | CLI | your ChatGPT or OpenAI sign-in | yes (`model_reasoning_effort`) | not forwarded |
| `command-code` | CLI | your Command Code sign-in | yes (`--effort`) | not forwarded |
| `gemini-cli` | CLI | your Google sign-in or `GEMINI_API_KEY` | no | not forwarded |
| `anthropic-api` | API | `ANTHROPIC_API_KEY` | yes | forwarded |
| `openai-api` | API | `OPENAI_API_KEY` (`OPENAI_BASE_URL` optional) | yes | forwarded |
| `openrouter-api` | API | `OPENROUTER_API_KEY` | yes | forwarded |
| `deepseek-api` | API | `DEEPSEEK_API_KEY` | yes | forwarded |

A CLI harness does not forward `temperature` or `max_tokens`. Each raw row lists those params in `metadata.params_not_applied`, so the dashboard can show that the harness defaults applied.

Each CLI call runs in an empty, isolated folder that is its own git repository. Thus no harness reads this repository, or a git repository above the temp folder, into its prompt. The measured input tokens are the harness's own overhead plus the prompt. To measure a harness inside this repository, set `workdir: repo` in the experiment.

Cost is API-equivalent. It is computed from the registry price, also for subscription harnesses that do not bill per token.

## How a comparison works

- **Configuration**: model + harness + harness version + effort. Its id is `<model_key>__<harness>-<version>__<effort|default>`.
- **Context**: suite version + prompt version + evaluators + case set + repeats. The dashboard compares configurations only inside one context.
- **Controlled** comparison: exactly one axis differs (model, harness, effort, or decoding). **Descriptive** comparison: more than one axis differs. The dashboard shows which axes differ.

Example: `smoke-harness-sweep` runs Claude Haiku 5.5 through Claude Code and through Command Code. That pair is a controlled harness comparison. The other targets differ in model and harness, so they are descriptive.

## Layout

```
lab/                       The CLI: run, score, validate, doctor, runs, report
  adapters/                One file per harness: build the call, parse its output
  evaluators/              Versioned scorers (exact-match@1, normalized-match@1, svg-structure@1)
  lib/                     YAML and JSON Schema subsets, metrics, derived state
dashboard/                 Local comparison UI: server.mjs + public/ (static, no build)
configs/models.yaml        Model registry: exact id, params, pricing, per-harness ids
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
