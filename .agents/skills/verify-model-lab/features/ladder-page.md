# Ladder evidence page

`/ladder.html` shows the difficulty ladder and what the stored runs do and do not show about it. It reads `state.ladder` from `/api/state`, the same numbers as `node lab ladder --calibrate` ([ladder-report.md](ladder-report.md)), and the basis of a task from `state.cases`. It writes nothing and calls no model.

## Sub-features

- `ladder-answer` opens the page. It gives how many tasks show a real disagreement, how many only one setup ran, and which pairs the runs can tell apart.
- `ladder-setups` has one row per setup and one column per tier: solved of counted, and the mean. A setup with fewer counted tasks than the ladder holds says so.
- `ladder-pairs` has one row per pair: tasks both ran, the tasks only one solved, the sign test p and what the runs show. Choosing two setups opens a card with the same numbers. A pair whose setups were not kept out equally, or that holds a leaked or unknown setup, reads `Differ, not a clean comparison`, never `Can tell apart`.
- `ladder-tasks` has one row per task, with filters by kind, tier and information class, and four sorts. Every tier value carries the word estimate. A setup with no result reads `not run`, never `0`.
- `ladder-empty` covers a root with no ladder, a ladder with no counted run, a suite that is refused (no number shown), and a load error.

## How to get to it (user POV)

`node lab dashboard`, then Ladder in the navigation, or `http://127.0.0.1:4317/ladder.html`. The filters and the chosen pair are in the URL hash.

## Driving it

Preconditions: `ROOT=$(node .agents/skills/verify-model-lab/scripts/temp-root.mjs)`, then `LAB_ROOT=$ROOT node lab dashboard --port 4318`.

- **Unit.** `node --test tests/dashboard-ladder.test.mjs` renders every block from the fixture and checks literal text.
- **Fixture page.** Open `/ladder.html`. Every `ladder-answer-fx-*` task appears.
- **Parity.** The page's counts equal `LAB_ROOT=$ROOT node lab ladder --calibrate --json`.
- **Layout.** Run the owner's layout checker on `/ladder.html` in light and dark. The "body and heading sizes" check does not apply: this repository follows its own type scale (`docs/dashboard-spec.md` §7.3).

## Gotchas

- The checker can measure before the first paint when `/api/state` is slow. Serve a saved copy of `/api/state` if a result looks wrong.
- `state.ladder` has no basis, so the page reads it from `state.cases`, and only when the level and minutes there match the ladder row.
