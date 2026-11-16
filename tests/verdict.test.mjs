// The answer sentence and the words on screen: fixed rules, checked against literal sentences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { answer, bestMarks, facts, gapP, rankSetups, wilson, errorWord, errorReason } from '../dashboard/public/js/verdict.js';
import { caseName, caseHint, durText, fairLine, groupTests, shortDate, testMeta, testTitle } from '../dashboard/public/js/words.js';

const agg = (o) => ({ n: 0, scored_n: 0, passed_n: 0, unscored_n: 0, errors_n: 0, latency_n: 0, p50_latency_ms: null, ...o });

test('facts: a failed call counts against the setup; a call lost to limits or sign-in does not', () => {
  const f = facts(agg({ n: 4, scored_n: 2, passed_n: 2, errors_n: 2, failed_n: 1, lost_n: 1 }));
  assert.equal(f.decided, 3);
  assert.equal(f.rate, 2 / 3);
  assert.equal(f.lost, 1);
  assert.equal(f.errors, 2);
});
const setup = (id, name, a, errorReason = '') => ({ id, name, facts: facts(agg(a)), errorReason });
const nine = (passed, p50, extra = {}) => ({ n: 9, scored_n: 9, passed_n: passed, latency_n: 9, p50_latency_ms: p50, ...extra });

test('timeouts show unfinished execution and elapsed time without lowering correctness', () => {
  const partial = setup('h', 'Haiku', { n: 2, scored_n: 1, passed_n: 1, errors_n: 1, failed_n: 0, incomplete_n: 1, incomplete_elapsed_ms: 300000 });
  assert.equal(partial.facts.decided, 1);
  assert.equal(partial.facts.rate, 1);
  assert.equal(partial.facts.incomplete, 1);
  const out = answer({ setups: [partial], cases: 2 });
  assert.deepEqual(out.sentences, ['Haiku passed 1 of 1 case.']);
  assert.deepEqual(out.more, ['Haiku had 1 unfinished try, unjudged after 5.0 min of elapsed execution.']);
  const only = answer({ setups: [setup('h', 'Haiku', { n: 1, errors_n: 1, failed_n: 0, incomplete_n: 1, incomplete_elapsed_ms: 300000 })], cases: 1 });
  assert.deepEqual(only.sentences, ['No completed answer yet.']);
  assert.deepEqual(only.more, ['Haiku had 1 unfinished try, unjudged after 5.0 min of elapsed execution.']);
});

test('equal passes name the faster setup when the times differ by 10% or more', () => {
  const out = answer({ setups: [setup('a', 'Beam', nine(9, 32349)), setup('b', 'Pulse', nine(9, 46000))], cases: 3, repeats: 3 });
  assert.deepEqual(out.sentences, ['Both passed 9 of 9.', 'Beam was faster: 32 s typical, against 46 s.']);
  assert.equal(out.kind, 'level');
  assert.deepEqual(out.more, []);
});

test('equal passes and times within 10% are level', () => {
  const out = answer({ setups: [setup('a', 'Beam', nine(9, 32000)), setup('b', 'Pulse', nine(9, 34000))], cases: 3, repeats: 3 });
  assert.deepEqual(out.sentences, ['Both passed 9 of 9.', 'Their typical times were level too.']);
  assert.equal(bestMarks([setup('a', 'Beam', nine(9, 32000)), setup('b', 'Pulse', nine(9, 34000))]).time.size, 0);
});

test('a clear gap and a gap within chance read differently', () => {
  const clear = answer({ setups: [setup('a', 'Beam', nine(9, 30000)), setup('b', 'Pulse', nine(5, 30000))], cases: 3, repeats: 3 });
  assert.deepEqual(clear.sentences, ['Beam passed more: 9 of 9, against 5 of 9.']);
  const noise = answer({ setups: [setup('a', 'Beam', nine(9, 30000)), setup('b', 'Pulse', nine(7, 30000))], cases: 3, repeats: 3 });
  assert.deepEqual(noise.sentences, ['Beam passed 9 of 9 and Pulse 7 of 9, but with this many tries the gap may be chance.']);
  assert.ok(gapP(9, 9, 5, 9) < 0.05);
  assert.ok(gapP(9, 9, 7, 9) > 0.05);
});

test('errors count as tries that did not pass and add their own sentence', () => {
  const out = answer({ setups: [setup('a', 'Beam', nine(9, 30000)), setup('b', 'Pulse', { n: 9, scored_n: 7, passed_n: 7, errors_n: 2, latency_n: 7, p50_latency_ms: 30000 }, 'time-out')], cases: 3, repeats: 3 });
  assert.deepEqual(out.sentences, ['Beam passed 9 of 9 and Pulse 7 of 9, but with this many tries the gap may be chance.']);
  assert.deepEqual(out.more, ['Pulse gave no answer in 2 of 9 tries (time-out).']);
});

test('fewer than 3 decided tries per setup names no winner and turns the marks off', () => {
  const one = (passed, err = 0) => ({ n: 1, scored_n: err ? 0 : 1, passed_n: passed, errors_n: err, latency_n: err ? 0 : 1, p50_latency_ms: err ? null : 5000 });
  const setups = [setup('a', 'Haiku', one(1)), setup('b', 'Luna', one(1)), setup('c', 'Gemini', one(0, 1), 'no result')];
  const out = answer({ setups, cases: 1, repeats: 1 });
  assert.equal(out.kind, 'few');
  assert.deepEqual(out.sentences, ['Too few tries to name a winner.']);
  assert.deepEqual(out.more, ['2 of 3 setups passed their only try.', 'Gemini gave no answer (no result).', 'Run 3 tries per case to compare.']);
  const marks = bestMarks(setups);
  assert.equal(marks.passed.size + marks.time.size + marks.price.size, 0);
});

test('one setup is a run report', () => {
  const out = answer({ setups: [setup('a', 'Beam', { n: 1, scored_n: 1, passed_n: 1, latency_n: 1, p50_latency_ms: 4581 })], cases: 1, repeats: 1 });
  assert.deepEqual(out.sentences, ['Beam passed 1 of 1 case in 4.6 s.']);
  const many = answer({ setups: [setup('a', 'Beam', nine(8, 32349))], cases: 3, repeats: 3 });
  assert.deepEqual(many.sentences, ['Beam passed 8 of 9 tries, 32 s typical.']);
});

test('answers no check decided are "not scored automatically", never failed', () => {
  const svg = (rating) => ({ n: 2, unscored_n: 2, latency_n: 2, p50_latency_ms: 4000, human_mean: rating, human_n: rating ? 1 : 0 });
  const out = answer({ setups: [setup('a', 'Haiku', svg(4)), setup('b', 'Mini', svg(null))], cases: 2, repeats: 1 });
  assert.equal(out.kind, 'unchecked');
  assert.deepEqual(out.sentences, ['Not scored automatically.']);
  assert.deepEqual(out.more, ['Your ratings: Haiku 4.0 of 5 (1 rating).']);
  const some = answer({ setups: [setup('a', 'A', nine(9, 1000)), setup('b', 'B', { ...nine(8, 1000), scored_n: 8, unscored_n: 1 })], cases: 3, repeats: 3 });
  assert.match(some.more.join(' '), /1 answer was not checked, so it counts neither way\./);
  assert.deepEqual(some.sentences, ['Both passed every checked try: A 9 of 9, B 8 of 8.', 'Their typical times were level too.']);
});

test('three or more setups name the next one in the gap sentence', () => {
  const out = answer({ setups: [setup('a', 'A', nine(9, 1000)), setup('b', 'B', nine(9, 1000)), setup('c', 'C', nine(2, 1000))], cases: 3, repeats: 3 });
  assert.deepEqual(out.sentences, ['A and B passed the most: 9 of 9 each, against 2 of 9 for C.']);
  const marks = bestMarks([setup('a', 'A', nine(9, 1000)), setup('b', 'B', nine(9, 1000)), setup('c', 'C', nine(2, 1000))]);
  assert.deepEqual([...marks.passed], ['a', 'b']);
});

test('a winner holds against every other setup, not only the next one', () => {
  const ten = (passed, n) => ({ n, scored_n: n, passed_n: passed, latency_n: n, p50_latency_ms: 1000 });
  const one = answer({ setups: [setup('a', 'Beam', ten(20, 20)), setup('b', 'Pulse', ten(14, 20)), setup('c', 'Echo', ten(2, 3))], cases: 1, repeats: 20 });
  assert.equal(one.kind, 'noise');
  assert.deepEqual(one.sentences, ['Beam passed the most: 20 of 20. Echo, with 2 of 3, is close enough that the gap may be chance.']);
  const two = answer({ setups: [setup('a', 'Beam', ten(20, 20)), setup('b', 'Pulse', ten(2, 3)), setup('c', 'Echo', ten(2, 3))], cases: 1, repeats: 20 });
  assert.deepEqual(two.sentences, ['Beam passed the most: 20 of 20. Pulse (2 of 3) and Echo (2 of 3) are close enough that the gaps may be chance.']);
  const some = answer({ setups: [setup('a', 'A', ten(20, 20)), setup('b', 'B', ten(2, 3)), setup('c', 'C', ten(2, 3)), setup('d', 'D', ten(2, 3)), setup('e', 'E', ten(0, 20))], cases: 1, repeats: 20 });
  assert.deepEqual(some.sentences, ['A passed the most: 20 of 20. 3 other setups are close enough that the gaps may be chance.']);
});

test('too few checked tries is not too few tries, and unchecked tries are never called passed', () => {
  const blind = { n: 9, unscored_n: 9, latency_n: 9, p50_latency_ms: 1000 };
  const out = answer({ setups: [setup('a', 'Beam', nine(9, 1000)), setup('b', 'Pulse', blind)], cases: 3, repeats: 3 });
  assert.equal(out.kind, 'few');
  assert.deepEqual(out.sentences, ['Too few checked tries to name a winner.']);
  assert.deepEqual(out.more, ['1 of 2 setups passed every checked try.', '9 answers were not checked, so they count neither way.']);
  const part = { n: 3, scored_n: 2, passed_n: 2, unscored_n: 1, latency_n: 3, p50_latency_ms: 1000 };
  const both = answer({ setups: [setup('a', 'Beam', part), setup('b', 'Pulse', part)], cases: 3, repeats: 1 });
  assert.deepEqual(both.sentences, ['Too few checked tries to name a winner.']);
  assert.deepEqual(both.more, ['Both passed every checked try.', '2 answers were not checked, so they count neither way.']);
});

test('stored tries, not declared ones, set the words: two runs of a one-try test', () => {
  const two = { n: 2, scored_n: 2, passed_n: 2, latency_n: 2, p50_latency_ms: 4581 };
  const out = answer({ setups: [setup('a', 'Beam', two), setup('b', 'Pulse', two)], cases: 1, repeats: 1 });
  assert.deepEqual(out.sentences, ['Too few tries to name a winner.']);
  assert.deepEqual(out.more, ['Both passed every try.', 'Run 3 tries per case to compare.']);
  const one = answer({ setups: [setup('a', 'Beam', two)], cases: 1, repeats: 1 });
  assert.deepEqual(one.sentences, ['Beam passed 2 of 2 tries, 4.6 s typical.']);
});

test('when every try failed, no setup is called faster', () => {
  const out = answer({ setups: [setup('a', 'Beam', nine(0, 30000)), setup('b', 'Pulse', nine(0, 46000))], cases: 3, repeats: 3 });
  assert.deepEqual(out.sentences, ['Neither setup passed a try.']);
  const three = answer({ setups: [setup('a', 'A', nine(0, 1000)), setup('b', 'B', nine(0, 1000)), setup('c', 'C', nine(0, 1000))], cases: 3, repeats: 3 });
  assert.deepEqual(three.sentences, ['None of the 3 setups passed a try.']);
});

test('every answer the rules give is true of the counts (600 random tests)', () => {
  let seed = 20261105;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let k = 0; k < 600; k += 1) {
    const repeats = 1 + rnd(5);
    const cases = 1 + rnd(4);
    const list = Array.from({ length: 2 + rnd(4) }, (_, i) => {
      const n = cases * (1 + rnd(repeats + 1)); // up to one run more than declared
      const errors = rnd(3) ? 0 : rnd(n + 1);
      const unchecked = rnd(3) ? 0 : rnd(n - errors + 1);
      const scored = n - errors - unchecked;
      return setup(`s${i}`, `S${i}`, { n, errors_n: errors, unscored_n: unchecked, scored_n: scored, passed_n: rnd(scored + 1), latency_n: n - errors, p50_latency_ms: n - errors ? 1000 + rnd(4) * 400 : null });
    });
    const out = answer({ setups: list, cases, repeats });
    const words = [...out.sentences, ...out.more].join(' ');
    const why = `${JSON.stringify(list.map((s) => s.facts))} -> ${words}`;
    if (out.kind === 'gap' || out.kind === 'noise') {
      const top = Math.max(...list.map((s) => s.facts.rate));
      const leaders = list.filter((s) => s.facts.rate === top);
      const pairs = list.filter((s) => s.facts.rate !== top).flatMap((x) => leaders.map((l) => gapP(l.facts.passed, l.facts.decided, x.facts.passed, x.facts.decided)));
      if (out.kind === 'gap') assert.ok(pairs.every((p) => p < 0.05), `a gap must hold against every setup: ${why}`);
      else assert.ok(pairs.some((p) => p >= 0.05), `chance must have a cause: ${why}`);
    }
    if (/every try/.test(words)) assert.ok(list.every((s) => s.facts.unchecked === 0), `unchecked tries called passed: ${why}`);
    if (/their only try/.test(words)) assert.ok(list.every((s) => s.facts.tries === 1), `"only try" said of more tries: ${why}`);
    if (/Run 3 tries per case/.test(words)) assert.ok(list.some((s) => s.facts.tries < 3), `more tries asked for, but every setup has 3: ${why}`);
    if (/faster|fastest/.test(words)) assert.ok(list.some((s) => s.facts.passed > 0), `a faster setup named when none passed: ${why}`);
  }
});

test('ranking puts more passes first, then the faster setup', () => {
  const list = [setup('slow', 'S', nine(9, 9000)), setup('weak', 'W', nine(5, 100)), setup('fast', 'F', nine(9, 1000))];
  assert.deepEqual(rankSetups(list).map((s) => s.id), ['fast', 'slow', 'weak']);
});

test('ranges and error words', () => {
  const [lo, hi] = wilson(9, 9);
  assert.equal(hi, 1);
  assert.ok(lo > 0.69 && lo < 0.71);
  assert.equal(wilson(0, 0), null);
  assert.equal(errorWord('timeout'), 'time-out');
  assert.equal(errorWord('provider.chatgpt-limit'), 'usage limit');
  assert.equal(errorWord('no_result'), 'no result');
  assert.equal(errorReason([{ status: 'error', error: { type: 'timeout' } }, { status: 'ok' }]), 'time-out');
});

test('words: times, dates, test titles, case names and the fairness line', () => {
  assert.deepEqual([850, 4581, 32349, 127500, 329000].map(durText), ['850 ms', '4.6 s', '32 s', '2.1 min', '5.5 min']);
  assert.equal(shortDate('2026-11-05T06:02:04.533Z'), '5 Nov 2026');
  const c = { suite: { id: 'agentic', version: '1.0.2' }, cases: ['a', 'b', 'c'], repeats: 3, latest_run_at: '2026-11-05T06:02:04Z' };
  assert.equal(testTitle(c), 'Agentic');
  assert.equal(testMeta(c, 2), '3 cases · 3 tries each · 2 setups · 5 Nov 2026');
  assert.equal(testMeta({ ...c, cases: ['x'], repeats: 1 }, 9, 'What is 2 + 2?'), '1 case: What is 2 + 2? · 1 try · 9 setups · 5 Nov 2026');
  assert.equal(caseName('agentic-slugify-bug', 'agentic', { task: 'Fix it.' }), 'Slugify bug');
  assert.equal(caseName('smoke-001', 'smoke', { question: 'What is 2 + 2?' }), 'What is 2 + 2?');
  assert.equal(caseHint({ task: 'src/slugify.mjs has a bug: `node --test` fails. Fix it.' }), 'src/slugify.mjs has a bug: `node --test` fails.');
  assert.deepEqual(fairLine({ mode: 'controlled', axes: ['model'] }), { tone: 'ok', text: 'Fair test: only the model differs.' });
  assert.equal(fairLine({ mode: 'descriptive', axes: ['model', 'harness', 'effort'] }).text, 'Mixed test: model, harness and effort differ. Read differences as hints, not causes.');
  assert.equal(fairLine({ mode: 'single', axes: [] }), null);
});

test('tests group by suite, newest first, with older suite versions folded', () => {
  const t = (id, version, at) => ({ key: `${id}@${version}@${at}`, suite: { id, version }, latest_run_at: at });
  const groups = groupTests([t('smoke', '0.1.0', '2026-11-04'), t('agentic', '1.0.0', '2026-11-04T16'), t('agentic', '1.0.2', '2026-11-05'), t('agentic', '1.0.10', '2026-11-03')]);
  assert.deepEqual(groups.map((g) => g.title), ['Agentic', 'Smoke']);
  assert.deepEqual(groups[0].current.map((c) => c.suite.version), ['1.0.10']);
  assert.deepEqual(groups[0].earlier.map((c) => c.suite.version), ['1.0.2', '1.0.0']);
});
