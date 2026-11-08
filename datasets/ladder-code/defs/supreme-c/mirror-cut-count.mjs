import { t } from './_util.mjs';

export default {
  slug: 'mirror-cut-count',
  tier: {
    level: 5,
    human_minutes: 270,
    basis: 'A palindromic tree together with series links (the suffix palindromes of a prefix fall into O(log n) arithmetic series), run over a (minimum, count) pair instead of a single number, so ties between series have to be merged exactly. Strings such as "aaaa..." have a palindrome of every length at every position, so the plain walk over all palindromic suffixes is O(n^2): 50 s or more of CPU on the huge inputs. About 4.5 h for an expert who knows the series-link technique.',
  },
  tags: ['efficiency'],
  name: 'palindromePieces',
  signature: 'palindromePieces(n, alpha, period, breaks, seed) -> [number, number]',
  task: [
    'A string s of length n over the letters 0..alpha-1 is built from a pseudo-random generator, so the input stays small.',
    'The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 for i = 0, 1, 2, ... (exact integer arithmetic; every product is below 2^47). Each draw returns the new x.',
    'Step 1: for j = 0..period-1, draw r and set w[j] = r mod alpha. Step 2: for i = 0..n-1 set s[i] = w[i mod period]. Step 3: repeat `breaks` times, in order: draw r1, then draw r2, set p = r1 mod n, and replace s[p] by (s[p] + 1 + (r2 mod (alpha - 1))) mod alpha. A break always changes the letter, and a later break can change a position that an earlier break has already changed.',
    'A palindrome is a non-empty string that reads the same forwards and backwards; a single letter is a palindrome.',
    'Cut s into consecutive non-empty pieces so that every piece is a palindrome. Every letter belongs to exactly one piece, and the whole string can be a single piece (a cut into one piece).',
    'Let m be the smallest possible number of pieces. Two cuts are different when their sets of cut positions are different. Count the different cuts into exactly m pieces: there can be several different ways, and the count can be huge.',
    'Return the array [m, c], where c is that count modulo 1000000007.',
    'Limits: 1 <= n <= 600000; 2 <= alpha <= 4; 1 <= period <= 8; 0 <= breaks <= 1000; 1 <= seed <= 2147483646.',
    'A string such as "aaaa..." has a palindromic suffix of every length at every position, so any method that looks at all palindromic suffixes of every prefix is far too slow, and so is a quadratic dynamic programme over all pieces.',
  ].join(' '),
  edges: {
    whole: 'the whole string can be a single piece',
    ties: 'there can be several different ways',
    break: 'a break always changes the letter',
    huge: '600000',
  },
  tests: [
    // Hand-derived expected values; the strings come from the generator (letters 0, 1, 2 written a, b, c).
    // Seed 1, alpha 2, period 1: w = [0], no break: "aaaaa" is one palindrome, so m = 1 and there is 1 way.
    t('whole', [5, 2, 1, 0, 1], [1, 1]),
    // Seed 1, alpha 2, period 8 gives the word "aabbabab", no break. Its only palindromic prefixes are "a" and "aa",
    // and no suffix after them is a palindrome, so m is at least 3. Three pieces: a|abba|bab and aa|b|babab, and nothing
    // else (aa|bb|abab, a|a|bbabab and aa|bbaba|b are not all palindromes). m = 3, 2 ways.
    t('ties', [8, 2, 8, 0, 1], [3, 2]),
    // Seed 2, alpha 2, period 2, n = 9, one break: the string is "bababbbab" (the break changes position 5 from "a" to "b").
    // Its palindromic prefixes are b, bab and babab, and no remainder after them is a palindrome, so no two-piece cut exists.
    // Three pieces: b|a|babbbab, bab|abbba|b and babab|b|bab, and no other. m = 3, 3 ways.
    t('ties', [9, 2, 2, 1, 2], [3, 3]),
    // Seed 1, alpha 3, period 2, n = 8, one break: "ababaaab" (the break changes position 5 from b to a).
    // Two pieces: aba|baaab is the only cut (ababa|aab and a|babaaab fail). m = 2, 1 way.
    t('break', [8, 3, 2, 1, 1], [2, 1]),
    // Seed 2, alpha 3, period 7, no break: "bbcabca". The only palindrome longer than one letter is "bb",
    // so the cut is bb|c|a|b|c|a: m = 6, 1 way.
    t('basic', [7, 3, 7, 0, 2], [6, 1]),
    t('huge', [600000, 3, 1, 8, 11]),
    t('huge', [600000, 3, 1, 8, 12]),
    t('huge', [600000, 2, 2, 8, 11]),
    t('huge', [600000, 2, 2, 8, 12]),
    t('huge', [600000, 3, 2, 8, 12]),
    t('huge', [600000, 3, 1, 5, 11]),
    t('huge', [600000, 3, 2, 5, 11]),
    t('huge', [600000, 2, 1, 8, 11]),
    t('huge', [560000, 2, 3, 2, 12]),
    t('huge', [580000, 3, 2, 3, 12]),
  ],
};
