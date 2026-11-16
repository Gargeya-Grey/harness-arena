# Results page

`/results.html` shows one test (a context: suite version, prompt, checks, cases, tries) and compares up to eight setups (model + harness + version + effort). Design: `docs/dashboard-spec.md` section 6. The answer sentence follows fixed rules in `dashboard/public/js/verdict.js`, pinned by `tests/verdict.test.mjs`.

## Sub-features

- `head` - `#test-title` (the suite id, capitalised) and `#test-meta` ("4 cases · 3 tries each · 6 setups · <date>"). Change test (`[data-act=change-test]`) and Share (`#share-btn`) on the right.
- `answer` - `#answer`: one large sentence, then errors and unchecked answers, then the fairness line ("Fair test: …" or "Mixed test: …"). One setup: a run report with a link to Run.
- `setups` - `#setups`: one row per setup, best first. Columns appear only when they hold a value. Best values carry the accent and a dot, explained in `#setups-foot`. `#details-btn` adds Slow end, Pass range, Price per pass, Tokens per try. A setup whose run kept the user setup out only in part, leaked it, or did not record the proof carries a chip under its name (`.who-sub.warn[data-setup-state]`: `partly kept out`, `leaked` or `unknown`). A kept-out or loaded setup has no chip.
- `choose` - `#choose-btn` opens `dialog#pick-setups`: tick up to 8 setups, Show them (`#choose-apply`).
- `cases` - `#cases`: one row per case, one mark per try (`.tm-pass` ✓, `.tm-fail` ×, `.tm-error` !, `.tm-unscored` ○). `#only-btn` (a switch) keeps only the cases where setups differ. A test with no score at all has no switch and no agreement line. When answers are stored with no score (for example a stopped run), `#answer` says "N answers are stored with no score, so nothing counts yet."
- `side-panel` - a mark opens `#inspector`: Answer and Evidence tabs, next try and next setup buttons. Escape closes it; focus returns to the mark.
- `charts` - `#charts-main` holds the charts that carry a result; `details#charts-more` holds the rest. Below 440px of chart width a chart is drawn 1.35 times narrower and shown at full width.
- `ratings` - `#ratings-sect`, only when the test has ratings: one row per saved rating, newest first (when, case and try, setup, rating, choice, notes).
- `runs` - `#runs`: the runs of the test, newest first, with Score again per run. A guard-stopped run needs Score anyway, then Confirm: score it. A run that stopped without finishing shows that state and a **Resume** button (`data-act="resume"`, starts `node lab run --resume <run_id>`). A run that counts in no result says why under its status (`not counted: ...`).
- `change-test` - `dialog#pick-test`: saved views, then tests by suite; older versions under "Earlier versions".
- `jobbar` - `#jobbar`: a thin bar while a job runs ("Run of <experiment> · N of M answers"). The page reloads its data when a run or score job ends.
- `old-links` - `/compare.html#…` forwards to `/results.html#…` with the hash kept; `#view=answers&ctx=…&cfg=…` still opens the test and setups.

## How to get to it (user POV)

`node lab dashboard`, then open `http://127.0.0.1:4317` and select Results in the rail, or a test under Latest results on Home. The URL hash holds the test, the chosen setups and the switch (`#ctx=…&cfg=a,b&only=1`).

## Driving it with the browser

Preconditions: the Launch steps in SKILL.md, with the fixture data root. The fixture `smoke` test with 3 tries has 4 cases and 6 setups; `svg-mini` has pictures and no automatic check; one `smoke` test has a single setup.

- **Answer.** Open the 6-setup smoke test. The answer reads "Claude Haiku 4.5 · claude-code (12 of 12) and Gemini 2.5 Flash (11 of 11) passed the most. The other 4 setups are close enough that the gaps may be chance." and the fairness line starts "Mixed test".
- **Setups.** The table has Setup, Passed, Typical time, API price, Errors. Details adds four columns and its label turns to "Hide details". No cell shows `NaN`, `undefined` or `$0.0000` for a non-zero price.
- **Choose setups.** Untick all but two, Show them: the table has two rows, and the hash has `cfg=`. Reload: the same two show.
- **Case by case.** 72 marks (6 setups × 4 cases × 3 tries). Turn on Only where setups differ: fewer rows, and `#cases-note` reads "N of 4 cases differ".
- **Side panel.** Select a mark. At 1440px the page makes room for the panel and the mark keeps a halo. Next try moves along the case. Escape closes it, and focus returns to the mark.
- **Unjudged verification.** A row without a score says that no automatic verdict is stored and verification is unjudged or unavailable. It must not claim that the task lacks an automatic check. For a proven case failure with unfinished probes, only judged probes enter the check count. Each unfinished probe has visible unjudged text and is not announced as failed. `tests/dashboard-ui.test.mjs` covers these render paths; verify the side panel against a disposable fixture root in Chromium too.
- **Charts.** Time, Passed against price and Consistency show first; Tokens and Outcomes sit under More charts. Open the one-setup test: no chart shows first.
- **Runs.** Score again on a fixture run starts a `score <run id>` job (`--force` only after Confirm: score it on a stopped run); the job bar shows, and the row stays when it ends.
- **Phone.** At 360px and 390px the tables become cards, chart text reads at 16px or more, and `document.documentElement.scrollWidth` does not exceed the viewport.
- **Proof.** Screenshots of the page in light and dark at 1440px, the side panel, Change test, and the 390px page.

## Gotchas

- A dashboard on port 4317 that was started before a server change serves old `/api/state` fields. Restart it before you judge numbers.
- Changing only the hash does not reload scripts. After an edit to a page script, open another page first, then the page again.
- The layout checker measures hidden content inside a closed `<details>` unless the fold hides it with `display: none`; `theme.css` does that for every fold.
