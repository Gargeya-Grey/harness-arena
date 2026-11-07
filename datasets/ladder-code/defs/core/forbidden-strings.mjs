import { t } from './_util.mjs';

const E18 = '1000000000000000000';

const task = [
  'Count the strings of length n over an alphabet of k letters that contain none of the given patterns as a substring. A substring is a run of consecutive characters, and occurrences may overlap.',
  'The alphabet is the first k lower-case letters: "a" for k = 1, "a" and "b" for k = 2, up to "a" to "d" for k = 4.',
  'patterns is an array of 0 to 8 strings of lower-case letters, each 0 to 6 characters long. Duplicates are allowed, and a pattern can be a substring of another pattern.',
  'A pattern with a letter outside the alphabet can never occur, so it forbids nothing. An empty pattern occurs in every string, the empty string included, so the answer is then "0".',
  'n is a decimal string from "0" to "1000000000000000000" (10^18). For n = "0" there is exactly one string, the empty string. With no patterns the answer is k^n.',
  'Return the count modulo 1000000007 as a decimal string.',
].join(' ');

export default {
  slug: 'forbidden-strings',
  tier: { level: 4, human_minutes: 50, basis: 'estimated from the reference (about 85 lines): an Aho-Corasick automaton with bad states spread along failure links, then a matrix power with an exact modular product in doubles; two known techniques combined, each with traps' },
  name: 'countAvoiding',
  signature: 'countAvoiding(k, patterns, n) -> string',
  tags: ['efficiency', 'automata'],
  task,
  edges: {
    overlap: 'occurrences may overlap',
    'empty-pattern': 'An empty pattern occurs in every string',
    'outside-alphabet': 'A pattern with a letter outside the alphabet can never occur',
    'zero-length': 'For n = "0" there is exactly one string',
    'no-patterns': 'With no patterns the answer is k^n',
    duplicates: 'Duplicates are allowed',
    nested: 'a pattern can be a substring of another pattern',
    modulus: 'modulo 1000000007',
    huge: '10^18',
  },
  tests: [
    t('overlap', [2, ['aa'], '3'], '5'),
    t('no-patterns', [2, [], '10'], '1024'),
    t('empty-pattern', [3, [''], '5'], '0'),
    t('empty-pattern', [3, ['', 'a'], '0'], '0'),
    t('zero-length', [2, ['a'], '0'], '1'),
    t('outside-alphabet', [3, ['z'], '4'], '81'),
    t('outside-alphabet', [3, ['az', 'b'], '3'], '8'),
    t('overlap', [1, ['aaa'], '2'], '1'),
    t('overlap', [1, ['aaa'], '3'], '0'),
    t('nested', [4, ['abcd', 'bc'], '3'], '56'),
    t('nested', [4, ['abcd', 'bc'], '4']),
    t('nested', [3, ['abcab', 'cab', 'b'], '7']),
    t('duplicates', [2, ['ab', 'ab'], '2'], '3'),
    t('overlap', [2, ['aba'], '5']),
    t('overlap', [2, ['aab', 'baa', 'abab'], '12']),
    t('no-patterns', [3, [], '0'], '1'),
    t('outside-alphabet', [4, ['dd', 'zz'], '9']),
    t('overlap', [2, ['aa', 'bb'], '20'], '2'),
    t('modulus', [2, ['aa'], '100000']),
    t('nested', [3, ['ab', 'ba', 'abcabc', 'ccc'], '300']),
    t('huge', [2, ['aa', 'bb'], E18], '2'),
    t('huge', [2, ['aa'], '1000000000000']),
    t('huge', [4, ['abcabc', 'dad', 'bcb', 'cc', 'aab', 'ddc', 'bdbd', 'ca'], E18]),
    t('huge', [3, ['aba', 'bcbcb', 'cac', 'aaaa'], '999999999999999989']),
  ],
};
