# Run an experiment

`node lab run` turns an experiment file into one immutable run per harness: a manifest, one raw row per model x case x repeat, the harness event stream, and scores.

## Sub-features

- `run-dry` prints the plan (model id per harness, effort, forwarded and not-forwarded params) and writes nothing.
- `run-filter` limits a run with `--harness`, `--models`, `--repeats` and `--cases`.
- `run-live` calls each harness, writes `results/<run_id>/`, and scores the run.
- `run-errors` records a failed call as a row with `error` set; a run where every call failed is `failed`.
- `run-isolation` runs each CLI call in an empty temp folder that is its own git repository.
- `run-user-config` adds each harness's isolation flags when the experiment sets `user_config: isolated`, and records them in `run.json` `harness.settings`.
- `run-declared` runs a CLI declared in `configs/harnesses.yaml`, with no adapter code.

## How to get to it (user POV)

- `node lab run experiments/<name>.yaml [--dry-run] [--harness h] [--models a,b] [--repeats n] [--cases a,b]`
- `npm run lab -- run experiments/<name>.yaml`

## Driving it with the shell

Preconditions:

- A disposable data root: `ROOT=$(node .agents/skills/verify-model-lab/scripts/temp-root.mjs)`. It prints the path of a fresh copy of `tests/fixtures/repo` with this repository's `experiments/` and `configs/models.yaml`.
- For `run-live` only: `node lab doctor` shows the harness `ready`, and the owner approved the calls. Each call spends subscription quota or money.

- **Dry run.** Run `LAB_ROOT=$ROOT node lab run $ROOT/experiments/smoke-harness-sweep.yaml --dry-run`. Exit code `0`. Stdout has one line per target, for example `codex: gpt-6-luna-low → model "gpt-6-luna", effort low`, and ends with `Dry run: nothing was called or written.` `ls $ROOT/results` is unchanged.
- **Filter.** Run the same with `--models gpt-6-luna-low --repeats 1 --cases smoke-001 --dry-run`. Stdout says `1 call(s) across 1 harness(es)`. With `--models nope`, exit code `1` and `Error: No target matches models nope`.
- **Live, one call.** Run `LAB_ROOT=$ROOT node lab run $ROOT/experiments/smoke-harness-sweep.yaml --models gpt-6-luna-low --repeats 1 --cases smoke-001`. Stdout shows the run id, the answer, latency and tokens, `scored ... 1/1 passed` or `0/1`, and `completed`. Then `LAB_ROOT=$ROOT node lab validate` ends with `All inputs and records are valid.`
- **Error path, no live call.** `npm test -- --test-name-pattern "adapter that throws"` runs a fake harness that throws; the run is `failed` with one error row per call.
- **User setup.** Run `LAB_ROOT=$ROOT node lab run $ROOT/experiments/smoke-opencode.yaml --dry-run`. Each line says `user setup loaded` or `user setup skipped (<flags>)`. No live call: `npm test -- --test-name-pattern "user_config"` proves the flags reach the call, `run.json` records them, and the configuration id ends in `__isolated`.
- **Declared harness.** No live call: `node --test tests/harnesses.test.mjs` declares a fake CLI in a temp `configs/harnesses.yaml` and runs it as a real process. For a real CLI, add its entry, then `LAB_ROOT=$ROOT node lab doctor` lists it with source `declared`, and `LAB_ROOT=$ROOT node lab validate` reports any problem in the entry.
- **Proof.** Keep stdout, `$ROOT/results/<run_id>/run.json` and `raw.jsonl`. Check `run.json` `harness.settings.workdir_git_fence` is `true`.

## Gotchas

- Without `LAB_ROOT`, the run writes into this repository's `results/`, which is append-only evidence. Use a temp root for verification.
- CLI harnesses load the user's own global settings (for example `~/.claude/CLAUDE.md`), so input tokens differ between machines. That is measured overhead, not a bug. `user_config: isolated` removes part of it; `node lab doctor` shows which harnesses can.
- OpenCode errors that name a provider (for example `provider.chatgpt-limit`) come from the provider connected inside OpenCode, not from the lab.
- `gemini-cli` with a free Google sign-in fails with `error.type` `auth` (`IneligibleTierError`). Set `GEMINI_API_KEY`, or run Gemini models through `command-code`.
- A harness that is not installed is skipped with a message; the other harnesses still run.
