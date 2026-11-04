# Feature map

One file per user-facing feature. Each file says how a user reaches the feature and how to drive and prove it.

| Feature | Surface | File | Sub-features |
|---|---|---|---|
| Run an experiment | CLI | [run-experiment.md](run-experiment.md) | run-dry, run-filter, run-live, run-errors, run-isolation, run-user-config, run-declared |
| Validate and report | CLI | [validate-report.md](validate-report.md) | validate, report |
| Compare configurations | Dashboard | [dashboard-compare.md](dashboard-compare.md) | lineup, overview, answers, charts, inspector, theme, narrow, dropdowns |
| Review, boards and export | Dashboard | [dashboard-review-boards.md](dashboard-review-boards.md) | blind-review, boards, export, runs |

Pick the file whose sub-feature names the change. A change to `dashboard/public/styles.css` or `js/charts.js` touches every dashboard sub-feature: check light, dark and a narrow width.
