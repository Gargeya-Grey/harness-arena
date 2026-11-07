import { t } from './_util.mjs';

const E18 = '1000000000000000000';

export default {
  slug: 'not-divisible',
  tier: { level: 3, human_minutes: 12, basis: 'estimated from the reference (22 lines): inclusion and exclusion with BigInt floor division and a sign rule', origin: 'coding-hard-not-divisible' },
  name: 'countNotDivisible',
  signature: 'countNotDivisible(lo, hi, primes) -> string',
  tags: ['efficiency'],
  task: [
    'Count the integers x with lo <= x <= hi that are divisible by none of the numbers in primes.',
    'primes is an array of distinct prime numbers (each from 2 to 1000, at most 14 entries, in any order); it can be empty.',
    'lo and hi are integers given as decimal strings; they can be negative and their absolute value is at most 10^18.',
    'If lo is greater than hi the answer is 0.',
    'Zero is divisible by every prime, so 0 is never counted when primes is not empty; when primes is empty, every integer in the range counts, including 0.',
    'A negative number is divisible by p when its absolute value is.',
    'Return the count as a decimal string.',
  ].join(' '),
  edges: {
    'zero-not-counted': 'Zero is divisible by every prime',
    'empty-primes': 'when primes is empty',
    negative: 'they can be negative',
    'negative-divisible': 'A negative number is divisible by p',
    'lo-above-hi': 'If lo is greater than hi',
    'huge-range': 'at most 10^18',
  },
  tests: [
    t('basic', ['1', '10', [2, 3]], '3'),
    t('zero-not-counted', ['-10', '10', [2, 3]], '6'),
    t('negative', ['-10', '-1', [2, 3]], '3'),
    t('zero-not-counted', ['0', '0', [2]], '0'),
    t('empty-primes', ['0', '0', []], '1'),
    t('empty-primes', ['-3', '3', []], '7'),
    t('lo-above-hi', ['5', '4', [2]], '0'),
    t('basic', ['7', '7', [7]], '0'),
    t('negative-divisible', ['-7', '-7', [7]], '0'),
    t('negative', ['-6', '-6', [7]], '1'),
    t('basic', ['-100', '100', [13, 2, 7]]),
    t('negative', ['-999999', '3', [5, 997, 2]]),
    t('huge-range', ['-' + E18, E18, [2, 3, 5, 7, 11, 13]]),
    t('huge-range', ['1', E18, [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43]]),
    t('huge-range', ['-999999999999999999', '-1', [997, 991, 983]]),
    t('huge-range', ['1000000000000', '1000000000100', [2, 3]]),
  ],
};
