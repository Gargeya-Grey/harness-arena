// Seeded generator for the reasoning-hard suite. Run `node datasets/reasoning-hard/generate.mjs`
// to print every line of cases.jsonl. The seed is fixed, so the output never
// changes unless this file or solvers.mjs changes.
//
// Every case is a random instance of one family (seven families). The instance
// is solved by the exhaustive solver in solvers.mjs; the answer in `expected`
// comes only from there. An instance is rejected, and a new one is drawn, when
//   - the answer is not unique (logic grid and knights and knaves: more than one
//     configuration satisfies the clues), or
//   - the instance is too easy (a closed-form bound already gives the answer, a
//     clue set is not minimal, the obvious shortcut is right).
// The instance is stored in the case's `metadata.instance`, so the tests can solve
// every case again from the stored data. The model only sees `input.question`.
//
// A template draws numbers only from its own stream, seeded by SEED + family + n:
// adding a family never changes the cases of another.

import { fileURLToPath } from 'node:url';
import {
  criticalPath,
  fastMst,
  holdsClue,
  logicGridSolutions,
  observedHolidays,
  scheduleSearch,
  statementTruth,
  solveCase,
  solveLattice,
  solveRoute,
  toIso,
  twoLegWalk,
  knightAssignments,
  solveMst,
  solveArrangement,
} from './solvers.mjs';

export const SEED = 20261107;

// ---- random numbers (same method as datasets/reasoning/generate.mjs) --------

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(name, n) {
  const next = mulberry32(hash(`${SEED}:${name}:${n}`));
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (list) => list[int(0, list.length - 1)];
  const shuffle = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const sample = (list, k) => shuffle(list).slice(0, k);
  // Draws until `build` returns a value (not null); fails loudly, never loops forever.
  const attempt = (build, limit = 20000) => {
    for (let i = 0; i < limit; i += 1) {
      const value = build();
      if (value != null) return value;
    }
    throw new Error(`template ${name} #${n}: no acceptable instance in ${limit} draws`);
  };
  return { next, int, pick, shuffle, sample, attempt };
}

// ---- text helpers -----------------------------------------------------------

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const orList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);

const NAMES = ['Aldo', 'Brisa', 'Cato', 'Dalia', 'Emeka', 'Farid', 'Greta', 'Hana', 'Ivo', 'Jorun', 'Kemal', 'Lior', 'Mina', 'Nuno', 'Odette', 'Pavel', 'Quill', 'Rafa', 'Sana', 'Tove', 'Ugo', 'Vera', 'Wim', 'Xenia', 'Yusuf', 'Zora'];
const DRINKS = ['tea', 'milk', 'juice', 'cocoa', 'water', 'coffee', 'cider', 'soda', 'broth', 'lemonade'];
const HOBBIES = ['archery', 'rowing', 'pottery', 'chess', 'baking', 'climbing', 'sewing', 'diving', 'fencing', 'origami'];
const PETS = ['ferret', 'gecko', 'parrot', 'rabbit', 'tortoise', 'hamster', 'newt', 'finch', 'goat', 'falcon'];
const TOWNS = ['Ashby', 'Brill', 'Cawdor', 'Dunmore', 'Elwick', 'Fenham', 'Garth', 'Hollin', 'Ingram', 'Jarrow', 'Kelby', 'Lorne', 'Marlow', 'Netley', 'Orsett', 'Penrith', 'Quenby', 'Ryhall', 'Selby', 'Tarn'];

const dateText = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const DAY = 86400000;
const isoTime = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoWeekday = (iso) => new Date(isoTime(iso)).getUTCDay();

// ---- family: logic grid -----------------------------------------------------

function randomLogicClue(rng, nCats, seats) {
  const item = () => [rng.int(0, nCats - 1), rng.int(0, seats - 1)];
  const type = rng.pick(['same', 'same', 'same', 'left', 'next', 'before', 'at', 'notat', 'gap', 'either', 'between', 'notsame']);
  const differ = (x, y) => x[0] !== y[0] || x[1] !== y[1];
  switch (type) {
    case 'same': {
      const a = item();
      const b = item();
      return a[0] !== b[0] ? { type, a, b } : null;
    }
    case 'at':
    case 'notat':
      return { type, a: item(), seat: rng.int(0, seats - 1) };
    case 'either': {
      const a = item();
      const cat = rng.int(0, nCats - 1);
      if (cat === a[0]) return null;
      const v1 = rng.int(0, seats - 1);
      const v2 = rng.int(0, seats - 1);
      return v1 === v2 ? null : { type, a, b: [cat, v1], c: [cat, v2] };
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

function logicGrid(rng, n) {
  const seats = 5;
  const fourCategories = n >= 4;
  return rng.attempt(() => {
    const categories = [
      { key: 'name', values: rng.sample(NAMES, seats) },
      { key: 'drink', values: rng.sample(DRINKS, seats) },
      { key: 'pet', values: rng.sample(PETS, seats) },
      ...(fourCategories ? [{ key: 'hobby', values: rng.sample(HOBBIES, seats) }] : []),
    ];
    const hidden = categories.map(() => rng.shuffle([0, 1, 2, 3, 4]));
    const pool = [];
    const seen = new Set();
    for (let i = 0; i < 500 && pool.length < 70; i += 1) {
      const clue = randomLogicClue(rng, categories.length, seats);
      if (!clue || !holdsClue(clue, hidden)) continue;
      const key = JSON.stringify(clue);
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(clue);
    }
    const isUnique = (clues) => logicGridSolutions({ seats, categories, clues }, 2).length === 1;
    let clues = [];
    for (const clue of pool) {
      clues.push(clue);
      if (isUnique(clues)) break;
    }
    if (!isUnique(clues)) return null;
    // Keep a minimal clue set: no clue can be dropped without losing uniqueness.
    for (const clue of rng.shuffle(clues)) {
      const rest = clues.filter((c) => c !== clue);
      if (isUnique(rest)) clues = rest;
    }
    if (clues.length < 8 || clues.length > 12) return null;
    if (fourCategories && clues.length < 11) return null;
    if (new Set(clues.map((c) => c.type)).size < 5) return null;
    if (clues.filter((c) => c.type === 'at').length > 2) return null;
    const askCat = rng.int(0, categories.length - 1);
    let ofCat = rng.int(0, categories.length - 1);
    if (ofCat === askCat) ofCat = (ofCat + 1) % categories.length;
    const instance = { seats, categories, clues: rng.shuffle(clues), ask: { cat: askCat, of: [ofCat, rng.int(0, seats - 1)] } };
    return instance;
  });
}

function renderLogicGrid(instance) {
  const { categories, clues, ask, seats } = instance;
  const ref = ([cat, value]) => {
    const v = categories[cat].values[value];
    if (cat === 0) return v;
    if (cat === 1) return `the ${v} drinker`;
    return cat === 2 ? `the ${v} owner` : `the ${v} fan`;
  };
  const text = (clue) => {
    const a = ref(clue.a);
    const b = clue.b ? ref(clue.b) : '';
    switch (clue.type) {
      case 'same': return `${cap(a)} and ${b} are the same person.`;
      case 'notsame': return `${cap(a)} and ${b} are different people.`;
      case 'at': return `${cap(a)} sits in seat ${clue.seat + 1}.`;
      case 'notat': return `${cap(a)} does not sit in seat ${clue.seat + 1}.`;
      case 'left': return `${cap(a)} sits directly to the left of ${b} (in the next lower seat number).`;
      case 'next': return `${cap(a)} sits right next to ${b}.`;
      case 'before': return `${cap(a)} sits somewhere to the left of ${b}, not necessarily right next to ${b}.`;
      case 'gap': return `Exactly one seat lies between ${a} and ${b}.`;
      case 'either': return `${cap(a)} is either ${b} or ${ref(clue.c)}.`;
      case 'between': return `${cap(a)} sits somewhere between ${b} and ${ref(clue.c)}, in either order and not necessarily right next to them.`;
      default: throw new Error(clue.type);
    }
  };
  const target = ref(ask.of);
  const questions = [
    `Who is ${target}?`,
    `What does ${target} drink?`,
    `Which pet does ${target} keep?`,
    `Which hobby does ${target} have?`,
  ];
  const formats = ['the first name of that person', 'the one word naming that drink', 'the one word naming that pet', 'the one word naming that hobby'];
  const parts = [
    `a different first name (${list(categories[0].values)})`,
    `drinks a different drink (${list(categories[1].values)})`,
    `keeps a different pet (${list(categories[2].values)})`,
    ...(categories[3] ? [`has a different hobby (${list(categories[3].values)})`] : []),
  ];
  const traits = `Each person has ${list(parts)}.`;
  return [
    `${cap(WORDS[seats])} people sit in a row of seats numbered 1 to ${seats} from left to right. ${traits} Every ${categories[3] ? 'name, drink, pet and hobby' : 'name, drink and pet'} is used by exactly one person.`,
    '',
    'Clues:',
    ...clues.map((clue, i) => `${i + 1}. ${text(clue)}`),
    '',
    `${questions[ask.cat]}`,
    `Answer format: ${formats[ask.cat]}, spelled as in the text above.`,
  ].join('\n');
}

// ---- family: knights and knaves ----------------------------------------------

function randomStatement(rng, by, n) {
  const others = [...Array(n).keys()].filter((i) => i !== by);
  const kind = () => rng.pick(['knight', 'knave']);
  const type = rng.pick(['is', 'is', 'same', 'diff', 'any', 'all', 'count', 'count']);
  switch (type) {
    case 'is': return { type, x: rng.pick(others), kind: kind() };
    case 'same':
    case 'diff': {
      const [x, y] = rng.sample(others, 2);
      return { type, x, y };
    }
    case 'any':
    case 'all':
      return { type, set: rng.sample(others, rng.int(2, 3)).sort((p, q) => p - q), kind: kind() };
    default: {
      const everyone = rng.next() < 0.5;
      const set = everyone ? [...Array(n).keys()] : rng.sample(others, 3).sort((p, q) => p - q);
      const op = rng.pick(['exactly', 'atleast', 'atmost']);
      const s = set.length;
      const k = op === 'exactly' ? rng.int(1, s - 1) : op === 'atleast' ? rng.int(2, s - 1) : rng.int(1, s - 2);
      return { type, set, kind: kind(), op, k };
    }
  }
}

function knights(rng, n) {
  const size = [6, 6, 7, 7][(n - 1) % 4];
  return rng.attempt(() => {
    const people = rng.sample(NAMES, size);
    const statements = people.map((_, i) => randomStatement(rng, i, size));
    if (new Set(statements.map((s) => s.type)).size < 4) return null;
    if (statements.filter((s) => s.type === 'is').length > 1) return null;
    if (statements.filter((s) => s.type === 'count').length < 2) return null;
    const found = knightAssignments({ people, statements });
    if (found.length !== 1) return null;
    const knightCount = found[0].filter(Boolean).length;
    if (knightCount < 2 || knightCount > size - 2) return null;
    // Red herrings: many assignments must fail on exactly one statement, so a
    // reader cannot settle the case by checking a couple of statements.
    let nearMisses = 0;
    for (let mask = 0; mask < 1 << size; mask += 1) {
      const assign = people.map((_, i) => Boolean(mask & (1 << i)));
      if (statements.filter((st, i) => statementTruth(st, assign) !== assign[i]).length === 1) nearMisses += 1;
    }
    if (nearMisses < size) return null;
    return { people, statements };
  });
}

function renderKnights(instance) {
  const { people, statements } = instance;
  const n = people.length;
  const names = (set) => list(set.map((i) => people[i]));
  const plural = (kind) => (kind === 'knight' ? 'knights' : 'knaves');
  const text = (s) => {
    switch (s.type) {
      case 'is': return `${people[s.x]} is a ${s.kind}.`;
      case 'same': return `${people[s.x]} and ${people[s.y]} are the same type.`;
      case 'diff': return `${people[s.x]} and ${people[s.y]} are of different types.`;
      case 'any': return `At least one of ${orList(s.set.map((i) => people[i]))} is a ${s.kind}.`;
      case 'all': return `${names(s.set)} are all ${plural(s.kind)}.`;
      default: {
        const scope = s.set.length === n ? `Among the ${WORDS[n]} of us` : `Among ${names(s.set)}`;
        const op = { exactly: 'exactly', atleast: 'at least', atmost: 'at most' }[s.op];
        const tail = s.k === 1 ? `one is a ${s.kind}` : `${WORDS[s.k]} are ${plural(s.kind)}`;
        return `${scope}, ${op} ${tail}.`;
      }
    }
  };
  return [
    `On an island, every inhabitant is either a knight, who always tells the truth, or a knave, who always lies. ${cap(WORDS[n])} islanders meet: ${list(people)}. Each of them makes exactly one statement:`,
    '',
    ...people.map((person, i) => `${person}: "${text(statements[i])}"`),
    '',
    'Exactly one assignment of knight or knave to the islanders fits all these statements. Find it.',
    `Answer format: one word of ${n} capital letters, one letter per islander in the order ${list(people)} is listed above, K for a knight and N for a knave, with no spaces or other characters.`,
  ].join('\n');
}

// ---- family: network (minimum cable network, shortest restricted route) ------

function randomGraph(rng, n, m) {
  const nodes = rng.sample(TOWNS, n).sort();
  const order = rng.shuffle([...Array(n).keys()]);
  const pairs = new Map();
  const add = (u, v) => {
    const key = u < v ? `${u}-${v}` : `${v}-${u}`;
    if (u === v || pairs.has(key)) return false;
    pairs.set(key, [Math.min(u, v), Math.max(u, v), rng.int(3, 40)]);
    return true;
  };
  for (let i = 1; i < n; i += 1) add(order[i], order[rng.int(0, i - 1)]);
  while (pairs.size < m) add(rng.int(0, n - 1), rng.int(0, n - 1));
  const edges = [...pairs.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return { nodes, edges };
}

function network(rng, n) {
  const variant = ['mst', 'mst-forced', 'mst-prebuilt', 'route-via', 'route-avoid'][(n - 1) % 5];
  return rng.attempt(() => {
    if (variant.startsWith('mst')) {
      const { nodes, edges } = randomGraph(rng, 11, 19);
      const base = { kind: 'mst', variant, nodes, edges };
      const plain = fastMst(base);
      if (variant === 'mst') return base;
      // Edges of a cheapest plain network: dropping those from the choice keeps the case honest.
      const indexes = edges.map((_, i) => i);
      const chosen = rng.sample(indexes, variant === 'mst-forced' ? 2 : 3);
      const inst = variant === 'mst-forced' ? { ...base, forced: chosen.sort((a, b) => a - b) } : { ...base, prebuilt: chosen.sort((a, b) => a - b) };
      try {
        solveMst(inst);
      } catch {
        return null; // required links form a cycle
      }
      const answer = fastMst(inst);
      if (variant === 'mst-forced') {
        const cheapest = edges.filter((_, i) => chosen.includes(i)).reduce((s, e) => s + e[2], 0);
        if (answer <= plain + 8 || cheapest < 40) return null;
      } else if (answer > plain - 12) return null;
      return inst;
    }
    const { nodes, edges } = randomGraph(rng, 12, 21);
    const [from, to, via] = rng.sample([...Array(12).keys()], 3);
    const base = { kind: 'route', variant, nodes, edges, from, to, via };
    if (variant === 'route-via') {
      const exact = solveRoute(base).answers[0];
      return exact > twoLegWalk(base) + 1 ? base : null;
    }
    const avoid = rng.sample([...Array(12).keys()].filter((i) => ![from, to, via].includes(i)), 2);
    const inst = { ...base, avoid: avoid.sort((a, b) => a - b) };
    let answer;
    try {
      answer = solveRoute(inst).answers[0];
    } catch {
      return null;
    }
    return answer > solveRoute(base).answers[0] + 3 && answer > twoLegWalk(inst) + 1 ? inst : null;
  });
}

function renderNetwork(instance) {
  const { nodes, edges } = instance;
  const link = ([u, v, w]) => `${nodes[u]} to ${nodes[v]}: ${w}`;
  if (instance.kind === 'mst') {
    const lines = [
      `A region has ${WORDS[nodes.length]} towns: ${list(nodes)}. A network of cables is to be built so that every town can reach every other town, directly or through other towns. These are all the links that can be built, with their cost in thousands of dollars (a link works in both directions):`,
      '',
      edges.map(link).join('; ') + '.',
      '',
    ];
    if (instance.forced) {
      lines.push(`The council has already decided that these links will be built, and their costs count: ${list(instance.forced.map((i) => `${nodes[edges[i][0]]} to ${nodes[edges[i][1]]}`))}.`);
    }
    if (instance.prebuilt) {
      lines.push(`These links already exist and cost nothing more: ${list(instance.prebuilt.map((i) => `${nodes[edges[i][0]]} to ${nodes[edges[i][1]]}`))}. The links that do not exist yet must be paid for at the price listed.`);
    }
    lines.push('What is the smallest total cost, in thousands of dollars, of the links that still have to be paid for so that all the towns are connected?');
    lines.push('Answer format: a whole number, with no units.');
    return lines.join('\n');
  }
  const lines = [
    `${cap(WORDS[nodes.length])} villages are joined by roads: ${list(nodes)}. These are all the roads, with their length in kilometres (every road can be driven in both directions):`,
    '',
    edges.map(link).join('; ') + '.',
    '',
    `A courier must drive from ${nodes[instance.from]} to ${nodes[instance.to]}. The route must pass through ${nodes[instance.via]}, and it must not enter any village more than once.`,
  ];
  if (instance.avoid) lines.push(`${list(instance.avoid.map((i) => nodes[i]))} are flooded, so the courier cannot enter them.`);
  lines.push('What is the smallest possible total length, in kilometres, of such a route?');
  lines.push('Answer format: a whole number, with no units.');
  return lines.join('\n');
}

// ---- family: schedule (two workers, precedence, minimum finishing time) ------

function schedule(rng) {
  const size = 9;
  return rng.attempt(() => {
    const hoursList = [...Array(size)].map(() => rng.int(2, 9));
    const needsList = hoursList.map((_, i) => {
      if (i === 0) return [];
      const count = rng.pick([0, 1, 1, 1, 2, 2]);
      return rng.sample([...Array(i).keys()], Math.min(count, i)).sort((a, b) => a - b);
    });
    const edgeCount = needsList.reduce((s, l) => s + l.length, 0);
    if (edgeCount < 8 || edgeCount > 12) return null;
    if (needsList.filter((l) => l.length === 0).length < 2) return null;
    const position = rng.shuffle([...Array(size).keys()]);
    const tasks = [];
    hoursList.forEach((hours, i) => {
      tasks[position[i]] = { name: String.fromCharCode(65 + position[i]), hours, needs: needsList[i].map((p) => position[p]).sort((a, b) => a - b) };
    });
    const instance = { machines: 2, tasks };
    const total = hoursList.reduce((s, h) => s + h, 0);
    const bound = Math.max(Math.ceil(total / 2), criticalPath(instance));
    return scheduleSearch(instance) > bound ? instance : null;
  });
}

function renderSchedule(instance) {
  const { tasks } = instance;
  return [
    `A workshop has ${WORDS[instance.machines]} identical workers and ${WORDS[tasks.length]} jobs, A to ${tasks.at(-1).name}. Each job is done by one worker without a break, and a worker does one job at a time. A job can start only when every job it needs is finished. A worker may wait. All workers start at hour 0.`,
    '',
    ...tasks.map((t) => `Job ${t.name}: ${t.hours} hours; needs ${t.needs.length ? list(t.needs.map((p) => tasks[p].name)) : 'nothing'}.`),
    '',
    'What is the smallest number of hours, counted from hour 0, after which all the jobs can be finished?',
    'Answer format: a whole number, with no units.',
  ].join('\n');
}

// ---- family: counting (lattice paths, seating arrangements) ------------------

function counting(rng, n) {
  const variant = ['lattice-via', 'lattice-run', 'lattice-both', 'arrangement', 'arrangement'][(n - 1) % 5];
  if (variant.startsWith('lattice')) {
    return rng.attempt(() => {
      const width = rng.int(6, 8);
      const height = rng.int(5, 7);
      const cells = [];
      for (let x = 0; x <= width; x += 1) for (let y = 0; y <= height; y += 1) if (!(x === 0 && y === 0) && !(x === width && y === height)) cells.push([x, y]);
      const picked = rng.sample(cells, 6);
      const blocked = picked.slice(0, rng.int(4, 5)).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const via = variant === 'lattice-run' ? null : picked[5];
      if (via && blocked.some((b) => b[0] === via[0] && b[1] === via[1])) return null;
      const maxRun = variant === 'lattice-via' ? null : variant === 'lattice-run' ? 2 : 3;
      const instance = { kind: 'lattice', variant, width, height, blocked, via, maxRun };
      const count = solveLattice(instance).answers[0];
      return count >= 40 && count <= 4000 && solveLattice({ ...instance, via: null, maxRun: null, blocked: [] }).answers[0] > 4 * count ? instance : null;
    });
  }
  return rng.attempt(() => {
    const people = rng.sample(NAMES, 8);
    const x = () => rng.int(0, 7);
    const rules = [];
    const seen = new Set();
    while (rules.length < 6) {
      const t = rng.pick(['notEnd', 'adjacent', 'notAdjacent', 'left', 'seat', 'notSeat', 'between', 'apart']);
      let rule;
      if (t === 'notEnd') rule = { t, x: x() };
      else if (t === 'seat') rule = { t, x: x(), seats: rng.sample([1, 2, 3, 4, 5, 6, 7, 8], 2).sort((a, b) => a - b) };
      else if (t === 'notSeat') rule = { t, x: x(), seats: rng.sample([1, 2, 3, 4, 5, 6, 7, 8], 3).sort((a, b) => a - b) };
      else if (t === 'between') {
        const [a, b, c] = rng.sample([...Array(8).keys()], 3);
        rule = { t, x: a, y: Math.min(b, c), z: Math.max(b, c) };
      } else {
        const [a, b] = rng.sample([...Array(8).keys()], 2);
        const symmetric = t === 'adjacent' || t === 'notAdjacent' || t === 'apart';
        rule = { t, x: symmetric ? Math.min(a, b) : a, y: symmetric ? Math.max(a, b) : b };
      }
      const key = JSON.stringify(rule);
      if (!seen.has(key)) {
        seen.add(key);
        rules.push(rule);
      }
    }
    const instance = { kind: 'arrangement', variant: 'arrangement', people, rules };
    const count = solveArrangement(instance).answers[0];
    if (count < 60 || count > 2500) return null;
    // Every rule must matter: dropping any one rule changes the count.
    const cuts = rules.filter((_, drop) => solveArrangement({ ...instance, rules: rules.filter((__, k) => k !== drop) }).answers[0] === count);
    return cuts.length === 0 ? instance : null;
  }, 400);
}

function renderCounting(instance) {
  if (instance.kind === 'lattice') {
    const { width, height, blocked, via, maxRun } = instance;
    const point = ([x, y]) => `(${x}, ${y})`;
    const lines = [
      `A robot moves on a grid of intersections (x, y), where x is a whole number from 0 to ${width} and y is a whole number from 0 to ${height}. It starts at (0, 0) and must reach (${width}, ${height}). Every move goes one step east (x increases by 1) or one step north (y increases by 1); it never moves west or south.`,
      '',
      `The intersections ${list(blocked.map(point))} are closed: the robot cannot enter them.`,
    ];
    if (via) lines.push(`The path must pass through the intersection ${point(via)}.`);
    if (maxRun) lines.push(`The robot never makes more than ${WORDS[maxRun]} moves in the same direction in a row (so a run of ${WORDS[maxRun + 1]} east moves, or ${WORDS[maxRun + 1]} north moves, is not allowed).`);
    lines.push('', 'Two paths are different if they visit different intersections or the same ones in a different order. How many different paths are possible?', 'Answer format: a whole number.');
    return lines.join('\n');
  }
  const { people, rules } = instance;
  const p = (i) => people[i];
  const text = (r) => {
    switch (r.t) {
      case 'notEnd': return `${p(r.x)} does not sit in seat 1 or in seat 8.`;
      case 'adjacent': return `${p(r.x)} and ${p(r.y)} sit in neighbouring seats.`;
      case 'notAdjacent': return `${p(r.x)} and ${p(r.y)} do not sit in neighbouring seats.`;
      case 'left': return `${p(r.x)} sits somewhere to the left of ${p(r.y)}, not necessarily right next to ${p(r.y)}.`;
      case 'seat': return `${p(r.x)} sits in seat ${r.seats[0]} or in seat ${r.seats[1]}.`;
      case 'notSeat': return `${p(r.x)} does not sit in ${orList(r.seats.map((s) => `seat ${s}`))}.`;
      case 'between': return `${p(r.x)} sits somewhere between ${p(r.y)} and ${p(r.z)}, in either order and not necessarily right next to them.`;
      case 'apart': return `At least two seats lie between ${p(r.x)} and ${p(r.y)}.`;
      default: throw new Error(r.t);
    }
  };
  return [
    `Eight friends, ${list(people)}, sit in a row of eight seats numbered 1 to 8 from left to right, one friend per seat. These rules hold:`,
    '',
    ...rules.map((r, i) => `${i + 1}. ${text(r)}`),
    '',
    'Two seatings are different if at least one friend sits in a different seat. How many different seatings follow all the rules?',
    'Answer format: a whole number.',
  ].join('\n');
}

// ---- family: congruence -------------------------------------------------------

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a / gcd(a, b)) * b;

function congruence(rng, n) {
  const variant = ['smallest', 'nth', 'count', 'smallest'][(n - 1) % 4];
  const k = n === 4 ? 6 : 5;
  const things = ['crates', 'tiles', 'coins', 'bottles', 'beads', 'tickets'];
  return rng.attempt(() => {
    const mods = rng.sample([4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 24, 25, 28, 30, 35, 36, 40, 42, 45, 48], k);
    if (mods.some((a) => mods.some((b) => a !== b && b % a === 0))) return null;
    const L = mods.reduce(lcm, 1);
    if (L < 4000 || L > 60000) return null;
    let sharing = 0;
    for (let i = 0; i < k; i += 1) for (let j = i + 1; j < k; j += 1) if (gcd(mods[i], mods[j]) > 1) sharing += 1;
    if (sharing < 4) return null;
    const x0 = rng.int(Math.floor(L / 3), L - 1);
    const styles = ['rem', 'short', 'over'];
    const congruences = mods.map((mod, i) => ({ mod, rem: x0 % mod, style: styles[(i + n) % 3] }));
    if (congruences.some((c) => c.rem === 0)) return null;
    const thing = things[(n + rng.int(0, 5)) % things.length];
    if (variant === 'smallest') return { kind: 'smallest', variant, thing, congruences };
    if (variant === 'nth') return { kind: 'nth', variant, thing, congruences, above: rng.int(2, 9) * 1000, nth: rng.int(3, 5) };
    const p = rng.pick([7, 11, 13]);
    if (L % p === 0) return null;
    const low = rng.int(1, 5) * 1000;
    return { kind: 'count', variant, thing, congruences, low, high: low + rng.int(24, 40) * L, notDivisibleBy: p };
  });
}

function renderCongruence(instance) {
  const { thing, congruences } = instance;
  const fact = (c) => {
    if (c.style === 'rem') return `When it is counted in groups of ${c.mod}, ${c.rem} ${c.rem === 1 ? thing.slice(0, -1) : thing} are left over.`;
    if (c.style === 'short') return `When it is counted in groups of ${c.mod}, the last group is ${c.mod - c.rem} short of a full group.`;
    return `The number is exactly ${c.rem} more than a multiple of ${c.mod}.`;
  };
  const lines = [
    `A depot keeps a positive whole number of ${thing} in storage. The ${thing} are blue and the depot is open every day. The following facts are all true:`,
    '',
    ...congruences.map((c, i) => `${i + 1}. ${fact(c)}`),
    '',
  ];
  if (instance.kind === 'smallest') {
    lines.push(`What is the smallest possible number of ${thing}?`);
  } else if (instance.kind === 'nth') {
    lines.push(`Among all numbers of ${thing} greater than ${instance.above} that fit these facts, what is the ${ORDINALS[instance.nth]} smallest?`);
  } else {
    lines.push(`How many whole numbers from ${instance.low} to ${instance.high}, both included, fit all of these facts and are also not divisible by ${instance.notDivisibleBy}?`);
  }
  lines.push('Answer format: a whole number.');
  return lines.join('\n');
}

// ---- family: calendar ----------------------------------------------------------

function calendar(rng, n) {
  const variant = ['finish', 'finish', 'count'][(n - 1) % 3];
  const inventory = n !== 2;
  return rng.attempt(() => {
    const startTime = Date.UTC(rng.int(2027, 2029), rng.int(0, 11), rng.int(1, 28));
    const from = toIso(startTime);
    const spanDays = variant === 'finish' ? rng.int(150, 230) : rng.int(170, 260);
    const endIso = toIso(startTime + spanDays * DAY);
    const holidayCount = rng.int(7, 9);
    const dates = new Set();
    while (dates.size < holidayCount) dates.add(toIso(startTime + rng.int(5, spanDays - 5) * DAY));
    const holidays = [...dates].sort();
    const weekendOnes = holidays.filter((h) => [0, 6].includes(isoWeekday(h)));
    if (weekendOnes.length < 2) return null;
    const observed = observedHolidays(holidays);
    if (new Set(observed).size !== observed.length) return null;
    const shutStart = startTime + rng.int(30, spanDays - 40) * DAY;
    const shutdown = [toIso(shutStart), toIso(shutStart + rng.int(6, 11) * DAY)];
    const base = { variant, from, holidays, shutdown, inventory };
    if (variant === 'count') return { kind: 'count', ...base, to: endIso };
    return { kind: 'finish', ...base, need: rng.int(95, 140) };
  });
}

function renderCalendar(instance) {
  const { from, holidays, shutdown, inventory } = instance;
  const lines = [];
  if (instance.kind === 'finish') {
    lines.push(`A project team starts work on ${WEEKDAYS[isoWeekday(from)]} ${dateText(from)}. The project needs ${instance.need} working days of work, one day of work per working day. The start date counts as a working day if it meets the rules below.`);
  } else {
    lines.push(`A company wants to know how many working days there are from ${WEEKDAYS[isoWeekday(from)]} ${dateText(from)} to ${dateText(instance.to)}, both days included.`);
  }
  lines.push(
    '',
    'Rules (use the real Gregorian calendar):',
    '1. Saturdays and Sundays are not working days.',
    `2. The company holidays are: ${list(holidays.map(dateText))}. A holiday is a day off on the date listed, except that a holiday falling on a Saturday is taken on the Friday before it, and a holiday falling on a Sunday is taken on the Monday after it.`,
    `3. The company is closed for a shutdown from ${dateText(shutdown[0])} to ${dateText(shutdown[1])}, both days included.`,
  );
  if (inventory) {
    lines.push('4. After rules 1 to 3 have decided which days are working days, the last such working day of each calendar month is an inventory day: no project work is done and it does not count.');
  }
  lines.push('');
  if (instance.kind === 'finish') {
    lines.push('On which date is the last day of work of the project?', 'Answer format: the date as YYYY-MM-DD.');
  } else {
    lines.push(`How many working days are there in that period${inventory ? ' (inventory days do not count)' : ''}?`, 'Answer format: a whole number.');
  }
  return lines.join('\n');
}

// ---- the suite ---------------------------------------------------------------

export const FAMILIES = {
  'logic-grid': { count: 5, build: logicGrid, render: renderLogicGrid },
  knights: { count: 4, build: knights, render: renderKnights },
  network: { count: 5, build: network, render: renderNetwork },
  schedule: { count: 4, build: schedule, render: renderSchedule },
  counting: { count: 5, build: counting, render: renderCounting },
  congruence: { count: 4, build: congruence, render: renderCongruence },
  calendar: { count: 3, build: calendar, render: renderCalendar },
};

export function generate() {
  const cases = [];
  for (const [family, { count, build, render }] of Object.entries(FAMILIES)) {
    for (let n = 1; n <= count; n += 1) {
      const instance = build(makeRng(family, n), n);
      const testCase = {
        case_id: `reasoning-hard-${family}-${n}`,
        input: { question: render(instance) },
        expected: null,
        tags: [family, 'hard'],
        metadata: { family, seed: SEED, instance },
      };
      const solved = solveCase(testCase);
      if (solved.answers.length !== 1) throw new Error(`${testCase.case_id}: ${solved.answers.length} answers`);
      if ('solutions' in solved && solved.solutions !== 1) throw new Error(`${testCase.case_id}: ${solved.solutions} solutions`);
      testCase.expected = solved.answers[0];
      cases.push(testCase);
    }
  }
  return cases;
}

export const lines = () => generate().map((item) => JSON.stringify(item));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(lines().join('\n') + '\n');
}

// Re-exported for tests that rebuild the text of one stored instance.
export const RENDER = Object.fromEntries(Object.entries(FAMILIES).map(([name, family]) => [name, family.render]));
