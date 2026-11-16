# Spreadsheet engine

`createSheet()` in `src/index.mjs` returns a sheet: a grid of cells that hold numbers, text, booleans or
formulas. When a cell changes, the sheet recomputes **only the formulas that depend on it**, each exactly
once, in dependency order, and tells you which. You build the formula parser, the evaluator, the function
library, the dependency graph (with cycle detection) and the sheet. `src/refs.mjs` and `src/values.mjs` are
done; read them first. `src/index.mjs` re-exports `createSheet` from `src/sheet.mjs`.

## 1. The grid and references

- Columns are `A` to `ZZ` (702 columns: `A`…`Z`, `AA`…`ZZ`), rows are `1` to `1000`.
- A reference is a column, then a row: `B7`, `AA12`. Letters are case-insensitive; the sheet always reports
  upper case. In a formula a reference may carry `$` marks (`$B$7`, `B$7`); they change nothing.
- **Reading order** is row by row, then column: `A1, B1, …, ZZ1, A2, B2, …`. Every list of cells that the
  sheet returns is in reading order unless this spec says otherwise.
- `set`, `get`, `input`, `precedents` and `dependents` take a reference from the caller. A value that is not
  a string of the form column-then-row inside the grid (`'A0'`, `'AAA1'`, `'A1001'`, `'1A'`, `'A 1'`, `''`,
  a number) throws a `RangeError`. `$` is not allowed here. Letters may be either case.
- Inside a formula, a reference that has the right form but lies outside the grid (`A0`, `A1001`) is allowed
  by the parser and gives the error value `#REF!` when it is evaluated.

## 2. Cell input

`sheet.set(ref, input)` takes a string (anything else throws a `TypeError`):

- `''` clears the cell (it becomes empty).
- A string whose first character is `=` is a formula; the text after the `=` is the formula.
- A string that starts with an apostrophe `'` is text; the apostrophe is not part of the value (`'123` is
  the text `123`, `'=1+1` is the text `=1+1`).
- A string that matches `^[+-]?(\d+(\.\d+)?|\.\d+)$` is a number.
- `TRUE` or `FALSE` in any case is a boolean.
- Anything else is text, kept as typed.

`sheet.input(ref)` returns the string last passed to `set` for that cell (`''` when empty).
`sheet.get(ref)` returns the cell value: a number, a string, a boolean, `null` for an empty cell, or an
error value `{ error: '#DIV/0!' }` (one of the codes in section 5). `sheet.cells()` returns the references
of all non-empty cells. Nothing is shared with the caller: `get` returns a new object for an error value on
every call, and changing it, or any array the sheet returned, never changes the sheet.

## 3. Formulas

Whitespace between tokens is ignored. Tokens: numbers `\d+(\.\d+)?` or `\.\d+`; strings `"…"` where `""`
inside stands for one quote; `TRUE`, `FALSE` in any case; references and ranges; names; operators and
punctuation `+ - * / ^ & = <> < <= > >= ( ) , :`.

**Names.** A word is a letter or `_` followed by letters, digits, `_`, `.` or `$`. A word followed by `(` is a
function call. A word of one or two letters then digits (`A1`, `$AB$12`) is a reference. `TRUE`/`FALSE` are
booleans. Any other word (`foo`, `AAA1`) is a name, which evaluates to `#NAME?`.
**Ranges.** `ref:ref` (with the same `$` freedom). The two corners are normalised, so `B3:A1` is `A1:B3`.

**Precedence**, from the loosest: comparison (`= <> < <= > >=`), then `&`, then `+ -`, then `* /`, then `^`,
then the unary signs `+` `-`, then the atoms. All binary operators are **left associative** (`2^3^2` is
`(2^3)^2` = 64). A unary sign binds tighter than `^`, so `-2^2` is 4, and `2^-2` is 0.25. Signs can stack
(`--3`).

A formula that does not parse (a missing parenthesis, a trailing token, an unterminated string, an empty
argument as in `SUM(1,,2)`, an empty formula such as `=` or `=   `, a character that is no token) has the
value `#PARSE!` and no precedents. A function name that is unknown is `#NAME?` and its arguments are not
evaluated.

## 4. Evaluation

The value of a reference to an empty cell is *empty*. The value of a formula is never empty: an empty result
is stored as `0`.

**Number coercion** (for arithmetic, unary minus, and functions that need a number): a number stays; `TRUE` is
1 and `FALSE` is 0; empty is 0; text that, after trimming spaces, matches the number pattern of section 2 is
that number; any other text (including `""`) is `#VALUE!`.

**Text coercion** (for `&`, `CONCAT`, `LEN`): empty is `""`; a number is `String(n)` (so `0.1+0.2` gives
`0.30000000000000004`); a boolean is `TRUE` or `FALSE`.

**Boolean coercion** (for `IF`, `NOT`, `AND`, `OR`): a boolean stays; a number is true unless it is 0; empty is
false; text is true or false only when it is `TRUE` or `FALSE` in any case, otherwise `#VALUE!`.

**Errors.** An error value as an operand makes the result that error. When several operands are errors, the
first one wins: left before right, arguments left to right, range cells in reading order. Errors in operands
are found before any coercion is tried, so `"x" + (1/0)` is `#DIV/0!`, and `"x" + "y"` is `#VALUE!`. The same holds for the two
arguments of `MOD` and of `ROUND`.

**Arithmetic** `+ - * /` and `^`: both operands are number-coerced (left first). `x/0` is `#DIV/0!`. `0^0` is
`#NUM!`, and `0^n` for negative `n` is `#DIV/0!`. A result that is not a finite number is `#NUM!`. Unary `-`
coerces its operand to a number; unary `+` returns its operand unchanged. A result of `-0` is `0`.

**Concatenation** `a & b`: text of both operands.

**Comparison** gives a boolean. If one side is empty it takes the default of the other side's type (0, `""` or
`FALSE`); two empty sides are equal. Values of different types are ordered: numbers, then text, then
booleans. Numbers compare as numbers, `FALSE` is below `TRUE`, and text compares case-insensitively: both
sides lower-cased, then by UTF-16 code unit.

**References and ranges.** A reference as an operand is the cell's value. A range anywhere except as an
argument of `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `AND`, `OR` or `CONCAT` is `#VALUE!`. A
reference outside the grid, or a range with a corner outside the grid, is `#REF!` when it is evaluated.

### Functions

Names are case-insensitive. A call with too few or too many arguments is `#VALUE!` (the arguments are not
evaluated). Argument counts: `SUM AVERAGE MIN MAX COUNT COUNTA AND OR CONCAT` 1 or more; `IF` 2 or 3;
`IFERROR` 2; `NOT ABS LEN` 1; `ROUND` 1 or 2; `MOD` 2.

**Items.** For `SUM AVERAGE MIN MAX COUNT COUNTA AND OR CONCAT`, each argument gives a list of items, in
order. A range gives one item per cell (reading order), a single reference gives one item, and anything else
gives one item that is its value (a *literal* item). An item that comes from a cell is a *cell item*.

- `SUM`: the sum of the numbers. A cell item counts only if its value is a number (text, booleans and empty
  cells are skipped). A literal item is number-coerced (`#VALUE!` for text that is not a number). An error
  item makes the result that error. No numbers gives 0.
- `AVERAGE`: the same numbers, their mean; no numbers gives `#DIV/0!`.
- `MIN`, `MAX`: the same numbers; no numbers gives 0.
- `COUNT`: how many numbers. Cell items count when they hold a number; literal items count when they are
  numbers, booleans or text that is a number. Errors are never counted and never make an error.
- `COUNTA`: how many items are not empty. Every literal item counts (also an error); a cell item counts when the
  cell is not empty (an error value in a cell counts). Never an error.
- `AND`, `OR`: cell items count only when they hold a boolean or a number; literal items are
  boolean-coerced. Error items give that error. No countable item gives `#VALUE!`. All arguments are looked at
  (no short cut).
- `CONCAT`: the text of every item in order, joined; an error item gives that error.
- `IF(c, a, b)`: boolean-coerce `c` (an error in `c` is the result). Only the chosen branch is evaluated, so an
  error in the other branch is never seen. A missing `b` gives `FALSE`. The branch value is returned as is.
- `IFERROR(v, f)`: `v` unless `v` is an error, then `f`. `f` is evaluated only in that case.
- `NOT(x)`: boolean-coerce, negate.
- `ABS(x)`: number-coerce, absolute value.
- `ROUND(x, d)`: `d` defaults to 0 and is cut toward zero to an integer. Rounds half away from zero **as the
  decimal text of `x` reads**: `ROUND(2.675, 2)` is 2.68, `ROUND(1.005, 2)` is 1.01, `ROUND(-2.5)` is -3,
  `ROUND(1234, -2)` is 1200.
- `MOD(a, b)`: number-coerce both; `b` of 0 is `#DIV/0!`; the result has the sign of `b`
  (`MOD(-3, 2)` is 1, `MOD(3, -2)` is -1).
- `LEN(x)`: the number of code points of the text of `x` (`LEN("😀")` is 1).

A function that returns a cell's value (`IF` returning a reference) may return empty; the formula result
then becomes 0 (section 4). Anywhere else an empty value used as a literal item counts as the number 0.

## 5. Error values

`#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`, `#PARSE!`, `#CYCLE!`. `src/values.mjs` has them.

## 6. Dependencies, recalculation and cycles

A formula **depends on** every in-grid cell it mentions: each single reference, and every cell of each range
(even when the reference is not evaluated, for example in the branch of an `IF` that is not taken). A range
with a corner outside the grid mentions no cell at all. An empty cell can be depended upon. `precedents(ref)` returns the cells that the formula in `ref` depends on (no
duplicates; `[]` for a cell that is not a formula or that has `#PARSE!`). `dependents(ref)` returns the formula
cells that depend on `ref` directly (not through other formulas).

`set(ref, input)` stores the cell, then recomputes. The **affected set** is the cell itself (when its new
input is a formula) together with every formula that depends on it, directly or through other formulas.
Every cell of the affected set is recomputed exactly once, whether or not its value would change (no early
cut-off). Cells outside the set are not touched. `set` returns the references of the recomputed cells in
the order in which they got their new values.

1. **Cycles.** A cell is *cyclic* when it depends on itself, directly or through other formulas. Cyclic cells
   of the affected set are not evaluated: they get `#CYCLE!` first, in reading order, and head the returned
   list.
2. **The rest** are evaluated in dependency order: a cell after every cell of the set that it depends on. When
   several cells are ready, the one first in reading order goes first. A cell that depends on a cyclic cell
   reads its `#CYCLE!` like any other error value (so `=A1+1` is `#CYCLE!`, and `=IFERROR(A1,0)` is 0).
3. Evaluating a formula, even one with `#PARSE!`, is one **evaluation**; assigning `#CYCLE!` is not.
   `sheet.evaluations()` is the total number of evaluations since the sheet was created.

Replacing a formula removes its old dependencies and adds the new ones: a cell that is no longer mentioned does
not trigger it. Clearing a cell recomputes its dependents (it is now empty). A cycle is not an exception: the
cells stay in the sheet with `#CYCLE!`, and when the cycle is broken by a later `set`, the cells recompute
normally.

## 7. Limits

A change at the top of a chain of 1000 formulas that two more columns of 1000 formulas hang from (3000
formulas in all) must recompute in well under a second, and so must a change in one of 500 cells that 500
formulas each sum. Expressions nested 400 parentheses deep or with a thousand operands must parse.

## Files

- `src/refs.mjs`, `src/values.mjs`, `src/index.mjs`: done.
- `src/parser.mjs`, `src/evaluator.mjs`, `src/functions.mjs`, `src/graph.mjs`, `src/sheet.mjs`: yours.
- `test/`: the visible tests. Add new test files; do not edit the existing ones.
