# Regex engine

`compile(pattern, flags)` builds a regular expression from the small syntax below and searches text with it.
It must find the same match a backtracking engine finds (the first match in priority order), but it must not
take exponential time. Every rule here is part of the contract. A rule is an exact promise: the hidden check
compares results and error codes.

```js
const re = compile('(?<year>\\d{4})-(\\d\\d)', 'i');
re.groupCount;               // 2
re.names;                    // { year: 1 }
re.exec('on 2024-05-17');    // { start: 3, end: 10, spans: [[3, 10], [3, 7], [8, 10]] }
```

## API

* `compile(pattern, flags = '')`: `pattern` and `flags` must be strings, else `TypeError`. A syntax problem throws
  `RegexSyntaxError` (a `SyntaxError`) with a `code` (see Errors). `src/errors.mjs` holds the class and the codes (finished).
* Flags: any of `i`, `m`, `s`, each at most once, in any order. Another letter or a repeated letter is `bad-flags`.
  Checked before the pattern is read.
  * `i`: ignore case for letters `A-Z` and `a-z` only (no other character folds).
  * `m`: `^` and `$` also match at line breaks.
  * `s`: `.` also matches a line feed.
* The result has: `source` (the pattern), `flags` (the string as given), `groupCount` (the number of capturing groups),
  `names` (a plain object from group name to group number, in the order the names appear).
* A character is one UTF-16 code unit. Indices are code unit indices. A character outside the BMP is two characters.
* `re.exec(text, from = 0)`: `text` must be a string, else `TypeError`. `from` must be an integer from 0 to `text.length`, else `RangeError`.
  Searches from `from` for the leftmost match (the smallest start index `>= from`), and for that start the first match in priority
  order (below). The text before `from` is still context for `^`, `\b` and `\B`. Returns `null`, or
  `{ start, end, spans }`: `spans[0]` is `[start, end]`, and `spans[i]` is `[from, to]` of group `i`, or `null` if group `i` took no part in the match.
  `spans` has `groupCount + 1` entries. A regex keeps no state between calls.
* `re.matchAll(text)`: `text` must be a string, else `TypeError`. An array of every match found by this loop, each shaped as `exec` returns:
  start at 0; find the leftmost match from there; add it; the next search starts at its `end`, or at `end + 1` when the match was empty;
  stop when the search start is past `text.length` or no match is found. A non-empty match may be followed by an empty match at its end.
* `re.replace(text, replacement, all = false)`: `text` and `replacement` must be strings, else `TypeError`. Replaces the first match
  (or every match of `matchAll` when `all` is true) and keeps the text between matches. In `replacement`:
  `$$` is `$`; `$&` is the matched text; `$1` to `$9` is the text of that group (an empty string if the group took no part;
  if the number is above `groupCount`, the two characters stay as they are); `$<name>` is the text of the named group
  (empty if it took no part; if no group has that name, or there is no `>`, the text stays as it is). Any other `$` stays a `$`.
  A reference is one digit: `$10` is group 1 followed by `0`.

## Syntax

* Literal: any character that is not special. The special characters are `\ ^ $ . | ? * + ( ) [` (and `{` where a counted repeat starts).
  `]`, `}` and `{` that does not start a counted repeat are literal.
* `.`: any character except line feed (U+000A); with `s` also line feed.
* Class `[...]`: a set of characters; `[^...]` is its complement; `[]` matches nothing and `[^]` matches any character.
  Inside a class:
  * an atom is one character, an escape (see Escapes) or a class escape (`\d \D \w \W \s \S`);
  * a `-` between two atoms makes a range; any other `-` is a literal. So `[a-]`, `[-a]` and `[\d-]` hold a literal `-`,
    and `[a-b-c]` holds the range `a-b`, `-` and `c`;
  * a range whose ends are not both single characters (a class escape as an end) or whose start is above its end is `bad-range`;
  * `^` is special only right after `[`. `\b` and `\B` are not allowed in a class (`bad-escape`).
  * With `i`, a character matches the class if it, or its other case, is in the set; `[^...]` then negates that test.
* Escapes (in and outside classes): `\n \r \t \f \v` (U+000A, 000D, 0009, 000C, 000B), `\0` (U+0000, nothing else is read),
  `\xHH` (exactly two hex digits), `\uHHHH` (exactly four), and `\` followed by any character that is not an ASCII letter or digit
  stands for that character. Every other `\` + letter or digit, a bad `\x` or `\u`, and a `\` at the end are `bad-escape`.
* Class escapes: `\d` = `0-9`; `\w` = `A-Za-z0-9_`; `\s` = U+0009 to U+000D, U+0020, U+00A0; the capital letters are the complements.
  Outside a class they are sets too. `i` does not change them.
* Assertions (match no character): `^` start of text (with `m` also right after a line feed); `$` end of text (with `m` also right
  before a line feed); `\b` a boundary between a `\w` character and a non-`\w` character (the edges of the text count as non-`\w`);
  `\B` where there is no boundary. Without `m`, `$` does not match before a final line feed.
* Groups: `( ... )` capturing, numbered by the position of the `(`, from 1. `(?: ... )` not capturing. `(?<name> ... )` capturing and named;
  a name is `[A-Za-z_][A-Za-z0-9_]*` and must be followed by `>`, else `bad-name`. `(?<` followed by `=` or `!` (look-behind) is
  `unsupported-group`, not `bad-name`. Any other `(?` is `unsupported-group` too, including `(?=`, `(?!`, `(?i)` and a `(?` at the end.
  A name used twice is `dup-name` (found when the second one is read).
* Alternation `a|b`: either side may be empty. `()` and `(|a)` are fine. Alternation has the lowest precedence, concatenation the next.
* Repeats, after an atom (a literal, `.`, a class, an escape, or a group): `*` `+` `?` `{n}` `{n,}` `{n,m}` (digits only, no spaces).
  A `{` that does not start one of these three forms is a literal. `n` and `m` are at most 1000, else `bad-count`; `m < n` is `bad-count`.
  A `?` after a repeat makes it lazy (`*?`, `+?`, `??`, `{n,m}?`); `{n}?` is the same as `{n}`. A repeat after nothing
  (at the start, after `(`, after `|`), after an assertion (`^ $ \b \B`), or after another repeat (including its lazy `?`) is `nothing-to-repeat`.
  So `a**`, `a+*`, `a*??` and `^*` are all `nothing-to-repeat`.

## Matching

The first match is the one a backtracking engine finds, trying choices in this order:

1. Alternation tries the left side first.
2. A greedy repeat takes one more iteration before it stops; a lazy repeat stops before it takes one more.
   `x{n,m}` takes at least `n` and at most `m` iterations; `x?` is `x{0,1}`.
3. **Empty iterations.** The repeating part of `*`, `+` (the iterations after the first), `{n,}` (the iterations after the first `n`) is an
   unbounded loop: an iteration of that loop that matches the empty string fails, and the engine goes back to the next choice.
   Iterations of `?` and `{n,m}`, and the `n` required iterations, may match the empty string. So `(a*)*` on `b` matches the empty
   string with group 1 taking no part, but `(a*)?` on `b` and `(a*)+` on `b` give group 1 = `[0, 0]`. `(a?){0,2}` on the empty text gives group 1 = `[0, 0]`.
   When the body of an unbounded loop holds a lazy repeat that can match the empty string (such as `(a*?)*`), the result is not
   specified and the hidden check does not test it.
4. Captures: a group holds the span of its last pass. A later iteration that does not pass through the group does not clear it
   (`(?:(a)|b)*` on `ab` gives group 1 = `[0, 1]`). An iteration that is thrown away (rule 3) leaves no capture.
   A group with `{0}` or `{0,0}` never takes part.
5. The leftmost start wins over priority: `b|ab` on `ab` matches `ab` at 0.

Case folding (`i`) applies to literal characters, class members and ranges as described above.

## Size

Write out every counted repeat: `x{n,m}` is `m` copies of `x` (the first `n` required), `x{n,}` is `n` copies and then `x*`, and
`x{0}` is nothing. The expanded pattern may hold at most 10000 atoms, counting every copy; an atom is a literal character, `.`, a class,
a class escape or an assertion (`^ $ \b \B`). Groups and alternation add nothing. More is `too-large`. This is checked after the whole
pattern was read without a syntax problem, and it must not take time or memory in proportion to the size that would be built:
`((a{1000}){1000}){1000}` is `too-large` at once.

## Errors

A syntax problem is found by reading the pattern from left to right; the first one found is thrown. A problem that is only
visible at the end (`unterminated-group`, `unterminated-class`) is found at the end. `too-large` comes after all of these.

| code | when |
|---|---|
| `bad-flags` | an unknown or repeated flag |
| `unterminated-group` | a `(` is never closed |
| `unmatched-paren` | a `)` with no `(` |
| `unterminated-class` | a `[` is never closed |
| `bad-range` | a class range that is reversed or has a class escape as an end |
| `nothing-to-repeat` | a repeat with nothing before it, or after an assertion or a repeat |
| `bad-count` | a count above 1000 or `m < n` |
| `bad-escape` | see Escapes |
| `unsupported-group` | `(?=`, `(?!`, `(?<=`, `(?<!`, `(?i)` and any other `(?` that is not `(?:` or `(?<name>` |
| `bad-name` | a group name that is not valid |
| `dup-name` | a group name used twice |
| `too-large` | see Size |

## Speed

Matching must be linear in the length of the text for a given pattern (more exactly: time proportional to text length times pattern
size). Patterns such as `(a|aa)+$`, `(x+x+)+y` and `(a?){30}a{30}` must not blow up, and a search through a long text
that has many near-matches must not restart from scratch at each start index.

## Files

* `src/errors.mjs`, `src/units.mjs`, `src/index.mjs`: finished.
* `src/parser.mjs`: pattern to syntax tree, with the syntax errors.
* `src/compiler.mjs`: syntax tree to a program, with the size rule.
* `src/matcher.mjs`: the search.
* `src/regex.mjs`: `compile` and the `Regex` class (`exec`, `matchAll`, `replace`).

The tests in `test/` show the shape of results. Do not edit them.
