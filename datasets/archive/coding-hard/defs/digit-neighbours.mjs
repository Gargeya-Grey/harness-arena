import { t } from './_util.mjs';

// Numbers 0..10^18 whose digits have no two equal neighbours: 0, then 9^d numbers
// with d digits for d = 1..18 (10^18 itself has equal neighbours). Worked out by
// hand, not by the reference solution.
const noEqualNeighboursUpToE18 = (1n + (9n ** 19n - 9n) / 8n).toString();

export default {
  name: 'countDistinctNeighbours',
  signature: 'countDistinctNeighbours(lo, hi, k) -> string',
  kind: 'efficiency',
  task: [
    'Count the integers x with lo <= x <= hi that satisfy both rules.',
    'Rule 1: no two neighbouring decimal digits of x are equal (the number 0 has one digit, so it passes; 100 fails; 121 passes).',
    'Rule 2: the sum of the decimal digits of x is divisible by k (0 has digit sum 0, which every k divides).',
    'lo and hi are non-negative integers given as decimal strings without leading zeros, up to 10^18.',
    'If lo is greater than hi the answer is 0.',
    'k is an integer (a number) from 1 to 60.',
    'Return the count as a decimal string.',
    'Example: lo "0", hi "20", k 3 gives "7" (the numbers 0, 3, 6, 9, 12, 15 and 18).',
  ].join(' '),
  edges: {
    zero: 'the number 0 has one digit',
    'zero-sum': '0 has digit sum 0',
    'equal-neighbours': '100 fails',
    'lo-above-hi': 'If lo is greater than hi',
    'huge-range': 'up to 10^18',
  },
  tests: [
    t('basic', ['0', '20', 3], '7'),
    t('zero', ['0', '0', 1], '1'),
    t('zero-sum', ['0', '0', 7], '1'),
    t('basic', ['1', '9', 1], '9'),
    t('equal-neighbours', ['11', '11', 1], '0'),
    t('equal-neighbours', ['100', '100', 1], '0'),
    t('basic', ['121', '121', 4], '1'),
    t('lo-above-hi', ['5', '3', 1], '0'),
    t('basic', ['10', '10', 1], '1'),
    t('basic', ['100', '200', 7]),
    t('basic', ['1', '100000', 13]),
    t('huge-range', ['0', '99999999', 60]),
    t('huge-range', ['0', '1000000000000000000', 1], noEqualNeighboursUpToE18),
    t('equal-neighbours', ['1000000000000000000', '1000000000000000000', 1], '0'),
    t('huge-range', ['123456789', '987654321000', 11]),
    t('huge-range', ['0', '999999999999999999', 60]),
    t('huge-range', ['500000000000000000', '1000000000000000000', 7]),
  ],
};
