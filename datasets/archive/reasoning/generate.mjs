// Seeded generator for the reasoning cases whose case_id starts with
// "reasoning-" and ends with "-<n>" (every template below). Each template builds
// its numbers, writes the question, and computes the expected answer in code, so
// no answer is typed by hand. The seed is fixed: the output never changes unless
// this file changes. Run `node datasets/archive/reasoning/generate.mjs` to print the JSONL
// lines that sit in cases.jsonl after the hand-written cases.
//
// Rules for a template: every answer is exact (an integer, or a decimal that is
// exact in base 10), the question names every assumption, and the template draws
// numbers only from its own random stream, seeded by SEED + template name + n.
// Adding a template never changes the numbers of another one.

import { fileURLToPath } from 'node:url';

export const SEED = 20261105;
export const PER_TEMPLATE = 2;

// ---- random numbers -------------------------------------------------------

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
  // Draws until `ok` accepts; fails loudly instead of looping forever.
  const until = (draw, ok, limit = 5000) => {
    for (let i = 0; i < limit; i += 1) {
      const value = draw();
      if (ok(value)) return value;
    }
    throw new Error(`template ${name} #${n}: no acceptable numbers in ${limit} draws`);
  };
  return { next, int, pick, until };
}

// ---- helpers --------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86400000;

const utc = (year, month, day) => Date.UTC(year, month - 1, day);
const dateText = ({ year, month, day }) => `${day} ${MONTHS[month - 1]} ${year}`;
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (year, month) => [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
const gcd = (a, b) => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const lcm = (a, b) => (a / gcd(a, b)) * b;
const money = (cents) => cents / 100;

function randomDate(rng, y1, y2) {
  const year = rng.int(y1, y2);
  const month = rng.int(1, 12);
  return { year, month, day: rng.int(1, daysIn(year, month)) };
}

function modPow(base, exp, mod) {
  let result = 1n;
  let b = BigInt(base) % mod;
  let e = BigInt(exp);
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

// ---- templates ------------------------------------------------------------
// Each returns { question, expected, tags }.

const TEMPLATES = {
  // Days between two dates that span at least one leap day.
  'date-span'(rng) {
    const from = randomDate(rng, 2017, 2023);
    const to = randomDate(rng, 2026, 2031);
    const expected = Math.round((utc(to.year, to.month, to.day) - utc(from.year, from.month, from.day)) / DAY_MS);
    return {
      question: `How many days are there from ${dateText(from)} to ${dateText(to)}? Count each day after the first date up to and including the second date, so the number of days from 1 March to 2 March is 1. Use the Gregorian calendar.`,
      expected,
      tags: ['dates', 'leap-years'],
    };
  },

  // Weekday of a later date, given the weekday of an earlier one.
  'weekday-between'(rng) {
    const from = randomDate(rng, 2019, 2023);
    const to = randomDate(rng, 2025, 2032);
    const weekday = (d) => new Date(utc(d.year, d.month, d.day)).getUTCDay();
    return {
      question: `${dateText(from)} was a ${WEEKDAYS[weekday(from)]}. What day of the week is ${dateText(to)}? Use the Gregorian calendar. Answer with the name of the day.`,
      expected: WEEKDAYS[weekday(to)],
      tags: ['dates', 'leap-years'],
    };
  },

  // Leap days over a span that holds a century year that is not a leap year.
  'leap-count'(rng) {
    const y1 = rng.int(1870, 1899);
    const y2 = rng.int(2100, 2130);
    let expected = 0;
    for (let y = y1; y <= y2; y += 1) if (isLeap(y)) expected += 1;
    return {
      question: `In the Gregorian calendar, how many 29 February dates occur from 1 January ${y1} to 31 December ${y2}, both days included?`,
      expected,
      tags: ['dates', 'leap-years', 'counting'],
    };
  },

  // A tank with a pump, a leak, and a second pump that starts late.
  'pump-leak'(rng) {
    const { a, c, b, h0, T, s } = rng.until(
      () => ({ a: rng.int(20, 60), c: rng.int(5, 19), b: rng.int(10, 40), h0: rng.int(5, 20), T: rng.int(30, 90), s: rng.int(10, 20) * 10 }),
      (p) => p.a > p.c && p.T > p.h0 + 5,
    );
    const cap = s + (a - c) * h0 + (a + b - c) * (T - h0);
    return {
      question: `A reservoir holds ${s} litres at time 0 and has a capacity of ${cap} litres. From time 0, pump A adds ${a} litres per minute, and a leak removes ${c} litres per minute for as long as the reservoir is not empty. Pump B adds ${b} litres per minute and is switched on ${h0} minutes after time 0. After how many minutes from time 0 is the reservoir exactly full?`,
      expected: T,
      tags: ['rates', 'multi-step'],
    };
  },

  // Part of a solution is drained and replaced with water, twice.
  'mixture-replace'(rng) {
    const { V, r1, r2, p } = rng.until(
      () => {
        const V = rng.pick([20, 40, 60, 80, 100, 120]);
        return { V, r1: rng.pick([V / 4, V / 2, V / 5, (V * 3) / 4].filter(Number.isInteger)), r2: rng.pick([V / 4, V / 2, V / 5].filter(Number.isInteger)), p: rng.int(20, 96) };
      },
      (x) => (x.p * (x.V - x.r1) * (x.V - x.r2)) % (x.V * x.V) === 0,
    );
    return {
      question: `A tank holds ${V} litres of a solution that is ${p} percent acid by volume. ${r1} litres of the solution are drained and replaced with ${r1} litres of pure water, and the tank is stirred well. Then ${r2} litres of the new mixture are drained and replaced with ${r2} litres of pure water, and the tank is stirred well again. What percent acid is the final mixture?`,
      expected: (p * (V - r1) * (V - r2)) / (V * V),
      tags: ['mixtures', 'percent', 'multi-step'],
    };
  },

  // Committee with a minimum number of seniors and two members who refuse to serve together.
  'committee'(rng) {
    const { seniors, juniors, k, j } = rng.until(
      () => ({ seniors: rng.int(4, 7), juniors: rng.int(3, 6), k: rng.int(4, 5), j: rng.int(2, 3) }),
      (x) => x.j < x.k,
    );
    const total = seniors + juniors;
    let expected = 0;
    for (let mask = 0; mask < 1 << total; mask += 1) {
      let size = 0;
      let senior = 0;
      for (let i = 0; i < total; i += 1) {
        if (mask & (1 << i)) {
          size += 1;
          if (i < seniors) senior += 1;
        }
      }
      const both = mask & 1 && mask & 2;
      if (size === k && senior >= j && !both) expected += 1;
    }
    return {
      question: `A club has ${seniors + juniors} members: ${seniors} seniors, including Ana and Ben, and ${juniors} juniors. A committee of exactly ${k} members is chosen. It must contain at least ${j} seniors, and Ana and Ben refuse to serve on the committee together (either one alone is fine). How many different committees are possible?`,
      expected,
      tags: ['combinatorics', 'constraints'],
    };
  },

  // Three-digit numbers with distinct digits, a divisor, and a banned digit.
  'digit-count'(rng) {
    const d = rng.pick([3, 4, 6, 8, 9]);
    const banned = rng.int(1, 9);
    let expected = 0;
    for (let n = 100; n <= 999; n += 1) {
      const digits = String(n).split('').map(Number);
      if (new Set(digits).size === 3 && n % d === 0 && !digits.includes(banned)) expected += 1;
    }
    return {
      question: `How many three-digit whole numbers (from 100 to 999) have three different digits, are divisible by ${d}, and do not contain the digit ${banned} anywhere?`,
      expected,
      tags: ['combinatorics', 'counting', 'constraints'],
    };
  },

  // A chain of unit conversions with exact factors.
  'unit-chain'(rng, n) {
    if (n % 2 === 1) {
      const { feet, inches, piece } = rng.until(
        () => ({ feet: rng.int(20, 90), inches: rng.int(1, 11), piece: rng.int(17, 49) }),
        () => true,
      );
      // length in hundredths of a centimetre: inches * 254
      const hundredths = (feet * 12 + inches) * 254;
      return {
        question: `A rope is ${feet} feet ${inches} inches long. 1 foot is exactly 12 inches and 1 inch is exactly 2.54 centimetres. The rope is cut into pieces that are each ${piece} centimetres long, and a leftover piece shorter than ${piece} centimetres is thrown away. How many pieces of ${piece} centimetres are cut?`,
        expected: Math.floor(hundredths / (piece * 100)),
        tags: ['units', 'multi-step'],
      };
    }
    const { v, m, s } = rng.until(
      () => ({ v: rng.int(40, 130), m: rng.int(2, 19), s: rng.int(1, 59) }),
      (x) => (x.v * (60 * x.m + x.s) * 5) % 18 === 0,
    );
    return {
      question: `A train travels at a constant speed of ${v} kilometres per hour. How many metres does it cover in ${m} minutes and ${s} seconds? (1 kilometre is 1000 metres.)`,
      expected: (v * (60 * m + s) * 5) / 18,
      tags: ['units', 'rates'],
    };
  },

  // Remainder of a sum of large powers.
  'mod-power'(rng) {
    const m = rng.pick([7, 9, 11, 13, 17, 19, 23]);
    const a = rng.int(2, 12);
    const c = rng.int(2, 12);
    const b = rng.int(80, 400);
    const d = rng.int(80, 400);
    const expected = Number((modPow(a, b, BigInt(m)) + modPow(c, d, BigInt(m))) % BigInt(m));
    return {
      question: `What is the remainder when ${a}^${b} + ${c}^${d} is divided by ${m}? (Here ${a}^${b} means ${a} multiplied by itself ${b} times.)`,
      expected,
      tags: ['modular', 'arithmetic'],
    };
  },

  // Signals with different periods that flash together.
  'signals-lcm'(rng) {
    const { a, b, c } = rng.until(
      () => ({ a: rng.pick([6, 8, 9, 10, 12, 14, 15, 18, 20]), b: rng.pick([6, 8, 9, 10, 12, 14, 15, 18, 20, 21, 24]), c: rng.pick([10, 12, 15, 16, 18, 21, 24, 25, 28, 30]) }),
      (x) => new Set([x.a, x.b, x.c]).size === 3 && lcm(lcm(x.a, x.b), x.c) <= 400,
    );
    const L = lcm(lcm(a, b), c);
    const hours = rng.int(20, 60);
    return {
      question: `Three lights flash at 08:00 all at the same moment. After that, the first light flashes every ${a} minutes, the second every ${b} minutes and the third every ${c} minutes. Counting the flash at 08:00 as the first, how many times do all three lights flash at the same moment from 08:00 until exactly ${hours} hours later? Both of those two moments are included.`,
      expected: Math.floor((hours * 60) / L) + 1,
      tags: ['modular', 'counting', 'multi-step'],
    };
  },

  // Workers join and leave a job.
  'work-share'(rng) {
    const { u, v, h1, h2, h3 } = rng.until(
      () => ({ u: rng.int(8, 30), v: rng.int(8, 30), h1: rng.int(2, 6), h2: rng.int(2, 7), h3: rng.int(2, 8) }),
      (x) => x.u !== x.v,
    );
    const N = u * h1 + (u + v) * h2 + v * h3;
    return {
      question: `A job needs ${N} tiles to be laid. Ana lays ${u} tiles per hour and Ben lays ${v} tiles per hour, and each works at a constant rate. Ana starts alone. After ${h1} hours Ben joins her. After the two have worked together for ${h2} hours, Ana leaves and Ben finishes the job alone. How many hours pass from the moment Ana starts until the job is finished?`,
      expected: h1 + h2 + h3,
      tags: ['work', 'rates', 'multi-step'],
    };
  },

  // Three price changes in a row.
  'compound-percent'(rng) {
    const steps = rng.until(
      () => ({ P: rng.int(2, 40) * 10, x: rng.pick([10, 15, 20, 25, 30, 40]), y: rng.pick([10, 15, 20, 25, 30, 40]), z: rng.pick([5, 10, 15, 20, 25]) }),
      (s) => (s.P * 100 * (100 + s.x) * (100 - s.y) * (100 - s.z)) % 1000000 === 0,
    );
    const { P, x, y, z } = steps;
    const cents = (P * 100 * (100 + x) * (100 - y) * (100 - z)) / 1000000;
    return {
      question: `A jacket is priced at $${P}. The shop first raises the price by ${x} percent. Then a sale lowers that new price by ${y} percent. Then a coupon lowers the sale price by a further ${z} percent. What is the final price in dollars? Give the exact value.`,
      expected: money(cents),
      tags: ['percent', 'compound', 'multi-step'],
    };
  },

  // A tiered bill plus tax.
  'tiered-bill'(rng) {
    const { t1, t2, r1, r2, r3, fee, use, tax } = rng.until(
      () => {
        const t1 = rng.int(2, 6);
        const t2 = rng.int(3, 8);
        const r1 = rng.int(2, 5);
        return { t1, t2, r1, r2: r1 + rng.int(1, 4), r3: r1 + rng.int(5, 9), fee: rng.int(5, 25), use: t1 + t2 + rng.int(2, 9), tax: rng.pick([10, 20, 25]) };
      },
      () => true,
    );
    const subtotal = fee + t1 * r1 + t2 * r2 + (use - t1 - t2) * r3;
    const cents = (subtotal * 100 * (100 + tax)) / 100;
    return {
      question: `A data plan has a fixed monthly fee of $${fee}. Usage is billed per whole gigabyte: the first ${t1} GB cost $${r1} per GB, the next ${t2} GB cost $${r2} per GB, and every GB after those costs $${r3} per GB. A tax of ${tax} percent is then added to the whole amount (the fee plus the usage charges). A customer uses ${use} GB in a month. What is the total bill in dollars?`,
      expected: money(cents),
      tags: ['percent', 'tiers', 'multi-step'],
    };
  },

  // A trip with two speeds and a rest stop.
  'trip-minutes'(rng) {
    const { v1, v2, D, rest } = rng.until(
      () => ({ v1: rng.pick([12, 15, 18, 20, 24, 30]), v2: rng.pick([8, 10, 16, 25, 36, 40, 45]), D: rng.int(4, 30) * 10, rest: rng.int(2, 9) * 5 }),
      (x) => x.v1 !== x.v2 && (60 * x.D) % x.v1 === 0 && (60 * x.D) % x.v2 === 0,
    );
    return {
      question: `A courier rides ${D} km from town A to town B at a constant ${v1} km/h, rests ${rest} minutes in town B, and then rides back along the same road at a constant ${v2} km/h. How many minutes pass from the moment the courier leaves town A until the courier is back in town A?`,
      expected: (60 * D) / v1 + (60 * D) / v2 + rest,
      tags: ['rates', 'units', 'multi-step'],
    };
  },

  // Means of groups that join and leave.
  'group-average'(rng) {
    const { n, k, x, r, s } = rng.until(
      () => ({ n: rng.int(10, 30), k: rng.int(2, 6), x: rng.int(40, 70), r: rng.int(70, 95), s: rng.int(50, 100) }),
      (q) => (q.k * q.x + (q.n - q.k) * q.r) % q.n === 0 && (q.r * (q.n - q.k) + q.s) % (q.n - q.k + 1) === 0,
    );
    const mean = (k * x + (n - k) * r) / n;
    return {
      question: `A class of ${n} students has a mean test score of ${mean}. ${k} of the students, whose scores have a mean of ${x}, are then removed from the data because they retook the test. One new student with a score of ${s} is added to the remaining students. What is the mean score of the students in the data now?`,
      expected: (r * (n - k) + s) / (n - k + 1),
      tags: ['averages', 'multi-step'],
    };
  },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

export function generate() {
  const cases = [];
  for (const name of TEMPLATE_NAMES) {
    for (let n = 1; n <= PER_TEMPLATE; n += 1) {
      const { question, expected, tags } = TEMPLATES[name](makeRng(name, n), n);
      cases.push({ case_id: `reasoning-${name}-${n}`, input: { question }, expected, tags });
    }
  }
  return cases;
}

export const lines = () => generate().map((item) => JSON.stringify(item));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(lines().join('\n') + '\n');
}
