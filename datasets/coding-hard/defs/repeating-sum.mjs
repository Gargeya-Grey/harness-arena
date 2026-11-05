import { t } from './_util.mjs';

const nines = '9'.repeat(60);
const digits = '987654321098765432109876543210987654321098765432109876543210';

export default {
  name: 'sumRepeatingDecimals',
  signature: 'sumRepeatingDecimals(terms) -> string',
  kind: 'numeric',
  task: [
    'Add decimal numbers that may have a repeating part and return the exact sum.',
    'terms is an array of strings. Every term is well formed and has one of these shapes, with an optional leading minus sign: I (an integer), I.F (a finite decimal), I.(R) (a decimal whose digits after the point are all repeating) or I.F(R) (a finite part followed by a repeating block).',
    'I, F and R are non-empty strings of decimal digits; they can have leading zeros, and each can be up to 60 digits long.',
    'The part in parentheses repeats forever, so "0.(3)" is 1/3, "1.2(45)" is 1.2454545... = 137/110 and "0.(9)" is exactly 1.',
    'Return the exact sum as a reduced fraction: "p/q" with q greater than 1 and no common factor of p and q, or just "p" when the sum is an integer.',
    'A negative sum has the minus sign in front of p ("-1/3").',
    'A zero sum, also for an empty terms array, is "0".',
  ].join(' '),
  edges: {
    repeating: 'repeats forever',
    'nine-repeat': 'is exactly 1',
    'leading-zeros': 'they can have leading zeros',
    reduced: 'no common factor of p and q',
    negative: 'minus sign in front of p',
    'zero-sum': 'A zero sum',
    long: 'up to 60 digits long',
  },
  tests: [
    t('repeating', [['0.(3)', '0.(6)']], '1'),
    t('basic', [['0.1', '0.2']], '3/10'),
    t('negative', [['-0.(3)']], '-1/3'),
    t('nine-repeat', [['0.(9)']], '1'),
    t('repeating', [['1.2(45)']], '137/110'),
    t('zero-sum', [[]], '0'),
    t('zero-sum', [['-0', '0.(0)', '-0.0']], '0'),
    t('zero-sum', [['1.(9)', '-2']], '0'),
    t('basic', [['5']], '5'),
    t('repeating', [['0.(142857)']], '1/7'),
    t('repeating', [['0.0(3)']], '1/30'),
    t('leading-zeros', [['007.0010(09)']], '770111/110000'),
    t('reduced', [['-2.5', '2.(5)']], '1/18'),
    t('reduced', [['0.(1)', '0.(01)']], '4/33'),
    t('repeating', [['0.(3)', '0.(3)', '0.(3)']], '1'),
    t('long', [[`${nines}.${nines}(${digits})`, '-0.(1)', `-${nines}.${nines}`]]),
    t('long', [[`0.(${digits})`, `0.${digits}(${nines})`]]),
  ],
};
