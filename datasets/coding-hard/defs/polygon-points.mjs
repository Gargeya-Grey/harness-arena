import { t } from './_util.mjs';

const SQUARE = [[0, 0], [4, 0], [4, 4], [0, 4]];
const L_SHAPE = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
const L_REVERSED = L_SHAPE.slice().reverse();
const FLAT_EDGE = [[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]];
const TRIANGLE = [[0, 0], [6, 0], [3, 6]];
const ZIGZAG = [[0, 0], [6, 0], [6, 4], [4, 2], [3, 4], [2, 2], [0, 4]];
const BIG = [[0, 0], [1000000000, 999999999], [0, 1000000000]];

export default {
  name: 'classifyPoints',
  signature: 'classifyPoints(polygon, points) -> array',
  kind: 'geometry',
  task: [
    'polygon is an array of [x, y] integer vertices (3 to 60 vertices, coordinates with absolute value at most 10^9) listed in order, clockwise or counter-clockwise, describing a simple polygon: its edges join each vertex to the next and the last to the first, they never cross or touch except at shared consecutive end points, and no vertex repeats.',
    'Three or more consecutive vertices can lie on one straight line.',
    'The polygon can be concave.',
    'points is an array of [x, y] integer points with the same limits.',
    'Return an array with one string for each point: "boundary" when the point lies on an edge (including every vertex), otherwise "inside" when it lies in the interior of the polygon, otherwise "outside".',
    'Be exact: products of such coordinates exceed 2^53.',
  ].join(' '),
  edges: {
    vertex: 'including every vertex',
    concave: 'can be concave',
    collinear: 'on one straight line',
    orientation: 'clockwise or counter-clockwise',
    exact: 'exceed 2^53',
  },
  tests: [
    t('basic', [SQUARE, [[2, 2]]], ['inside']),
    t('vertex', [SQUARE, [[0, 0], [4, 4]]], ['boundary', 'boundary']),
    t('basic', [SQUARE, [[4, 2], [2, 0]]], ['boundary', 'boundary']),
    t('basic', [SQUARE, [[5, 2], [-1, 2], [2, 5], [2, -1], [5, 5]]], ['outside', 'outside', 'outside', 'outside', 'outside']),
    t('concave', [L_SHAPE, [[3, 3]]], ['outside']),
    t('concave', [L_SHAPE, [[1, 3], [3, 1], [1, 1]]], ['inside', 'inside', 'inside']),
    t('vertex', [L_SHAPE, [[3, 2], [2, 3], [2, 2]]], ['boundary', 'boundary', 'boundary']),
    t('concave', [L_SHAPE, [[1, 2], [-1, 2], [5, 2]]], ['inside', 'outside', 'outside']),
    t('orientation', [L_REVERSED, [[3, 3], [1, 3], [3, 2]]], ['outside', 'inside', 'boundary']),
    t('collinear', [FLAT_EDGE, [[1, 0], [3, 0], [2, 0], [2, 1], [5, 0]]], ['boundary', 'boundary', 'boundary', 'inside', 'outside']),
    t('vertex', [TRIANGLE, [[3, 6], [3, 3], [-1, 0], [7, 0], [3, 0], [0, 6]]], ['boundary', 'inside', 'outside', 'outside', 'boundary', 'outside']),
    t('concave', [ZIGZAG, [[4, 3], [3, 3], [2, 3], [1, 3], [5, 3], [1, 2], [3, 2], [4, 2], [0, 2], [7, 2]]], ['outside', 'inside', 'outside', 'boundary', 'boundary', 'inside', 'inside', 'boundary', 'boundary', 'outside']),
    t('orientation', [ZIGZAG.slice().reverse(), [[4, 3], [3, 3], [2, 3], [1, 3], [5, 3]]], ['outside', 'inside', 'outside', 'boundary', 'boundary']),
    t('exact', [BIG, [[999999999, 999999998], [999999999, 999999999], [500000000, 499999999], [1000000000, 999999999], [1, 1], [0, 500000000]]], ['outside', 'inside', 'outside', 'boundary', 'inside', 'boundary']),
    t('exact', [BIG.slice().reverse(), [[999999999, 999999998], [999999999, 999999999], [499999999, 499999999], [333333333, 333333332]]]),
    t('exact', [[[-1000000000, -1000000000], [1000000000, -999999999], [999999999, 1000000000], [-1000000000, 999999999]], [[0, 0], [999999999, 1000000000], [1000000000, -999999999], [-1000000000, 1000000000], [1000000000, 1000000000]]]),
  ],
};
