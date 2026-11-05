import { t, rng, shuffled } from './_util.mjs';

const identity = (length) => Array.from({ length }, (_, i) => i);
const rand = rng(20261105);
const perm = (length) => shuffled(rand, identity(length));
const labels = (length) => Array.from({ length }, (_, i) => 'v' + i);

export default {
  name: 'shuffleN',
  signature: 'shuffleN(items, a, b, n) -> array',
  kind: 'efficiency',
  task: [
    'items is an array of L values (1 <= L <= 300; the values can be of any JSON type, and some can be equal).',
    'a and b are arrays that are each a permutation of the numbers 0 .. L-1.',
    'One step with a permutation perm turns the current array cur into a new array next, where next[i] = cur[perm[i]] for every index i.',
    'The steps are numbered from 1: the odd steps (1, 3, 5, ...) use the permutation a and the even steps (2, 4, 6, ...) use the permutation b.',
    'n is a decimal string with 0 <= n <= 10^18.',
    'Return the array after n steps, starting from items.',
    'When n is "0" return a copy of items.',
    'Do not change the arguments.',
  ].join(' '),
  edges: {
    alternate: 'the odd steps (1, 3, 5, ...) use the permutation a',
    'n-zero': 'When n is "0"',
    'equal-values': 'some can be equal',
    'huge-n': '10^18',
  },
  tests: [
    t('n-zero', [['a', 'b', 'c'], [1, 2, 0], [0, 2, 1], '0'], ['a', 'b', 'c']),
    t('alternate', [['a', 'b', 'c'], [1, 2, 0], [0, 2, 1], '1'], ['b', 'c', 'a']),
    t('alternate', [['a', 'b', 'c'], [1, 2, 0], [0, 2, 1], '2'], ['b', 'a', 'c']),
    t('alternate', [['a', 'b', 'c'], [1, 2, 0], [0, 2, 1], '3'], ['a', 'c', 'b']),
    t('alternate', [[1, 2, 3, 4, 5], [0, 1, 2, 3, 4], [1, 2, 3, 4, 0], '7'], [4, 5, 1, 2, 3]),
    t('huge-n', [['x'], [0], [0], '1000000000000000000'], ['x']),
    t('huge-n', [[1, 2, 3, 4], [1, 0, 3, 2], [1, 0, 3, 2], '999999999999999999'], [2, 1, 4, 3]),
    t('equal-values', [['a', 'a', 'b', 1, null, true], [2, 0, 1, 4, 5, 3], [5, 4, 3, 2, 1, 0], '999999999999999999']),
    t('equal-values', [['p', 'q', 'p', 'q', 'p'], [4, 3, 2, 1, 0], [1, 2, 3, 4, 0], '2']),
    t('huge-n', [labels(7), perm(7), perm(7), '1000000000000000000']),
    t('huge-n', [labels(12), perm(12), perm(12), '123456789012345678']),
    t('huge-n', [labels(30), perm(30), perm(30), '999999999999999999']),
    t('huge-n', [labels(300), perm(300), perm(300), '1000000000000000000']),
    t('huge-n', [labels(300), perm(300), perm(300), '777777777777777777']),
    t('alternate', [labels(9), perm(9), perm(9), '1999']),
  ],
};
