// Family "grid": a seating logic grid with indirect clues (6 people and 4 traits in
// tier 4, 7 people and 5 traits in tier 5). The instance is
//   { seats, categories: [{ kind, values }], clues: [...], ask: { cat, of: [cat, value] } }
// A clue names items as [category, value]. Category 0 is the first name.
//
// The solver is a constraint search with propagation. It counts solutions up to a
// limit, so the generator can keep a clue set only when exactly one seating fits
// and no clue can be dropped (every clue is needed).

import { cap, list } from './_rng.mjs';

const DRINKS = ['tea', 'milk', 'juice', 'cocoa', 'water', 'coffee', 'cider', 'soda', 'broth', 'lemonade'];
const HOBBIES = ['archery', 'rowing', 'pottery', 'chess', 'baking', 'climbing', 'sewing', 'diving', 'fencing', 'origami'];
const PETS = ['ferret', 'gecko', 'parrot', 'rabbit', 'tortoise', 'hamster', 'newt', 'finch', 'goat', 'falcon'];
const TRADES = ['baker', 'welder', 'nurse', 'tailor', 'plumber', 'painter', 'glazier', 'cooper', 'miller', 'farrier'];
const POOLS = { drink: DRINKS, pet: PETS, hobby: HOBBIES, trade: TRADES };

// ---- clue meaning -------------------------------------------------------------

// Each type: how many items it names and the test on their seats (0-based).
const ARITY = { same: 2, notsame: 2, left: 2, next: 2, notnext: 2, before: 2, gap: 2, far: 2, at: 1, notat: 1, end: 1, odd: 1, even: 1, either: 3, between: 3 };

function compileClue(clue, seats) {
  const test = {
    same: (a, b) => a === b,
    notsame: (a, b) => a !== b,
    left: (a, b) => a + 1 === b,
    next: (a, b) => Math.abs(a - b) === 1,
    notnext: (a, b) => a !== b && Math.abs(a - b) !== 1,
    before: (a, b) => a < b,
    gap: (a, b) => Math.abs(a - b) === 2,
    far: (a, b) => Math.abs(a - b) >= 3,
    at: (a) => a === clue.seat,
    notat: (a) => a !== clue.seat,
    end: (a) => a === 0 || a === seats - 1,
    odd: (a) => a % 2 === 0,
    even: (a) => a % 2 === 1,
    either: (a, b, c) => a === b || a === c,
    between: (a, b, c) => (b < a && a < c) || (c < a && a < b),
  }[clue.type];
  if (!test) throw new Error(`unknown clue type ${clue.type}`);
  const items = [clue.a, clue.b, clue.c].filter(Boolean);
  if (items.length !== ARITY[clue.type]) throw new Error(`clue ${clue.type} names ${items.length} items`);
  return { items, test };
}

export function holdsClue(clue, seatOf, seats) {
  const { items, test } = compileClue(clue, seats);
  return test(...items.map(([cat, value]) => seatOf[cat][value]));
}

// ---- solver --------------------------------------------------------------------

const bitCount = (x) => {
  let n = 0;
  for (let v = x; v; v &= v - 1) n += 1;
  return n;
};

export function gridSolutions(instance, limit = 2) {
  const n = instance.seats;
  const cats = instance.categories.length;
  const total = n * cats;
  const full = (1 << n) - 1;
  const clues = instance.clues.map((clue) => {
    const { items, test } = compileClue(clue, n);
    return { vars: items.map(([cat, value]) => cat * n + value), test };
  });
  const dom0 = new Array(total).fill(full);
  for (const { vars, test } of clues) {
    if (vars.length !== 1) continue;
    for (let s = 0; s < n; s += 1) if (!test(s)) dom0[vars[0]] &= ~(1 << s);
  }
  const multi = clues.filter((clue) => clue.vars.length > 1);

  // Removes seats that no assignment of the other items in a clue can support.
  const revise = (dom, { vars, test }) => {
    let changed = false;
    const [x, y, z] = vars;
    for (let p = 0; p < vars.length; p += 1) {
      const v = vars[p];
      for (let s = 0; s < n; s += 1) {
        if (!(dom[v] & (1 << s))) continue;
        let ok = false;
        if (vars.length === 2) {
          const other = p === 0 ? y : x;
          for (let t = 0; t < n && !ok; t += 1) {
            if (!(dom[other] & (1 << t))) continue;
            ok = p === 0 ? test(s, t) : test(t, s);
          }
        } else {
          const others = [0, 1, 2].filter((q) => q !== p);
          const [q1, q2] = others;
          for (let t = 0; t < n && !ok; t += 1) {
            if (!(dom[vars[q1]] & (1 << t))) continue;
            for (let u = 0; u < n && !ok; u += 1) {
              if (!(dom[vars[q2]] & (1 << u))) continue;
              const seats = [0, 0, 0];
              seats[p] = s;
              seats[q1] = t;
              seats[q2] = u;
              ok = test(seats[0], seats[1], seats[2]);
            }
          }
        }
        if (!ok) {
          dom[v] &= ~(1 << s);
          changed = true;
        }
      }
      if (dom[v] === 0) return -1;
    }
    return changed ? 1 : 0;
  };

  const propagate = (dom) => {
    for (let again = true; again;) {
      again = false;
      for (const clue of multi) {
        const r = revise(dom, clue);
        if (r < 0) return false;
        if (r > 0) again = true;
      }
      for (let c = 0; c < cats; c += 1) {
        const base = c * n;
        for (let i = 0; i < n; i += 1) {
          const d = dom[base + i];
          if (d === 0) return false;
          if ((d & (d - 1)) === 0) {
            for (let j = 0; j < n; j += 1) {
              if (j !== i && dom[base + j] & d) {
                dom[base + j] &= ~d;
                again = true;
                if (dom[base + j] === 0) return false;
              }
            }
          }
        }
        for (let s = 0; s < n; s += 1) {
          let count = 0;
          let last = -1;
          for (let i = 0; i < n; i += 1) {
            if (dom[base + i] & (1 << s)) {
              count += 1;
              last = i;
            }
          }
          if (count === 0) return false;
          if (count === 1 && dom[base + last] !== 1 << s) {
            dom[base + last] = 1 << s;
            again = true;
          }
        }
      }
    }
    return true;
  };

  const solutions = [];
  const search = (dom) => {
    if (solutions.length >= limit || !propagate(dom)) return;
    let pick = -1;
    let size = n + 1;
    for (let v = 0; v < total; v += 1) {
      const k = bitCount(dom[v]);
      if (k > 1 && k < size) {
        pick = v;
        size = k;
      }
    }
    if (pick < 0) {
      solutions.push(Array.from({ length: cats }, (_, c) => Array.from({ length: n }, (__, i) => Math.log2(dom[c * n + i]))));
      return;
    }
    for (let s = 0; s < n; s += 1) {
      if (!(dom[pick] & (1 << s))) continue;
      const next = dom.slice();
      next[pick] = 1 << s;
      search(next);
      if (solutions.length >= limit) return;
    }
  };
  search(dom0);
  return solutions;
}

export function answerOf(instance, seatOf) {
  const { ask, categories } = instance;
  const seat = seatOf[ask.of[0]][ask.of[1]];
  return categories[ask.cat].values[seatOf[ask.cat].indexOf(seat)];
}

export function solve(instance) {
  const found = gridSolutions(instance, 2);
  return { solutions: found.length, answer: found.length === 1 ? answerOf(instance, found[0]) : null };
}

/** Share of clues whose removal leaves the asked answer undecided (two seatings fit with different answers). */
export function ambiguityShare(instance) {
  let undecided = 0;
  instance.clues.forEach((_, drop) => {
    const rest = { ...instance, clues: instance.clues.filter((__, i) => i !== drop) };
    const answers = new Set(gridSolutions(rest, 60).map((seatOf) => answerOf(instance, seatOf)));
    if (answers.size > 1) undecided += 1;
  });
  return undecided / instance.clues.length;
}

// ---- generator -----------------------------------------------------------------

const TYPE_WEIGHTS = {
  same: 5, left: 3, next: 3, before: 4, gap: 3, far: 1, either: 4, between: 4, notsame: 2, notnext: 2, notat: 2, at: 1, end: 1, odd: 1, even: 1,
};

function randomClue(rng, cats, n) {
  const item = () => [rng.int(0, cats - 1), rng.int(0, n - 1)];
  const differ = (x, y) => x[0] !== y[0] || x[1] !== y[1];
  const pool = Object.entries(TYPE_WEIGHTS).flatMap(([type, w]) => Array(w).fill(type));
  const type = rng.pick(pool);
  switch (type) {
    case 'same':
    case 'notsame': {
      const a = item();
      const b = item();
      return a[0] !== b[0] ? { type, a, b } : null;
    }
    case 'at':
    case 'notat':
      return { type, a: item(), seat: rng.int(0, n - 1) };
    case 'end':
    case 'odd':
    case 'even':
      return { type, a: item() };
    case 'either': {
      const a = item();
      const cat = rng.int(0, cats - 1);
      const v1 = rng.int(0, n - 1);
      const v2 = rng.int(0, n - 1);
      return cat === a[0] || v1 === v2 ? null : { type, a, b: [cat, v1], c: [cat, v2] };
    }
    case 'between': {
      const a = item();
      const b = item();
      const c = item();
      return differ(a, b) && differ(a, c) && differ(b, c) ? { type, a, b, c } : null;
    }
    default: {
      const a = item();
      const b = item();
      return differ(a, b) ? { type, a, b } : null;
    }
  }
}

/**
 * cfg: { seats, kinds: ['drink', ...] (traits after the name), minClues, maxClues, minShare }
 * Draws a hidden seating, true clues in random order until exactly one seating fits,
 * then drops every clue that is not needed.
 */
export function build(rng, cfg) {
  const { seats, kinds, minClues, maxClues, minShare } = cfg;
  return rng.attempt(() => {
    const categories = [{ kind: 'name', values: rng.sample(NAME_VALUES, seats) }, ...kinds.map((kind) => ({ kind, values: rng.sample(POOLS[kind], seats) }))];
    const hidden = categories.map(() => rng.shuffle([...Array(seats).keys()]));
    const seen = new Set();
    const pool = [];
    for (let i = 0; i < 4000 && pool.length < 160; i += 1) {
      const clue = randomClue(rng, categories.length, seats);
      if (!clue || !holdsClue(clue, hidden, seats)) continue;
      const key = JSON.stringify(clue);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(clue);
    }
    const base = { seats, categories, ask: { cat: 0, of: [0, 0] } };
    const unique = (clues) => gridSolutions({ ...base, clues }, 2).length === 1;
    let clues = [];
    for (const clue of pool) {
      clues.push(clue);
      if (clues.length >= minClues - 6 && unique(clues)) break;
    }
    if (!unique(clues)) return null;
    for (const clue of rng.shuffle(clues)) {
      const rest = clues.filter((c) => c !== clue);
      if (unique(rest)) clues = rest;
    }
    if (clues.length < minClues || clues.length > maxClues) return null;
    if (clues.filter((c) => ['at', 'end', 'odd', 'even'].includes(c.type)).length > 3) return null;
    if (clues.filter((c) => ['either', 'between', 'gap', 'before', 'far'].includes(c.type)).length < Math.ceil(clues.length / 3)) return null;
    // The question: an item of one category, asked for another.
    const askCat = rng.int(0, categories.length - 1);
    let ofCat = rng.int(0, categories.length - 1);
    if (ofCat === askCat) ofCat = (ofCat + 1) % categories.length;
    const of = [ofCat, rng.int(0, seats - 1)];
    const instance = { ...base, clues: rng.shuffle(clues), ask: { cat: askCat, of } };
    const answerValue = hidden[askCat].indexOf(hidden[ofCat][of[1]]);
    // No single clue may state the answer outright.
    const direct = instance.clues.some((c) => c.type === 'same' && ((c.a[0] === ofCat && c.a[1] === of[1] && c.b[0] === askCat && c.b[1] === answerValue) || (c.b[0] === ofCat && c.b[1] === of[1] && c.a[0] === askCat && c.a[1] === answerValue)));
    if (direct) return null;
    const share = ambiguityShare(instance);
    return share >= minShare ? instance : null;
  }, 200);
}

const NAME_VALUES = ['Aldo', 'Brisa', 'Cato', 'Dalia', 'Emeka', 'Farid', 'Greta', 'Hana', 'Ivo', 'Jorun', 'Kemal', 'Lior', 'Mina', 'Nuno', 'Odette', 'Pavel', 'Quill', 'Rafa', 'Sana', 'Tove'];

// ---- text ----------------------------------------------------------------------

export function render(instance) {
  const { categories, clues, ask, seats } = instance;
  const ref = ([cat, value]) => {
    const v = categories[cat].values[value];
    switch (categories[cat].kind) {
      case 'name': return v;
      case 'drink': return `the ${v} drinker`;
      case 'pet': return `the ${v} owner`;
      case 'hobby': return `the ${v} fan`;
      default: return `the ${v}`;
    }
  };
  const text = (clue) => {
    const a = ref(clue.a);
    const b = clue.b ? ref(clue.b) : '';
    switch (clue.type) {
      case 'same': return `${cap(a)} and ${b} are the same person.`;
      case 'notsame': return `${cap(a)} and ${b} are different people.`;
      case 'at': return `${cap(a)} sits in seat ${clue.seat + 1}.`;
      case 'notat': return `${cap(a)} does not sit in seat ${clue.seat + 1}.`;
      case 'end': return `${cap(a)} sits in seat 1 or in seat ${seats}.`;
      case 'odd': return `${cap(a)} sits in an odd-numbered seat.`;
      case 'even': return `${cap(a)} sits in an even-numbered seat.`;
      case 'left': return `${cap(a)} sits directly to the left of ${b} (in the next lower seat number).`;
      case 'next': return `${cap(a)} sits right next to ${b}.`;
      case 'notnext': return `${cap(a)} and ${b} are different people, and they do not sit right next to each other.`;
      case 'before': return `${cap(a)} sits somewhere to the left of ${b}, not necessarily right next to ${b}.`;
      case 'gap': return `Exactly one seat lies between ${a} and ${b}.`;
      case 'far': return `At least two seats lie between ${a} and ${b}.`;
      case 'either': return `${cap(a)} is either ${b} or ${ref(clue.c)}.`;
      case 'between': return `${cap(a)} sits somewhere between ${b} and ${ref(clue.c)}, in either order and not necessarily right next to them.`;
      default: throw new Error(clue.type);
    }
  };
  const target = ref(ask.of);
  const questions = {
    name: `Who is ${target}?`,
    drink: `What does ${target} drink?`,
    pet: `Which pet does ${target} keep?`,
    hobby: `Which hobby does ${target} have?`,
    trade: `What is the trade of ${target}?`,
  };
  const formats = { name: 'the first name of that person', drink: 'the one word naming that drink', pet: 'the one word naming that pet', hobby: 'the one word naming that hobby', trade: 'the one word naming that trade' };
  const parts = categories.map(({ kind, values }) => {
    switch (kind) {
      case 'name': return `has a different first name (${list(values)})`;
      case 'drink': return `drinks a different drink (${list(values)})`;
      case 'pet': return `keeps a different pet (${list(values)})`;
      case 'hobby': return `has a different hobby (${list(values)})`;
      default: return `has a different trade (${list(values)})`;
    }
  });
  const kindName = { name: 'name', drink: 'drink', pet: 'pet', hobby: 'hobby', trade: 'trade' };
  const WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const kind = categories[ask.cat].kind;
  return [
    `${cap(WORD[seats])} people sit in a row of seats numbered 1 to ${seats} from left to right. Each person ${list(parts)}. Every ${list(categories.map((c) => kindName[c.kind]))} is used by exactly one person.`,
    '',
    'Clues:',
    ...clues.map((clue, i) => `${i + 1}. ${text(clue)}`),
    '',
    questions[kind],
    `Answer format: ${formats[kind]}, spelled as in the text above.`,
  ].join('\n');
}
