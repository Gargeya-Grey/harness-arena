# Difficulty ladder report

`node lab ladder` shows where configurations separate on the difficulty ladder (`configs/ladder.yaml`, `docs/difficulty.md`). It reads only the derived view: the rows that count (closed, ledger-matched, scored runs), the same rows as the dashboard. It writes nothing and calls no model.

## Sub-features

- `ladder-table` prints one row per configuration and one column per tier. A cell is `solved/counted` tasks, then the mean score. A task is solved when its mean score over the counted repeats is 1. The last column is the total.
- `ladder-calibrate` (`--calibrate`) adds one line per ladder task: its mean across the configurations that ran it, their number, its tier's target band, and a verdict: `in band`, `move to <tier>`, `rework` or `no data`. A task that a configuration with a lower total solves, while one with a higher total fails on every repeat, gets `negative discrimination` in the `check` column.
- `ladder-json` (`--json`) prints the same data as `{ problems, filters, configs, tiers, cases }`.
- `ladder-filter` limits the report with `--suite <ladder-answer|ladder-code|ladder-agent>` (or `answer`, `code`, `agent`) and `--runs <id,...>` (a run id, or part of one).
- `ladder-problems` prints ladder problems first: a case outside its tier, or a tier that does not hold the task counts of `configs/ladder.yaml`.
- `ladder-archive` reads old runs of retired suites without trouble: they are not ladder cases, so they do not enter the table.

## How to get to it (user POV)

- `node lab ladder [--calibrate] [--suite <id>] [--runs <id,...>] [--json]`
- The dashboard job list allows `ladder` (no arguments).

## Driving it with the shell

Preconditions:

- `ROOT=$(node .agents/skills/verify-model-lab/scripts/temp-root.mjs)`. The temp root has the ladder table and the three ladder suites, and runs of the smoke suite only.

- **Empty.** Run `LAB_ROOT=$ROOT node lab ladder`. Exit code `0`. Stdout has the header `configuration  1 easy (5)  2 medium (10) ...`, no row, and `No counted ladder runs yet.` With `--calibrate`, all 80 tasks show `no data`.
- **Filter.** `LAB_ROOT=$ROOT node lab ladder --suite ladder-code --calibrate` lists 28 tasks. `--suite nope` exits `1` and names the three suites. `--runs no-such-run` exits `1`.
- **JSON.** `LAB_ROOT=$ROOT node lab ladder --json | node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(0,'utf8'))))"` prints `problems`, `filters`, `configs`, `tiers`, `cases`.
- **Populated, no live call.** `node --test tests/ladder-report.test.mjs` builds a root with fake runs (and a run still running, and one changed after it was vouched for, which count nowhere) and checks literal values: solved counts, means, a `move to` verdict, a `rework` verdict, the negative-discrimination flag, the filters and the printed tables.
- **Live.** A pilot (`node lab run experiments/ladder-code.yaml --repeats 1`) costs quota; run it only when the owner asked. Then `node lab ladder --calibrate` reads it.

## Gotchas

- A cell with a `*` means the configuration has counted results for fewer tasks than the tier holds. Experiments differ in targets, so compare totals only between configurations that ran the same tasks.
- A rate-limited or sign-in-failed call is lost: it leaves the mean. A timeout or crash counts as 0.
- A root without `configs/ladder.yaml` (for example `tests/fixtures/repo`) gives `No usable difficulty ladder`.
- The verdicts are a prompt to look at a task, not a ruling: the pilot panel is small (`docs/difficulty.md`, Calibration).
