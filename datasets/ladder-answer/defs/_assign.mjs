// Family "assign": count the ways to give nine workers nine different machines when
// some pairs are not allowed. The forbidden pairs sit in a small block of the table
// (a few workers and a few machines), so counting by inclusion and exclusion over
// the forbidden pairs (the rook polynomial) is the hand method. The instance is
//   { people: [names], machines: [names], forbidden: [[person, machine], ...] }
//
// Three exact methods that share no code:
//   countBrute   tries every one of the 9! assignments
//   countDp      adds people one at a time over the set of machines already used
//   countRook    inclusion and exclusion: sum over k of (-1)^k * r_k * (n - k)!, where
//                r_k counts the ways to pick k forbidden pairs that share no person or machine
// The shortcuts are two tempting estimates: stop the inclusion-exclusion after the
// terms for one and two forbidden pairs, and treat every worker's list as independent.

import { WORDS, NAMES, list } from './_rng.mjs';

const MACHINES = ['press', 'lathe', 'mill', 'drill', 'saw', 'kiln', 'loom', 'forge', 'vise', 'plane'];

const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));

export function countBrute(instance) {
  const n = instance.people.length;
  const bad = instance.people.map(() => new Array(n).fill(false));
  for (const [p, m] of instance.forbidden) bad[p][m] = true;
  const used = new Array(n).fill(false);
  let count = 0;
  const rec = (p) => {
    if (p === n) {
      count += 1;
      return;
    }
    for (let m = 0; m < n; m += 1) {
      if (used[m] || bad[p][m]) continue;
      used[m] = true;
      rec(p + 1);
      used[m] = false;
    }
  };
  rec(0);
  return count;
}

export function countDp(instance) {
  const n = instance.people.length;
  const bad = instance.people.map(() => new Set());
  for (const [p, m] of instance.forbidden) bad[p].add(m);
  let ways = new Map([[0, 1]]);
  for (let p = 0; p < n; p += 1) {
    const next = new Map();
    for (const [mask, count] of ways) {
      for (let m = 0; m < n; m += 1) {
        if (mask & (1 << m) || bad[p].has(m)) continue;
        next.set(mask | (1 << m), (next.get(mask | (1 << m)) || 0) + count);
      }
    }
    ways = next;
  }
  return ways.get((1 << n) - 1) || 0;
}

/** r_k for k = 0..: the ways to choose k forbidden pairs with no person and no machine used twice. */
export function rookNumbers(instance) {
  const cells = instance.forbidden;
  const r = new Array(cells.length + 1).fill(0);
  const rec = (from, k, people, machines) => {
    r[k] += 1;
    for (let i = from; i < cells.length; i += 1) {
      const [p, m] = cells[i];
      if (people & (1 << p) || machines & (1 << m)) continue;
      rec(i + 1, k + 1, people | (1 << p), machines | (1 << m));
    }
  };
  rec(0, 0, 0, 0);
  while (r.length > 1 && r.at(-1) === 0) r.pop();
  return r;
}

export function countRook(instance) {
  const n = instance.people.length;
  return rookNumbers(instance).reduce((sum, rk, k) => sum + (k % 2 ? -1 : 1) * rk * factorial(n - k), 0);
}

export function solve(instance) {
  const answer = countDp(instance);
  return { answer };
}

export function solveProved(instance) {
  const answer = countDp(instance);
  if (countBrute(instance) !== answer) throw new Error('assign: brute force disagrees with the DP');
  if (countRook(instance) !== answer) throw new Error('assign: inclusion-exclusion disagrees with the DP');
  return { answer };
}

export function shortcuts(instance) {
  const n = instance.people.length;
  const perPerson = instance.people.map((_, p) => instance.forbidden.filter(([q]) => q === p).length);
  const r = rookNumbers(instance);
  const secondOrder = factorial(n) - r[1] * factorial(n - 1) + r[2] * factorial(n - 2);
  const independent = Math.round(perPerson.reduce((value, f) => (value * (n - f)) / n, factorial(n)));
  return [
    { name: 'stop inclusion-exclusion after the pair terms', answer: secondOrder },
    { name: 'treat each worker as independent', answer: independent },
  ];
}

export function build(rng, cfg) {
  const { size, rows, cols, cells, min, max } = cfg;
  return rng.attempt(() => {
    const people = rng.sample(NAMES, size);
    const machines = MACHINES.slice(0, size);
    const rowSet = rng.sample([...Array(size).keys()], rows);
    const colSet = rng.sample([...Array(size).keys()], cols);
    const block = rowSet.flatMap((p) => colSet.map((m) => [p, m]));
    const forbidden = rng.sample(block, cells).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (new Set(forbidden.map((c) => c[0])).size < rows - 1) return null;
    const instance = { people, machines, forbidden };
    const answer = countDp(instance);
    if (answer < min || answer > max || answer % 100 === 0) return null;
    // Both shortcuts must be clearly off, not just by one.
    return shortcuts(instance).every((s) => Math.abs(s.answer - answer) > answer * 0.03) ? instance : null;
  }, 3000);
}

export function render(instance) {
  const { people, machines, forbidden } = instance;
  const lines = people
    .map((person, p) => {
      const banned = forbidden.filter(([q]) => q === p).map(([, m]) => `the ${machines[m]}`);
      return banned.length ? `${person} cannot use ${list(banned).replace(/ and /g, ' or ')}.` : null;
    })
    .filter(Boolean);
  return [
    `A workshop has ${WORDS[people.length]} workers (${list(people)}) and ${WORDS[machines.length]} machines (${list(machines.map((m) => `the ${m}`))}). Every worker is given exactly one machine, and every machine goes to exactly one worker. These are the only restrictions:`,
    '',
    ...lines.map((line, i) => `${i + 1}. ${line}`),
    '',
    `Every other pairing of a worker with a machine is allowed. Two assignments are different if at least one worker gets a different machine. In how many different ways can the machines be given out?`,
    'Answer format: a whole number.',
  ].join('\n');
}
