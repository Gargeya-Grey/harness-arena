# Ladder evidence page

`/ladder.html` shows the difficulty ladder and what the stored runs do and do not show about it. It reads `state.ladder` from `/api/state`, the same numbers as `node lab ladder --calibrate` ([ladder-report.md](ladder-report.md)). It writes nothing and calls no model.

## Sub-features

- `ladder-answer` opens the page. It gives how many tasks show a real disagreement, how many only one setup ran, and which pairs the runs can tell apart.
- `ladder-setups` has one row per setup and one column per tier: solved of counted, and the mean. A setup with fewer counted tasks than the ladder holds says so.
- `ladder-pairs` has one row per pair: tasks both ran, the tasks only one solved, the sign test p and what the runs show. Choosing two setups opens a card with the same numbers. A pair whose setups were not kept out equally, or that holds a leaked or unknown setup, reads `Differ, not a clean comparison`, never `Can tell apart`.
- `ladder-tasks` has one row per task, with name/id/basis search, filters by kind/tier/information class, and four sorts. Every tier value carries the word estimate. A setup's missing score cell reads `no result`, never `0`; the group is explicitly labelled `No counted result`.
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

## Premium Ladder acceptance

- Coverage and used suite versions remain visible before the setup table. In the expanded verification root, 10 of68 tasks have counted results and58 do not. The exact numbers depend on the selected frozen versions; compare with the API, never a fixed total.
- Evidence-bearing tasks appear first. The named No counted result disclosure retains all other rows; this label does not claim they were never attempted. Show all tasks opens them. Explicit search or information filtering reveals matching rows directly.
- Close Task details and verify name, kind, estimated time, information class, coverage and any Check this task flag remain visible. Reopen details, search/clear, and refresh: disclosure/focus/caret state stays usable.
- Pair slots read First setup and Second setup, retaining global setup letters. Row filters change neither headline statistics nor setup comparisons. Search and chosen pair remain in the URL.
