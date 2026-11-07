import { t } from './_util.mjs';

const spec = [
  'layoutText(text, width, justify) breaks a paragraph into lines of at most width characters and returns the array of lines (strings).',
  '',
  'WORDS. Only the space character separates words. Leading, trailing and repeated spaces are ignored. Every other character, including tabs and line breaks, is part of a word and counts as one column. If the text has no words, return an empty array.',
  '',
  'ITEMS. A hyphen "-" inside a word is a place where the word may be broken, but only when the characters just before and just after the hyphen are both letters or digits (A-Z, a-z, 0-9). So "well-known" can be broken after its hyphen, but "a--b", "-a", "a-", "x-(y" and "(a)-b" cannot. A break after such a hyphen leaves the hyphen at the end of the line, and the rest of the word starts the next line. The word is cut into fragments at these places, and each fragment ends with its hyphen (the last one has none). A fragment that is longer than width is cut further into pieces of exactly width characters (the last piece may be shorter); no hyphen is added there. The pieces of all fragments, in order, are the items of the word. Every item is at most width characters long.',
  '',
  'LINES. A line is made of consecutive items of the text, from one or more words. Items of the same word are joined with no space between them; items of different words are separated by exactly one space. The length of a line is the number of characters it holds, spaces included, and it must be at most width. Every item must be on exactly one line, in order.',
  '',
  'CHOICE OF LINES. Choose the lines that minimise the total cost. The cost of a line is (width - length)^2, where length is its natural length as defined above, except that the last line has no cost. If several choices have the same minimum cost, take the one whose first line is longest (the first line ends at the latest item); if that is still tied, the one whose second line is longest, and so on: the breaks are compared from the first line on, and the later break is better.',
  '',
  'JUSTIFICATION. When justify is true, every line except the last is padded with spaces until its length is exactly width. The padding goes into the gaps, which are the places where two different words meet on that line (the spaces of the natural line). With g gaps and e = width - length extra spaces, every gap gets floor(e / g) extra spaces, and the leftmost (e mod g) gaps get one more. A line with no gap is left as it is, even when it is shorter than width. When justify is false, and for the last line, no padding is added. No line has trailing or leading spaces.',
  '',
  'Return the lines in order. The text has at most 2000 characters and width is between 1 and 200.',
].join('\n');

const P1 = 'The quick brown fox jumps over the lazy dog while the well-known state-of-the-art system re-enters the atmosphere, and nobody notices the extraordinarily long-winded explanation that follows it.';
const P2 = 'In a village of La Mancha, the name of which I have no desire to call to mind, there lived not long since one of those gentlemen that keep a lance in the lance-rack, an old buckler, a lean hack, and a greyhound for coursing. An olla of rather more beef than mutton, a salad on most nights, scraps on Saturdays, lentils on Fridays, and a pigeon or so extra on Sundays, made away with three-quarters of his income.';
const P3 = 'Pneumonoultramicroscopicsilicovolcanoconiosis is a word, as is supercalifragilisticexpialidocious, and so is antidisestablishmentarianism; but a-b-c-d-e-f-g is not, and neither is 1-2-3-4-5-6-7-8-9-10-11-12.';

// Hand-derived tests: the lines of each were worked out from the task text alone, before the reference solution was
// run on it, and are stored here as written (generate.mjs does not compute them). The tie-later rows each have two optimal breaks.
const hand = [
  t('words', ['  hello   world  ', 20, false], ['hello world']),
  t('empty', ['', 5, true], []),
  t('empty', ['   ', 3, false], []),
  t('other-whitespace', ['a\nb c', 3, true], ['a\nb', 'c']),
  t('other-whitespace', ['a\tb  c', 3, false], ['a\tb', 'c']),
  t('hyphen-rule', ['well-known', 6, false], ['well-', 'known']),
  t('hyphen-rule', ['a--b', 2, false], ['a-', '-b']),
  t('hyphen-rule', ['x-(y', 2, false], ['x-', '(y']),
  t('hyphen-rule', ['(a)-b', 3, false], ['(a)', '-b']),
  t('hyphen-rule', ['1-2', 2, false], ['1-', '2']),
  t('hyphen-rule', ['a-b-c', 4, false], ['a-b-', 'c']),
  t('hyphen-rule', ['ab-12-cd', 4, false], ['ab-', '12-', 'cd']),
  t('hyphen-rule', ['a-', 1, false], ['a', '-']),
  t('long-piece', ['abcdefghij', 4, false], ['abcd', 'efgh', 'ij']),
  t('long-piece', ['abcdefg-hi', 5, false], ['abcde', 'fg-hi']),
  t('optimal', ['aaaa bbbbb cc ddddddddd', 10, false], ['aaaa', 'bbbbb cc', 'ddddddddd']),
  t('optimal', ['aaaa bbbbb cc ddddddddd', 10, true], ['aaaa', 'bbbbb   cc', 'ddddddddd']),
  t('last-line-free', ['a bb ccc', 6, false], ['a bb', 'ccc']),
  t('distribution', ['aa bb cc dd ee ff gg hh ii jj', 16, true], ['aa  bb  cc dd ee', 'ff gg hh ii jj']),
  t('justify-off', ['aa bb cc dd ee ff gg hh ii jj', 16, false], ['aa bb cc dd ee', 'ff gg hh ii jj']),
  t('distribution', ['a b c dddddddddd', 10, true], ['a    b   c', 'dddddddddd']),
  t('distribution', ['a b c dddddddd', 8, true], ['a   b  c', 'dddddddd']),
  t('distribution', ['a b c d eeeeeeeeeeee', 12, true], ['a   b   c  d', 'eeeeeeeeeeee']),
  t('glue', ['well-known x yyyyyyyyyyyy', 14, true], ['well-known   x', 'yyyyyyyyyyyy']),
  t('no-gap', ['abc defghij', 7, true], ['abc', 'defghij']),
  t('no-gap', ['a b c', 1, true], ['a', 'b', 'c']),
  t('tie-later', ['aaaaa bb ccc dd eeeeee', 6, false], ['aaaaa', 'bb ccc', 'dd', 'eeeeee']),
  t('tie-later', ['a bb c d e fff ggggg', 6, true], ['a   bb', 'c  d e', 'fff', 'ggggg']),
  t('tie-later', ['a b c ddd eeeee', 5, false], ['a b c', 'ddd', 'eeeee']),
  t('tie-later', ['a bb c dddd eee', 5, true], ['a  bb', 'c', 'dddd', 'eee']),
];

// Tests whose expected value is computed from the reference solution when generate.mjs runs.
// A computed test with the same arguments as a hand-derived one is dropped.
const computed = [
    t('words', ['  the   quick  brown fox ', 10, false]),
    t('empty', ['', 5, true]),
    t('empty', ['     ', 3, false]),
    t('other-whitespace', ['a\tb c\nd e', 5, true]),
    t('glue', ['a well-known state-of-the-art re-entry', 12, false]),
    t('glue', ['a well-known state-of-the-art re-entry', 12, true]),
    t('hyphen-rule', ['x--y -a b- c-(d e-1 1-2 (a)-b well-', 6, false]),
    t('hyphen-rule', ['x--y -a b- c-(d e-1 1-2 (a)-b well-', 9, true]),
    t('long-piece', ['incomprehensibilities are extraordinarily hard', 8, true]),
    t('long-piece', ['super-duper-extra-long-hyphenated-word', 10, false]),
    t('long-piece', ['abcdefghijkl-mn x', 5, true]),
    t('last-line-free', ['aaa bbb ccc dd', 7, false]),
    t('last-line-free', ['aaaa bbbb c', 9, true]),
    t('tie-later', ['a abc abc abcde a abcde abcde abcde', 9, false]),
    t('tie-later', ['abc a abcde a abcde abc', 7, true]),
    t('tie-later', ['abcd abcdefg abcdefgh a abcdefgh abcdefghi', 12, true]),
    t('distribution', ['aa bb cc dd ee ff gg hh ii jj', 17, true]),
    t('distribution', ['a b c d e f g h i j k l m n o p q r s t', 11, true]),
    t('distribution', ['ab cd efg hi jkl mn opq', 13, true]),
    t('no-gap', ['abcdefgh abcdefgh', 8, true]),
    t('no-gap', ['x-y x-y z', 3, true]),
    t('justify-off', ['aa bb cc dd ee ff gg hh ii jj', 17, false]),
    t('justify-off', ['one two three four five six seven eight nine ten', 14, false]),
    t('optimal', [P1, 20, true]),
    t('optimal', [P1, 30, false]),
    t('optimal', [P1, 41, true]),
    t('optimal', [P2, 40, true]),
    t('optimal', [P2, 60, false]),
    t('optimal', [P2, 27, true]),
    t('optimal', [P2, 8, true]),
    t('optimal', [P3, 16, true]),
    t('optimal', [P3, 25, false]),
    t('optimal', [P3, 1, false]),
    t('optimal', ['a b c', 1, true]),
    t('last-line-free', ['short text', 80, true]),
];
const argsKey = (test) => JSON.stringify(test.args);
const handKeys = new Set(hand.map(argsKey));

export default {
  slug: 'balanced-layout',
  tier: {
    level: 5,
    human_minutes: 135,
    basis: 'A word-splitting rule with hyphen conditions, forced cutting of long fragments, an optimal line-breaking DP with an exact tie-break, and exact justification arithmetic. About 12 rules; the reference is about 80 lines. An expert needs about 2 to 2.5 h to read the rules closely and match every tie and edge.',
  },
  tags: ['spec'],
  name: 'layoutText',
  signature: 'layoutText(text, width, justify) -> array of strings',
  task: spec,
  edges: {
    words: 'only the space character separates words',
    empty: 'return an empty array',
    'other-whitespace': 'including tabs and line breaks',
    'hyphen-rule': 'just before and just after the hyphen',
    'long-piece': 'a fragment that is longer than width is cut further',
    glue: 'items of the same word are joined with no space',
    optimal: 'minimise the total cost',
    'last-line-free': 'except that the last line has no cost',
    'tie-later': 'the later break is better',
    distribution: 'the leftmost (e mod g) gaps get one more',
    'no-gap': 'a line with no gap is left as it is',
    'justify-off': 'when justify is false',
  },
  tests: [...hand, ...computed.filter((test) => !handKeys.has(argsKey(test)))],
};
