import { t } from './_util.mjs';

export default {
  slug: 'roman',
  tier: { level: 2, human_minutes: 3, basis: 'estimated from the reference (a value table walked from the top, 8 lines) plus checking the subtractive pairs', origin: 'coding-roman' },
  name: 'toRoman',
  signature: 'toRoman(n) -> string',
  tags: ['strings'],
  task: 'Convert an integer n from 1 to 3999 to a Roman numeral in standard subtractive form (4 is IV, 9 is IX, 40 is XL).',
  edges: {
    subtractive: 'standard subtractive form',
    bounds: 'from 1 to 3999',
  },
  tests: [
    t('bounds', [1], 'I'),
    t('subtractive', [4], 'IV'),
    t('subtractive', [9], 'IX'),
    t('basic', [58], 'LVIII'),
    t('subtractive', [1994], 'MCMXCIV'),
    t('bounds', [3999], 'MMMCMXCIX'),
    t('subtractive', [40]),
    t('subtractive', [90]),
    t('subtractive', [400]),
    t('subtractive', [900]),
    t('basic', [3888]),
    t('basic', [2024]),
  ],
};
