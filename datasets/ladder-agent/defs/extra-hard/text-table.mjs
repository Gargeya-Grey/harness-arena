export default {
  slug: 'text-table',
  tier: {
    level: 4,
    human_minutes: 60,
    basis: 'Estimate from the size of the work, not a timed solve: about 17 separate faults in 10 of 13 files, mostly in Unicode width and cluster handling, roughly 30 minutes to find them and 30 to fix and check them.',
  },
  tags: ['bugfix'],
  task: `Our text-table renderer breaks on real data.
- Korean, Japanese kana, full-width letters and emoji make the columns drift, and accented letters written as a letter plus a combining mark are counted twice. A family emoji (several people joined together), a flag and an emoji with a skin tone each count as several characters.
- Coloured text (ESC [ 31 m and the like) is counted as if the codes were visible, and a cut can fall inside a code or drop the code that switches the colour off.
- A tab shows as one space, null shows as the word null, an object shows as [object Object], and a lone carriage return or other control character is left in the cell.
- With the ellipsis '...' a cut cell is two columns too wide. A cut can split an accented letter or an emoji.
- A number such as 1.005 with 2 decimals gives 1.00, thousands separators also appear inside the decimals, -0.001 prints as -0.00, and decimals: 1.5 is accepted.
- Wrapped text loses its indent and any run of more than one space.
- Centred text puts the extra space on the left.
- The title of a wrapping column is cut instead of wrapped, a row is only as tall as its first cell, and a table without borders keeps trailing spaces.
- When maxWidth is set, the leftmost of the widest columns shrinks, columns with a fixed width shrink too, and minWidth is ignored.

The rules we agreed on:
- Width in terminal columns: a control character (below U+0020, and U+007F-009F) and a zero-width character (U+0300-036F, 1AB0-1AFF, 1DC0-1DFF, 200B-200F, 2060, 20D0-20FF, FE00-FE0F, FE20-FE2F: combining marks, zero-width space and joiners, variation selectors) take 0. Characters in these ranges take 2: Hangul jamo and syllables, CJK and kana and full-width forms, the ideographic space, regional indicators, and emoji blocks (U+1100-115F, 2E80-303E, 3041-33FF, 3400-4DBF, 4E00-9FFF, A000-A4CF, AC00-D7A3, F900-FAFF, FE30-FE6F, FF00-FF60, FFE0-FFE6, 1F1E6-1F1FF, 1F300-1F64F, 1F680-1F6FF, 1F900-1F9FF, 20000-3FFFD). All others take 1. Text is split into grapheme clusters, and a cluster takes the width of its widest character, but 2 if it holds U+FE0F. Width is counted per cluster everywhere: in widths, padding, cutting and wrapping.
- Colour codes are ESC [ digits and semicolons m. They take 0 columns and are never split. Any other control character, ESC alone included, is removed from a cell.
- A cell value is text as it is; null and undefined are empty; Date is its ISO string; an object or array is JSON; anything else is String(value). A cell with several lines (a new line, CRLF or a lone CR is a line break) is several lines. A tab moves to the next multiple of 4 columns counted from the start of its line.
- truncate(line, width, ellipsis) leaves a line that fits as it is. Otherwise it keeps as many whole clusters as fit in width minus the width of the ellipsis, then the ellipsis; the ellipsis is left out when it is wider than width. A cluster that does not fit whole is dropped. Colour codes found after the cut are kept, in order, after the ellipsis. Codes before the cut stay where they are.
- formatNumber(value, { decimals, thousands }) rounds half away from zero on the decimal digits of the number as JavaScript writes it (1.005 gives 1.01 at 2 decimals, -2.5 gives -3 at 0), never in exponent form. Thousands separators go in the whole part only. A result that is zero has no minus sign. decimals is a whole number from 0 to 20, else RangeError. NaN, Infinity and values that are not numbers are written with String().
- wrapLine(line, width) breaks at spaces. The spaces at a break are dropped, trailing spaces are dropped, the spaces inside a line stay as they are, and so does the indent of the first line. A word wider than width is cut into pieces of whole clusters. An empty line gives [''].
- Centring puts the extra space on the right. A row is as tall as its tallest cell (also the header row); shorter cells are filled with blank lines. Header cells follow the overflow rule of their column. With border: 'none' the trailing spaces of every line are removed.
- Column widths: width fixes a column. Otherwise it starts at its widest line (cells and title) and is held between minWidth (default 1) and maxWidth. If the table is wider than maxWidth (borders and padding count), the widest column that may shrink loses one column at a time, the rightmost of equally wide ones first, never below its minWidth and never a column with a fixed width. If that is not enough the table throws RangeError.

Public exports stay as they are. The existing tests must keep passing and must not be edited; put any new tests in new files.`,
};
