# Control page

`/` runs the lab from the browser: it starts allowlisted `node lab` commands as jobs (`dashboard/jobs.mjs`) and shows their output. Design: `docs/dashboard-spec.md` section 13.

## Sub-features

- `home` - meter rows (`#meters`) for experiments, runs, harnesses, checks, activity; a warn meter puts a hollow ring on its nav item.
- `run-preview` - Run page: `#exp-select` (custom select), `#harness-select`, model and case chips (`.mchip`), `#repeats`, `#call-count`; Preview starts `run ... --dry-run`.
- `run-start` - `#start-btn` asks once (`Start N calls?`, 5 s), the second press starts the run.
- `run-stop` - the output head's Stop button: first press = `cancel` on stdin (job `stopping`, run finishes its current call); second press ends the process tree.
- `runs-score` - Runs page: Score again per run, Score anyway (`--force`, confirm step) for a guard-stopped run, `#score-all`.
- `harnesses` - `#doctor-btn` runs `doctor`; rows parsed from its output.
- `checks` - `validate`, `report`, `runs` buttons with result tags.
- `activity` - `#jobs-list`; selecting a job shows its output.
- `appearance` - swatches (`#swatches`, radio group, arrow keys), `#mode-seg` (System, Light, Dark) and `#motion-seg`; saved as `lab-theme`, `theme`, `lab-motion` in `localStorage`, shared with Compare.
- `shell` - the app rail (`shell.js`) on both pages: run card, nav, and the light/dark switch `#theme-toggle` at its foot. The Compare nav item opens `/compare.html`; an old `/#compare` link redirects there.
- `offline` - two failed polls show `#offline`, and the run card says "Server stopped".

## How to get to it (user POV)

`node lab dashboard`, then open `http://127.0.0.1:4317`.

## Driving it with the browser

Preconditions: the Launch steps in SKILL.md (disposable data root, port 4391). Never press Start on a real experiment: it calls models. To prove `run-start` and `run-stop`, declare a fake harness in `$ROOT/configs/harnesses.yaml` (`bin: node`, `args: ["-e", "setTimeout(() => console.log('Paris'), 4000)"]`, `stdin: true`, `output: text`) and an experiment `$ROOT/experiments/slow-test.yaml` with one target on it.

- **Preview.** Run page, choose `opencode-agentic` (keyboard: focus the trigger, arrows, Enter), select the `slugify-bug` chip, repeats 1, Preview. The output ends with `Dry run: nothing was called or written.` and `$ROOT/results` gains no folder.
- **Start guard.** Press Start once: the label reads `Start N calls?` and `GET /api/jobs` shows `running: null`.
- **Stop.** With `slow-test`, Start twice, then Stop once: the tag reads `Stopping after the current call`; the job ends `stopped`, and the newest `run.json` has `status: failed`.
- **Harnesses / Checks.** Check harnesses lists one row per harness; Validate ends with `All inputs and records are valid.`
- **Runs.** `#score-all` opens Activity with a `score --all` job that passes. Use `agent-browser click "#score-all"`: `find role button --name` can pick another button.
- **Appearance.** Choose Ember, Light and Reduced, reload: all three hold, and the accent is orange. Open Compare: it is light and orange too. Select System: the page follows the computer again.
- **Narrow.** At 600px the rail is 64px with icons only, and the page does not scroll sideways.
- **Layout check.** Run the owner's layout checker (house style) on each view in light and dark through a same-origin proxy. Known false positives: `.sr` labels "past their box" and the Run form groups as "short lists".

## Known gaps

- Job output lives in server memory; a server restart empties Activity.
