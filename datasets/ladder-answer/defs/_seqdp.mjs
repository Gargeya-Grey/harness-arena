// Family "seqdp": count the words of a given length over five letters that follow a
// list of rules. A careful dynamic program over (position, last letter, run length,
// counts of the limited letters) is the hand method; there are far too many words to
// list. The instance is
//   { letters, length, forbidden: [[a, b]], maxRun, exactly: { letter, count },
//     atMost: { letter, count } | null, firstNot: [letters], lastIn: [letters] }
//
// Four exact methods that share no code:
//   countForward   fills a table position by position
//   countBackward  a memoised recursion that counts the ways to finish a word
//   countBrute     lists every word (only used for short words, to test the other two)
// `valid` is the one place that states the rules for a whole word.

const LETTERS = 'ABCDE';

export function valid(word, rules) {
  const w = [...word];
  if (rules.firstNot.includes(w[0]) || !rules.lastIn.includes(w.at(-1))) return false;
  let run = 1;
  for (let i = 1; i < w.length; i += 1) {
    if (rules.forbidden.some(([a, b]) => a === w[i - 1] && b === w[i])) return false;
    run = w[i] === w[i - 1] ? run + 1 : 1;
    if (run > rules.maxRun) return false;
  }
  if (w.filter((c) => c === rules.exactly.letter).length !== rules.exactly.count) return false;
  if (rules.atMost && w.filter((c) => c === rules.atMost.letter).length > rules.atMost.count) return false;
  return true;
}

export function countBrute(rules, length = rules.length) {
  const total = LETTERS.length ** length;
  let count = 0;
  for (let k = 0; k < total; k += 1) {
    let word = '';
    for (let i = 0, rest = k; i < length; i += 1, rest = Math.floor(rest / LETTERS.length)) word = LETTERS[rest % LETTERS.length] + word;
    if (valid(word, rules)) count += 1;
  }
  return count;
}

const blocked = (rules, a, b) => rules.forbidden.some(([x, y]) => x === a && y === b);

export function countForward(rules, length = rules.length) {
  // state key: last letter, run length, number of exactly-letters, number of atMost-letters
  let table = new Map();
  const bump = (map, key, by) => map.set(key, (map.get(key) || 0) + by);
  for (const c of LETTERS) {
    if (rules.firstNot.includes(c)) continue;
    bump(table, [c, 1, c === rules.exactly.letter ? 1 : 0, rules.atMost && c === rules.atMost.letter ? 1 : 0].join('|'), 1);
  }
  for (let pos = 1; pos < length; pos += 1) {
    const next = new Map();
    for (const [key, ways] of table) {
      const [last, runText, xText, yText] = key.split('|');
      const run = Number(runText);
      for (const c of LETTERS) {
        if (blocked(rules, last, c)) continue;
        const r = c === last ? run + 1 : 1;
        if (r > rules.maxRun) continue;
        const x = Number(xText) + (c === rules.exactly.letter ? 1 : 0);
        const y = Number(yText) + (rules.atMost && c === rules.atMost.letter ? 1 : 0);
        if (x > rules.exactly.count || (rules.atMost && y > rules.atMost.count)) continue;
        bump(next, [c, r, x, y].join('|'), ways);
      }
    }
    table = next;
  }
  let total = 0;
  for (const [key, ways] of table) {
    const [last, , xText] = key.split('|');
    if (rules.lastIn.includes(last) && Number(xText) === rules.exactly.count) total += ways;
  }
  return total;
}

export function countBackward(rules, length = rules.length) {
  const memo = new Map();
  // Ways to add `left` more letters after one that ends the prefix, given what the prefix used.
  const finish = (left, last, run, x, y) => {
    if (left === 0) return rules.lastIn.includes(last) && x === rules.exactly.count ? 1 : 0;
    const key = `${left}|${last}|${run}|${x}|${y}`;
    if (memo.has(key)) return memo.get(key);
    let ways = 0;
    for (const c of LETTERS) {
      if (blocked(rules, last, c)) continue;
      const r = c === last ? run + 1 : 1;
      if (r > rules.maxRun) continue;
      const nx = x + (c === rules.exactly.letter ? 1 : 0);
      const ny = y + (rules.atMost && c === rules.atMost.letter ? 1 : 0);
      if (nx > rules.exactly.count || (rules.atMost && ny > rules.atMost.count)) continue;
      ways += finish(left - 1, c, r, nx, ny);
    }
    memo.set(key, ways);
    return ways;
  };
  let total = 0;
  for (const c of LETTERS) {
    if (rules.firstNot.includes(c)) continue;
    const x = c === rules.exactly.letter ? 1 : 0;
    const y = rules.atMost && c === rules.atMost.letter ? 1 : 0;
    if (x > rules.exactly.count || (rules.atMost && y > rules.atMost.count)) continue;
    total += finish(length - 1, c, 1, x, y);
  }
  return total;
}

// Lists every valid word by extending prefixes, cutting a prefix as soon as a rule is broken
// or the chosen letter can no longer reach its count. Feasible when the answer is below a few tens of millions.
export function countDfs(rules) {
  const { length, exactly, atMost } = rules;
  let count = 0;
  const walk = (left, last, run, x, y) => {
    if (x > exactly.count || x + left < exactly.count || (atMost && y > atMost.count)) return;
    if (left === 0) {
      if (rules.lastIn.includes(last)) count += 1;
      return;
    }
    for (const c of LETTERS) {
      if (blocked(rules, last, c)) continue;
      const r = c === last ? run + 1 : 1;
      if (r > rules.maxRun) continue;
      walk(left - 1, c, r, x + (c === exactly.letter ? 1 : 0), y + (atMost && c === atMost.letter ? 1 : 0));
    }
  };
  for (const c of LETTERS) {
    if (!rules.firstNot.includes(c)) walk(length - 1, c, 1, c === exactly.letter ? 1 : 0, atMost && c === atMost.letter ? 1 : 0);
  }
  return count;
}

/** The same rules for a shorter word, to test the counting methods against the listing. */
export const shorter = (rules, length) => ({ ...rules, length });

export function solve(instance) {
  return { answer: countForward(instance) };
}

export function solveProved(instance) {
  const answer = countForward(instance);
  if (countBackward(instance) !== answer) throw new Error('seqdp: the two counting methods disagree');
  return { answer };
}

export function shortcuts(instance) {
  const without = (patch) => countForward({ ...instance, ...patch });
  return [
    { name: 'forget the limit on repeated letters', answer: without({ maxRun: instance.length }) },
    { name: 'forget the count of the chosen letter', answer: countForwardAnyCount(instance) },
  ];
}

// Same table, but the chosen letter may appear any number of times.
function countForwardAnyCount(instance) {
  let total = 0;
  for (let k = 0; k <= instance.length; k += 1) total += countForward({ ...instance, exactly: { ...instance.exactly, count: k } });
  return total;
}

export function build(rng, cfg) {
  const { length, pairs, exactly, atMost, min, max } = cfg;
  return rng.attempt(() => {
    const all = [];
    for (const a of LETTERS) for (const b of LETTERS) if (a !== b) all.push([a, b]);
    const letter = rng.pick([...LETTERS]);
    const limited = rng.pick([...LETTERS].filter((c) => c !== letter));
    const rules = {
      letters: LETTERS,
      length,
      forbidden: rng.sample(all, pairs).sort((p, q) => p.join('').localeCompare(q.join(''))),
      maxRun: 2,
      exactly: { letter, count: exactly },
      atMost: atMost == null ? null : { letter: limited, count: atMost },
      firstNot: rng.sample([...LETTERS], 1),
      lastIn: rng.sample([...LETTERS], 2).sort(),
    };
    const answer = countForward(rules);
    if (answer < min || answer > max) return null;
    const off = shortcuts(rules).every((s) => s.answer !== answer);
    return off ? rules : null;
  }, 3000);
}

export function render(rules) {
  const { length, forbidden, exactly, atMost, firstNot, lastIn } = rules;
  const times = (n) => (n === 1 ? 'exactly once' : `exactly ${['zero', 'one', 'two', 'three', 'four', 'five', 'six'][n]} times`);
  const lines = [
    `Every word of length ${length} below is written with the five letters A, B, C, D and E. A word is valid when all of these rules hold:`,
    '',
    `1. ${firstNot.length === 1 ? `The first letter is not ${firstNot[0]}.` : ''}`,
    `2. The last letter is ${lastIn.join(' or ')}.`,
    `3. None of these pairs of letters appears in the word, where XY means X directly followed by Y: ${forbidden.map(([a, b]) => `${a}${b}`).join(", ")}.`,
    '4. No letter appears three times in a row.',
    `5. The letter ${exactly.letter} appears ${times(exactly.count)} in the word.`,
  ];
  if (atMost) lines.push(`6. The letter ${atMost.letter} appears at most ${atMost.count === 1 ? 'once' : ['zero', 'one', 'two', 'three', 'four'][atMost.count] + ' times'} in the word.`);
  return [
    ...lines,
    '',
    'How many valid words are there?',
    'Answer format: a whole number.',
  ].join('\n');
}
