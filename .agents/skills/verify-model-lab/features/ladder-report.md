# Difficulty ladder report

`node lab ladder` shows where configurations separate on the difficulty ladder (`configs/ladder.yaml`, `docs/difficulty.md`). It reads only the derived view: the rows that count (closed, ledger-matched, scored runs), as the dashboard counts them, but pooled across experiments within one suite version per suite. It writes nothing and calls no model.

## Sub-features

- `ladder-table` prints one row per configuration and one column per tier. A cell is `solved/counted` tasks, then the mean score. A task is solved when its mean score over the counted repeats is 1. The last column is the total.
- `ladder-calibrate` (`--calibrate`) adds one line per ladder task: its tier, the number of configurations that ran it, and its information class: `no-data`, `one-config`, `all-solved`, `all-unsolved` or `disagree` (a task is solved by a configuration when its mean over the counted repeats is 1; one configuration is never `disagree`, and equal partial scores are `all-unsolved`). A line `Information: N disagree, ...` counts the classes. Under it, one line per pair of configurations: `<a> vs <b>: <shared> shared, <a only> and <b only>, p <sign test>`. The output has no band and no verdict. A task gets `negative discrimination` in the `check` column when, of two configurations that ran it, the one with the higher mean on the other tasks both ran scores under 0.5 on every repeat while the other scores 1 on every repeat (a 0.95 is not a failure).
- `ladder-versions` prints `Suite versions used: ...` under the table. Per suite it uses the newest suite version that has counted runs, and says how many counted runs of other versions it left out. `--suite-version <suite>@<version>` (repeat or comma-separate) picks another version. A suite version whose counted runs mix prompt versions, or quality evaluator versions, is refused with a message that names them; `--runs` narrows the choice. `--suite-version` for a suite that `--suite` leaves out is refused. Tiers, tier sizes and the case set come from the suite on disk, and a run does not store case metadata: when the scored version is not the version on disk, one `Warning:` line per suite says so (JSON: `warnings`), and the disk tiers are used.
- `ladder-json` (`--json`) prints the same data as `{ problems, filters, configs, tiers, cases, information, pairs, versions, warnings }`. Each case has an `information` class, and no mean, band or verdict. Each config has a `setup_state`. Runs of different setup states are different configs and never pool.
- `ladder-filter` limits the report with `--suite <ladder-answer|ladder-code|ladder-agent>` (or `answer`, `code`, `agent`) and `--runs <id,...>` (a run id, or part of one).
- `ladder-problems` prints ladder problems first: a case outside its tier, or a tier that does not hold the task counts of `configs/ladder.yaml`.
- `ladder-archive` reads old runs of retired suites without trouble: they are not ladder cases, so they do not enter the table.

## How to get to it (user POV)

- `node lab ladder [--calibrate] [--suite <id>] [--suite-version <suite>@<version>] [--runs <id,...>] [--json]`
- The dashboard job list allows `ladder` (no arguments).

## Driving it with the shell

Preconditions:

- `ROOT=$(node .agents/skills/verify-model-lab/scripts/temp-root.mjs)`. The temp root has the ladder table, the real `ladder-code` and `ladder-agent` suites, the fixture `ladder-answer` suite (12 tasks, so `ladder` prints 4 ladder problems about the answer task counts) and four counted fixture pilot runs of it: Claude Code leaked, Claude Code clean, Command Code partly kept out, Codex loaded.

- **Fixture table.** Run `LAB_ROOT=$ROOT node lab ladder`. Exit code `0`. Four configuration rows: the clean Claude Code id ends in `__isolated`, the leaked one in `__isolated-leaked`, Command Code in `__isolated-partial`. With `--calibrate`: `Information: 4 disagree, 1 one-config, 3 all-solved, 2 all-unsolved, 58 no-data.` and six pair lines.
- **Empty.** `LAB_ROOT=$ROOT node lab ladder --suite ladder-code` has the header `configuration  1 easy (2) ...`, no row, and `No counted ladder runs yet.` With `--calibrate`, its 28 tasks show `no-data`. A real root of 80 tasks and no counted run shows `no-data` for all 80.
- **Filter.** `LAB_ROOT=$ROOT node lab ladder --suite ladder-code --calibrate` lists 28 tasks. `--suite nope` exits `1` and names the three suites. `--runs no-such-run` exits `1`.
- **JSON.** `LAB_ROOT=$ROOT node lab ladder --json | node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(0,'utf8'))))"` prints `problems`, `filters`, `configs`, `tiers`, `cases`, `information`, `pairs`, `versions`, `warnings`.
- **Populated, no live call.** `node --test tests/ladder-report.test.mjs` builds a root with fake runs (and a run still running, and one changed after it was vouched for, which count nowhere) and checks literal values: solved counts, means, the five information classes, the pair evidence with hand-computed sign-test values, setup states that never pool, the legacy-id annotations and boards, the negative-discrimination flag (on shared tasks only), the suite-version choice and its refusals (mixed prompt or evaluator versions), the disk-version warning, the filters and the printed tables.
- **Live.** A pilot (`node lab run experiments/ladder-code.yaml --repeats 1`) costs quota; run it only when the owner asked. Then `node lab ladder --calibrate` reads it.

## Gotchas

- A cell with a `*` means the configuration has counted results for fewer tasks than the tier holds. Experiments differ in targets, so compare totals only between configurations that ran the same tasks. The negative-discrimination check already compares only shared tasks.
- A rate-limited or sign-in-failed call is lost: it leaves the mean. A timeout or crash counts as 0.
- A root without `configs/ladder.yaml` (for example `tests/fixtures/repo`) gives `No usable difficulty ladder`.
- The classes are a prompt to look at a task, not a ruling: the pilot panel is small (`docs/difficulty.md`, Evidence). A tier is a label of an expert-time estimate. The report does not say how a tier should score.
