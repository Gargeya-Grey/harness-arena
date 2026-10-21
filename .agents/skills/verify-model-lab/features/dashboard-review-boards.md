# Review, boards and export

## Sub-features

- `blind-review` - `#nav-review`, pick a case, "Start blind review". `dialog#review` shows two answers as A and B with names hidden, a 1-5 rating, a preference and notes. "Save rating" appends one annotation.
- `boards` - the rail's Boards section: `#board-select`, `#board-save` ("Save current"), `#board-delete`. A board stores the context, lineup and view.
- `export` - `#export-btn` opens `#export-menu`: Markdown table, CSV, JSON, and 16:9 and 1:1 PNG share cards. The leaderboard and each chart card have their own CSV, SVG and Markdown buttons.
- `runs` - `#nav-runs`. One row per run with its status, and a line that says whether every record validates.

## How to get to it (user POV)

The Review and Runs tabs in the app bar, the Boards section at the bottom of the rail, and the Export button at the right of the app bar.

## Driving it with the browser

Preconditions: the Launch steps in SKILL.md, with a disposable data root. Saving a rating or a board writes files.

- **Blind review.** Open Review, start a review for `smoke-001`, rate 4, choose "A better", save. The dialog reveals the names. Second view: the last line of `$ROOT/annotations/human@1.jsonl` has the rating, and the Review view now lists it.
- **Boards.** "Save current" with a title. Second view: `$ROOT/boards/<id>.json` exists. Change the lineup, choose the board in `#board-select`: the lineup returns. Delete removes the file.
- **Export.** "Copy Markdown table" puts a table on the clipboard with one row per lineup entry. "Download CSV" saves a file with the same rows. A PNG share card shows the lineup letters with names.
- **Runs.** The row count matches `ls $ROOT/results | wc -l`. Status "completed" shows a leaf dot; "failed" shows a clay dot.
- **Proof.** Screenshots of the dialog before and after save, and the annotation and board files.

## Gotchas

- The rating dialog closes on Escape without writing anything.
- Never save a rating or a board against this repository's own data during verification; use `LAB_ROOT`.
