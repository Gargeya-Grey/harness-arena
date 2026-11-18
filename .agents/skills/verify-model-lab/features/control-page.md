# Control page

`/` runs the lab from the browser: Home, Run and Lab. It starts allowlisted `node lab` commands as jobs (`dashboard/jobs.mjs`) and shows their output. Results is its own page (`results-page.md`). Design: `docs/dashboard-spec.md` section 13.

## Sub-features

- `home` - `#live-job` while a job runs (progress, `#live-stop`, `#live-open`); `#latest`: the three newest tests with their meta line and the first sentence of their answer, linked to Results; `#attention-sect` only when something is wrong; `#first-sect` only with no results.
- `run-preview` - Run: native `#exp-select` with `#exp-search`, Model setups with individual effort and a harness/provider/model picker, Cases and tries (`#case-chips`, `#repeats`), and the plan (`#plan-n`, `#plan-break`). Preview starts `run ... --dry-run`.
- `run-signal` - `#signal`, above the Preview and Start buttons: Worth running, Low signal or Unknown with its reasons, from `GET /api/signal`. It reads stored runs only, calls no model and writes nothing. A change of selection clears the old result at once.
- `explicit-selection` - Setup rows and case choices determine the count, signal query and run request. Clear setups or deselect all cases to verify that Preview and Start disable.
- `experiment-search` - Search keeps the selected experiment outside matches and exposes exact configuration and actual availability reasons.
- `run-start` - `#start-btn` asks once (`Start N calls?`, 5 s); the second press starts the run.
- `run-progress` - `#run-output-sect`: a bar of answers done, the current case, errors so far, the log under "Show the log", and See results when the run ends.
- `run-stop` - Stop: the first press writes `cancel` on stdin (job `stopping`, the run finishes its current call); a second press ends the process tree.
- `lab` - Harnesses (`#doctor-btn` runs `doctor`; one row per harness), Records (`#problems-row` lists each record that fails its schema, only when one does; then Validate, Score all, Report with result tags), Recent jobs (`#jobs-list`; a click shows the output in `#lab-job`), Appearance.
- `appearance` - swatches (`#swatches`, radio group, arrow keys), `#mode-seg` (System, Light, Dark) and `#motion-seg`; saved as `lab-theme`, `theme`, `lab-motion` in `localStorage`, shared with Results.
- `shell` - the app rail (`shell.js`) on both pages: run card, nav (Home, Run, Results, Ladder, Lab), and the light/dark switch `#theme-toggle` at its foot. Old links `#runs`, `#harnesses`, `#checks`, `#activity` and `#appearance` open Lab; `#compare` opens Results.
- `offline` - two failed polls show `#offline`, and the run card says "Server stopped".

## How to get to it (user POV)

`node lab dashboard`, then open `http://127.0.0.1:4317`.

## Driving it with the browser

Preconditions: the Launch steps in SKILL.md (disposable data root, port 4391). Never press Start on a real experiment: it calls models. To prove `run-start` and `run-stop`, declare a fake harness in `$ROOT/configs/harnesses.yaml` (`bin: node`, `args: ["-e", "setTimeout(() => console.log('Paris'), 4000)"]`, `stdin: true`, `output: text`) and an experiment `$ROOT/experiments/slow-test.yaml` with one target on it.

- **Home.** Each Latest results row shows a different meta line, and a click opens that test on Results.
- **Preview.** Run, choose a Ladder agent preset (keyboard: focus the trigger, arrows, Enter), open Cases and tries, select only the chip for a single task and set tries to 1. Select Preview. The log names each included setup and ends with `Dry run: nothing was called or written.` The results directory gains no folder.
- **Signal.** Choose an experiment: `#signal` shows a verdict and its reasons, and `node lab signal experiments/<name>.yaml --json` gives the same verdict. Narrow to another model: the old verdict clears at once, and a new one follows. `$ROOT/results` gains no folder.
- **Start guard.** Press Start once: the label reads `Start N calls?` and `GET /api/jobs` shows `running: null`.
- **Stop.** With `slow-test`, Start twice, then Stop once: the job ends `stopped`, and the newest `run.json` has `status: failed`.
- **Lab.** Check harnesses lists one row per harness; Validate ends with `All inputs and records are valid.`; Score all starts a `score --all` job that passes. Add a line that is not JSON (`{oops`) to `$ROOT/annotations/human@1.jsonl` and reload: Home shows "1 record does not match the schema", and Lab shows the file and the reason in its first Records row.
- **Appearance.** Choose Ember, Light and Reduced, reload: all three hold, and the accent is orange. Open Results: it is light and orange too. Select System: the page follows the computer again.
- **Narrow.** At 600px all five destinations use labelled bottom navigation. At 768px the compact desktop rail remains. Neither layout scrolls the document sideways.
- **Layout check.** Run the owner's layout checker (house style) on `/#home`, `/#run`, `/#lab`, and `/results.html` on the 6-setup `smoke` test and on the `svg-mini` test with a rating (the two ledgers that become phone cards), in light and dark through a same-origin proxy. The "body and heading sizes" check does not apply: this repository follows Odicto's type scale (`docs/dashboard-spec.md` §7.3).

## Known gaps

- Job output lives in server memory; a server restart empties Recent jobs.

## Premium control acceptance

- Open Run on a disposable root. Add a model outside the preset. Add the same model at a second effort. Confirm that the shared control excludes levels absent from any selected ladder. Set a shared effort and check that identical rows merge. Clear the rows and verify zero calls and disabled Preview and Start.
- Open the Harness picker and confirm every configured harness is listed, even when its model picker is empty. Refresh CLI metadata and check that imported model IDs and their reported efforts are selectable, and that unavailable connections show a reason. Preview a newly discovered model and verify its exact harness, model ID, and effort in the dry-run log.
- Search experiments by mode/id, retain the selected preset outside matches, and inspect actual availability reasons. A harmless one-case Preview must name exactly the selected model/harness/case/repeat and leave the run-folder list unchanged.
- `#narrow` starts open. Harness, effort and setup policy are readable before starting. Check the existing two-press Start guard without approving a live call.
- Lab uses one column while `#lab-output-col` is hidden. Selecting a job opens named output; polling preserves the reader's scroll. Appearance and technical help are named disclosures.
- At 320/390px the shared frame has five labelled bottom destinations, theme access and a visible active/offline job path. Check keyboard focus and the last control against navigation. Desktop keeps the rail; clean idle-job metadata stays out of the phone header.
- Double navigation text from a fresh document at320/390px and390x380. Every label must stay inside its own target and avoid adjacent labels. The bar grows when needed; its observed height sets content/focus clearance. This CSS text stress is distinct from native browser/OS scaling.
