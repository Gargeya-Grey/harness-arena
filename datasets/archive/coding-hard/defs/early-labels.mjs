import { t, rng, randInt, shuffled } from './_util.mjs';

const rand = rng(555);
// A random acyclic graph: edges go from an earlier to a later place in a hidden order.
function randomDag(names, edgeCount) {
  const hidden = shuffled(rand, names);
  const edges = [];
  for (let i = 0; i < edgeCount; i += 1) {
    const a = randInt(rand, 0, hidden.length - 2);
    const b = randInt(rand, a + 1, hidden.length - 1);
    edges.push([hidden[a], hidden[b]]);
  }
  return edges;
}
const small = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const wide = Array.from({ length: 60 }, (_, i) => 'n' + i);

export default {
  name: 'earlyLabelOrder',
  signature: 'earlyLabelOrder(nodes, edges) -> array | null',
  kind: 'graph',
  task: [
    'nodes is an array of distinct strings (1 to 200 entries). edges is an array of [a, b] pairs with both a and b taken from nodes; each pair means that a must appear before b in the order. The same pair can appear more than once.',
    'Return an order of all the nodes that follows every edge and is the best by this rule. Sort the labels in ascending order, s1 < s2 < s3 < ..., comparing strings by UTF-16 code unit as the JavaScript < operator does (so "10" < "9" and "B" < "a"). Among all valid orders choose the one in which s1 stands at the earliest possible position; among those, the one in which s2 stands at the earliest possible position; and so on.',
    'This is not the same as the order that is smallest when read from left to right.',
    'Return null if no valid order exists, which happens exactly when the edges contain a cycle (including an edge [a, a]).',
  ].join(' '),
  edges: {
    'earliest-position': 'at the earliest possible position',
    'left-to-right': 'smallest when read from left to right',
    'string-order': '"10" < "9"',
    'self-loop': 'including an edge [a, a]',
    duplicate: 'can appear more than once',
    'null-on-cycle': 'Return null if no valid order exists',
  },
  tests: [
    t('basic', [['a'], []], ['a']),
    t('basic', [['b', 'c', 'a'], []], ['a', 'b', 'c']),
    t('earliest-position', [['a', 'b', 'c'], [['c', 'a']]], ['c', 'a', 'b']),
    t('left-to-right', [['d', 'c', 'b', 'a'], [['d', 'a']]], ['d', 'a', 'b', 'c']),
    t('basic', [['x', 'y', 'z'], [['x', 'y'], ['y', 'z']]], ['x', 'y', 'z']),
    t('null-on-cycle', [['a', 'b'], [['a', 'b'], ['b', 'a']]], null),
    t('self-loop', [['a'], [['a', 'a']]], null),
    t('null-on-cycle', [['a', 'b', 'c'], [['b', 'c'], ['c', 'b']]], null),
    t('string-order', [['10', '9', '2'], []], ['10', '2', '9']),
    t('string-order', [['a', 'B'], []], ['B', 'a']),
    t('duplicate', [['b', 'a'], [['b', 'a'], ['b', 'a']]], ['b', 'a']),
    t('basic', [['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]], ['a', 'b', 'c', 'd']),
    t('earliest-position', [['e', 'd', 'c', 'b', 'a'], [['e', 'a'], ['d', 'b'], ['c', 'a']]]),
    t('earliest-position', [small, randomDag(small, 6)]),
    t('earliest-position', [small, randomDag(small, 9)]),
    t('earliest-position', [shuffled(rand, wide), randomDag(wide, 90)]),
    t('null-on-cycle', [shuffled(rand, wide), [...randomDag(wide, 40), ['n7', 'n20'], ['n20', 'n41'], ['n41', 'n7']]], null),
  ],
};
