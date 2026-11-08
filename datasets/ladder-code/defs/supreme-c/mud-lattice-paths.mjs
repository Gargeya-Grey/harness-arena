import { t } from './_util.mjs';

export default {
  slug: 'mud-lattice-paths',
  tier: {
    level: 5,
    human_minutes: 210,
    basis: 'Two combinatorial arguments together, modulo a prime. Paths between two parallel lines are counted by the reflection principle with an alternating sum over all repeated reflections (a single reflection is wrong), and the mud cells are removed by inclusion and exclusion over the cells sorted by position, each pair needing its own two-line count. Products modulo 998244353 reach 10^18, so the multiplication has to be exact. The grid dynamic programme costs about 10^10 cells: 45 s or more of CPU on the huge inputs. About 3.5 h for an expert who knows both arguments.',
  },
  tags: ['efficiency'],
  name: 'countMudPaths',
  signature: 'countMudPaths(a, b, c, d, k, seed) -> number',
  task: [
    'A token walks on the integer grid from (0,0) to (a,b). Every step moves it one cell right (x + 1) or one cell up (y + 1). Some cells are mud. The mud cells are built from a pseudo-random generator, so the input stays small.',
    'The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 for i = 0, 1, 2, ... (exact integer arithmetic; every product is below 2^47). Each draw returns the new x.',
    'For j = 0..k-1, in order, draw r1 and then r2, and set px = r1 mod (a + 1) and py = px + (r2 mod (c + d + 3)) - (d + 1). A drawn cell with y < 0 or y > b is discarded. Otherwise (px, py) is a mud cell. The same cell can be drawn twice; it is one mud cell.',
    'A path from (0,0) to (a,b) is valid when every cell it visits, the start and the end included, satisfies both rules: (1) the cell is not a mud cell: a mud cell may not be visited; (2) -d <= y - x <= c, so the path can never go above the line y = x + c and can never go below the line y = x - d.',
    'Return the number of valid paths modulo 998244353, as a number. There may be no path at all (for instance when the start, the end or a whole barrier of cells is mud, or when (a,b) itself lies outside the band), and then the answer is 0.',
    'Limits: 1 <= a, b <= 200000; 0 <= c, d <= 400000; 0 <= k <= 300; 1 <= seed <= 2147483646; a + b <= 30 * (c + d + 2).',
    'The grid has up to 4 * 10^10 cells, so a dynamic programme over the grid is far too slow. Products modulo 998244353 can reach 10^18, which a double cannot hold exactly.',
  ].join(' '),
  edges: {
    ceiling: 'above the line y = x + c',
    'two-sided': 'below the line y = x - d',
    'mud-block': 'a mud cell may not be visited',
    blocked: 'there may be no path at all',
    outside: 'a drawn cell with y < 0 or y > b is discarded',
    huge: '200000',
  },
  tests: [
    // Hand-derived expected values; seed 1 draws: 48282 183136786 1153105965 949389933 ...
    // a = b = 3, c = 0 (never above y = x), d = 10 (the lower line is out of reach), no mud: the paths that stay on or below the
    // diagonal are counted by the Catalan number C3 = 5.
    t('ceiling', [3, 3, 0, 10, 0, 1], 5),
    // a = b = 3, c = d = 1, no mud: y - x moves by +1 (up) or -1 (right) and stays in -1..1, so it goes 0, +-1, 0, +-1, 0, +-1, 0:
    // three excursions, each up or down: 2^3 = 8.
    t('two-sided', [3, 3, 1, 1, 0, 1], 8),
    // Same band, k = 2, seed 2: the first drawn cell is (1,-1) and is discarded (y < 0), the second is (0,1) and is mud.
    // The paths that start with an up step visit (0,1); by symmetry that is half of the 8: 4.
    t('mud-block', [3, 3, 1, 1, 2, 2], 4),
    // Same band, k = 2, seed 1: the mud cells are (2,1) and (1,2). Every valid path goes through (1,1) after 2 steps, and its next
    // cell is (2,1) or (1,2): both are mud, so there is no path.
    t('blocked', [3, 3, 1, 1, 2, 1], 0),
    // a = 3, b = 2, c = d = 1, k = 2, seed 3: the cell (0,2) lies on the line y = x + 2, outside the band, and (2,3) has y > b and is
    // discarded. Neither changes anything. The 5 steps need 3 right and 2 up; the walk of y - x is 0, +-1, 0, +-1, 0, -1 (it must be at 0
    // after 4 steps): 2 * 2 = 4.
    t('outside', [3, 2, 1, 1, 2, 3], 4),
    t('huge', [200000, 200000, 40000, 40000, 300, 20260101]),
    t('huge', [200000, 190000, 100, 60000, 300, 424242]),
    t('huge', [200000, 200000, 20000, 70000, 300, 777]),
    t('huge', [180000, 200000, 60000, 5000, 300, 31337]),
    t('huge', [200000, 150000, 35000, 35000, 250, 99]),
    t('huge', [199999, 200000, 100000, 30, 300, 2024]),
    t('huge', [200000, 200000, 25000, 25000, 300, 5150]),
    t('huge', [160000, 200000, 50000, 50000, 300, 61803]),
    t('huge', [200000, 200000, 70000, 100, 300, 27182]),
    t('huge', [200000, 120000, 10000, 90000, 300, 14142]),
  ],
};
