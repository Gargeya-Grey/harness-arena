import { t } from './_util.mjs';

export default {
  name: 'squareDigit',
  signature: 'squareDigit(n) -> string',
  kind: 'efficiency',
  task: [
    'Write the squares of the positive integers one after another with no separator: 1, 4, 9, 16, 25, 36, ... gives the infinite digit string that begins 149162536496481100121144.',
    'Return the n-th digit of this string (counting from 1) as a one-character string.',
    'n is a decimal string with 1 <= n <= 10^18.',
  ].join(' '),
  edges: {
    'one-based': 'counting from 1',
    'digit-count-change': 'one after another with no separator',
    'huge-n': '10^18',
  },
  tests: [
    t('one-based', ['1'], '1'),
    t('basic', ['2'], '4'),
    t('basic', ['3'], '9'),
    t('basic', ['4'], '1'),
    t('basic', ['10'], '4'),
    t('digit-count-change', ['15'], '1'),
    t('digit-count-change', ['16'], '1'),
    t('digit-count-change', ['17'], '0'),
    t('digit-count-change', ['18'], '0'),
    t('basic', ['22'], '1'),
    t('basic', ['24'], '4'),
    t('basic', ['1000000']),
    t('huge-n', ['123456789']),
    t('huge-n', ['100000000000']),
    t('huge-n', ['999999999999999999']),
    t('huge-n', ['1000000000000000000']),
    t('huge-n', ['314159265358979323']),
    t('huge-n', ['271828182845904523']),
  ],
};
