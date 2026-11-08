// The answer sentence and the best-value marks, by fixed rules. Pure: no DOM, so node:test loads it.
// Words follow the brief: setup, try, passed "9 of 9", typical time, gave no answer.
import { plural, durText } from './words.js';

const MIN_TRIES = 3; // decided tries per setup before a winner can be named
const FASTER = 1.1; // the slower typical time must be 10% or more above the faster one
const ALPHA = 0.05;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// What one setup did, read from its aggregate. An error is a try that did not pass;
// an answer no check decided ("not checked") counts neither way.
export function facts(agg) {
  const a = agg || {};
  const errors = a.errors_n || 0;
  // A failed call scores 0 and counts against the setup. A lost one (quota, sign-in, CLI
  // missing) counts neither way. An aggregate without failed_n counts every error.
  const failed = a.failed_n ?? errors;
  const checked = a.scored_n || 0;
  const passed = a.passed_n || 0;
  const decided = checked + failed;
  return {
    tries: a.n || 0,
    errors,
    failed,
    lost: a.lost_n || 0,
    mismatched: a.model_mismatch_n || 0,
    checked,
    passed,
    unchecked: a.unscored_n || 0,
    // Set by the page from state: answers stored with no score, counted or not.
    unscoredAnswers: 0,
    decided,
    rate: decided ? passed / decided : null,
    time: isNum(a.p50_latency_ms) ? a.p50_latency_ms : null,
    timed: a.latency_n || 0,
    slow: isNum(a.p95_latency_ms) ? a.p95_latency_ms : null,
    price: isNum(a.total_cost_usd) ? a.total_cost_usd : null,
    pricePerPass: isNum(a.cost_per_passed_case) ? a.cost_per_passed_case : null,
    rating: isNum(a.human_mean) ? a.human_mean : null,
    ratings: a.human_n || 0,
  };
}

export const passedText = (f) => `${f.passed} of ${f.decided}`;

// Wilson score interval, 95%: the range shown under Details.
export function wilson(passed, total) {
  if (!total) return null;
  const z = 1.959964;
  const p = passed / total;
  const d = 1 + (z * z) / total;
  const mid = (p + (z * z) / (2 * total)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / d;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

const logFact = (() => {
  const memo = [0];
  return (n) => {
    for (let i = memo.length; i <= n; i += 1) memo[i] = memo[i - 1] + Math.log(i);
    return memo[n];
  };
})();
const logChoose = (n, k) => logFact(n) - logFact(k) - logFact(n - k);

// Two-sided mid-p Fisher exact test on two pass counts. Small tries are the common case,
// and mid-p keeps the exact test from calling every small gap chance.
export function gapP(p1, n1, p2, n2) {
  const k = p1 + p2;
  const N = n1 + n2;
  const lo = Math.max(0, k - n2);
  const hi = Math.min(k, n1);
  const prob = (x) => Math.exp(logChoose(n1, x) + logChoose(n2, k - x) - logChoose(N, k));
  const obs = prob(p1);
  let less = 0;
  let same = 0;
  for (let x = lo; x <= hi; x += 1) {
    const q = prob(x);
    if (q < obs * (1 - 1e-9)) less += q;
    else if (q <= obs * (1 + 1e-9)) same += q;
  }
  return Math.min(1, less + same / 2);
}

// Rank: passed share, then typical time, then the order given.
export function rankSetups(list) {
  return list
    .map((s, i) => ({ s, i }))
    .sort((x, y) => {
      const a = x.s.facts;
      const b = y.s.facts;
      if ((a.rate === null) !== (b.rate === null)) return a.rate === null ? 1 : -1;
      if (a.rate !== b.rate && a.rate !== null) return b.rate - a.rate;
      if ((a.time === null) !== (b.time === null)) return a.time === null ? 1 : -1;
      if (a.time !== b.time && a.time !== null) return a.time - b.time;
      return x.i - y.i;
    })
    .map((x) => x.s);
}

const firm = (setups) => setups.length > 0 && setups.every((s) => s.facts.decided >= MIN_TRIES);

// The faster of a group, only when every member has enough timed tries and the gap is 10% or more.
function fasterOf(group) {
  const timed = group.filter((s) => s.facts.time !== null);
  if (timed.length < 2 || timed.length < group.length || timed.some((s) => s.facts.timed < MIN_TRIES)) return { kind: 'unknown' };
  const sorted = [...timed].sort((a, b) => a.facts.time - b.facts.time);
  const [first, next] = sorted;
  if (next.facts.time < first.facts.time * FASTER) return { kind: 'level', first, next };
  return { kind: 'faster', first, next };
}

// Best-value marks for the table: the most passed, the faster time, the lowest price. A mark says
// "best in this column", as the answer's "passed the most" does, gap or chance. None with too few
// tries: the answer then names no leader, and a mark would.
export function bestMarks(setups) {
  const out = { passed: new Set(), time: new Set(), price: new Set() };
  if (setups.length < 2 || !firm(setups)) return out;
  const rates = setups.map((s) => s.facts.rate);
  const top = Math.max(...rates);
  if (rates.some((r) => r !== top)) setups.filter((s) => s.facts.rate === top).forEach((s) => out.passed.add(s.id));
  const fast = fasterOf(setups);
  if (fast.kind === 'faster') out.time.add(fast.first.id);
  const priced = setups.filter((s) => s.facts.price !== null);
  if (priced.length === setups.length) {
    const low = Math.min(...priced.map((s) => s.facts.price));
    if (priced.some((s) => s.facts.price !== low)) priced.filter((s) => s.facts.price === low).forEach((s) => out.price.add(s.id));
  }
  return out;
}

const listWords = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

function noAnswer(s, withName = true) {
  const f = s.facts;
  const who = withName ? `${s.name} ` : '';
  const why = s.errorReason ? ` (${s.errorReason})` : '';
  return f.tries === 1 ? `${who}gave no answer${why}` : `${who}gave no answer in ${f.errors} of ${f.tries} tries${why}`;
}

function errorSentence(setups) {
  const bad = setups.filter((s) => s.facts.errors > 0);
  if (!bad.length) return null;
  if (bad.length === 1) return `${noAnswer(bad[0])}.`;
  if (bad.length === 2) return `${noAnswer(bad[0])}, and ${noAnswer(bad[1])}.`;
  return `${bad.length} setups gave no answer in some tries: see the Errors column.`;
}

function uncheckedSentence(setups) {
  const n = setups.reduce((sum, s) => sum + s.facts.unchecked, 0);
  if (!n) return null;
  return n === 1 ? '1 answer was not checked, so it counts neither way.' : `${n} answers were not checked, so they count neither way.`;
}

function ratingSentence(setups) {
  const rated = setups.filter((s) => s.facts.ratings > 0);
  if (!rated.length) return 'Rate the answers to compare them.';
  return `Your ratings: ${rated.map((s) => `${s.name} ${s.facts.rating.toFixed(1)} of 5 (${plural(s.facts.ratings, 'rating')})`).join('; ')}.`;
}

function timeText(f) {
  return f.time === null ? '' : f.tries === 1 ? ` in ${durText(f.time)}` : `, ${durText(f.time)} typical`;
}

const both = (n) => (n === 2 ? 'Both' : `All ${n}`);

// The answer: big sentences, smaller sentences, and the facts they rest on.
// setups: [{ id, name, facts, errorReason }] in table order. The words count the tries stored,
// which can be more than the experiment declared when a test was run twice.
export function answer({ setups, cases = 0 }) {
  const say = (kind, sentences, more = []) => ({ kind, sentences, more: more.filter(Boolean), firm: kind === 'gap' || kind === 'noise' || kind === 'level' });
  if (!setups.length) return say('empty', ['No answers yet.']);
  const decided = setups.filter((s) => s.facts.decided > 0);
  if (!decided.length || setups.every((s) => s.facts.checked === 0 && s.facts.errors < s.facts.tries)) {
    if (setups.every((s) => s.facts.tries === 0)) {
      // A run that stopped before scoring holds answers that count nowhere yet. Say how many.
      const stored = setups.reduce((sum, s) => sum + (s.facts.unscoredAnswers || 0), 0);
      if (stored > 0) return say('empty', [`${plural(stored, 'answer')} ${stored === 1 ? 'is' : 'are'} stored with no score, so nothing counts yet.`], [errorSentence(setups)]);
      return say('empty', ['No answers yet.']);
    }
    return say('unchecked', ['Not scored automatically.'], [ratingSentence(setups), errorSentence(setups)]);
  }
  if (setups.length === 1) {
    const s = setups[0];
    const f = s.facts;
    const unit = f.tries > cases ? 'try' : 'case';
    const whole = `${s.name} passed ${f.passed} of ${plural(f.decided, unit, unit === 'try' ? 'tries' : 'cases')}${timeText(f)}.`;
    return say('single', [whole], [errorSentence(setups), uncheckedSentence(setups)]);
  }
  if (!firm(setups)) {
    const all = setups.length;
    // Missing tries ask for a bigger run; missing checks do not, because the tries are already there.
    const short = setups.some((s) => s.facts.tries < MIN_TRIES);
    const clean = setups.filter((s) => s.facts.decided > 0 && s.facts.passed === s.facts.decided).length;
    const what = setups.every((s) => s.facts.tries === 1) ? 'their only try' : setups.some((s) => s.facts.unchecked > 0) ? 'every checked try' : 'every try';
    const tally = clean === all ? `${both(all)} passed ${what}.` : `${clean} of ${all} setups passed ${what}.`;
    return say('few', [short ? 'Too few tries to name a winner.' : 'Too few checked tries to name a winner.'], [tally, errorSentence(setups), uncheckedSentence(setups), short ? `Run ${MIN_TRIES} tries per case to compare.` : null]);
  }
  const ranked = rankSetups(setups);
  const top = ranked[0].facts.rate;
  const leaders = ranked.filter((s) => s.facts.rate === top);
  const rest = ranked.filter((s) => s.facts.rate !== top);
  const texts = [...new Set(leaders.map((s) => passedText(s.facts)))];
  const leaderText = texts.length === 1 ? texts[0] : leaders.map((s) => `${s.name} ${passedText(s.facts)}`).join(', ');
  const extra = [errorSentence(setups), uncheckedSentence(setups)];
  if (!rest.length) {
    // Speed only matters for setups that passed something.
    if (top === 0) return say('level', [setups.length === 2 ? 'Neither setup passed a try.' : `None of the ${setups.length} setups passed a try.`], extra);
    const head = texts.length === 1 ? `${both(leaders.length)} passed ${leaderText}.` : `${both(leaders.length)} passed ${top === 1 ? 'every checked try' : 'the same share'}: ${leaderText}.`;
    const fast = fasterOf(leaders);
    if (fast.kind === 'faster') {
      const word = leaders.length === 2 ? 'faster' : 'fastest';
      const next = leaders.length === 2 ? `against ${durText(fast.next.facts.time)}` : `next was ${fast.next.name} at ${durText(fast.next.facts.time)}`;
      return say('level', [head, `${fast.first.name} was ${word}: ${durText(fast.first.facts.time)} typical, ${next}.`], extra);
    }
    if (fast.kind === 'level') return say('level', [head, 'Their typical times were level too.'], extra);
    return say('level', [head], ['Too few timed tries to compare speed.', ...extra]);
  }
  // A gap is clear only against every other setup: one with few tries can sit below the next one
  // and still be within chance of the leaders.
  const close = rest.filter((x) => leaders.some((s) => gapP(s.facts.passed, s.facts.decided, x.facts.passed, x.facts.decided) >= ALPHA));
  const runner = rest[0];
  const names = listWords(leaders.map((s) => s.name));
  const each = leaders.length > 1 && texts.length === 1 ? ' each' : '';
  // One count for every leader goes after the names; different counts go beside each name.
  const lead = (more) => (texts.length === 1 ? `${names} passed ${more}: ${leaderText}${each}` : `${listWords(leaders.map((s) => `${s.name} (${passedText(s.facts)})`))} passed ${more}`);
  if (!close.length) {
    const against = setups.length === 2 ? `against ${passedText(runner.facts)}` : `against ${passedText(runner.facts)} for ${runner.name}`;
    return say('gap', [`${lead(setups.length === 2 ? 'more' : 'the most')}, ${against}.`], extra);
  }
  if (setups.length === 2) {
    return say('noise', [`${leaders[0].name} passed ${passedText(leaders[0].facts)} and ${runner.name} ${passedText(runner.facts)}, but with this many tries the gap may be chance.`], extra);
  }
  const near = close.length === 1
    ? `${close[0].name}, with ${passedText(close[0].facts)}, is close enough that the gap may be chance.`
    : close.length === 2
      ? `${close[0].name} (${passedText(close[0].facts)}) and ${close[1].name} (${passedText(close[1].facts)}) are close enough that the gaps may be chance.`
      : `${close.length === rest.length ? `The other ${close.length}` : `${close.length} other`} setups are close enough that the gaps may be chance.`;
  return say('noise', [`${lead('the most')}. ${near}`], extra);
}

// Common error types in plain words; anything else keeps its own type.
export function errorWord(type) {
  const t = String(type || '');
  if (!t) return '';
  if (/timeout|timed_out/i.test(t)) return 'time-out';
  if (/limit|quota|rate/i.test(t)) return 'usage limit';
  if (/auth|login|sign|credential/i.test(t)) return 'not signed in';
  if (/not_found|enoent|spawn/i.test(t)) return 'harness not found';
  return t.replace(/^provider\./, '').replace(/[._-]+/g, ' ');
}

// The most common error of a setup's answers, in words.
export function errorReason(observations) {
  const counts = new Map();
  for (const o of observations) {
    if (o.status !== 'error') continue;
    const word = errorWord(o.error && o.error.type);
    if (word) counts.set(word, (counts.get(word) || 0) + 1);
  }
  let best = '';
  let n = 0;
  for (const [word, c] of counts) if (c > n) [best, n] = [word, c];
  return best;
}
