# Feature map

One file per user-facing feature. Each file says how a user reaches the feature and how to drive and prove it.

| Feature | Surface | File | Sub-features |
|---|---|---|---|
| Run an experiment | CLI | [run-experiment.md](run-experiment.md) | run-dry, run-filter, run-live, run-errors, run-isolation, run-user-config, run-declared, run-agentic, run-resume, run-interleave |
| Isolated user setup | CLI | [isolation-temp-home.md](isolation-temp-home.md) | iso-doctor, iso-dry, iso-record, iso-auth, iso-writeback |
| Validate and report | CLI | [validate-report.md](validate-report.md) | validate, report, new-case |
| Control page | Dashboard | [control-page.md](control-page.md) | home, run-preview, run-start, run-stop, runs-score, runs-resume, harnesses, checks, activity, appearance, offline |
| Compare configurations | Dashboard | [dashboard-compare.md](dashboard-compare.md) | lineup, overview, answers, charts, inspector, theme, narrow, dropdowns |
| Review, boards and export | Dashboard | [dashboard-review-boards.md](dashboard-review-boards.md) | blind-review, boards, export, runs |

Pick the file whose sub-feature names the change. A change to `dashboard/public/styles.css` or `js/charts.js` touches every comparison sub-feature: check light, dark and a narrow width. A change to `control.css`, `control.js` or `dashboard/jobs.mjs` touches every control-page sub-feature.
