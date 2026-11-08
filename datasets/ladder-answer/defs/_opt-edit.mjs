// Family "edit": the cheapest way to turn one word into another with weighted edits.
// The instance is { from, to, classes: [letters of class 0, class 1, class 2] }. Rules:
//   - keeping a letter costs 0; replacing a letter by another costs 1 within a class and 3 across classes
//   - between two placed pairs (or before the first, or after the last) the k deleted letters cost
//     4 + k together, and the k inserted letters cost 4 + k together (two runs, paid separately)
//
// Two exact methods that share no code:
//   editGotoh     the three-table dynamic programme (ends with a match, a deletion, an insertion)
//   editDijkstra  shortest path in the graph of states (letters used of each word, kind of last step)
// The shortcuts are five tempting alignments.

const GAP_OPEN = 4;
const SUB_SAME = 1;
const SUB_OTHER = 3;

const classOf = (instance, ch) => instance.classes.findIndex((letters) => letters.includes(ch));

function subCost(instance, a, b) {
  if (a === b) return 0;
  return classOf(instance, a) === classOf(instance, b) ? SUB_SAME : SUB_OTHER;
}

export function editGotoh(instance) {
  const a = instance.from;
  const b = instance.to;
  const n = a.length;
  const m = b.length;
  const INF = 1e9;
  const M = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const I = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  M[0][0] = 0;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (i > 0 && j > 0) M[i][j] = Math.min(M[i - 1][j - 1], D[i - 1][j - 1], I[i - 1][j - 1]) + subCost(instance, a[i - 1], b[j - 1]);
      if (i > 0) D[i][j] = Math.min(Math.min(M[i - 1][j], I[i - 1][j]) + GAP_OPEN + 1, D[i - 1][j] + 1);
      if (j > 0) I[i][j] = Math.min(Math.min(M[i][j - 1], D[i][j - 1]) + GAP_OPEN + 1, I[i][j - 1] + 1);
    }
  }
  return Math.min(M[n][m], D[n][m], I[n][m]);
}

export function editDijkstra(instance) {
  const a = instance.from;
  const b = instance.to;
  const n = a.length;
  const m = b.length;
  // kind: 0 start or last step kept/replaced, 1 last step deleted, 2 last step inserted
  const key = (i, j, kind) => (i * (m + 1) + j) * 3 + kind;
  const dist = new Map([[key(0, 0, 0), 0]]);
  const settled = new Set();
  // Bucket queue: all costs are small non-negative integers.
  const buckets = [[[0, 0, 0]]];
  for (let d = 0; d < buckets.length; d += 1) {
    for (const [i, j, kind] of buckets[d] || []) {
      const k = key(i, j, kind);
      if (settled.has(k) || dist.get(k) !== d) continue;
      settled.add(k);
      if (i === n && j === m) return d;
      const relax = (i2, j2, kind2, cost) => {
        const k2 = key(i2, j2, kind2);
        const d2 = d + cost;
        if (dist.has(k2) && dist.get(k2) <= d2) return;
        dist.set(k2, d2);
        (buckets[d2] ||= []).push([i2, j2, kind2]);
      };
      if (i < n && j < m) relax(i + 1, j + 1, 0, subCost(instance, a[i], b[j]));
      if (i < n) relax(i + 1, j, 1, kind === 1 ? 1 : GAP_OPEN + 1);
      if (j < m) relax(i, j + 1, 2, kind === 2 ? 1 : GAP_OPEN + 1);
    }
  }
  return null;
}

// ---- shortcuts -----------------------------------------------------------------------------

/** Price a list of steps (m keep/replace, d delete, i insert) under the true rules. */
function price(instance, steps) {
  // Between two placed pairs, the deleted letters form one run and the inserted letters one run,
  // whatever the order of the steps in the list.
  let ai = 0;
  let bj = 0;
  let total = 0;
  let del = 0;
  let ins = 0;
  const close = () => {
    if (del) total += GAP_OPEN + del;
    if (ins) total += GAP_OPEN + ins;
    del = 0;
    ins = 0;
  };
  for (const s of steps) {
    if (s === 'm') {
      close();
      total += subCost(instance, instance.from[ai], instance.to[bj]);
      ai += 1;
      bj += 1;
    } else if (s === 'd') {
      del += 1;
      ai += 1;
    } else {
      ins += 1;
      bj += 1;
    }
  }
  close();
  return total;
}

/** Optimal alignment under other costs: classic dynamic programme with given costs, returns the steps. */
function alignWith(a, b, sub, gap) {
  const n = a.length;
  const m = b.length;
  const T = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) T[i][0] = i * gap;
  for (let j = 1; j <= m; j += 1) T[0][j] = j * gap;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) T[i][j] = Math.min(T[i - 1][j - 1] + sub(a[i - 1], b[j - 1]), T[i - 1][j] + gap, T[i][j - 1] + gap);
  }
  const steps = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && T[i][j] === T[i - 1][j - 1] + sub(a[i - 1], b[j - 1])) {
      steps.push('m');
      i -= 1;
      j -= 1;
    } else if (i > 0 && T[i][j] === T[i - 1][j] + gap) {
      steps.push('d');
      i -= 1;
    } else {
      steps.push('i');
      j -= 1;
    }
  }
  return steps.reverse();
}

function greedySteps(instance) {
  const a = instance.from;
  const b = instance.to;
  let i = 0;
  let j = 0;
  let last = '';
  const steps = [];
  while (i < a.length || j < b.length) {
    const options = [];
    if (i < a.length && j < b.length) options.push(['m', subCost(instance, a[i], b[j])]);
    if (i < a.length) options.push(['d', last === 'd' ? 1 : GAP_OPEN + 1]);
    if (j < b.length) options.push(['i', last === 'i' ? 1 : GAP_OPEN + 1]);
    options.sort((p, q) => p[1] - q[1]);
    steps.push(options[0][0]);
    if (options[0][0] !== 'd') j += options[0][0] === 'i' || options[0][0] === 'm' ? 1 : 0;
    if (options[0][0] !== 'i') i += 1;
    last = options[0][0];
  }
  return steps;
}

function lcsSteps(instance) {
  // Align a longest common subsequence; between matched letters pair the rest by replacement, then gap.
  const a = instance.from;
  const b = instance.to;
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const steps = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j] && L[i][j] === L[i + 1][j + 1] + 1) {
      steps.push('m');
      i += 1;
      j += 1;
      continue;
    }
    // next anchor: the first pair (i2, j2) that continues a longest common subsequence
    let ni = n;
    let nj = m;
    outer: for (let s = 0; s <= n + m; s += 1) {
      for (let i2 = i; i2 <= Math.min(n, i + s); i2 += 1) {
        const j2 = j + (s - (i2 - i));
        if (j2 > m) continue;
        if (i2 < n && j2 < m && a[i2] === b[j2] && L[i2][j2] === L[i][j] && L[i2][j2] === L[i2 + 1][j2 + 1] + 1) {
          ni = i2;
          nj = j2;
          break outer;
        }
      }
    }
    const da = ni - i;
    const db = nj - j;
    const both = Math.min(da, db);
    for (let k = 0; k < both; k += 1) steps.push('m');
    for (let k = both; k < da; k += 1) steps.push('d');
    for (let k = both; k < db; k += 1) steps.push('i');
    i = ni;
    j = nj;
  }
  return steps;
}

function positionSteps(instance) {
  const n = instance.from.length;
  const m = instance.to.length;
  const both = Math.min(n, m);
  return [...Array(both).fill('m'), ...Array(n - both).fill('d'), ...Array(m - both).fill('i')];
}

export function shortcuts(instance) {
  const a = instance.from;
  const b = instance.to;
  const unit = alignWith(a, b, (x, y) => (x === y ? 0 : 1), 1);
  const noClass = alignWith(a, b, (x, y) => (x === y ? 0 : 3), 3);
  return [
    { name: 'fewest edits (every edit costs 1), priced with the real costs', answer: price(instance, unit) },
    { name: 'every replacement 3 and every gap letter 3 (no run discount), priced with the real costs', answer: price(instance, noClass) },
    { name: 'always take the cheapest next step', answer: price(instance, greedySteps(instance)) },
    { name: 'keep a longest common subsequence, pair and gap the rest', answer: price(instance, lcsSteps(instance)) },
    { name: 'pair the letters in order, then one gap for the length difference', answer: price(instance, positionSteps(instance)) },
  ];
}

export function solveProved(instance) {
  const answer = editGotoh(instance);
  if (editDijkstra(instance) !== answer) throw new Error('edit: the two methods disagree');
  return { answer };
}

export const solve = (instance) => ({ answer: editGotoh(instance) });

export function build(rng, cfg) {
  const { length, edits } = cfg;
  const classes = [['a', 'e', 'o', 'u'], ['d', 't', 'k', 'p'], ['m', 'n', 'r', 'l']];
  const all = classes.flat();
  return rng.attempt(() => {
    const from = Array.from({ length }, () => rng.pick(all));
    const to = from.slice();
    for (let e = 0; e < edits; e += 1) {
      const at = rng.int(0, to.length - 1);
      const kind = rng.int(0, 2);
      if (kind === 0) to[at] = rng.pick(all);
      else if (kind === 1) to.splice(at, rng.int(1, 3));
      else to.splice(at, 0, ...Array.from({ length: rng.int(1, 3) }, () => rng.pick(all)));
    }
    const instance = { from: from.join(''), to: to.join(''), classes: classes.map((c) => c.join('')) };
    if (Math.abs(instance.from.length - instance.to.length) < 2 || instance.to.length < length - 3) return null;
    const answer = editGotoh(instance);
    const list = shortcuts(instance);
    const misses = list.filter((s) => s.answer !== answer).length;
    if (misses < list.length) return null; // every shortcut misses (the suite test asks for it)
    if (Math.min(...list.map((s) => s.answer)) > answer * 1.25) return null;
    return instance;
  }, 8000);
}

export function render(instance) {
  const { from, to, classes } = instance;
  return [
    `Turn the word "${from}" (${from.length} letters) into the word "${to}" (${to.length} letters) with the cheapest set of edits. Every edit works on one letter:`,
    '',
    '1. A letter of the first word may be kept (cost 0), if it is placed against the same letter of the second word.',
    '2. A letter of the first word may be replaced by a letter of the second word. The cost is 1 when the two letters are in the same class and 3 when they are in different classes.',
    `   The classes are: ${classes.map((c) => c.split('').join(' ')).join(' | ')}.`,
    '3. Letters of the first word that are left over may be deleted, and letters of the second word that are left over may be inserted. Look at the stretch between two neighbouring placed pairs of letters (kept or replaced), or before the first pair, or after the last pair. The k letters of the first word that are deleted in that stretch form one run and cost 4 + k together. The k letters of the second word that are inserted in that stretch form another run and cost 4 + k together. A stretch has at most one deletion run and at most one insertion run, and the two runs are paid separately.',
    '4. Letters keep their order: if one letter of the first word is placed against a letter of the second word, every letter before it is placed against letters before it.',
    '',
    'What is the smallest possible total cost?',
    'Answer format: a whole number, with no units.',
  ].join('\n');
}
