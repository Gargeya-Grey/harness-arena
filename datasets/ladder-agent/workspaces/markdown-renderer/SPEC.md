# Markdown renderer

`render(source)` in `src/index.mjs` turns a Markdown subset into HTML. This is **not** CommonMark: this
document is the whole definition, and where it differs from what you know, this document wins. You build
`src/blocks.mjs` (lines to block structure), `src/html.mjs` (blocks to HTML) and `src/inline.mjs` (inline
markup). `src/text.mjs` and `src/index.mjs` are done; read them first. You may add modules. `render` throws a
`TypeError` for a value that is not a string, and it never throws for a string.

## 1. Text and output conventions

- `\r\n` and `\r` are line ends, like `\n`. `splitLines` does this and expands tabs (see below). The text
  `a\n` is the lines `a` and `` (an empty last line).
- A **blank line** holds only spaces. Each tab in the leading whitespace of a line counts as four spaces
  (`splitLines`); a tab anywhere else is an ordinary character.
- `escapeHtml` replaces `&` `<` `>` `"` by `&amp;` `&lt;` `&gt;` `&quot;`. All text, code, attribute values and
  info strings are escaped this way and nothing else is: there is no raw HTML and no entity support (`&copy;`
  gives `&amp;copy;`, `<b>` gives `&lt;b&gt;`).
- ASCII punctuation is the 32 characters `` !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~ ``. A backslash before ASCII
  punctuation is removed and the punctuation is an ordinary character (`\*` is a literal star, which never
  starts emphasis). A backslash before anything else is a backslash.
- Every block in the output ends with `\n`. The empty document gives `''`.

## 2. Blocks: what starts a block

A line is looked at after the container markers (quote, list item) of its parents have been removed. The
indent of a line is its number of leading spaces. **A paragraph is open** while the previous non-blank line
belonged to a paragraph that no blank line or other block has closed.

When **no paragraph is open**, the first rule that fits wins:

1. Indent 4 or more: an *indented code* line.
2. A fence opening (section 3.3).
3. An ATX heading (section 3.2).
4. A thematic break (section 3.2).
5. A quote line (section 4).
6. A list item (section 5).
7. A link reference definition (section 6).
8. Otherwise the line starts a paragraph.

When a **paragraph is open** and the line is not blank:

1. A *setext underline* (section 3.2) turns the paragraph into a heading.
2. If the line has indent 3 or less and is a fence opening, an ATX heading, a thematic break, a quote line, a
   bullet item with text, or an ordered item with text whose number has the value 1, it closes the paragraph and
   starts that block. (`2019. was a year` and an empty item `-` do **not** interrupt a paragraph.)
3. Every other line continues the paragraph, whatever its indent. There is no other way to close a paragraph:
   a quote or list item is never continued by an unmarked line (**no lazy continuation**).

A blank line closes the paragraph. Leading spaces are removed from every line of a paragraph; the trailing
spaces and tabs of the last line are removed. The lines are joined with `\n` and given to `renderInline`.

## 3. Leaf blocks

**3.1 Paragraph.** `<p>` inline content `</p>`.

**3.2 Headings and breaks.**

- *ATX heading*: up to 3 spaces, 1 to 6 `#`, then a space or the end of the line. The rest of the line is
  trimmed of spaces and tabs; then a closing run of `#` is removed if it is the whole text or is preceded by a
  space; then it is trimmed again. `#hashtag` and `####### x` are not headings. `<h1>` to `<h6>`.
- *Setext heading*: a paragraph followed by a line of up to 3 spaces, then only `=` (level 1) or only `-`
  (level 2), then optional trailing spaces. The heading text is the paragraph text (several lines are
  allowed). `---` under a paragraph is an underline, not a thematic break; `-` alone is an underline too.
- *Thematic break*: up to 3 spaces, then 3 or more of the same character `-`, `*` or `_`, with any number of
  spaces between them and after them, and nothing else. `<hr>`. A thematic break is never a list item
  (`* * *`, `- - -`).

**3.3 Fenced code.** A fence opening is up to 3 spaces, then 3 or more backticks or 3 or more tildes, then
the info string (the rest of the line, trimmed). An opening with backticks whose info string contains a
backtick is not a fence. The block ends at the first line of up to 3 spaces, then the same character at least
as many times as the opening, then spaces only. Without such a line it ends with the last line of the
container. The content lines lose up to as many leading spaces as the opening line had. The output is
`<pre><code>` + escaped content, each line followed by `\n` + `</code></pre>`; no content gives
`<pre><code></code></pre>`. If the info string has a first word, the tag is
`<code class="language-WORD">` (the word is escaped, with no backslash processing).

**3.4 Indented code.** A line with indent 4 or more when no paragraph is open. The block takes the following
lines while they are blank or have indent 4 or more; blank lines at its end are not part of it. Each line loses
its first four characters (a blank line loses up to four). Output as for fenced code, without a class.

## 4. Block quotes

A quote line has up to 3 spaces, then `>`. The quote is the maximal run of consecutive quote lines. From each
line the spaces, the `>` and one space after it (if there is one) are removed, and the remaining lines are
parsed as blocks (so quotes nest, and a reference definition inside counts, see section 6). Output:
`<blockquote>\n` + the inner blocks + `</blockquote>\n`. A line without `>`, even a non-blank one, ends the quote.

## 5. Lists

**5.1 Items.** A list item line has up to 3 spaces, then a marker, then spaces or the end of the line. A marker
is one of `-` `+` `*` (a *bullet*), or 1 to 9 digits followed by `.` or `)` (an *ordered* marker). A line that
is a thematic break is not an item. Let *N* be the number of spaces after the marker, and *W* the width of the
marker. If the rest of the line is empty (an *empty first line*), or *N* is more than 4, the item's **content
column** is the indent plus *W* plus 1, and the first line of the item content is the rest of the line after
that one space (so with *N* > 4 it begins with *N* − 1 spaces: indented code). Otherwise the content column is
the indent plus *W* plus *N* and the first line is the rest of the line.

**5.2 What belongs to an item.** After the first line, the item takes each following line while:

- the line is non-blank and its indent is at least the content column (the first *content column* characters are
  removed), or
- the line is blank, and the next non-blank line has an indent of at least the content column (the blank lines
  are kept, each with up to *content column* leading characters removed).

Otherwise the item ends. A non-blank line with a smaller indent always ends it, which includes a line that
looks like a paragraph continuation. An item with an empty first line ends at once if the next line is blank.
The collected lines are parsed as blocks: that is the item.

**5.3 Lists.** After an item, the blank lines and the next non-blank line are looked at. If that line is an
item line (indent up to 3, whatever the indent of the first item) of the same kind, it starts the next item of
the same list. *Same kind* means the same bullet character, or the same ordered delimiter (`.` or `)`; the
numbers may be any). Anything else ends the list: a different bullet or delimiter starts a new list.

**5.4 Loose and tight.** A list is **loose** when a blank line lies between two of its items, or between two
child blocks of one of its items. Blank lines inside a fenced or indented code block, and inside a nested
list, do not count for the outer list. Any other list is **tight**.

## 6. Link reference definitions

When no paragraph is open, a line of the form `[label]: dest` or `[label]: dest "title"` (up to 3 spaces
before; any number of spaces, also none, after the colon; at least one space before a title; the title is in `"` or `'`, and a title in parentheses is not one; nothing else on the line) defines
a link and produces no output. The label has no unescaped `[` or `]`, and is not blank. The destination is a
maximal run of non-space characters, including quotes. Consume that entire run before looking for a title.
If the entire run is wrapped in `<` `>`, those are removed. A quoted suffix without a separating space belongs
to the destination: `[a]: /u't'` has destination `/u't'` and no title, while `[a]: /u 't'` has destination `/u`
and title `t`. This precedence also applies when angle brackets occur in the run. Backslash escapes in destination
and title are processed. A label is matched after `normalizeLabel`. The first definition of a label wins.
Definitions may come after the link that uses them, anywhere in the document. A definition line that does not
fit this form is paragraph text.

## 7. Block output

```
<p>…</p>\n   <h1>…</h1>\n   <hr>\n   <pre><code>…</code></pre>\n
<blockquote>\n …inner blocks… </blockquote>\n
<ul>\n …items… </ul>\n      <ol>\n …items… </ol>\n      <ol start="N">\n   (ordered; N is the first number's value, when it is not 1)
```

An item is `<li>…</li>\n`; an item with no blocks is `<li></li>\n`. In a **loose** list it is `<li>\n` + the
HTML of its blocks + `</li>\n`. In a **tight** list the item starts with `<li>`, a paragraph is written as its
inline content only (no `<p>`, no newline after it), and before any other block a `\n` is written unless the
output of the item so far already ends with one. So `- a`, a nested list under it, gives
`<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n`.

## 8. Inline content

`renderInline(text, refs)` scans the text from left to right. Each rule below applies where the scan is, and
the first that fits wins; the text of a paragraph keeps its `\n` between lines.

**8.1 Backslash.** A backslash before `\n` is a hard line break. A backslash before ASCII punctuation is
that character. Otherwise it is a backslash.

**8.2 Code spans.** A run of *n* backticks opens a span that ends at the next run of exactly *n* backticks. The
content is the text between; each `\n` in it becomes a space; if it begins **and** ends with a space and is not
only spaces, one space is removed from each end. Output `<code>` + escaped content + `</code>`. Nothing
inside is interpreted (no backslash, no emphasis, no brackets). A run with no matching run is literal
backticks. A span binds tighter than everything after it in the text: ``[a`](u)` `` has no link.

**8.3 Emphasis.** A *delimiter run* is a maximal run of one character `*` or `_`. With *before* and *after* the
characters next to the run (the start and end of the text count as a space), the run is:

- *left-flanking* when *after* is not whitespace, and (*after* is not ASCII punctuation, or *before* is
  whitespace or ASCII punctuation);
- *right-flanking* when *before* is not whitespace, and (*before* is not ASCII punctuation, or *after* is
  whitespace or ASCII punctuation).

A `*` run **can open** when left-flanking and **can close** when right-flanking. A `_` run can open when
left-flanking and (not right-flanking, or *before* is punctuation); it can close when right-flanking and
(not left-flanking, or *after* is punctuation). A run that can do neither is literal text.

Matching works on the list of runs, with *closers* taken from left to right. For a closer, look back through
the earlier runs, nearest first, for an **opener**: a run of the same character that can open, with characters
left, and that passes the **rule of three**: if the opener can close or the closer can open, and the *original*
lengths of the two runs add up to a multiple of 3, then they match only if both lengths are multiples of 3.
When an opener is found, use 2 characters (strong) if both runs have at least 2 left, else 1 (em). The used
characters are those next to the text between the runs. The result is `<strong>` or `<em>` after the used
characters of the opener and the closing tag before the used characters of the closer. All runs between the
opener and the closer are dropped (they stay literal). Repeat for the same closer while it has characters left.
A closer that finds no opener stays literal. Later matches on the same run wrap earlier ones: `***a***` is
`<em><strong>a</strong></em>`. Unused characters are literal text. Matching is done for the whole text at the
end, except that the runs inside a link or image text are matched when the link is formed (8.4), and never
match runs outside it.

**8.4 Links and images.** `[` and `![` open a *bracket*. At a `]`, the nearest open bracket is used (none: the
`]` is literal). It becomes a link (or image) when one of these follows, tried in this order:

1. `(` *dest* `)` or `(` *dest* *title* `)`, with blanks (spaces, tabs, line ends) allowed after `(` , around
   the title, and before `)`, and at least one blank before the title. *dest* is either `<…>` (no `<` or line
   end inside) or a run of characters that are not blank or control characters, where `(` and `)` must
   balance; an unbalanced `)` ends it; the run may be empty. *title* is `"…"` or `'…'`. A backslash before
   punctuation in dest and title is removed.
2. `[label]`, `[]` or nothing at all. With a non-blank label in the second brackets, that label is used (if it
   is not defined, there is no link and the shortcut below is **not** tried); with `[]` or nothing, the raw
   text between the first brackets is the label. The label is matched by `normalizeLabel` in the definitions.

If neither fits, the bracket is literal `[`, and the `]` is literal text. Output: `<a href="DEST">` or
`<a href="DEST" title="TITLE">` … `</a>`; an image is `<img src="DEST" alt="ALT">` (with ` title="TITLE"`
after `alt` when there is a title, even an empty one). DEST and TITLE are escaped. When the destination, after backslash
removal, begins with `javascript:`, `vbscript:` or `data:` (any case), DEST is empty. ALT is the plain text of
the image's text: literal text and code span content as written (unescaped, then escaped for the attribute),
the ALT of an inner image, no tags, and a space for each line break. **A link never contains a link**: when a
link (not an image) forms, every open `[` bracket before it (not `![`) can no longer form a link, so that
bracket and its `]` are literal text. An image may contain a link, and a link an image.

**8.5 Line breaks.** A `\n` in the text is a **hard break**, `<br>` + `\n`, when at least two spaces come before
it; else a soft break, which stays `\n`. The spaces before a `\n` are not output. A hard break by backslash
(8.1) writes `<br>\n` and its `\n`.

## 9. Limits

A text of 60 000 delimiter runs, and one of 200 nested quotes, lists or emphasis levels, must render in well under
a second without stack overflow. Do not rescan the text for each run.

## Files

- `src/text.mjs`, `src/index.mjs`: done. `src/blocks.mjs`, `src/html.mjs`, `src/inline.mjs`: yours.
- `test/`: the visible tests. Add new test files; do not edit the existing ones.
