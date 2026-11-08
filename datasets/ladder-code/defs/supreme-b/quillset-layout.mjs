import { t, lcg, draw } from './_util.mjs';

const spec = [
  'Implement typeset(text, options), a small typesetter for monospaced text. It returns an array of strings, the lines of the page. options is an object { width, align, indent, hang, hyphenate, columns, gutter, exceptions }. width is a whole number from 8 to 80. align is "left" (the default), "right", "center" or "justify". indent (default 0) and hang (default 0) are whole numbers from 0 to 8. hyphenate (default false) is a boolean. columns (default 1) is 1, 2 or 3. gutter (default 2) is a whole number from 1 to 6. exceptions (default none) is an array of strings made of lowercase letters a-z and hyphens.',
  '',
  'WIDTH OF TEXT. Every width below is measured in cells. Each code point of a string takes the cells given by its number: U+0300 to U+036F (combining marks) take 0 cells; U+1100 to U+115F, U+2E80 to U+A4CF, U+AC00 to U+D7A3, U+FF01 to U+FF60 and U+FFE0 to U+FFE6 take 2 cells; every other code point takes 1 cell. The width of a string is the sum over its code points (iterate by code point, not by UTF-16 unit). A space is 1 cell.',
  '',
  'PARAGRAPHS AND WORDS. First every "\\r\\n" and every single "\\r" in text becomes "\\n". A line is blank when it holds only spaces and tabs (or nothing). Paragraphs are the maximal runs of non-blank lines, so one or more blank lines separate two paragraphs, and blank lines at the start and the end are ignored. The words of a paragraph are the pieces of its lines joined by one space and cut at every run of spaces and tabs. A text without any word gives the empty array. Nothing else is whitespace: in particular U+00A0 is an ordinary character of a word.',
  'The lines of the result are the lines of the first paragraph, then one empty string "", then the lines of the second paragraph, and so on: exactly one empty string between two paragraphs, whatever the number of blank lines in the text.',
  '',
  'KINDS OF PARAGRAPH. Look at the first word of a paragraph that has two or more words. If it is "#" the paragraph is a level 1 heading; if it is "##" it is a level 2 heading; if it is ">" it is a quote. That first word is then removed and is not part of the text. Every other paragraph is plain (a paragraph of the single word "#" is plain and shows "#"). The rest of the words go through GLUE below.',
  'GLUE. Process the words in order with a pending prefix that starts as the empty string. A word made only of characters from . , ; : ! ? ) (one or more of them), when at least one word has already been output and the last output word is not "//", is appended to the last output word. A word made only of ( characters, when it is not the last word and the next word is not "//", is added to the pending prefix. Any other word is output as the pending prefix followed by the word, and the pending prefix becomes empty. (So "( fig ) ," becomes the one word "(fig),".) A word of ( characters that is the last word, or is followed by "//", is output like any other word.',
  '',
  'THE PIECES OF A WORD. A word is split into pieces, and after each piece but the last there is a break point of one kind: hard, soft or auto. The text of the word is the pieces written one after another.',
  '- A word that holds an underscore "_" that is not directly preceded by a backslash is a no-break word: every such underscore shows as a space, every "~" is removed, and every "\\_" shows as a plain "_". A no-break word is one single piece and has no break point (it may hold spaces, which count in its width).',
  '- Otherwise a "\\_" shows as a plain "_" and the following applies. A "~" is a soft break point when there is a character directly before it and a character directly after it in the word, neither of which is "~", and the piece before it is not empty (that is, it does not come directly after a hard break point). The "~" itself is never shown. Every other "~" is removed without effect. A word that is empty after the removal of its "~" is dropped from the paragraph.',
  '- A "-" is a hard break point, placed after the hyphen, when the character before it and the character after it are both ASCII letters or digits (for this rule the word is taken with each "\\_" already replaced by "_" and with its "~" still in place, so a "~" next to a "-" stops the break). The hyphen stays at the end of its piece. Any other "-" is an ordinary character.',
  '- Automatic hyphenation happens only when options.hyphenate is true, and only for a word that has exactly one piece and holds no "-" and no "~". Let core be the word without its leading characters from ( " \' and without its trailing characters from . , ; : ! ? ) " \'. If core has at least 4 characters and all of them are ASCII letters, its automatic break points are found as follows. Compare in lowercase. If core, in lowercase, equals an entry of options.exceptions with its hyphens removed, the break points are the places of the hyphens in that entry (a hyphen after n letters is a break point between letter n - 1 and letter n of core, counting letters from 0; positions 0 and the length of core are ignored; when several entries match, the last of them is used); this is used for any length of core of 4 or more. Otherwise, if core has fewer than 7 letters there are none. Otherwise let L be the length of core and consider every position p from 3 to L - 3 (a break between letter p - 1 and letter p, counting letters from 0, so at least 3 letters stay on each side). The letters a e i o u are vowels, and y is a vowel unless it is the letter 0 of core; every other letter is a consonant. The digraphs are ch sh th ph and ck. Position p is a break point in exactly these three cases: (1) letter p - 1 is a vowel, letter p is a consonant and letter p + 1 is a vowel; (2) letter p - 1 is a vowel, letters p and p + 1 form a digraph and letter p + 2 is a vowel; (3) letters p - 1 and p are consonants, letter p - 2 and letter p + 1 are vowels, and letters p - 1 and p do not form a digraph. The pieces then are the parts of the word between these break points, all of kind auto (leading and trailing punctuation stay with the first and last piece).',
  '',
  'LINES OF A PARAGRAPH. The available width of a line is the width of the layout (see the end) minus the prefix of the line. The prefix is 0 for every line when align is "right" or "center". When align is "left" or "justify" the prefix of the first line is indent, and the prefix of every other line is the continuation prefix, which is hang, except for a paragraph that starts with a list marker: when a plain or quote paragraph has two or more words and its first word (after GLUE) is made of digits followed by "." or ")", or is "-" or "+", the continuation prefix is indent + the width of that first word + 1, and hang is not used. The prefix is not part of the line width used below; it is only subtracted from the available width.',
  'Lines are filled greedily, word by word, from left to right. The current line is a list of items; its used width is the sum of the widths of its items plus 1 for each gap between two items. For each word, in order, repeat the following steps until the whole word is placed:',
  '1. If the word is "//": the current line ends as a forced line and nothing else happens; if the current line has no item, an empty line is produced (it is shown as ""). A forced line is not justified and is not a mark-break line, and the next line starts empty.',
  '2. Let rest be all the remaining pieces of the word written together. If used width + 1 (when the line has an item) + width of rest is at most the available width, rest becomes one item of the line and the word is done.',
  '3. Otherwise look for a break point inside the rest. For k from the number of remaining pieces minus 1 down to 1, consider ending the line after the first k pieces: the candidate text is those k pieces, plus one "-" when the break point after piece k is soft or auto (a hard break point has its hyphen in the piece already). The candidate fits when used width + 1 (when the line has an item) + width of the candidate text is at most the available width. The first candidate that fits (so the largest k) is chosen. But a soft or auto break point is not allowed when the two lines directly before this line in the paragraph both ended with a soft or auto break (a mark break); only hard break points are considered then. If a candidate is chosen, the candidate text becomes the last item of the current line, the line ends, and the word continues with the pieces after the first k.',
  '4. If no candidate fits and the current line has an item, the line ends (not forced, not a mark break) and the word starts again from step 2 on the next line.',
  '5. If no candidate fits and the current line has no item, the first piece is cut: take characters from its start while the total width stays at most the available width, but always at least one character. That part becomes the only item of the line, the line ends without a "-", and the rest of the first piece (if any) stays as the first piece of the word, with its break point; if nothing is left of the first piece, the word continues with the next piece.',
  'At the end of the paragraph a current line that has an item ends as the last line. A line that ends after a chosen candidate with a soft or auto break point is a mark-break line; a hard break point, a forced cut and a plain end of line are not.',
  '',
  'WIDOWS. After the lines of a plain or quote paragraph are made, if the paragraph has at least 3 lines, the last line has exactly one item whose width is at most 3, neither the last line nor the line before it is forced, the line before it has at least 2 items, its last item is not a part of a word that goes on in the next line (an item made by a chosen candidate or by a cut is such a part), and the width of that last item + 1 + the width of the item of the last line is at most the width of the layout minus the continuation prefix (0 when align is "right" or "center"), then that last item moves from the line before to the front of the last line. The prefix of the last line is the continuation prefix.',
  '',
  'ALIGNMENT. The text of a line is its items joined by single spaces. align "left": the prefix, then the text. "right": spaces so that the line ends at the width of the layout, then the text. "center": floor((width of the layout - width of the text) / 2) spaces, then the text. "justify": the prefix, then the text with its gaps made wider, but only for a line that is not the last line of its paragraph, is not forced and has at least 2 items; any other line of a justified paragraph is written like "left". An empty line is the empty string.',
  'JUSTIFY. Let extra be the available width minus the width of the text. The gaps are the spaces between two neighbouring items. The weight of a gap is 2 when the item before it, after removing any closing characters from " \' ) ] at its end, ends with one of . ! ? : and otherwise 1. Let T be the sum of the weights. Each gap first gets floor(extra * weight / T) extra spaces. The left-over spaces (extra minus the sum of the shares), fewer than the number of gaps, go one each to the gaps with the largest value of (extra * weight) mod T; among equal values the gap that is closer to the end of the line comes first. A gap then holds 1 + its extra spaces.',
  '',
  'HEADINGS. A heading is laid out with the width of the layout, never with indent, hang, list markers, hyphenation or the widow treatment. A level 1 heading is written in capitals (every word through toUpperCase) and is centered; a level 2 heading is written as it is and aligned left with prefix 0. After its lines comes one more line: the widest line of the heading (its width after removing spaces at both ends) as that many "=" characters for level 1, centered like the lines ("center" rule), and as that many "-" characters from the start of the line for level 2.',
  'QUOTES. A quote is laid out like a plain paragraph with the layout width reduced by 2 (and with the same align, indent, hang and list rule), and every line of it is then written as "> " followed by the line, with any spaces at the end of the result removed (so an empty line becomes ">").',
  '',
  'COLUMNS. The width of a column is the width option when columns is 1. Otherwise it is floor((width - gutter * (columns - 1)) / columns), and this is the width of the layout in every rule above. All paragraphs are laid out into one list of lines, as above. When columns is 1 that list is the result. Otherwise let n be its length: column i (counting from 0) gets the next n div columns lines of the list, plus 1 more if i < n mod columns. In every column, empty lines at its top are removed. The result has as many rows as the tallest column; a row is the cells of the columns, each cell padded with spaces at its end to the width of the layout (an absent cell is all spaces), joined by gutter spaces, with the spaces at the end of the whole row removed.',
].join('\n');

// ---------------------------------------------------------------- seeded documents

const VOCAB = [
  'the', 'a', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dogs', 'computer', 'keyboard', 'typesetting', 'extraordinary',
  'information', 'beautiful', 'understanding', 'photograph', 'amazing', 'development', 'paragraph', 'impossible', 'wonderful',
  'sentence.', 'question?', 'amazing!', 'quote:', '"Yes."', '(maybe)', 'well-known', 'state-of-the-art', 'e-mail', 'twenty-one',
  'hy~phen~ated', 'con~tin~ue', 'a~b', 'no_break_here', 'fig_1', '10_km', 'x\\_y', 'me~', '~~', 'is', 'to', 'of', 'in', 'at', 'it',
  'ultra-long-hyphenated-compound-word', 'supercalifragilistic', 'ab', 'xyz', 'ok', ',', '.', ')', '(', '!', '//', '//',
  '日本語', 'ｆｕｌｌ', 'café', 'née', 'thickness', 'quickly', 'strength', 'rhythm', 'yellowish', 'mythology',
];

function document(seed, paragraphs, perParagraph) {
  const next = lcg(seed);
  const pick = () => VOCAB[draw(next, VOCAB.length)];
  const heads = ['', '', '', '', '', '# ', '## ', '> ', '> 1. ', '1. ', '- ', '+ ', '12) '];
  const parts = [];
  for (let p = 0; p < paragraphs; p += 1) {
    const head = heads[draw(next, heads.length)];
    const words = [];
    const count = 12 + draw(next, perParagraph);
    for (let i = 0; i < count; i += 1) words.push(pick());
    const gap = ['\n', ' ', '  ', '\t', '\r\n', ' '];
    let body = head;
    words.forEach((word, index) => {
      body += (index > 0 ? gap[draw(next, gap.length)] : '') + word;
    });
    parts.push(body);
  }
  const separators = ['\n\n', '\n\n\n', '\n \n', '\r\n\r\n'];
  return parts.map((part, index) => (index === 0 ? part : separators[draw(next, separators.length)] + part)).join('');
}

const opt = (width, extra = {}) => ({ width, ...extra });

// Hand-derived (worked out from the task text; the reference has to agree). The longer ones, which use several rules at once, are
// hidden tests; the others are small worked examples of single rules that tests/ladder-code-supreme-b.test.mjs checks against the reference.
const worked = [
  // Width 15, left: "the quick brown" is 15 wide, "fox jumps over" 14, "the lazy dog" 12; the last line has 3 items, so no widow.
  t('greedy', ['the quick brown fox jumps over the lazy dog', opt(15)], ['the quick brown', 'fox jumps over', 'the lazy dog']),
  // Width 22, justify. Line 1 "Hello world. This is" is 20 wide, extra 2. Gaps: Hello|world. weight 1, world.|This weight 2 (the item ends with "."),
  // This|is weight 1; T = 4. Shares floor(2 * w / 4) = 0, 1, 0; one space is left. (2 * w) mod 4 = 2, 0, 2: the larger values are the first and the last gap,
  // and of the two the gap closer to the end wins: the last gap. So the gaps are 1, 2 and 2 spaces wide. The last line is written left.
  t('justify-weights', ['Hello world. This is fine and good.', opt(22, { align: 'justify' })], ['Hello world.  This  is', 'fine and good.']),
  // Automatic hyphenation of "computer" (c o m p u t e r, L = 8, positions 3 to 5): p = 3: letters 2 and 3 are consonants (m p), letter 1 (o) and
  // letter 4 (u) are vowels: case 3. p = 4: letter 3 is a consonant: no case. p = 5: u is a vowel, t a consonant, e a vowel: case 1. Pieces com|pu|ter.
  // Width 5: the whole word is too wide; k = 2: "compu-" is 6 wide, too wide; k = 1: "com-" is 4 wide: it fits. Then the rest "puter" is 5 wide: it fits.
  t('auto-hyphen', ['computer', opt(5, { hyphenate: true })], ['com-', 'puter']),
  // Width 6: k = 2: "compu-" is exactly 6 wide and is chosen (the largest k that fits). The rest "ter" is the last line.
  t('auto-hyphen', ['computer', opt(6, { hyphenate: true })], ['compu-', 'ter']),
  // Soft hyphens, width 4: "ab~cd~ef~gh~ij". Line 1: the largest k whose text plus "-" fits is k = 1: "ab-" (3). Line 2: "cd-". Two mark-break lines in a row, so the
  // soft break points are not allowed for line 3: nothing fits, the line is empty: the first piece "ef" is cut by width (2 of 4): "ef" with no "-".
  // Line 4: the rest "ghij" is 4 wide and fits.
  t('mark-limit', ['ab~cd~ef~gh~ij', opt(4)], ['ab-', 'cd-', 'ef', 'ghij']),
  // Width 10, widow: "aaaa bbbb" and "cccc dddd" fill two lines, the last line is "ee" (one item, 2 wide), 3 lines, the line before has 2 items:
  // "dddd" moves down (4 + 1 + 2 = 7 <= 10).
  t('widow', ['aaaa bbbb cccc dddd ee', opt(10)], ['aaaa bbbb', 'cccc', 'dddd ee']),
  // A list marker, width 12, left. The marker "1." is 2 wide, so the continuation prefix is 0 + 2 + 1 = 3 and the available width of the later lines is 9.
  // Line 1 "1. Alpha" (8) cannot take " beta" (13). Then "beta" (a next word would make 10 > 9), "gamma", "delta".
  t('list-marker', ['1. Alpha beta gamma delta', opt(12)], ['1. Alpha', '   beta', '   gamma', '   delta']),
  // Glue, a no-break word and a hard break point, width 9. Words: see ( fig_1 ) , well-known foo . -> see, "(fig_1)," (no-break word: shows "(fig 1),", 8 wide),
  // well-known, "foo.". "see" + 8 does not fit (12 > 9): line "see". "(fig 1)," is 8 wide; "well-known" does not fit in the rest of that line and the hard
  // candidate "well-" (5) does not either: the line ends. "well-" (5) fits on its own line (the hard break needs no mark); "known foo." is 10 > 9 so "known" and "foo." follow.
  t('glue-nobreak', ['see ( fig_1 ) , well-known foo .', opt(9)], ['see', '(fig 1),', 'well-', 'known', 'foo.']),
  // Forced breaks, justify, width 12. "aa bb" ends at "//" (forced, not justified). "cc dd ee ff" is 11 wide and "gg" would make 14: extra 1, three gaps of weight 1, T = 3,
  // shares 0, 0, 0, and one space goes to the gap closest to the end: "cc dd ee  ff". The last line "gg hh" is written left. A second "//" right after a line end gives "".
  t('forced-break', ['aa bb // cc dd ee ff gg hh', opt(12, { align: 'justify' })], ['aa bb', 'cc dd ee  ff', 'gg hh']),
  t('forced-empty', ['x // // y', opt(8)], ['x', '', 'y']),
  // Columns: width 11, 2 columns, gutter 1: column width floor((11 - 1) / 2) = 5. Lines "aa bb", "cc dd", "ee ff" (the last has 2 items: no widow). n = 3: column 0 gets 1 + 1 = 2 lines,
  // column 1 gets 1. Row 0 is "aa bb" + " " + "ee ff"; row 1 is "cc dd" + " " + 5 spaces, with the spaces at the end removed.
  t('columns', ['aa bb cc dd ee ff', opt(11, { columns: 2, gutter: 1 })], ['aa bb ee ff', 'cc dd']),
  // Exceptions: "artifact" with the entry "ar-ti-fact" and width 4. Breaks after 2 and 4 letters: ar|ti|fact. k = 2: "arti-" is 5 > 4; k = 1: "ar-" fits. Then "tifact": k = 1: "ti-" fits.
  // That was the second mark-break line in a row, but "fact" fits whole (4 wide), so no break is needed. Without the entry the automatic rules break only after "arti".
  t('exceptions', ['artifact', opt(4, { hyphenate: true, exceptions: ['ar-ti-fact'] })], ['ar-', 'ti-', 'fact']),
  // Wide characters and combining marks: "eéeé" is 4 wide (U+0301 takes no cell), "日本" is 4 wide.
  // Width 9, center: the text "eéeé 日本" is 9 wide, so no padding.
  t('cell-width', ['eéeé 日本', opt(9, { align: 'center' })], ['eéeé 日本']),
  t('cell-width', ['eéeé 日本', opt(8)], ['eéeé', '日本']),
  // Headings and quotes, width 20. "# Big title" is a level 1 heading: "BIG TITLE" (9 wide) centered: floor(11 / 2) = 5 spaces, and the underline of 9 "=" with 5 spaces.
  // "## Part two" is a level 2 heading: "Part two" (8), then 8 "-". The paragraphs are separated by "". The quote "> q r" becomes "> q r".
  t('headings', ['# Big title\n\n## Part two\n\n> q r', opt(20)], ['     BIG TITLE', '     =========', '', 'Part two', '--------', '', '> q r']),
  // Right and center alignment ignore indent and hang. Width 10: "ab cd" (5 wide): right gives 5 spaces; center floor(5 / 2) = 2 spaces.
  t('align', ['ab cd', opt(10, { align: 'right', indent: 3 })], ['     ab cd']),
  t('align', ['ab cd', opt(10, { align: 'center', hang: 2 })], ['  ab cd']),
];

const HIDDEN = new Set(['glue-nobreak', 'mark-limit', 'headings', 'widow', 'columns', 'forced-break']);
const hand = worked.filter((one) => HIDDEN.has(one.edge));
const examples = worked.filter((one) => !HIDDEN.has(one.edge));

const computed = [];
const plans = [
  [101, 4, 14, { width: 24, align: 'justify', hyphenate: true }],
  [102, 4, 14, { width: 30, align: 'justify', indent: 2, hang: 1, hyphenate: true }],
  [103, 3, 14, { width: 33, align: 'justify', hyphenate: true, columns: 2, gutter: 3 }],
  [104, 3, 14, { width: 66, align: 'justify', hyphenate: true, columns: 3, gutter: 2, indent: 1, hang: 2 }],
  [105, 4, 14, { width: 20, align: 'right', hyphenate: true }],
  [106, 3, 14, { width: 18, align: 'center', hyphenate: false, columns: 2 }],
  [107, 4, 14, { width: 26, align: 'justify', hyphenate: true, indent: 3, hang: 0, exceptions: ['ty-pe-set-ting', 'photo-graph', 'beau-ti-ful'] }],
  [108, 3, 14, { width: 24, align: 'justify', hyphenate: true, hang: 4 }],
  [109, 3, 14, { width: 36, align: 'justify', hyphenate: true, columns: 2, gutter: 4, indent: 2, hang: 2, exceptions: ['key-board', 'con-tin-ue'] }],
  [110, 4, 14, { width: 50, align: 'justify', hyphenate: true, columns: 3, gutter: 1, hang: 3 }],
  [111, 4, 14, { width: 16, align: 'justify', hyphenate: true, indent: 2 }],
  [112, 3, 14, { width: 42, align: 'justify', hyphenate: true, columns: 2 }],
  [113, 3, 14, { width: 15, align: 'justify', hyphenate: true, hang: 2, indent: 1 }],
  [114, 3, 14, { width: 44, align: 'justify', hyphenate: true, columns: 2, gutter: 2 }],
];
plans.forEach(([seed, paragraphs, size, options]) => computed.push(t('mixed-document', [document(seed, paragraphs, size), options])));

export default {
  slug: 'quillset-layout',
  tier: {
    level: 5,
    human_minutes: 480,
    basis: 'A typesetter with cell widths, paragraph and word splitting, glue, three kinds of break point, rule-based hyphenation with exceptions and a limit on consecutive hyphenated lines, greedy filling with a forced cut, a widow rule, four alignments with weighted justification, headings, quotes, list markers and balanced columns, over about 60 stated rules. The reference is about 400 lines. An expert needs a full working day to read the rules closely, write it and check it against worked examples.',
  },
  tags: ['spec'],
  name: 'typeset',
  signature: 'typeset(text, options) -> array of strings',
  task: spec,
  edges: {
    'mark-limit': 'both ended with a soft or auto break',
    widow: 'that last item moves from the line before to the front of the last line',
    'glue-nobreak': 'is a no-break word',
    'forced-break': 'as a forced line',
    columns: 'empty lines at its top are removed',
    headings: 'a level 1 heading',
    'mixed-document': 'exactly one empty string between two paragraphs',
  },
  examples,
  tests: [...hand, ...computed],
};
