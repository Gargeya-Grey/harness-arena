import { t } from './_util.mjs';

export default {
  slug: 'palindrome',
  tier: { level: 1, human_minutes: 1.5, basis: 'estimated from the reference (3 lines: normalise, compare with the reverse); one rule per sentence', origin: 'coding-palindrome' },
  name: 'isPalindrome',
  signature: 'isPalindrome(s) -> boolean',
  tags: ['strings'],
  task: 'Return true when s reads the same forwards and backwards after you remove every character that is not a letter or a digit and ignore case. An empty string is a palindrome.',
  edges: {
    'non-alphanumeric': 'remove every character that is not a letter or a digit',
    case: 'ignore case',
    empty: 'An empty string is a palindrome',
  },
  tests: [
    t('non-alphanumeric', ['A man, a plan, a canal: Panama'], true),
    t('basic', ['race a car'], false),
    t('empty', [''], true),
    t('non-alphanumeric', ["No 'x' in Nixon"], true),
    t('case', ['0P'], false),
    t('case', ['Aa'], true),
    t('non-alphanumeric', ['!?, '], true),
    t('non-alphanumeric', ['1a2'], false),
    t('basic', ['12321']),
    t('basic', ['ab']),
  ],
};
