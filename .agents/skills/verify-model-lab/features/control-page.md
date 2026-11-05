# Control page

`/` runs the lab from the browser: Home, Run and Lab. It starts allowlisted `node lab` commands as jobs (`dashboard/jobs.mjs`) and shows their output. Results is its own page (`results-page.md`). Design: `docs/dashboard-spec.md` section 13.

## Sub-features

- `home` - `#live-job` while a job runs (progress, `#live-stop`, `#live-open`); `#latest`: the three newest tests with their meta line and the first sentence of their answer, linked to Results; `#attention-sect` only when something is wrong; `#first-sect` only with no results.
- `run-preview` - Run: `#exp-select` (custom select), `details#narrow` ("Narrow it down": `#harness-chips` with 2 or more harnesses, `#model-chips`, `#case-chips`, `#repeats`), the plan (`#plan-n`, `#plan-break`); Preview starts `run ... --dry-run`.
- `run-start` - `#start-btn` asks once (`Start N calls?`, 5 s); the second press starts the run.
- `run-progress` - `#run-output-sect`: a bar of answers done, the current case, errors so far, the log under "Show the log", and See results when the run ends.
- `run-stop` - Stop: the first press writes `cancel` on stdin (job `stopping`, the run finishes its current call); a second press ends the process tree.
- `lab` - Harnesses (`#doctor-btn` runs `doctor`; one row per harness), Records (`#problems-row` lists each record that fails its schema, only when one does; then Validate, Score all, Report with result tags), Recent jobs (`#jobs-list`; a click shows the output in `#lab-job`), Appearance.
- `appearance` - swatches (`#swatches`, radio group, arrow keys), `#mode-seg` (System, Light, Dark) and `#motion-seg`; saved as `lab-theme`, `theme`, `lab-motion` in `localStorage`, shared with Results.
- `shell` - the app rail (`shell.js`) on both pages: run card, nav (Home, Run, Results, Lab), and the light/dark switch `#theme-toggle` at its foot. Old links `#runs`, `#harnesses`, `#checks`, `#activity` and `#appearance` open Lab; `#compare` opens Results.
- `offline` - two failed polls show `#offline`, and the run card says "Server stopped".

## How to get to it (user POV)

`node lab dashboard`, then open `http://127.0.0.1:4317`.

## Driving it with the browser

Preconditions: the Launch steps in SKILL.md (disposable data root, port 4391). Never press Start on a real experiment: it calls models. To prove `run-start` and `run-stop`, declare a fake harness in `$ROOT/configs/harnesses.yaml` (`bin: node`, `args: ["-e", "setTimeout(() => console.log('Paris'), 4000)"]`, `stdin: true`, `output: text`) and an experiment `$ROOT/experiments/slow-test.yaml` with one target on it.

- **Home.** Each Latest results row shows a different meta line, and a click opens that test on Results.
- **Preview.** Run, choose `opencode-agentic` (keyboard: focus the trigger, arrows, Enter), open Narrow it down, select the `Slugify bug` chip, tries 1, Preview. The log ends with `Dry run: nothing was called or written.` and `$ROOT/results` gains no folder. The progress head reads "Preview of opencode-agentic".
- **Start guard.** Press Start once: the label reads `Start N calls?` and `GET /api/jobs` shows `running: null`.
- **Stop.** With `slow-test`, Start twice, then Stop once: the job ends `stopped`, and the newest `run.json` has `status: failed`.
- **Lab.** Check harnesses lists one row per harness; Validate ends with `All inputs and records are valid.`; Score all starts a `score --all` job that passes. Add a line that is not JSON (`{oops`) to `$ROOT/annotations/human@1.jsonl` and reload: Home shows "1 record does not match the schema", and Lab shows the file and the reason in its first Records row.
- **Appearance.** Choose Ember, Light and Reduced, reload: all three hold, and the accent is orange. Open Results: it is light and orange too. Select System: the page follows the computer again.
- **Narrow.** At 600px the rail is 64px with icons only, and the page does not scroll sideways.
- **Layout check.** Run the owner's layout checker (house style) on `/#home`, `/#run`, `/#lab`, and `/results.html` on the 6-setup `smoke` test and on the `svg-mini` test with a rating (the two ledgers that become phone cards), in light and dark through a same-origin proxy. The "body and heading sizes" check does not apply: this repository follows Odicto's type scale (`docs/dashboard-spec.md` §7.3).

## Known gaps

- Job output lives in server memory; a server restart empties Recent jobs.
