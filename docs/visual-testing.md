# Visual testing

`visual-web` is an exploratory five-task suite beside the canonical 80-task ladder. It covers semantic HTML, an interior studio portfolio, a 2D planner, a furnished Three.js room and a room configurator. Its tier labels are untimed expert estimates. They need human timing and broader pilot coverage before claiming calibrated difficulty.

## Run and inspect

```powershell
node lab run experiments/visual-web-repaired-explicit-effort.yaml --dry-run
node lab run experiments/visual-web-repaired-explicit-effort.yaml
node tools/visual-web/inspect.mjs --runs <id1,id2,id3> --out .cache/verify/<new-directory>
```

On native Windows, isolated Codex calls reuse the installed sandbox with bounded per-call context:

```powershell
node lab run experiments/visual-web-repaired-explicit-effort.yaml --harness opencode
node lab run experiments/visual-web-repaired-explicit-effort.yaml --harness claude-code
node lab run experiments/visual-web-repaired-explicit-effort.yaml --harness codex
```

The combined matrix makes 15 calls, one per task and configuration, using the owner's sign-ins. Targets are Beam free through OpenCode, Haiku 5.5 through Claude Code, and GPT-6.1 Terra through Codex at high effort. Beam is a mutable free alias. The models, harnesses and Windows Codex setup differ, so outcomes describe configurations. Codex setup is labelled partly kept out on Windows, not clean isolation. Use `--cases <id>` or `--harness <name>` for smaller runs. Calls are sequential and use the normal evidence ledger and run lock.

Current suite 1.1.0 uses `workspace-tests@3` with dimension `format`. It measures only whether `index.html` was delivered and is nonempty. It does not assert valid HTML, functional behavior or visual quality. The regression proof deliberately accepts a nonempty text file to keep that limitation explicit. Frozen 1.0.0 and its version 2 scores remain available for historical runs.

The separate browser inspector rebuilds the exact stored workspace, refuses changed suite hashes and untrusted/open runs, opens a new temporary Chromium profile, and exercises the stated page contracts. It captures desktop, phone and interaction screenshots. It measures rendered geometry, real Three.js object/render readiness, lighting/camera changes, planner state and configurator persistence. The check implementation hash, source run IDs, workspace hashes and browser version are recorded in `report.json`. Reports are derived observations, not native quality scores or ledger entries. Existing report directories cannot be overwritten.

Chromium must already be installed. Set `LAB_CHROME` to its executable if it is not in a standard location. The inspector uses that browser and built-in Node modules, installs no project dependencies, and makes no model calls. The Three.js module is pinned in the frozen prompt; its CDN must be reachable. Separate a CDN/browser failure from a model defect when interpreting a result. Software WebGL in a headless browser establishes rendering, not physical GPU performance.

Codex CLI 0.169.0 on Windows retains the owner's installed home and verified sandbox backend. Per-call flags skip user config and rules, suppress personal memory, skill catalogs, plugins, apps and hooks, clear inherited session identifiers, and scope work to the benchmark folder. A model-free capture verifies the effective prompt and tool inventory. Global `AGENTS.md` still loads, so the recorded setup is **partly kept out**. The sandbox permits filesystem reads beyond the workspace; trace review remains necessary. No global configuration or sandbox secrets are changed or copied.

The adapter refuses a missing or unrecognized backend and an elevated backend without existing setup markers before the model call. These checks cannot guarantee that Windows will never need a later runtime repair. Fresh elevated homes are not created. The old `visual-web-codex-installed.yaml` remains the historical loaded configuration. `visual-web-terra-recovery.yaml` reruns only the unchanged fifth case with bounded context and a new immutable run. Preserve the earlier exclusion. A repository mention is conservatively excluded; its message does not claim a hidden-check read without evidence.

The harder [Foldaway Apartment family](foldaway-apartment.md) adds three versions of one transformation system, plus an authored playable reference and independent geometry/browser checks. It does not alter these five cases or the canonical ladder.

## Visual review

Browser observation version 2 validates against `schemas/browser-observation.schema.json`. A judged check has a boolean `passed`. A dependent check blocked by a failed prerequisite has `passed: null`, `status: blocked` and `blocked_by`. Unfinished transition observations have `status: incomplete` and a reason. Summaries keep these observations outside the judged denominator. The inspector waits for permitted transitions, checks effective mesh visibility and framing, and exercises configurator choices, both clamp directions, restoration, reset and reduced motion. See [benchmark repairs](benchmark-repairs.md) for version boundaries.

Read each case's `metadata.visual_review`, then inspect both viewport screenshots and the interaction state. Record observations about composition, typography, spacing, illustrations/furniture, lighting and the clarity of controls. Mark each stated requirement pass, fail or unverified, with the screenshot or action that supports it. A subjective review is labelled as a reviewer judgement; it is not an objective score. Do not infer attractive design from a file check, DOM match or nonblank framebuffer.

One repeat is a pilot. It cannot establish reliability, and one case per tier cannot establish a configuration's general capability at that tier. Models and harnesses vary together. Retain timeouts, provider errors, skipped artifacts and console failures. Compare configurations only on the cases both actually completed under compatible conditions.

## Difficulty review

Use `node lab ladder --calibrate` to inspect the suite versions named by its output. For current inputs, select them explicitly, for example `--suite-version ladder-answer@3.0.0 --suite-version ladder-code@3.0.0 --suite-version ladder-agent@2.0.0`. Missing counted runs are missing evidence. Historical tasks and leaked user setups cannot validate a replacement suite or a clean setup. An answer task solved with computation tools violates the no-computer condition even if its answer is correct; inspect tool evidence before using such rows as calibration evidence.

All-unsolved and negative-discrimination flags call for checking the task, reference, attempt and conditions. A task moves tier only with evidence that its expert-time estimate was wrong. Keep stable IDs and freeze a previously used suite before changing its cases. Historical score bands in retirement notes are superseded policy, not current acceptance criteria.

## Verification

```powershell
node --test tests/visual-web.test.mjs tests/visual-browser.test.mjs
node lab validate
npm test
```

The browser regression tests pass a real semantic page, then break its landmarks, link and layout. A blank canvas with fake scene hooks must fail the Three.js checks. Tests report skipped when Chromium is absent; that is not browser proof. The inspector closes its own pages, server and browser, then removes its scratch workspace rebuilds and attempts browser profile removal. If Windows refuses profile deletion after Chrome stops, the report records the retained path separately from browser shutdown; it does not claim the profile was removed. Immutable runs and retained screenshots stay in place.
