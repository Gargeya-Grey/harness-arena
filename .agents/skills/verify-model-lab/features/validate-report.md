# Validate and report

`node lab validate` checks every input and stored record against `schemas/` and the cross-file rules. `node lab runs` and `node lab report` read the stored evidence only.

## Sub-features

- `validate-clean` prints counts and `All inputs and records are valid.` with exit code `0`.
- `validate-faults` lists each problem as `<file>: <message>` with exit code `1`.
- `runs-ledger` lists runs newest first with status, rows and errors.
- `report-markdown` prints one comparison table per context; `--write` writes `reports/comparison.md`.
- `score-again` recomputes scores from `raw.jsonl` without model calls.
- `new-case` scaffolds a case (`node lab new-case <suite> <slug> [--agent]`); `validate` reports each `<<FILL IN>>` marker left. An archived suite is refused.
- `validate-archive` checks the suites in `datasets/archive/<id>/` and the experiments in `experiments/archive/`, never takes `datasets/archive` for a suite, and refuses a suite id that is in `datasets/` and in `datasets/archive/`.

## How to get to it (user POV)

- `node lab validate`, `node lab runs`, `node lab report [--write]`, `node lab score <run-id> | --all`

## Driving it with the shell

Preconditions:

- `ROOT=$(node .agents/skills/verify-model-lab/scripts/temp-root.mjs)`

- **Clean.** Run `LAB_ROOT=$ROOT node lab validate`. Exit code `0`; the first line has `9 runs` and `77 rows`.
- **Fault.** Run `printf '{not json\n' >> $ROOT/results/$(ls $ROOT/results | head -1)/raw.jsonl` and validate again. Exit code `1`; one problem names that file and line.
- **Ledger.** Run `LAB_ROOT=$ROOT node lab runs`. Nine run ids, each with `n/n rows`.
- **Report.** Run `LAB_ROOT=$ROOT node lab report`. Three `##` context headings and a table whose first column holds labels such as `Claude Haiku 4.5 · claude-code 2.1.306`.
- **Report columns.** The table has `n (cases)`, `Failed` and `Lost`. A free alias (`pinned: false`) shows `(alias, not pinned)` after its label.
- **New case.** Run `LAB_ROOT=$ROOT node lab new-case smoke my-case`. It prints the files it wrote and the new suite version. `LAB_ROOT=$ROOT node lab validate` now exits `1` with a problem that names `datasets/smoke/cases.jsonl` and `<<FILL IN>>`.
- **Archive.** `LAB_ROOT=$ROOT node lab validate` counts the archived suites. Copy one back (`cp -r $ROOT/datasets/archive/coding $ROOT/datasets/coding`) and validate again: exit code `1`, one problem says the suite is in both places. Remove the copy. `LAB_ROOT=$ROOT node lab new-case reasoning x` exits `1` and says the suite is archived.
- **Score again.** Run `LAB_ROOT=$ROOT node lab score --all`. Then `git diff --no-index` between a score file and its copy from before shows no change in `passed` values.

## Gotchas

- `report --write` writes `reports/comparison.md` under the data root. With no `LAB_ROOT` it changes this repository.
- A completed run with fewer rows than models x cases x repeats is a validation problem, not a warning.
