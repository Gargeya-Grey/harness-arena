# Dashboard specification

**Status:** built through Phase 4 (see §10). Sections 5-7 describe the dashboard as built; the original React plan is replaced by a zero-dependency Node server and vanilla ES modules. This is the implementation contract for the local comparison dashboard. It extends `docs/strategy.md` with artifact and annotation storage; the existing run invariants still apply.

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
| Comparison interaction | Left rail with a lettered lineup (up to 8) and a configuration list; tabbed views share the lineup |
| Compatibility | Shared context is enforced; configuration axes are diffed and labeled |
| Comparison entity | Configuration = model + harness + harness version + effort |
| Cost | Notional API-equivalent cost, labeled as not billed |
| First multimodal test | Constrained SVG generation, then animated SVG, then three.js |
| Artifact storage | Raw output committed; derived renders regenerable; large media local and hashed |
| Human review | Blind, case-by-case, 1-5 ratings, notes, random pairwise A/B |
| Annotation storage | Append-only JSONL, separate from machine scores |
| Information architecture | Single-page lab plus saved Boards drawer |
| Charts | Hand-drawn SVG: quality against cost, latency, tokens, reliability, errors; plus an answers grid and per-observation inspector |
| Export | Per-widget exports plus composed share cards and Markdown captions |
| Visual direction | Fonts and colour tokens from the owner's house style; layout and components are the app's own. Light and dark themes |
| Stack | Node 22 built-ins only: `node:http`, `node:fs`, `node:test`; browser ES modules; hand-written SVG |

## 3. Domain model

### 3.1 Configuration

A configuration is the unit added to the lineup.

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

This resolves the tension between strict comparability and comparing whatever access you have. Context is always enforced; configuration differences are surfaced rather than hidden. The comparison badge names what varies. If the lineup varies on several axes, the badge switches to Descriptive rather than blocking the view.

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
  "view": {
    "charts": ["scorecard", "quality-cost", "reliability", "latency", "errors"],
    "theme": "dark"
  }
}
```

Boards store references, never copied results. A board that no longer resolves is shown as stale with the missing run or config named.

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
  public/
    index.html            shell: app bar, rail, views, inspector, dialog
    styles.css            tokens and components
    app.js                boot, routing, theme, events
    js/                   one module per view: leaderboard, answers, charts,
                          runs, reviewview, inspector, configs, exporter, ...
    fonts/                Instrument Sans and IBM Plex Mono, served locally
boards/                   saved comparison boards (repo root)
```

Keep the run harness separate. The dashboard reads evidence; it does not execute model calls.

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

Bind to `127.0.0.1` only. Reject requests with a non-local `Host` header. No external network calls. There is no file watcher and no event stream: the Refresh button reads the folder again.

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

### 6.1 Shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ app bar: brand · context select · Overview Answers Charts Runs Review│
│          · refresh · export · theme                                  │
├──────────────┬──────────────────────────────────────┬────────────────┤
│ rail         │ page head: comparison badge · counts │ inspector      │
│ lineup A–H   │ view                                 │ (docked ≥1200px│
│ config list  │                                      │  else drawer)  │
│ boards       │                                      │                │
└──────────────┴──────────────────────────────────────┴────────────────┘
```

- ≥1024px: the rail is a sticky 288px column.
- <1024px: the rail collapses behind a "Lineup · N of 8 selected" toggle above the view.
- ≥1200px: the inspector docks at 520px. While it is open the rail is hidden, so the view keeps its width. Below 1200px it is a drawer.
- <900px: the app bar wraps; the view tabs take their own row.
- The page never scrolls sideways. Wide tables scroll inside their own frame with a sticky first column.

### 6.2 App bar and page head

- Context select: each option has two lines. The first names the suite and prompt; the second holds cases, repeats, evaluators, "subset", runs and the latest date, so two contexts never read the same. If two still match, the case ids are added. Changing the context keeps lineup entries that exist in the new context.
- View tabs: Overview, Answers, Charts, Runs, Review. The view, context and lineup live in the URL hash, so every view is bookmarkable.
- Refresh reads the results folder again. Export opens the export menu. The theme button switches light and dark.
- The page head shows the comparison badge (Controlled, Replicate, Single or Descriptive, with what varies) and "N runs · N configurations · latest date".

### 6.3 Configuration list

- Search by model, harness, provider or effort. Filter chips by harness and provider, with counts.
- Grouped by provider. Each row shows the display name and harness, version and effort. A dot marks rows in the lineup.
- Add and Remove buttons. Drag-and-drop is an enhancement, never the only path.

### 6.4 Lineup

- Up to eight configurations. Each one gets a letter, A–H, by its place in the lineup.
- The letter marks that configuration everywhere: tiles, leaderboard rows, answers headers, chart labels and the inspector title. Colour never identifies a configuration.
- Drag to reorder, or use the up and down buttons. Remove with ×. A live region announces each change.
- The lineup is the single source of truth for every view and export.

### 6.5 Views

**Overview**

- KPI band: Best quality, Fastest p50, Lowest cost per pass, Error rate. Each tile shows the value, the winner's letter and name, and `n`. A tie shows every tied letter and "N-way tie". A missing count prints nothing, never NaN.
- Leaderboard: one row per lineup entry. Quality with its 95% interval, pass rate, errors, p50, p95, cost, cost per pass, tokens. Best cells are marked; a findings box above states the winners and says when intervals overlap.
- The quality-against-cost and latency charts.

**Answers**

- Rows: cases (id, question, expected). Columns: lineup entries.
- Each cell shows one chip per repeat (pass, fail, error or unscored glyph plus `rN`) and the response text of the open or first repeat, clamped to four lines. Missing cells are hatched.
- Filters: only disagreements, only failures, one repeat. A chip opens the inspector.

**Charts**

1. Quality against cost: one point per configuration, 95% whiskers when `n >= 3`, log cost scale when the spread is wide. Labels are a letter badge plus the name, placed to avoid collisions; on a narrow plot the letter alone.
2. Latency: p50 dot and p95 ring per configuration; toggle harness end-to-end or model request. Successful calls only.
3. Tokens per call: input, cache read and output as small multiples, each on its own scale.
4. Reliability: agreement across repeats of the same case.
5. Errors: scored, error and unscored attempts per configuration; the denominator is every attempt.

Every chart card shows its `n`, a caption, and SVG and CSV exports.

**Runs**

- One row per run: start time, experiment and run id, harness, models, rows, errors, status. Status filter. A line states whether every record validates.

**Review**

- Pick a case and start a blind review (§6.7).

### 6.6 Inspector

Tabs: Answer, Metrics, Provenance. The title carries the configuration's letter; the sub line shows harness, version and case.

- **Answer:** the full response text or the error, the artifact when there is one, each evaluator's score, the human rating, and the request that was sent.
- **Metrics:** quality, passed, format check, both latencies, cost, input, cache and output tokens, and the other usage counts.
- **Provenance:** run, configuration, model and model key, provider, harness and entrypoint, access method, effort, params applied, prompt, case, repeat, start and finish times, session id.

Not built yet: zoom, fullscreen and download on the stage, next and previous observation, and a link to the raw row.

### 6.7 Review mode

- A dialog for one case shows two answers side by side as Answer A and Answer B: one from a lineup entry and one from the next lineup entry that has an answer for that case. A coin flip picks which side is A. Names are hidden until save.
- Absolute rating of Answer A: 1-5, plus notes. Pairwise: A better, B better or tie.
- Save reveals the names and appends one annotation. Escape or Cancel writes nothing.

Not built yet: more than two answers at once, random pairs across the whole lineup, progress and skip, correcting a rating with `supersedes`, and highlighting the case on exit.

### 6.8 Boards

- The Boards section of the rail: a select of saved boards, "Save current" and Delete.
- A board stores the context, the lineup and the view.
- Saving a new board never replaces another: when two titles map to the same id, the second gets a numbered suffix.
- The URL hash holds the view, context and lineup, so every comparison is bookmarkable; it does not name the board.
- Loading a board whose configurations are no longer in the context skips them and says how many were skipped. There is no repair action.

### 6.9 Export and sharing

Per-widget menu:

- Chart PNG at 2x.
- Chart SVG.
- Data CSV, Markdown table, and JSON.
- Artifact download in its original format.

Share card composer:

- Title and optional subtitle.
- Select one or two charts, or one artifact.
- Model/harness labels on or off.
- Provenance footer on or off: run ids, date, context, notional-cost note.
- Theme: light publication or dark.
- Aspect: 16:9 at 1600×900, or 1:1 at 1080×1080. Export at 2x.
- Copy Markdown caption with the same metric table and provenance.

### 6.10 States

Every surface ships with:

- **Loading:** skeletons with stable geometry; no layout shift.
- **Empty:** what belongs here, why, and the next action.
- **Error:** what failed, the file or endpoint, and a recovery action.
- **No results:** charts explain the missing sample and offer to widen the context.
- **Partial data:** explicit "not run", "unscored", and "failed" marks.
- **Overflow:** long model names wrap; numbers use tabular figures; tables scroll horizontally with a sticky first column.
- **Disabled:** incompatible configurations explain why on focus and hover.

### 6.11 Accessibility

- Every drag-and-drop action has a keyboard and button equivalent.
- Focus rings: 2px, offset, high contrast, visible on both themes.
- Minimum target 44×44px under a coarse pointer. With a mouse, dense controls are 24-32px.
- Color never carries meaning alone; every series has a label and a pattern or shape in dense charts.
- Tables use real table semantics, column headers, and row headers.
- Live regions announce lineup changes, index refreshes, and rating submissions.
- The app survives 200% zoom and reflows at 320px.
- `prefers-reduced-motion` is honored.

## 7. Visual system

Only two things come from the owner's house style (`~/.claude/design/DESIGN.md`): the fonts and the colour tokens. Layout, components and charts are the app's own design and do not follow the rest of DESIGN.md.

### 7.1 Themes and tokens

Light and dark, one set of token names. The theme follows `prefers-color-scheme` until the user picks one with the theme button; `[data-theme]` on the root then wins.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F6F7F4` | `#0E1412` | Rail, table heads |
| `--paper-raised` | `#FFFFFF` | `#151D1A` | Page and cards |
| `--sage` | `#E2EDE6` | `#17261F` | Letter badges, hover |
| `--ink` | `#14201C` | `#ECEFEA` | Text |
| `--ink-2` | `#53615B` | `#A3B0AA` | Secondary text |
| `--rule` | `#DDE2DC` | `#26302C` | Borders and grid lines |
| `--forest` | `#1E5B49` | `#ECEFEA` | Primary action, active tab |
| `--leaf` / `--leaf-ink` | `#10B981` / `#0B7A55` | `#10B981` / `#3DDC9F` | Best values, pass marks |
| `--clay` | `#B4472F` | `#E5866B` | Errors and failures |

App-only tokens built from these: `--hover`, `--best-bg`, `--shadow`, `--backdrop`.

### 7.2 Identity in charts

Configurations are told apart by their letter, not by colour. Charts draw in ink and rule tones; leaf marks the best value and clay marks errors. A chart is readable in greyscale.

### 7.3 Typography

- UI and body: Instrument Sans, 14px base. Numbers, ids, versions and response text: IBM Plex Mono. Both are served locally from `public/fonts/`.
- KPI values: Plex Mono 26px. Section titles 15-16px, weight 600. Micro labels 11-12px.
- Tabular figures for every metric.

### 7.4 Space, shape, motion

- Controls 30-32px high; every control and chip is at least 44px under `(pointer: coarse)`.
- Dropdowns: every `<select>` gets a themed button and listbox (`js/select.js`), because the operating system draws a native select's open list outside the theme. The native select stays in the DOM as the source of truth for value and `change` events. The list opens below the button, or above it when less than 200px is free below and more is free above. Keyboard: arrows, Home, End, Page Up and Down, Enter or Space to choose, Escape to close, type to jump. A keyboard open is instant; a pointer open eases in over 150ms. Cards and tables have a 14px radius and a 1px rule border.
- Motion: drawer and dialog enter with a strong ease-out under 300ms; buttons scale to 0.97 on press. `prefers-reduced-motion` removes all of it.

### 7.5 Share cards

- Title, the chart, the lineup letters with names, and a provenance footer.
- Export at 2x. Text at least 16px at card scale.
- The Markdown caption mirrors the card: context, configurations, metric table, provenance, notional-cost caveat.

## 8. Metrics

| Metric | Definition | Uncertainty and edge cases |
|---|---|---|
| Quality | Mean evaluator value per configuration, 0-1 | Bootstrap 95% interval when `n >= 3`; show `n`; mark insufficient data |
| Pass rate | Passed observations / scored observations | Wilson 95% interval; unscored excluded and counted |
| Reliability | Repeat agreement: frequency of the majority outcome per case, averaged across cases | Only cases with 2+ repeats; score variance shown separately |
| Cost | Notional API-equivalent cost from stored `cost_usd` | Label "not billed"; subscription amortization deferred |
| Cost per passed case | Total cost / passed observations | `null` when no passes; show `n` |
| Latency | Harness end-to-end duration; model-request duration when available | p50 and p95 nearest-rank; successful calls only; excluded count stated |
| Tokens | Input, output, cache read, cache write | Show throughput only when duration is present |
| Error rate | Rows with `error` / all attempts | Includes timeouts and format failures when tagged |
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

The UI shell may start after Phase 0. Phase 1 must land before chart polish, so the gallery is designed against real artifacts.

## 11. Acceptance criteria for v1

- One command starts the dashboard; it binds to `127.0.0.1` and makes no external requests.
- Existing results load without migration; missing artifacts and annotations default to empty.
- Context is enforced. Controlled and descriptive comparisons are labeled correctly.
- Eight configurations can be compared; drag-and-drop and keyboard paths both work.
- All five charts show `n` and handle missing, failed, and unscored observations honestly.
- SVG artifacts render in the gallery; video and audio play with native controls; HTML and three.js run sandboxed.
- Human review is blind, append-only, and never mutates machine scores.
- Chart PNG/SVG, CSV/Markdown/JSON, and share-card exports work.
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
