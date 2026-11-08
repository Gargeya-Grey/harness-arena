import { t } from './_util.mjs';

// Convex chain on a parabola, closed by its chord: a 31-vertex convex polygon.
const parabola = (shift) => Array.from({ length: 31 }, (_, i) => [i + shift, i * i - 3 * shift]);

const task = [
  'a and b are convex polygons. Each is an array of 3 to 40 vertices [x, y], integers with an absolute value of at most 1000000, listed in order, clockwise or counter-clockwise. A polygon has a positive area and no vertex repeats. Three or more consecutive vertices can lie on one straight line.',
  'Return the intersection of the two polygons (the region that lies in both, boundary included) as the object {area, vertices}. All numbers are exact.',
  'area is a string: "p" when the area is an integer, otherwise "p/q" in lowest terms with q above 1 (for example "12" or "7/2").',
  'vertices lists the corners of the intersection in counter-clockwise order. Each corner is [x, y] with x and y strings written like area (an exact fraction in lowest terms, a minus sign in front of p for a negative value, "0" for zero). List only real corners: no vertex lies on the straight line between its two neighbours, and no vertex repeats. Start with the vertex that has the smallest x, and among equal x the smallest y.',
  'When the intersection has no area (the polygons are apart, or they share only a point or a segment), return {area: "0", vertices: []}.',
].join(' ');

export default {
  slug: 'convex-clip',
  tier: { level: 4, human_minutes: 60, basis: 'estimated from the reference (about 110 lines): exact rational clipping, then cleaning duplicates and collinear points, then a fixed start and format; the degenerate cases are where an expert spends the time' },
  name: 'clipConvex',
  signature: 'clipConvex(a, b) -> {area, vertices}',
  tags: ['geometry'],
  task,
  edges: {
    orientation: 'clockwise or counter-clockwise',
    collinear: 'Three or more consecutive vertices can lie on one straight line',
    'exact-fractions': 'an exact fraction in lowest terms',
    'integer-area': '"p" when the area is an integer',
    'no-collinear-output': 'no vertex lies on the straight line between its two neighbours',
    'start-vertex': 'Start with the vertex that has the smallest x',
    'no-area': 'the polygons are apart, or they share only a point or a segment',
    'boundary-included': 'boundary included',
    huge: 'an absolute value of at most 1000000',
  },
  tests: [
    t('integer-area', [[[0, 0], [4, 0], [4, 4], [0, 4]], [[2, 2], [6, 2], [6, 6], [2, 6]]], { area: '4', vertices: [['2', '2'], ['4', '2'], ['4', '4'], ['2', '4']] }),
    t('no-area', [[[0, 0], [1, 0], [1, 1], [0, 1]], [[5, 5], [6, 5], [6, 6], [5, 6]]], { area: '0', vertices: [] }),
    t('no-area', [[[0, 0], [2, 0], [2, 2], [0, 2]], [[2, 0], [4, 0], [4, 2], [2, 2]]], { area: '0', vertices: [] }),
    t('no-area', [[[0, 0], [2, 0], [2, 2], [0, 2]], [[2, 2], [4, 2], [4, 4], [2, 4]]], { area: '0', vertices: [] }),
    t('orientation', [[[0, 0], [10, 0], [10, 10], [0, 10]], [[2, 2], [2, 5], [5, 5], [5, 2]]], { area: '9', vertices: [['2', '2'], ['5', '2'], ['5', '5'], ['2', '5']] }),
    t('start-vertex', [[[0, 0], [4, 0], [0, 3]], [[0, 3], [4, 0], [0, 0]]], { area: '6', vertices: [['0', '0'], ['4', '0'], ['0', '3']] }),
    t('no-collinear-output', [[[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]], [[-1, -1], [5, -1], [5, 5], [-1, 5]]], { area: '16', vertices: [['0', '0'], ['4', '0'], ['4', '4'], ['0', '4']] }),
    t('collinear', [[[0, 0], [4, 0], [4, 2], [4, 4], [0, 4], [0, 2]], [[1, 1], [3, 1], [3, 5], [1, 5]]], { area: '6', vertices: [['1', '1'], ['3', '1'], ['3', '4'], ['1', '4']] }),
    t('boundary-included', [[[0, 0], [4, 0], [4, 4], [0, 4]], [[2, -1], [5, 2], [2, 5], [-1, 2]]], { area: '14', vertices: [['0', '1'], ['1', '0'], ['3', '0'], ['4', '1'], ['4', '3'], ['3', '4'], ['1', '4'], ['0', '3']] }),
    t('collinear', [[[0, 0], [4, 0], [4, 4], [0, 4]], [[2, 0], [6, 2], [2, 4]]], { area: '6', vertices: [['2', '0'], ['4', '1'], ['4', '3'], ['2', '4']] }),
    t('boundary-included', [[[0, 0], [6, 0], [6, 6], [0, 6]], [[3, 0], [6, 3], [3, 6], [0, 3]]], { area: '18', vertices: [['0', '3'], ['3', '0'], ['6', '3'], ['3', '6']] }),
    t('no-area', [[[0, 0], [4, 0], [0, 4]], [[4, 0], [4, 4], [0, 4]]], { area: '0', vertices: [] }),
    t('exact-fractions', [[[0, 0], [7, 0], [0, 5]], [[1, -1], [6, 4], [-2, 3]]]),
    t('exact-fractions', [[[0, 0], [5, 1], [6, 6], [1, 5]], [[0, 3], [3, -1], [7, 3], [3, 7]]]),
    t('exact-fractions', [[[-3, -2], [4, -3], [5, 4], [-1, 6]], [[-4, 1], [2, -5], [6, 1], [0, 7]]]),
    t('orientation', [[[0, 0], [0, 9], [9, 9], [9, 0]], [[1, 1], [1, 12], [13, 13], [8, 1]]]),
    t('huge', [[[-1000000, -1000000], [1000000, -1000000], [1000000, 1000000], [-1000000, 1000000]], [[-999999, -1000000], [1000000, 3], [7, 999999]]]),
    t('huge', [[[-1000000, -999999], [999999, -1000000], [1000000, 999999], [-999999, 1000000]], [[-1000000, 1], [3, -1000000], [1000000, -2], [-7, 1000000]]]),
    t('exact-fractions', [parabola(0), parabola(5).map(([x, y]) => [x, y + 300])]),
    t('exact-fractions', [parabola(0), [[0, 1000], [40, 1000], [20, -50]]]),
  ],
};
