# Feature map

One file per user-facing feature. Each file says how a user reaches the feature and how to drive and prove it.

| Feature | Surface | File | Sub-features |
|---|---|---|---|
| Run an experiment | CLI | [run-experiment.md](run-experiment.md) | run-dry, run-filter, run-effort, run-live, run-errors, run-cutoff, run-isolation, run-user-config, run-declared, run-agentic, run-resume, run-interleave |
| Visual web pilot | CLI and browser | [visual-web.md](visual-web.md) | visual-delivery, visual-render, visual-interactions, visual-review |
| Foldaway Apartment | CLI and browser | [foldaway-apartment.md](foldaway-apartment.md) | apartment-modes, apartment-timeline, apartment-clearance, apartment-reversal |
| Isolated user setup | CLI | [isolation-temp-home.md](isolation-temp-home.md) | iso-doctor, iso-dry, iso-record, iso-auth, iso-writeback |
| Validate and report | CLI | [validate-report.md](validate-report.md) | validate, report, new-case |
| Control page | Dashboard | [control-page.md](control-page.md) | home, run-preview, run-signal, run-start, run-progress, run-stop, explicit-selection, experiment-search, lab, appearance, shell, offline |
| Test library, effort and history | Dashboard and CLI | [history-controls.md](history-controls.md) | test-library, prepare-one, effort-selection, graph-navigation, visual-outputs, rerun-prefill, delete-run, reset-history, local-storage |
| Results page | Dashboard | [results-page.md](results-page.md) | head, answer, setups, choose, picker-search, cases, case-filters, side-panel, charts, metric-coverage, ratings, runs, disclosure-state, change-test, jobbar, old-links |
| Difficulty ladder report | CLI | [ladder-report.md](ladder-report.md) | ladder-table, ladder-calibrate, ladder-json, ladder-filter, ladder-archive |
| Ladder evidence page | Dashboard | [ladder-page.md](ladder-page.md) | ladder-answer, ladder-setups, ladder-pairs, ladder-tasks, ladder-search, ladder-coverage, ladder-disclosures, ladder-empty |
| Rate answers, saved views and Share | Dashboard | [results-rate-share.md](results-rate-share.md) | rate, saved-views, share |

Pick the file whose sub-feature names the change. A change to `results.css`, `results.js` or a module in `js/` touches every Results sub-feature: check light, dark, 390px and 1440px. A change to `js/verdict.js` changes the answer: run `tests/verdict.test.mjs`. A change to `control.css`, `control.js` or `dashboard/jobs.mjs` touches every control-page sub-feature. A change to `theme.css` or `shell.js` touches both pages.
