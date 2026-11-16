# Line diff, unified diff and patch

Four functions: `diffLines` finds a minimal edit script between two lists of lines, `unifiedDiff` prints two texts as a
unified diff, `parsePatch` reads a unified diff, and `applyPatch` applies it to a text, even when the text has moved a
little or changed around the hunk. The output must match the rules here byte for byte. Every rule is part of the contract.

```js
const patch = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n');
// --- a
// +++ b
// @@ -1,3 +1,3 @@
//  a
// -b
// +B
//  c
applyPatch('a\nb\nc\n', patch);   // { ok: true, text: 'a\nB\nc\n', hunks: [{ start: 1, offset: 0, fuzz: 0 }] }
```

## Lines

A text is cut into lines at each `"\n"`. A line **keeps its newline**: `'a\nb'` has the lines `['a\n', 'b']`. A text that ends with
`"\n"` has no extra empty line; `''` has no lines. So `'b'` and `'b\n'` are different lines. `src/lines.mjs` has
`splitLines(text)` and `joinLines(lines)` (finished). Two lines are equal when the strings are equal.

## diffLines(a, b)

`a` and `b` are arrays of strings (any strings; they need not end with a newline). Returns the edit script as an array of
`{ type, line }`, where `type` is `'equal'`, `'delete'` or `'insert'`. The `'equal'` and `'delete'` lines in order are `a`; the `'equal'`
and `'insert'` lines in order are `b`. The script has the fewest `'delete'` plus `'insert'` operations that is possible (`O((N+M)D)` time,
`D` = that count; it must stay fast when `D` is small and the lists are long).

Many minimal scripts exist, so the script is the one that **Myers' greedy forward search** finds, with this exact tie rule.
`N = a.length`, `M = b.length`, `V` is an integer array indexed by diagonal `k = x - y` (`V[1] = 0`, all else unused until set):

```
for d = 0 .. N + M:
  keep a copy of V as it is now: trace[d]
  for k = -d, -d + 2, ..., d:
    if k == -d or (k != d and V[k-1] < V[k+1]):  x = V[k+1]        // an insert: move down
    else:                                         x = V[k-1] + 1    // a delete: move right
    y = x - k
    while x < N and y < M and a[x] == b[y]:  x += 1, y += 1         // follow the equal lines
    V[k] = x
    if x >= N and y >= M:  stop, D = d
```

The path is read back from `(x, y) = (N, M)`: for `d = D` down to `1`, with `V = trace[d]` and `k = x - y`, decide
`down = (k == -d or (k != d and V[k-1] < V[k+1]))` in the same way, `prevK = down ? k + 1 : k - 1`, `prevX = V[prevK]`,
`prevY = prevX - prevK`; step back along the equal lines while `x > prevX and y > prevY`; then the step to `(prevX, prevY)` is an
`'insert'` of `b[prevY]` if `down`, else a `'delete'` of `a[prevX]`. After `d = 1` the remaining steps back to `(0, 0)` are equal lines.
Finally, in each maximal run of non-equal operations, all the `'delete'` operations come first, then all the `'insert'`
operations, each group in its own order. Two empty lists give `[]`.

## unifiedDiff(oldText, newText, options)

`options`: `oldName` (default `'a'`), `newName` (default `'b'`), `context` (default 3, an integer `>= 0`, else `RangeError`). Both texts must be
strings, else `TypeError`. The lines of both texts (see Lines) go to `diffLines`. If the script has no `'delete'` or `'insert'`, the result is
the empty string. Otherwise the result is:

```
--- <oldName>
+++ <newName>
<hunk>
<hunk>
...
```

Every line of the output, the last one included, ends with `"\n"`.

* **Hunks.** A change is a maximal run of non-equal operations. A hunk holds one change or more, with `context` equal lines before the
  first and after the last one (fewer at the edges of the file). Two neighbouring changes go in the same hunk when the number of equal
  lines between them is at most `2 * context`; then those equal lines are shown once. Hunks come in order and do not share lines.
* **Hunk lines.** Each operation line is written as one character, then the line without its `"\n"`: a space for `'equal'`, `-` for `'delete'`,
  `+` for `'insert'`. A line that does not end with `"\n"` (only the last line of a text can) is followed by one extra line:
  `\ No newline at end of file` (a backslash, a space, then the words).
* **Header.** `@@ -<old> +<new> @@`. `<old>` is `start,count` for the old side and `<new>` the same for the new side. `count` is the number of
  `'equal'` plus `'delete'` lines of the hunk (old) or of `'equal'` plus `'insert'` lines (new). `start` is the 1-based line number of the first
  line of the hunk on that side; when `count` is 0, `start` is the number of the line before the hunk's place (0 if the hunk is at the very
  top). When `count` is 1 the text is `start` alone, without `,1`. So `@@ -3 +3 @@` and `@@ -5,0 +6,2 @@` and `@@ -0,0 +1,3 @@` are possible.

## parsePatch(text)

`text` must be a string, else `TypeError`. A patch has one file. Returns
`{ oldName, newName, hunks }`; each hunk is `{ oldStart, oldCount, newStart, newCount, lines }`, with `lines` an array of
`{ type, line }` in the same shape as `diffLines` (`line` keeps its `"\n"`, and has none when a `\ No newline at end of file` line follows it).
Rules, in the order they are checked while reading line by line (a line ends at `"\n"`; a last line without `"\n"` is also a line):

1. Empty text, or text with no `---` line at all, gives `{ oldName: null, newName: null, hunks: [] }`.
2. Lines before the first line that starts with `--- ` are ignored (for example `diff --git ...`, `index ...`).
3. The `--- ` line must be followed directly by a line starting with `+++ `, else `PatchError` `bad-header`. A name is the text after the
   4 characters, up to the first tab (a tab and a time stamp after the name are dropped).
4. A hunk header is `@@ -A[,B] +C[,D] @@` with decimal numbers (an omitted count is 1), optionally followed by a space and any text. Right after the
   `+++` line the next line must be a hunk header, unless the input ends; any other line there is `bad-hunk-header`.
5. The hunk body is read until `oldCount` lines of old side (`' '` and `'-'` lines) and `newCount` lines of new side (`' '` and `'+'` lines) are
   complete. A body line starts with `' '`, `'-'`, `'+'` or `\`; the rest of the line is its text. A `\` line (whatever follows the backslash) marks the line
   before it as having no newline and is not counted. If the input ends, or another `@@` line comes, before the counts are complete: `count-mismatch`.
   A line that starts with something else: `bad-hunk-line`. A body line that would push a side above its count: `count-mismatch`.
6. After a hunk's counts are complete, an optional `\` line may follow; then the next line must be `@@` (the next hunk) or the input must end. Any other line is
   `bad-hunk-line`. A `\` line before any body line of its hunk, or right after another `\` line, is `bad-hunk-line`.

`PatchError` (in `src/errors.mjs`, finished) has a `code`. The codes: `bad-header`, `bad-hunk-header`, `bad-hunk-line`, `count-mismatch`.

## applyPatch(text, patch, options)

`text` is a string, `patch` is a string (parsed with `parsePatch`, so its errors are thrown) or a parsed patch, else `TypeError`.
`options`: `fuzz` (default 0, an integer `>= 0`, else `RangeError`), `reverse` (default `false`).
`reverse: true` applies the patch backwards: `'delete'` and `'insert'` swap, `oldStart` swaps with `newStart` and `oldCount` with `newCount`.

The lines of `text` are the file. Hunks are applied in order. For a hunk, `old` = its `'equal'` and `'delete'` lines in order,
`expected` = `oldStart`, or `oldStart + 1` when `oldCount` is 0. A place `p` (1-based, the line of the file where `old[0]` would stand) is **valid**
when `p >= 1`, `p + old.length - 1 <= file length`, and `p >= minPlace`, where `minPlace` is `1` for the first hunk and
`start + old.length` of the previously applied hunk after that.
It **matches** when `file[p-1+i]` equals `old[i]` for every compared `i`.

To find the place, try `fuzz level f = 0, 1, ..., fuzz` in this order, and for each level the shifts `s = 0, +1, -1, +2, -2, ...` (the
nearer first, the later place before the earlier one); the place tried is `p = expected + shiftSoFar + s`, where `shiftSoFar` is the `offset` of the previously applied hunk
(0 for the first). The first valid place that matches is used. The search covers every valid place of the file, so it ends.
At level `f`, the first `min(f, lead)` and the last `min(f, trail)` lines of `old` are **not compared**, where `lead` is the number of `'equal'` lines
before the first non-equal line of the hunk and `trail` the number of `'equal'` lines after the last one (for a hunk with no change, `lead` is all its lines and `trail` is 0).

If no hunk place is found, the result is `{ ok: false, hunk: <index of that hunk, from 0> }` and nothing is changed. Otherwise the new file is the file with, for each hunk, its `old` lines
(at the place found) replaced by its new lines: for each hunk line in order, `'equal'` keeps the **file's** line, `'delete'` drops the file's line, `'insert'` adds the hunk's line.
The result is `{ ok: true, text, hunks }` with `hunks[i] = { start, offset, fuzz }`: `start` is the place found, `offset = start - expected`, `fuzz` the level that matched.
A patch with no hunks gives the same text.

## Speed

`diffLines` must handle two lists of 20000 lines that differ by a few hundred lines quickly, and `unifiedDiff`, `applyPatch` must be linear in the sizes of text and patch
(plus the search for places, which may look at every place of the file for each hunk).

## Files

* `src/errors.mjs`, `src/lines.mjs`, `src/index.mjs`: finished.
* `src/myers.mjs`: `diffLines`.
* `src/format.mjs`: `unifiedDiff`.
* `src/parse.mjs`: `parsePatch`.
* `src/apply.mjs`: `applyPatch`.

The tests in `test/` show the shape of results. Do not edit them.
