# Rate answers, saved views and Share

## Sub-features

- `rate` - Rate answers (`[data-act=rate-start]` in the answer, or Rate this answer in the side panel) opens `dialog#review`: the case's task, then two answers as A and B with the names hidden. Rate A 1-5, choose A is better, B is better or Same, add notes. Save rating appends one annotation, reveals the names and adds a row under Your ratings (`#ratings`); Rate another moves to the next case. Shown on tests with pictures or unchecked answers, and on tests with ratings.
- `saved-views` - Share › Save view opens `dialog#save-view` (`#view-title`). It writes a board: the test, the setups shown and `view.only`. Saved views list first in Change test; Remove asks once more (Confirm remove).
- `share` - `#share-btn` opens `#share-pop`: Copy link, Save view, Copy as Markdown, Download CSV, Download JSON, Wide picture (16:9), Square picture (1:1).

## How to get to it (user POV)

On Results: the Share button at the top right, the Rate answers button in the answer, and Change test for saved views.

## Driving it with the browser

Preconditions: the Launch steps in SKILL.md, with a disposable data root. Saving a rating or a view writes files.

- **Rate.** Open the `svg-mini` test, Rate answers, rate 4, choose "A is better", Save rating. The dialog shows the names. Close it: Your ratings shows the new row first, with the choice in words. Second view: the last line of `$ROOT/annotations/human@1.jsonl` has the rating.
- **Saved view.** Share › Save view with a title, Save. Second view: `$ROOT/boards/<id>.json` exists with `view.only`. Change the setups, open Change test, select the view: the setups return. Remove, then Confirm remove: the file is gone, and no run changed.
- **Share.** Copy as Markdown puts a table on the clipboard that starts with `## <test>` and has one row per shown setup. Download CSV saves the same rows with the header `setup,model,harness,…`. Wide picture saves a 1600 × 900 PNG in the light palette.
- **Proof.** Screenshots of the rating dialog before and after save, and the annotation and board files.

## Gotchas

- The rating dialog closes on Escape without writing anything.
- Never save a rating or a view against this repository's own data during verification; use `LAB_ROOT`.
