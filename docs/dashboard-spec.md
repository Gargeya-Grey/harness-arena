# Dashboard specification

**Status:** built through Phase 4 (see §10). In November 2026 Results replaced the Compare workspace and the Runs page (§6, §13). Sections 5-7 and 13 describe the dashboard as built; the original React plan is replaced by a zero-dependency Node server and vanilla ES modules. This is the implementation contract for the local comparison dashboard. It extends `docs/strategy.md` with artifact and annotation storage; the existing run invariants still apply.

## 1. Goals

- Local-only, private, single-user. Start it when needed; close it when done.
- Compare model configurations on quality, reliability, cost, latency, errors, and multimodal artifacts.
- Make every number traceable to a run, case, repeat, raw row, and artifact.
- Support blind human review for creative outputs.
- Produce share-ready exports: chart PNG/SVG, CSV/Markdown/JSON, artifact downloads, composed share cards.
- Start with one command. No database, no accounts, no external services.

**Non-goals:** hosting, multi-user access, authentication, PDF reports, mobile app, local model inference.

## 2. Decision log

| Decision | Choice |
|---|---|
| Audience and deployment | Local, private, single-user web app |
| Data plumbing | Local Node server (`dashboard/server.mjs`) plus vanilla ES modules; no database, no build step |
| Comparison interaction | One Results page per test: the answer sentence, the setups table, case by case, charts, runs. Up to 8 setups shown, lettered A–H in table order |
| Compatibility | Shared context is enforced; configuration axes are diffed and labeled |
| Comparison entity | Configuration = model + harness + harness version + effort |
| Cost | Notional API-equivalent cost, labeled as not billed |
| First multimodal test | Constrained SVG generation, then animated SVG, then three.js |
| Artifact storage | Raw output committed; derived renders regenerable; large media local and hashed |
| Human review | Blind, case-by-case, 1-5 ratings, notes, random pairwise A/B |
| Annotation storage | Append-only JSONL, separate from machine scores |
| Information architecture | Four places: Home, Run, Results, Lab. Saved views sit in Change test and Share |
| Charts | Hand-drawn SVG: time, passed against price, consistency, tokens, outcomes. A chart shows first only when it carries a result |
| Export | One Share menu for the whole result: link, saved view, Markdown, CSV, JSON, and a wide or square picture |
| Visual direction | One design language for both pages: the owner's Odicto design system, with a light mode derived from it. Light and dark themes |
| Stack | Node 22 built-ins only: `node:http`, `node:fs`, `node:test`; browser ES modules; hand-written SVG |

## 3. Domain model

### 3.1 Configuration

A configuration (a setup on screen) is the unit Results compares.

| Field | Source | Example |
|---|---|---|
| `model_key` | `configs/models.yaml` | `deepseek-v4.1-flash-max` |
| `provider` | registry | `deepseek` |
| `model` | registry | `deepseek/deepseek-v4.1-flash` |
| `harness.name` | `run.json` | `command-code` |
| `harness.version` | `run.json` | `1.86.3` |
| `reasoning_effort` | model entry or harness settings | `max` |
| `temperature`, `max_tokens` | applied request params | `null` when harness defaults applied |
| `access_method` | `run.json` | `subscription` |

`config_id` is computed, not stored:

```
<model_key>__<harness-name>-<harness-version>__<effort-or-default>
```

Example: `deepseek-v4.1-flash-max__command-code-1.86.3__max`.

The shelf groups configurations by provider and model display name. Harness and effort appear as badges. The same model through two harnesses is two configurations.

### 3.2 Comparison context

A comparison is valid only when every selected configuration shares this context:

- suite id and version
- prompt id and version
- evaluator ids and versions
- exact case id set
- repeat count

If the context differs, the dashboard blocks the comparison and explains which field differs.

### 3.3 Controlled vs descriptive comparisons

Configuration axes are `model`, `harness`, `effort`, and `decoding` (temperature, max tokens, seed, and other applied params).

- **Controlled comparison:** exactly one axis varies. The dashboard may use causal language.
- **Descriptive comparison:** more than one axis varies. The dashboard shows a visible "descriptive" badge, lists the differing axes, and avoids causal claims.

This resolves the tension between strict comparability and comparing whatever access you have. Context is always enforced; configuration differences are surfaced rather than hidden. The fairness line under the answer names what varies. If the shown setups vary on several axes, it reads "Mixed test" rather than blocking the view.

### 3.4 Observation

An observation is one raw row plus its run manifest, scores, artifacts, and human annotations. Its identity is:

```
(run_id, case_id, config_id, repeat)
```

### 3.5 Missing data

- `not run`: the case/model/repeat combination has no raw row. Render as a hatched cell or a gap, never as zero.
- `failed`: a raw row exists with `error` set. Render as an error mark and include it in error-rate denominators.
- `no score`: a raw row exists but no evaluator output. Render as "unscored", not zero.

## 4. Storage additions

### 4.1 Artifacts

Add an optional `artifacts` array to each raw result row:

```json
{
  "artifacts": [
    {
      "artifact_id": "svg-001__deepseek-v4.1-flash-max__r0__raw",
      "role": "raw",
      "mime": "image/svg+xml",
      "path": "artifacts/svg-001/deepseek-v4.1-flash-max__command-code-1.86.3__max/r0/output.svg",
      "sha256": "…",
      "derived": false
    },
    {
      "artifact_id": "svg-001__deepseek-v4.1-flash-max__r0__render",
      "role": "render",
      "mime": "image/png",
      "path": "artifacts/svg-001/deepseek-v4.1-flash-max__command-code-1.86.3__max/r0/render.png",
      "sha256": "…",
      "derived": true
    }
  ]
}
```

Paths are relative to `results/<run_id>/`. The dashboard resolves them against the run directory and rejects traversal.

Artifact roles: `raw`, `render`, `thumbnail`, `capture`, `reference`.

Artifact metadata sidecar, written next to the files:

```json
{
  "schema_version": 1,
  "artifact_id": "…",
  "role": "raw",
  "mime": "image/svg+xml",
  "source": "model",
  "renderer": "native-svg",
  "width": 512,
  "height": 512,
  "duration_ms": null,
  "sha256": "…",
  "created_at": "2026-10-21T08:04:28.923Z",
  "sanitized": true
}
```

Commit policy:

- Commit raw text, SVG, small images, and `artifact.json`.
- Treat screenshots, thumbnails, and captured video as derived. Gitignore them and regenerate on demand.
- Keep large raw media in a local `artifacts/` store referenced by SHA-256. The repo remains lean; the raw evidence remains hashed and traceable.
- Refuse to commit any single file above 10 MB. The limit is configurable.

### 4.2 Annotations

Human review writes to a top-level append-only file: `annotations/human@1.jsonl`.

```json
{
  "annotation_id": "01J…",
  "run_id": "20261021T080428Z__smoke__smoke-command-code__900ca7",
  "case_id": "svg-001",
  "config_id": "deepseek-v4.1-flash-max__command-code-1.86.3__max",
  "repeat": 0,
  "reviewer": "owner",
  "created_at": "2026-10-21T09:00:00.000Z",
  "scale": "1-5",
  "value": 4,
  "notes": "Clean geometry; antennae are uneven.",
  "pair_id": null,
  "pair_choice": null,
  "revealed": true,
  "supersedes": null
}
```

Rules:

- Never edit or delete an annotation. Corrections append a new record with `supersedes`.
- Pairwise records include `pair_id` and `pair_choice` (`A` or `B`); `value` may be null.
- Human ratings are a separate dimension. They never overwrite or silently blend with machine scores.
- The dashboard is the only writer, through a validated local endpoint.

### 4.3 Boards

Saved comparisons live in `boards/*.json`:

```json
{
  "board_id": "svg-baseline",
  "title": "SVG robot · Command Code vs API",
  "created_at": "2026-10-21T09:00:00.000Z",
  "updated_at": "2026-10-21T09:00:00.000Z",
  "context": {
    "suite": "svg-primitives",
    "prompt": "svg-scene",
    "cases": ["svg-001", "svg-002", "svg-003"],
    "repeats": 3
  },
  "treatment_axis": "model",
  "configs": ["…", "…"],
  "view": { "only": true }
}
```

On screen a board is a saved view (§6.7). Results writes `view.only` (the "Only where setups differ" switch); boards saved by the old Compare page keep their other `view` fields, and Results ignores them. Boards store references, never copied results. A saved view whose test has no stored runs now stays in the list, disabled, with the reason.

### 4.4 Derived cache

Not built. The server rebuilds `/api/state` from the files on every request. When volume makes that slow, `.cache/dashboard/` will hold thumbnails, normalized indices, and regenerated renders. It is gitignored and safe to delete. Deleting it never deletes evidence.

### 4.5 Schema files

Add and validate:

- `schemas/artifact.schema.json`
- `schemas/annotation.schema.json`
- `schemas/board.schema.json`
- updated `schemas/result.schema.json` with the optional `artifacts` array

## 5. Architecture

### 5.1 Repository layout

```
dashboard/
  server.mjs              local server: indexer, /api routes, static files
  jobs.mjs                starts allowlisted `node lab` commands as jobs (section 13)
  public/
    index.html            control page: Home, Run, Lab (section 13)
    control.css/.js       control page style and script; boot.js applies theme before paint
    results.html/.css/.js Results (section 6)
    compare.html/.js      forwards old Compare links to /results.html, hash kept
    theme.css, shell.js   shared tokens, components and the app rail
    js/                   one module per part: verdict (the answer rules), summary,
                          setups, cases, charts, runs, inspector, review, dialogs,
                          exporter, words, model, ...
    fonts/                Instrument Sans and IBM Plex Mono, served locally
boards/                   saved comparison boards (repo root)
```

The server never calls a model itself. The control page starts the CLI as a child process (`dashboard/jobs.mjs`); the CLI makes the calls and writes the evidence, exactly as in a terminal. Results only reads evidence, apart from writing ratings and saved views and starting a score job.

### 5.2 Stack

- Node 22 or newer, no npm dependencies. `node lab dashboard` starts it.
- Browser ES modules, no bundler. Charts are SVG strings built in `js/charts.js`.
- Tests: `node --test` (`npm test`). Record checks: `node lab validate`.

### 5.3 Server endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/state` | The whole index: contexts, configs, observations, cases, runs, annotations, boards, problems, meta |
| GET | `/api/artifact?…` | Artifact bytes with the correct MIME type |
| POST | `/api/annotations` | Append one validated annotation |
| POST | `/api/boards` | Create or update a board |
| DELETE | `/api/boards/:id` | Delete a board file |
| GET | `/api/catalog` | Experiments (targets, case ids, access, user setup), harness names, model keys |
| GET | `/api/jobs` | Jobs since the server started, newest first, and the running job id |
| POST | `/api/jobs` | Start one job: `{command: run\|score\|validate\|doctor\|runs\|report, ...}`. 409 while another job runs |
| GET | `/api/jobs/:id?since=n` | One job and its output lines from line `n` |
| POST | `/api/jobs/:id/cancel` | Stop a job (section 13) |

Bind to `127.0.0.1` only. Reject requests with a non-local `Host` header, and any write with a foreign `Origin` or a non-JSON body. No external network calls. There is no file watcher and no event stream: both pages poll `/api/jobs` and read `/api/state` again when a run or score job ends.

### 5.4 Indexing

- Every `/api/state` request scans `results/*/run.json`, `raw.jsonl`, `scores/*.jsonl`, `annotations/*.jsonl` and `boards/*.json`.
- Records that fail to parse or validate appear in `problems` instead of failing the whole dashboard.
- Aggregates are computed on read. Nothing is materialized.

### 5.5 Rendering boundary

- Static SVG: serve as `image/svg+xml` with a sandbox CSP (`default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox`) and display through `<img>`, which runs no script and loads nothing external. The server does not rewrite the file.
- HTML or three.js: serve in a sandboxed iframe with `sandbox="allow-scripts"`, no `allow-same-origin`, no top navigation, no forms, no popups.
- CSP for generated documents: `default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; connect-src 'none'; sandbox allow-scripts`.
- Vendor three.js locally. Inject a local import map. A generated scene that imports from a CDN fails the render check by design.
- Video and audio use native elements with `controls`, no autoplay, and range requests.
- Playwright capture uses a fixed viewport: 1280×720, 30 fps, maximum 10 seconds.

## 6. Interface

Two pages share one app rail: the control page `/` (Home, Run, Lab; §13) and Results (`/results.html`). Results replaced the Compare workspace and the Runs page in November 2026. `/compare.html` now only forwards to `/results.html` and keeps the hash, so old links still open.

Five rules decide every screen:

- **Answer first.** A result opens with one sentence: who did better, by how much, and how sure the data lets us be. The numbers below support that sentence.
- **Show what exists; say once what is missing.** An empty metric is left out, and one quiet line says why ("No API prices: these models are free or not priced.").
- **One name for each thing** (§6.1). p50, n, CI and r0 never appear on the main path.
- **Detail on demand, in three levels:** sentence, then table, then one answer. Each level is one click from the level above.
- **The page fits the test.** One setup gives a run report. Too few tries name no winner.

### 6.1 Words

Screens use plain words. Files, schemas and the CLI keep their own.

| On screen | In the files | Meaning |
|---|---|---|
| Setup | configuration, target | A model through a harness at one effort |
| Test | context | One suite version with its prompt, checks, cases and tries. Named by the suite id, capitalised: "Agentic" |
| Try | repeat | One call of one case, counted from 1 |
| Answer | observation, raw row | What one try returned |
| Check | evaluator, score | What decides passed or failed |
| Passed | quality, pass rate | "9 of 9": tries passed of tries decided |
| Typical time | p50 latency | Half the tries were faster |
| Slow end | p95 latency | 1 try in 20 was slower (Details only) |
| API price | notional cost | What the calls would cost at list price; not billed |
| Fair test / Mixed test | controlled / descriptive | One axis differs / more than one axis differs |
| Gave no answer | error | The call failed or timed out |
| Not checked | unscored | No check decided this answer; it counts neither way |

Experiment, run and harness keep their names.

### 6.2 Results page

One column, up to 1120px, read top to bottom. At 1440 × 900 the head, the answer and the setups table fit above the fold.

1. **Head.** The test name and one line under it: "3 cases · 3 tries each · 2 setups · 5 Nov 2026". One case is named instead of counted ("1 case: Csv quotes"). Tries count what is stored, so two runs of one test read "2 tries each". The parts of this line never break inside. On the right: Change test and Share.
2. **Answer.** One sentence in large type (§6.3), then smaller sentences for errors and unchecked answers, then the fairness line.
3. **Setups.** One row per setup, best first: passed share, then typical time. Columns: Setup (name, harness under it), Passed (a bar and "9 of 9"), Typical time, API price (only when a price exists), Errors (only when one exists). The best value in a column carries the accent and a dot, and a foot note explains the dot; when every row ties, nothing is marked. Details adds Slow end, Pass range (Wilson 95%), Price per pass and Tokens per try. Choose setups picks up to 8 of the test's setups; by default the 8 best are shown.
4. **Case by case.** One row per case, named in words. One mark per try: passed (✓), failed (×), gave no answer (!), not checked (○). Marks differ by shape, not only by colour, and each has a full name for a screen reader. A mark opens the side panel (§6.4). The switch "Only where setups differ" hides the cases every shown setup agrees on; it is on by default from 5 cases.
5. **Charts.** A chart shows only when it carries a result (§6.5). The others wait under "More charts"; when none is shown first, the fold reads "All charts".
6. **Your ratings.** Only when the test has ratings: every saved rating, newest first, with when, the case and try, the setup, the rating ("4 of 5"), the choice from the row's setup ("Better than …", "… was better", "Same as …") and the notes.
7. **Runs.** The runs the test is built from, newest first: started, experiment and harness, answers stored of expected, errors, and status (Finished, Incomplete, Stopped, Failed, Running). Score again checks one run's answers again and calls no model. A run the guard stopped shows why ("the agent wrote outside its folder") and needs Score anyway, then Confirm: score it. While any job runs, these buttons wait. Run ids fold under "Run ids".

A thin bar on top shows a running job ("Run of agentic-sweep · 4 of 36 answers") and links to its output. When a run or score job ends, the page reads the data again.

States:

- **No results:** "No results yet", with a link to Run.
- **One setup:** a run report ("Beam (free) passed 1 of 1 case in 22 s.") and a link to run another setup on the test. No fairness line.
- **Pictures, or answers no check decided:** the answer says "Not scored automatically" and offers Rate answers (§6.6).
- **Phone (720px and below):** the setups, cases, ratings and runs tables become one card per row with labels; nothing scrolls sideways.

### 6.3 The answer

`js/verdict.js` builds the answer by fixed rules; `tests/verdict.test.mjs` pins every sentence.

- A setup counts its decided tries: checked, plus gave no answer. Below 3 decided tries per setup the answer names no winner and the best-value marks are off. With fewer than 3 tries it says "Too few tries to name a winner." and asks for 3 tries per case; with enough tries but too few checked ones it says "Too few checked tries to name a winner." A setup "passed every try" only when no try of the test went unchecked; otherwise the words are "every checked try".
- Passed shares are compared with a two-sided mid-p Fisher exact test at 0.05, between every leader and every other setup. A gap is clear only when every pair is: "A passed more: 9 of 9, against 5 of 9." Otherwise the answer names the setups within chance: "Echo, with 2 of 3, is close enough that the gap may be chance.", two by name, three or more by count ("The other 4 setups are close enough that the gaps may be chance.").
- The best-value marks say "best in this column", as "passed the most" does, whether the gap is clear or within chance.
- When passes tie, the faster setup is named only when each has 3 or more timed tries and the slower typical time is at least 10% above the faster one. Otherwise the answer says the times were level. When no setup passed a try, the answer says so ("Neither setup passed a try.") and names no faster one.
- Errors add a sentence ("GPT-5 mini gave no answer in 1 of 12 tries (time-out)."). Unchecked answers add "1 answer was not checked, so it counts neither way."
- The fairness line reads "Fair test: only the model differs." when one axis differs among the shown setups, and otherwise "Mixed test: … differ. Read differences as hints, not causes."

### 6.4 Side panel

A try mark opens the side panel: 460px on the right. From 1280px the page makes room for it; below that it covers the page. The open mark keeps a halo. Two tabs:

- **Answer:** the error first when there is one, then the check (for an agent task, each probe), the files the agent changed, and the answer text or the picture. Buttons move to the next try of the case and to the next setup. Rate this answer opens the rating dialog.
- **Evidence:** run, setup, model id, harness and version, effort, settings applied, prompt, case, try, and start and finish times.

Escape closes the panel, and focus returns to the mark.

### 6.5 Charts

Hand-drawn SVG in `js/charts.js`. Setups are told apart by their letter (A–H, in table order) and name, never by colour. Marks are ink; the accent marks the best value; the danger colour marks no answer.

| Chart | Shown first when |
|---|---|
| Time per try (typical time dot, slow end ring) | 2 or more setups have timed tries |
| Passed against price | 2 or more setups have a price and a passed share |
| Consistency (how often the tries of one case agreed) | 2 or more tries per case, and the setups differ |
| Tokens per try | Never: under More charts |
| Outcomes (every try: passed, failed, no answer, not checked) | Never: under More charts |

Ticks use one unit per axis and are fitted to their labels: no two labels come closer than 6px, and the last tick leaves at most a third of the axis empty. A price axis turns to a log scale when the dearest price is more than 10 times the cheapest; the caption then says so. Below 440px of chart width (a phone) a chart is drawn 1.35 times narrower and shown at full width, so its smallest text (12px) reads at 16.2px.

### 6.6 Rate answers

A dialog shows one case's task, then two answers side by side as Answer A and Answer B, from two setups, with the names hidden. A coin flip picks the sides. Rate A from 1 to 5, choose A is better, B is better or Same, and add notes. Save reveals the names, appends one annotation and adds a row under Your ratings; Rate another moves to the next case. Cancel or Escape writes nothing. A rating sits beside the automatic check, never in place of it. The action shows on tests with pictures or unchecked answers, and on tests that already have ratings.

### 6.7 Change test and saved views

Change test lists the saved views first, then the tests grouped by suite, newest first. Each entry shows its meta line and the first sentence of its answer, so a test can be found by what happened in it. The open test is marked. Older suite versions fold under "Earlier versions"; the fold opens by itself when the open test is in it.

Share › Save view stores the test and the setups shown as a board (§4.3). Saving under the same title updates that view. A saved view is removed in two steps (Remove, then Confirm remove); removing a view deletes the choice only, never a run. The URL hash holds the test, the chosen setups and the switch (`#ctx=…&cfg=a,b&only=1`), so every view is also a link.

### 6.8 Share

One menu holds every export of the whole result:

- **Link:** Copy link, Save view.
- **Table:** Copy as Markdown, Download CSV, Download JSON. They carry what the page says: the title, the meta line, the answer, the fairness line, and one row per setup with the best values marked.
- **Picture:** Wide (16:9, 1600 × 900) and Square (1:1, 1080 × 1080), drawn in the fixed light palette whatever the theme.

### 6.9 Accessibility

- Every action works from the keyboard. Dialogs trap Tab and return focus to the control that opened them.
- Focus rings: 2px, offset, visible in both themes.
- Colour never carries meaning alone: try marks differ by shape, best values carry a dot as well as the accent.
- Tables use real table semantics, with column and row headers.
- One live region announces loads, saves and job results.
- No text under 12px. `prefers-reduced-motion` and the Motion setting are honoured.

## 7. Visual system

Both pages use one visual system: the owner's Odicto design system, with a light mode derived from it. `dashboard/public/theme.css` holds the tokens and the shared components (rail, run card, nav, buttons, wells, segmented control, status marks, chips, count pills, the fold marker, toasts). `dashboard/public/shell.js` draws the app rail on both pages. Page rules live in `control.css` (Home, Run, Lab) and `results.css` (Results).

### 7.1 Themes and tokens

- Colours are OKLCH, built from the theme hue `--h` and chroma scale `--k` (Appearance: Forest, Ocean, Plum, Ember, Graphite). Lightness is fixed per mode.
- Dark is Odicto as written. Light keeps the same token names: canvas 0.972, near-white glass, text 0.235, accent 0.48. The light accent was chosen so accent text passes 4.5:1 on every surface for all five theme colours.
- Mode: `theme` in `localStorage` (`light` or `dark`); no value follows `prefers-color-scheme`. `[data-theme]` on the root wins. `boot.js` applies it before the first paint, and both pages listen for the change.

### 7.2 Identity in charts

Setups are told apart by their letter and name, not by colour. Charts draw in ink and line tones; the accent marks the best value and the danger colour marks no answer. A chart is readable in greyscale.

### 7.3 Typography

- One font for words and numbers: Instrument Sans with tabular figures (measured: "1111" and "0000" are the same width). IBM Plex Mono only for code, ids and model answers. Both are served locally from `public/fonts/`.
- Odicto's type scale: page title 34px (28 under 900px), answer sentence 18-22px, row titles 15px, body 14px, row text 12.5-13.5px, section labels 11.5px uppercase. No other text under 12px.
- A meta line ("3 cases · 3 tries each · …") breaks only between its parts.

### 7.4 Space, shape, motion

- Controls 32-44px high; every control and chip is at least 44px under `(pointer: coarse)`.
- Panels (tables, charts, groups) are glass: radius 18, a top rim and a soft lift shadow. Fields are wells (inset). Menus, the side panel and dialogs float above the glass.
- Every fold (`<details>`) uses one marker: a chevron that turns when it opens (`summary.disclose`). A closed fold takes its content out of layout.
- Motion: one easing curve and three durations (120, 180, 320ms). The current item carries the glowing 2px stem: the nav pill and the segmented knob slide to it. The Motion setting (Full, Reduced, Off) and `prefers-reduced-motion` reduce or remove it.

### 7.5 Pictures

- Share › Wide picture (1600 × 900) or Square picture (1080 × 1080): the test name, the meta line, the answer, and the setups table with the best values underlined.
- Drawn on a canvas in the fixed light palette, whatever the page theme. Text at least 16px at picture scale.

## 8. Metrics

| Metric | Definition | Uncertainty and edge cases |
|---|---|---|
| Quality | Mean evaluator value per configuration, 0-1; a failed call counts as 0, a lost call (usage limit, sign-in, CLI missing) is left out | Bootstrap 95% interval clustered by case (cases, then repeats), widened to Wilson on the case count, from 3 cases; show `n` and the case count; mark insufficient data |
| Pass rate | Passed observations / counted observations (scored plus failed) | Same clustered bootstrap; unscored and lost excluded and counted |
| Reliability | Repeat agreement: frequency of the majority outcome per case, averaged across cases | Only cases with 2+ repeats; score variance shown separately |
| Cost | Notional API-equivalent cost from stored `cost_usd` | Label "not billed"; subscription amortization deferred |
| Cost per passed case | Total cost / passed observations | `null` when no passes; show `n` |
| Latency | Harness end-to-end duration; model-request duration when available | p50 and p95 nearest-rank; successful calls only; excluded count stated |
| Tokens | Input, output, cache read, cache write | Show throughput only when duration is present |
| Error rate | Rows with `error` / all attempts | Split into failed (scored 0) and lost (not scored) |
| Model check | Rows whose harness reported another model | Shown on the configuration with the count; `pinned: false` aliases marked |
| Format compliance | Mean of evaluator values in dimension `format` | Show evaluator id and version |
| Human rating | Mean 1-5 rating per configuration | Separate dimension; never blended; show reviewer and `n` |
| Pairwise preference | Wins / comparisons | Show pair count; randomize sides; reveal after submission |

Aggregates never appear without `n`. A chart with one observation does not draw an error bar or a confident mean.

## 9. First SVG suite

### 9.1 Scope

Suite id: `svg-primitives`, version `0.1.0`.

Prompt id: `svg-scene`, version `1`. Single user message for portability across harnesses:

```
Generate a single SVG file.
Return only the SVG markup. No markdown fences and no explanation.
The root element must have width="{{width}}" height="{{height}}" and viewBox="0 0 {{width}} {{height}}".
Requirements:
{{brief}}
```

### 9.2 Cases

| Case | Brief | Checks |
|---|---|---|
| `svg-001` | 512×512 robot: rectangular blue body, circular gray head above it, two red antennae from the head, two arms, two legs, transparent background | Valid SVG, viewBox, required shapes and colors, clean render, no scripts or external references |
| `svg-002` | 512×512 house: green ground, beige body, red triangular roof, brown door, blue window | Same structural checks |
| `svg-003` | 512×512 minimalist "partly cloudy" weather icon; style is open | Valid SVG, clean render, human rating; requirement checks are informational |

The exact color values and geometry requirements live in the case metadata, not in the prompt evaluator. Keep them explicit in `cases.jsonl`.

### 9.3 Evaluators

| Evaluator | Dimension | Version | What it checks |
|---|---|---|---|
| `svg-structure` | format | 1 | XML parses, root `<svg>`, viewBox matches, no `<script>`, no `foreignObject`, no external URLs or event handlers |
| `svg-requirements` | quality | 1 | Required elements and colors for cases 001 and 002; returns `null` for 003 |
| `render-success` | format | 1 | Headless render completes and produces a screenshot |
| `human-preference` | human | 1 | Blind 1-5 rating and optional pairwise choice |

### 9.4 Artifacts

- `output.svg`: raw model output, committed.
- `render.png`: derived screenshot, gitignored, regenerable.
- `artifact.json`: metadata and hashes, committed.
- Optional `capture.webm` for animated SVG, derived.

### 9.5 Run plan

- Minimum two configurations in the same context, three repeats per case.
- If only one configuration is available, the run is still valid but is marked "single configuration" and no comparative claims are made.
- The dashboard must load the existing `smoke-001` run without artifacts; missing arrays default to empty.

### 9.6 Three.js

Deferred until the SVG suite runs. The artifact contract already supports HTML/JS, screenshots, and video. The brief and scoring rubric will be added after the SVG pipeline is proven.

## 10. Implementation phases

| Phase | Deliverable | Done when | State |
|---|---|---|---|
| 0 | Data contract: artifact, annotation, board schemas; computed configuration model | Schemas validate; existing runs load with empty defaults; compatibility tests pass | Done |
| 1 | Artifact pipeline and SVG suite | SVG run produces raw output, render, metadata, scores; files follow the paths and hashes in this spec | Done |
| 2 | Dashboard shell: server index, context bar, shelf, tray, scorecard, gallery | A real run can be selected, configurations dragged or added, and artifacts viewed | Done |
| 3 | Remaining charts, inspector, per-widget exports | All five charts render from the same view model; PNG/CSV/Markdown exports work | Done |
| 4 | Blind review, annotations, boards | Ratings append to JSONL; reveal works; boards save and restore | Done |
| 5 | Share card composer and light theme | 16:9 and 1:1 exports include provenance and a Markdown caption | Partial: PNG cards, no composer |
| 6 | three.js viewer and suite | Sandboxed scene renders; screenshot/video capture works; rubric is documented | Not started |
| 7 | Redesign: Results replaces Compare and Runs; Home, Run, Lab | The answer sentence follows §6.3; every page passes the layout check at 360-1440px in light and dark | Done |

The UI shell may start after Phase 0. Phase 1 must land before chart polish, so the gallery is designed against real artifacts.

## 11. Acceptance criteria for v1

- One command starts the dashboard; it binds to `127.0.0.1` and makes no external requests.
- Existing results load without migration; missing artifacts and annotations default to empty.
- Context is enforced. Controlled and descriptive comparisons are labeled correctly.
- Up to eight setups are compared at once; every action works from the keyboard.
- Charts handle missing, failed and unscored tries honestly; a chart with nothing to show is not drawn.
- SVG artifacts render in the side panel; video and audio play with native controls; HTML and three.js run sandboxed.
- Human review is blind, append-only, and never mutates machine scores.
- Markdown, CSV, JSON and picture exports work.
- Keyboard-only users can complete the core flow; focus states are visible; the layout reflows at 320px.
- Every stored record validates against its schema.

## 12. Deferred decisions

- Subscription amortization and billing profiles.
- PDF report export.
- Hosting, sharing, and multi-user access.
- Git LFS or an external object store for large media.
- Automated scoring for three.js and motion.
- Exact benchmark briefs beyond the first SVG suite.
- A chart library, if hand-drawn SVG stops being enough.
- Native desktop packaging through Tauri or Electron.

## 13. Control page

`/` is the control page: the owner runs the lab from it. The rail has four items: Home, Run, Results, Lab. Results is its own page (§6). Old control page links (`#runs`, `#harnesses`, `#checks`, `#activity`, `#appearance`) open Lab; `#compare` opens Results. The run card at the top of the rail shows the current or last job and opens its output from any page.

### 13.1 Pages

| Page | What it does |
|---|---|
| Home | While a job runs, a card with its progress, Stop and Open. Latest results: the three newest tests, each with its meta line and the first sentence of its answer, linked to Results. Needs attention, only when something is wrong: a record that fails its schema, a failed or stopped last run of a test, a failed Validate, no harness ready. First test: three steps, only when there are no results. One main button: New run |
| Run | Experiment (description first, file name second), then "Narrow it down", folded: harness (only with 2 or more), models, cases by name, and tries per case. The plan: Setups × Cases × Tries = calls. Preview (`--dry-run`) and Start run. Progress: a bar (answers of calls), the current case, errors so far, the log under "Show the log", and See results when the run ends |
| Lab | Harnesses (`node lab doctor`, one row per harness, Check harnesses). Records: when a stored record fails its schema, a first row lists the file and the reason (the first 8; Validate prints every one); then Validate, Score all, Report, each with its last result. Recent jobs: every job since the server started; a click shows its output. Appearance: theme colour, mode (System, Light, Dark) and motion (Full, Reduced, Off), saved in `localStorage` for both pages |

Start asks once: the first press shows "Start N calls?" for 5 seconds, and only a second press starts the run. A live run costs quota; a preview costs nothing. Job names read the same everywhere: "agentic-sweep run" inside a sentence, "Run of agentic-sweep" at the start of a line; an experiment id keeps its own spelling.

### 13.2 Jobs

- Allowlist: `run`, `score`, `validate`, `doctor`, `runs`, `report`. Never `dashboard`.
- The server spawns `node lab/cli.mjs <args>` with an argument array, no shell, `cwd` and `LAB_ROOT` set to the data root.
- An experiment is a file name in `<root>/experiments/`. A run id must have a `run.json` in `<root>/results/`. Harness names, model keys and case ids match `^[A-Za-z0-9][\w.:@/+-]*$`, so no value can start with `-` and become a flag. Repeats: 1 to 50.
- One job at a time. Output is kept in memory (the last 5,000 lines per job, the last 30 jobs) and lost when the server stops. The evidence is in `results/` as usual.
- Stop: the first stop of a live run writes `cancel` to the child's stdin (`LAB_JOB=1`), which acts as Ctrl+C: the run finishes its current call, keeps what it wrote and is marked failed. A second stop, or a stop of any other command, ends the process tree (`taskkill /T /F` on Windows, the process group on other systems).
- Known limit: when the server itself stops, it asks a running job to stop and exits; the job may then fail on a closed output pipe.

### 13.3 Visual system

Both pages follow the owner's Odicto design system (§7), in light and dark:

- App rail (248px; 64px icons below 900px): the brand, the run card (five pixel bars: idle, running, stopping, server stopped), one sliding nav pill with a glowing stem, and the light/dark switch at the foot.
- Main column up to 1120px. From 1180px, Run puts the plan in a sticky side column, and Lab puts the job output beside its lists.
- Glass groups (radius 18, top rim, grain in dark) with hairline rows; wells for inputs; a custom select with a fixed menu; one accent.
- Status marks by shape (dot, hollow ring, diamond), so colour is never the only signal.
- Toasts that last 7 seconds; an offline banner after two failed polls.
