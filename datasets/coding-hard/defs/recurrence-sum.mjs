import { t } from './_util.mjs';

const BIG = '1000000000000000000';

export default {
  name: 'linearRecurrenceSum',
  signature: 'linearRecurrenceSum(a0, a1, p, q, n, m) -> string',
  kind: 'efficiency',
  task: [
    'Define a sequence by a(0) = a0, a(1) = a1 and a(k) = p*a(k-1) + q*a(k-2) for k >= 2.',
    'Return the sum a(0) + a(1) + ... + a(n), reduced modulo m, as a decimal string.',
    'a0, a1, p and q are integers (numbers) with absolute value at most 1000000000; they can be negative.',
    'n is a non-negative integer given as a decimal string, up to 10^18.',
    'm is an integer from 1 to 1000000000.',
    'The answer is always in the range 0 to m-1: a negative sum is brought into that range (the sum -1 with m = 7 gives "6").',
    'When n is "0" the sum is a0 reduced modulo m.',
    'When m is 1 the answer is "0".',
  ].join(' '),
  edges: {
    'negative-sum': 'the sum -1 with m = 7',
    'n-zero': 'When n is "0"',
    'm-one': 'When m is 1',
    'negative-input': 'they can be negative',
    'huge-n': 'up to 10^18',
  },
  tests: [
    t('basic', [0, 1, 1, 1, '10', 1000], '143'),
    t('n-zero', [5, 7, 2, 3, '0', 4], '1'),
    t('n-zero', [-5, 7, 2, 3, '0', 4], '3'),
    t('basic', [5, 7, 2, 3, '1', 100], '12'),
    t('m-one', [3, 4, 5, 6, BIG, 1], '0'),
    t('negative-sum', [-5, 0, 1, 0, '3', 7], '2'),
    t('negative-input', [3, -2, -1, -1, '10', 1000]),
    t('basic', [1, 1, 1, 1, '100000', 999999999]),
    t('huge-n', [0, 1, 1, 1, BIG, 1000000000]),
    t('huge-n', [2, 3, 1, 0, '999999999999999999', 1000000000], '999999999'),
    t('huge-n', [4, 9, 0, 0, BIG, 1000], '13'),
    t('huge-n', [123456789, -987654321, 999999999, -999999999, '123456789012345678', 999999937]),
    t('negative-input', [-1000000000, 1000000000, -1000000000, -1000000000, '987654321987654321', 1000000000]),
    t('huge-n', [7, -3, 2, 5, '500000000000000000', 1000000000]),
    t('huge-n', [1, 2, 1000000000, 1000000000, '1000000000000', 998244353]),
  ],
};
