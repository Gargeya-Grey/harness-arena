# Compare configurations

The dashboard compares up to eight configurations (model + harness + version + effort) inside one context (suite + prompt + evaluators + cases + repeats).

## Sub-features

- `lineup` - the rail's Lineup section (`#tray`). Each entry gets a letter, A–H, by its place. Up, down and × buttons; drag to reorder. The Configurations section (`#cfg-search`, `#cfg-filters`, `#cfg-list`) adds and removes entries.
- `overview` - `#nav-overview`. KPI band (`#tiles`), leaderboard (`#lb`) with a findings box, and two charts (`#charts-body`).
- `answers` - `#nav-answers`. Grid (`#ans`): cases as rows, lineup entries as columns, a chip per repeat and the response text.
- `charts` - `#nav-charts`. Five SVG charts (`#charts-all`): quality against cost, latency, tokens, reliability, errors.
- `inspector` - a repeat chip in the answers grid opens `#inspector`, with the Answer, Metrics and Provenance tabs.
- `theme` - `#theme-toggle` switches light and dark.
- `narrow` - below 1024px the rail folds behind `#cfg-toggle` ("Lineup · N of 8 selected").
- `dropdowns` - every `<select>` (`#ctx-select`, `#board-select`, `#lb-sort-select` below 720px, `#rev-case`) shows as a themed button `#<id>-btn` with a listbox `#<id>-list`.

## How to get to it (user POV)

`node lab dashboard`, then open `http://127.0.0.1:4317` and select Compare, or open `http://127.0.0.1:4317/compare.html` directly (drive it there: the browser tools reach into the frame poorly). Pick a context in `#ctx-select`. The URL hash holds the view, context and lineup, so a copied URL reopens the same comparison.

## Driving it with the browser

Preconditions: the Launch steps in SKILL.md, with the fixture data root. The `smoke` context (4 cases, 3 repeats) has 6 configurations.

- **Lineup.** The page opens with up to four configurations already in the lineup. Remove all but one with ×, then add two with their Add buttons. The lineup shows A, B, C in order and `#tray-note` reads `3 / 8`. Move C up: the letters follow the new order in the leaderboard and charts.
- **Overview.** The Best quality tile in the fixture smoke context, with its default four configurations, shows two letters and `2-way tie`. In the `svg-mini` context (n = 2) the Fastest p50 tile says `n below 3: no winner yet`, and the findings box says the data is insufficient to rank. No tile, cell or chart shows `NaN`, `undefined` or `$0.0000` for a non-zero cost.
- **Answers.** Every cell shows `r0 r1 r2` chips and response text. "Only failures" hides cases where every repeat passed.
- **Charts.** Each card shows `n = …` and SVG and CSV buttons. The Errors chart's count text does not overlap its bars.
- **Inspector.** Select a chip. At 1440px the inspector docks on the right and the title starts with the letter. Escape closes it and focus returns to the chip.
- **Theme.** Select `#theme-toggle`, reload: the choice holds. Check both themes.
- **Narrow.** Chrome windows do not go below about 500px. Load the page in a 390px iframe on the same origin, then read `document.documentElement.scrollWidth` inside it: it must not exceed 390. The scatter shows letters only at that width.
- **Dropdowns.** Open `#ctx-select-btn`: the list is themed in light and dark, and two contexts with the same suite and prompt show different second lines. Focus the button, press ArrowDown, ArrowDown, Enter: the context and the URL hash change. Escape closes a list and focus returns to its button. A click outside closes it. `#board-select-btn` at the bottom of the rail opens upward.
- **Proof.** Screenshots of Overview, Answers and Charts in light and dark, an open dropdown in each theme, and the narrow frame.

## Gotchas

- A dashboard on port 4317 that was started before a server change serves old `/api/state` fields. Restart it before you judge numbers.
- `/api/state` is rebuilt per request; there is no file watcher. Use `#refresh` after a new run.
