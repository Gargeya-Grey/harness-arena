import { t } from './_util.mjs';

// Independent count of the plain numbers up to x, used only to pick k for a chosen
// answer x (so the expected value of those tests is written down, not computed).
function iroot(x, r) {
  let lo = 0n;
  let hi = 1n << (BigInt(x.toString(2).length) / BigInt(r) + 2n);
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (mid ** BigInt(r) <= x) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}
const plainUpTo = (x) => x - iroot(x, 2) - iroot(x, 3) + iroot(x, 6);
const isPlain = (x) => iroot(x, 2) ** 2n !== x && iroot(x, 3) ** 3n !== x;
const at = (answer) => {
  const x = BigInt(answer);
  if (!isPlain(x)) throw new Error(`${answer} is a square or a cube`);
  return t('huge-k', [plainUpTo(x).toString()], x.toString());
};

export default {
  name: 'kthPlainNumber',
  signature: 'kthPlainNumber(k) -> string',
  kind: 'efficiency',
  task: [
    'The positive integers that are neither a perfect square nor a perfect cube, taken in increasing order, form the sequence 2, 3, 5, 6, 7, 10, 11, 12, 13, 14, 15, 17, 18, ...',
    '(1 and 64 are both a square and a cube; 4, 9 and 16 are squares; 8 and 27 are cubes; none of these appear).',
    'Return the k-th term of this sequence as a decimal string.',
    'k is given as a decimal string with 1 <= k <= 10^18.',
  ].join(' '),
  edges: {
    'square-and-cube': 'both a square and a cube',
    cube: '8 and 27 are cubes',
    'huge-k': '10^18',
  },
  tests: [
    t('basic', ['1'], '2'),
    t('basic', ['2'], '3'),
    t('basic', ['3'], '5'),
    t('basic', ['5'], '7'),
    t('basic', ['6'], '10'),
    t('basic', ['12'], '17'),
    t('basic', ['19'], '24'),
    t('basic', ['20'], '26'),
    t('cube', ['21'], '28'),
    t('square-and-cube', ['54'], '63'),
    t('square-and-cube', ['55'], '65'),
    t('huge-k', ['1000000000000']),
    t('huge-k', ['1000000000000000000']),
    t('huge-k', ['999999999999999999']),
    at('999999999999999998'),
  ],
};
