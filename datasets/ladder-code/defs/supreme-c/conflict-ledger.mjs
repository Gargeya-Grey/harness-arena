import { t } from './_util.mjs';

export default {
  slug: 'conflict-ledger',
  tier: {
    level: 5,
    human_minutes: 240,
    basis: 'Offline dynamic connectivity: a segment tree over the question times, with every link stored on the O(log q) nodes of its lifetime, and a union-find with parity and an undo stack that is walked depth first. The parity bit finds odd cycles, and the count of stations in odd components has to survive every undo. The exact removal rule (the last link moves into the freed place) fixes the lifetimes. The best simple answer rebuilds the union-find for every question, O(q * (n + links)): 20 s or more of CPU on the huge inputs. About 4 h for an expert who has done it before.',
  },
  tags: ['efficiency'],
  name: 'conflictLedger',
  signature: 'conflictLedger(n, q, reach, removeTenths, seed) -> number',
  task: [
    'A network of n stations numbered 0..n-1 starts with no links. A list of q operations adds links, removes links and asks questions. The operations are built from a pseudo-random generator, so the input stays small.',
    'The generator draws x_0 = seed and x_(i+1) = (x_i * 48271 + 11) mod 2147483647 for i = 0, 1, 2, ... (exact integer arithmetic; every product is below 2^47). Each draw returns the new x.',
    'For each operation, in order, draw three numbers r1, r2, r3 (always all three, whatever the operation does) and set kind = r1 mod 10.',
    'If kind >= 7, the operation is a question (kinds 7, 8 and 9). Let w = r2 mod n.',
    'If kind is from 7 - removeTenths to 6, the operation is a removal. Keep a list of the links that exist, in the order in which they were added. If the list is empty, nothing happens. Otherwise let i = r2 mod (the length of the list), delete the link at position i, and let the removal move the last link of the list into its place (when i is the last position, the list just gets shorter). The order of the list is therefore not the order of adding once a link has been removed.',
    'Otherwise (kind <= 6 - removeTenths) the operation adds a link: u = r2 mod n, v = (u + (r3 mod reach)) mod n, and the link joins u and v. u may equal v (a self-loop). A link is an unordered pair of stations, and at most one link per pair exists: a link that already exists is not added again, and then the list stays as it is. A link that was removed can be added again later, and goes to the end of the list.',
    'A component is a maximal set of stations that are joined by links; a station with no link is a component of its own. A component is odd when it contains a cycle of odd length. A self-loop is an odd cycle (of length 1), a triangle is an odd cycle, and a cycle of even length is not an odd cycle.',
    'For a question, look at the links that exist at that moment and compute four numbers: a1 = the number of components, a2 = the number of stations that belong to odd components, a3 = the number of stations in the component of station w, a4 = 1 if the component of w is odd and 0 if not.',
    'Fold the answers into a checksum: h starts at 0. For each question, in order, apply h = (h * 1000003 + a) mod 1000000007 for a = a1, a2, a3, a4, in this order. Return h as a number (0 when there is no question).',
    'Limits: 1 <= n <= 100000; 1 <= q <= 90000; 1 <= reach <= n; 0 <= removeTenths <= 6; 1 <= seed <= 2147483646.',
    'There can be 90000 operations on 100000 stations, so rebuilding the components for every question is far too slow.',
  ].join(' '),
  edges: {
    'self-loop': 'a self-loop is an odd cycle',
    'even-cycle': 'a cycle of even length is not an odd cycle',
    'odd-cycle': 'a triangle is an odd cycle',
    'removal-order': 'move the last link of the list into its place',
    duplicate: 'a link that already exists is not added again',
    huge: '90000',
  },
  tests: [
    // Hand-derived expected values: the operations are worked out from the draws of the seed (each operation takes three draws),
    // and each question gives (components, stations in odd components, size of the component of w, 1 if it is odd).
    // The checksum folds those numbers, four per question, with h = h * 1000003 + a mod 1000000007.
    //
    // n = 4, q = 7, reach 4, removeTenths 2, seed 19: add (3,3); question w=1: (4,1,1,0); question w=0: (4,1,1,0);
    // add (0,3); question w=1: (3,2,1,0), the component {0,3} holds the self-loop; remove the link at position 0, which is (3,3);
    // question w=0: (3,0,2,0).
    t('self-loop', [4, 7, 4, 2, 19], 745014762),
    // n = 4, q = 9, reach 4, removeTenths 0, seed 50: add (0,1); question w=2: (3,0,1,0); question w=3: (3,0,1,0); add (0,2), (1,3);
    // (0,1) again is a duplicate; add (2,3), which closes the four-cycle 0-1-3-2: question w=0: (1,0,4,0); question w=3: (1,0,4,0).
    t('even-cycle', [4, 9, 4, 0, 50], 450352079),
    // n = 4, q = 12, reach 4, removeTenths 2, seed 61: add (0,3), (0,0); question w=3: (3,2,2,1); remove position 0, which is (0,3)
    // (the last link (0,0) moves to position 0); remove position 0 again, which is (0,0); add (1,3), (2,3); question w=2: (2,0,3,0);
    // add (1,2), which closes the triangle 1-2-3; question w=1: (2,3,3,1); question w=0: (2,3,1,0); question w=0: (2,3,1,0).
    t('odd-cycle', [4, 12, 4, 2, 61], 216437268),
    // n = 4, q = 14, reach 4, removeTenths 3, seed 8. The list is [(0,3),(0,1),(2,3)] when position 0 is removed: the last link (2,3)
    // moves to position 0, the list is [(2,3),(0,1)], and the next removal at position 1 removes (0,1), not (2,3).
    // Questions: (4,0,1,0), (1,0,4,0), (2,0,2,0), (3,0,1,0), (3,0,2,0).
    t('removal-order', [4, 14, 4, 3, 8], 637525700),
    // n = 5, q = 12, reach 5, removeTenths 3, seed 36: question w=0 with no links: (5,0,1,0); adds (1,1), (1,4), (4,4);
    // question w=4: (4,2,2,1); removals of (1,4) and (1,1); question w=0: (5,1,1,0); adding (4,4) again changes nothing;
    // remove (4,4); add (0,4); question w=0: (4,0,2,0).
    t('duplicate', [5, 12, 5, 3, 36], 503544438),
    t('huge', [100000, 90000, 30, 1, 5]),
    t('huge', [100000, 85000, 100000, 1, 6]),
    t('huge', [100000, 90000, 3, 2, 7]),
    t('huge', [100000, 90000, 1000, 1, 8]),
    t('huge', [100000, 75000, 2, 1, 9]),
    t('huge', [100000, 90000, 50, 1, 10]),
    t('huge', [100000, 70000, 5000, 1, 11]),
    t('huge', [100000, 90000, 12, 2, 12]),
    t('huge', [100000, 80000, 100, 1, 13]),
    t('huge', [100000, 90000, 60000, 2, 14]),
  ],
};
