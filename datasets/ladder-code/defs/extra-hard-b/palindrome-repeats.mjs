import { t } from './_util.mjs';

export default {
  slug: 'palindrome-repeats',
  tier: {
    level: 4,
    human_minutes: 80,
    basis: 'The reference is about 65 lines: a palindromic tree (suffix links by a second walk, one node per distinct palindrome) with the occurrence counts pushed along the suffix links in reverse order of creation; the structure is known, but the link walk and the count propagation take an expert more than an hour to write and check.',
  },
  tags: ['efficiency', 'strings'],
  name: 'repeatedPalindromes',
  signature: 'repeatedPalindromes(source, minLen) -> number',
  task: [
    'Count the palindromic substrings of a string S that are long enough and occur at least twice.',
    'A palindrome reads the same forwards and backwards. Count each distinct palindromic substring P once, when its length is at least minLen and it occurs in S at least twice. Occurrences are counted by their start position and may overlap: the string "aa" occurs twice in "aaa". A single letter is a palindrome.',
    'source is either the string S itself (lower-case letters), or an object { n, alphabet, runMax, seed } that describes S, so that the input stays small.',
    'For the object form, S is built from runs of one letter. The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 (exact integer arithmetic; every product is below 2^47). Repeat until S has n characters: draw the next term x and take the letter with index (x mod alphabet) (the letters are "a", "b", "c", ... in order); draw the next term y and take the run length (y mod runMax) + 1; append that many copies of the letter, but only as many as are needed to make S exactly n characters long. Two neighbouring runs may have the same letter.',
    'Return the count as a number.',
    'Limits: for the string form, 1 <= length of S <= 1000. For the object form, 1 <= n <= 200000, 1 <= alphabet <= 26, 1 <= runMax <= 200000 and 1 <= seed <= 2147483646. 1 <= minLen <= 200000.',
    'The inputs are too large for any method that visits every palindrome occurrence one by one.',
  ].join(' '),
  edges: {
    overlap: 'may overlap',
    distinct: 'Count each distinct palindromic substring P once',
    'min-length': 'its length is at least minLen',
    letter: 'A single letter is a palindrome',
    'no-repeat': 'at least twice',
    huge: '200000',
  },
  tests: [
    // abaab: the palindromes are a (start 1, 3, 4: three times), b (2, 5: twice), aba, aa and baab (once each): a and b count.
    t('letter', ['abaab', 1], 2),
    // aaaa with minLen 2: aa occurs 3 times, aaa twice, aaaa once: aa and aaa count.
    t('overlap', ['aaaa', 2], 2),
    // abababa with minLen 3: aba at 1, 3, 5 (3 times), bab at 2 and 4 (twice), ababa at 1 and 3 (twice), babab once, abababa once: 3.
    t('min-length', ['abababa', 3], 3),
    // abcbabcba with minLen 3: bcb at 2 and 6, abcba at 1 and 5 count; bab (4), cbabc (3), bcbabcb (2) and the whole string occur once: 2. One distinct palindrome is counted once, not per occurrence.
    t('distinct', ['abcbabcba', 3], 2),
    // abcde: every palindrome is a single letter and occurs once: 0.
    t('no-repeat', ['abcde', 1], 0),
    t('huge', [{ n: 200000, alphabet: 1, runMax: 1, seed: 1 }, 1]),
    t('huge', [{ n: 200000, alphabet: 2, runMax: 50000, seed: 7 }, 1]),
    t('huge', [{ n: 180000, alphabet: 3, runMax: 30000, seed: 99 }, 2]),
    t('huge', [{ n: 150000, alphabet: 2, runMax: 20000, seed: 12345 }, 5]),
    t('huge', [{ n: 160000, alphabet: 26, runMax: 40000, seed: 5 }, 1000]),
    t('huge', [{ n: 190000, alphabet: 4, runMax: 60000, seed: 31 }, 3]),
    t('huge', [{ n: 200000, alphabet: 2, runMax: 100000, seed: 2026 }, 50]),
    t('huge', [{ n: 170000, alphabet: 3, runMax: 25000, seed: 424242 }, 1]),
    t('huge', [{ n: 150000, alphabet: 2, runMax: 150000, seed: 8675309 }, 100]),
    t('huge', [{ n: 180000, alphabet: 5, runMax: 35000, seed: 11 }, 10]),
  ],
};
