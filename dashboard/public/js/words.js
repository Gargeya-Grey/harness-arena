// One name for each thing on screen. Pure functions: no DOM, so node:test can load them.

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-05T06:02:04Z" -> "5 Nov 2026". Read from the string, so the day never shifts with the time zone.
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// "2026-11-05T06:02:04Z" -> "06:02 UTC".
export const utcTime = (iso) => {
  const m = /T(\d{2}:\d{2})/.exec(String(iso || ''));
  return m ? `${m[1]} UTC` : '';
};

// A time in words: "850 ms", "4.6 s", "32 s", "2.1 min".
export function durText(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 9.95) return `${s.toFixed(1)} s`;
  if (s < 119.5) return `${Math.round(s)} s`;
  const m = s / 60;
  return `${m < 9.95 ? m.toFixed(1) : Math.round(m)} min`;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// A test is named by its suite: "agentic" -> "Agentic".
export const testTitle = (c) => cap(String(c.suite.id).replace(/[-_]+/g, ' '));

const firstText = (input) => {
  if (!input || typeof input !== 'object') return '';
  for (const key of ['question', 'task', 'prompt', 'instruction', 'brief', 'text']) {
    if (typeof input[key] === 'string' && input[key].trim()) return input[key].trim();
  }
  const any = Object.values(input).find((v) => typeof v === 'string' && v.trim());
  return any ? any.trim() : '';
};

const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

// A case in words: "agentic-slugify-bug" -> "Slugify bug". An ID that is only digits ("smoke-001")
// says nothing, so the question itself names the case.
export function caseName(caseId, suiteId, input) {
  const bare = String(caseId).startsWith(`${suiteId}-`) ? String(caseId).slice(String(suiteId).length + 1) : String(caseId);
  if (/^[\d_-]+$/.test(bare)) {
    const q = firstText(input);
    if (q) return clip(q.split(/(?<=[.?!])\s/)[0], 64);
  }
  return cap(bare.replace(/[-_]+/g, ' '));
}

// The first sentence of the question or task, short enough for one line under the case name.
export function caseHint(input, max = 110) {
  const q = firstText(input).replace(/\s+/g, ' ');
  if (!q) return '';
  return clip(q.split(/(?<=[.?!])\s/)[0], max);
}

const triesText = (repeats) => (repeats > 1 ? `${repeats} tries each` : '1 try');

// Tries per case as stored. Two runs of one test add up, so a setup can hold more than the experiment asked for.
function storedTries(c) {
  const per = Object.values(c.aggregates || {}).map((a) => Math.ceil((a.n || 0) / Math.max(1, c.cases.length))).filter((n) => n > 0);
  if (!per.length) return triesText(c.repeats);
  const lo = Math.min(...per);
  const hi = Math.max(...per);
  return lo === hi ? triesText(hi) : `${lo}–${hi} tries each`;
}

// "3 cases · 3 tries each · 2 setups · 5 Nov 2026". One case is named instead of counted.
export function testMeta(c, setupCount, caseLabel) {
  const cases = c.cases.length === 1 && caseLabel ? `1 case: ${caseLabel}` : plural(c.cases.length, 'case');
  return [cases, storedTries(c), plural(setupCount, 'setup'), shortDate(c.latest_run_at)].filter(Boolean).join(' · ');
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = String(b).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

const newest = (a, b) => String(b.latest_run_at || '').localeCompare(String(a.latest_run_at || ''));

// Tests grouped by suite, newest suite first. The newest suite version is "current";
// older versions fold under "Earlier versions".
export function groupTests(contexts) {
  const bySuite = new Map();
  for (const c of contexts) {
    if (!bySuite.has(c.suite.id)) bySuite.set(c.suite.id, []);
    bySuite.get(c.suite.id).push(c);
  }
  const groups = [...bySuite.entries()].map(([suite, list]) => {
    const top = list.map((c) => c.suite.version).sort(compareVersions).at(-1);
    return {
      suite,
      title: testTitle(list[0]),
      current: list.filter((c) => c.suite.version === top).sort(newest),
      earlier: list.filter((c) => c.suite.version !== top).sort((a, b) => compareVersions(b.suite.version, a.suite.version) || newest(a, b)),
      latest: list.map((c) => c.latest_run_at || '').sort().at(-1),
    };
  });
  return groups.sort((a, b) => String(b.latest).localeCompare(String(a.latest)));
}

const AXIS_WORDS = { model: 'model', harness: 'harness', effort: 'effort', decoding: 'decoding settings', setup: 'user setup' };
const listWords = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// The fairness line under the answer, from model.js comparison().
export function fairLine(cmp) {
  if (!cmp) return null;
  if (cmp.mode === 'controlled') return { tone: 'ok', text: `Fair test: only the ${AXIS_WORDS[cmp.axes[0]] || cmp.axes[0]} differs.` };
  if (cmp.mode === 'replicate') return { tone: 'ok', text: 'The same setup, run more than once: differences are noise.' };
  if (cmp.mode === 'descriptive') return { tone: 'warn', text: `Mixed test: ${listWords(cmp.axes.map((a) => AXIS_WORDS[a] || a))} differ. Read differences as hints, not causes.` };
  return null;
}
