# Validate and report

`node lab validate` checks every input and stored record against `schemas/` and the cross-file rules. `node lab runs` and `node lab report` read the stored evidence only.

## Sub-features

- `validate-clean` prints counts and `All inputs and records are valid.` with exit code `0`.
- `validate-faults` lists each problem as `<file>: <message>` with exit code `1`.
- `runs-ledger` lists runs newest first with status, rows and errors.
- `report-markdown` prints one comparison table per context; `--write` writes `reports/comparison.md`.
- `score-again` recomputes scores from `raw.jsonl` without model calls.

## How to get to it (user POV)

- `node lab validate`, `node lab runs`, `node lab report [--write]`, `node lab score <run-id> | --all`

## Driving it with the shell

Preconditions:

- `ROOT=$(node .agents/skills/verify-model-lab/scripts/temp-root.mjs)`

- **Clean.** Run `LAB_ROOT=$ROOT node lab validate`. Exit code `0`; the first line has `9 runs` and `77 rows`.
- **Fault.** Run `printf '{not json\n' >> $ROOT/results/$(ls $ROOT/results | head -1)/raw.jsonl` and validate again. Exit code `1`; one problem names that file and line.
- **Ledger.** Run `LAB_ROOT=$ROOT node lab runs`. Nine run ids, each with `n/n rows`.
- **Report.** Run `LAB_ROOT=$ROOT node lab report`. Three `##` context headings and a table whose first column holds labels such as `Claude Haiku 4.5 · claude-code 2.1.306`.
- **Score again.** Run `LAB_ROOT=$ROOT node lab score --all`. Then `git diff --no-index` between a score file and its copy from before shows no change in `passed` values.

## Gotchas

- `report --write` writes `reports/comparison.md` under the data root. With no `LAB_ROOT` it changes this repository.
- A completed run with fewer rows than models x cases x repeats is a validation problem, not a warning.
