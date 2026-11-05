// Share: the result as a Markdown table, CSV, JSON, or a picture (PNG drawn on a canvas, always light).
// Every export says the same as the page: the test, the answer, the fairness line, the setups.
import { S, ctx, shownSetups, selectedCfgs, comparison, aggOf, cfgOf } from './model.js';
import { bestMarks, passedText, wilson } from './verdict.js';
import { verdictFor, caseLabel } from './summary.js';
import { testTitle, testMeta, fairLine, durText } from './words.js';
import { harnessLine } from './setups.js';
import { isNum, usdText, toCsv, download, slug } from './util.js';

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const PRICE_NOTE = 'API price is what the same calls would cost on the pay-as-you-go API. Nothing was billed.';

function fileBase() {
  const c = ctx();
  return slug(c ? `${c.suite.id}-v${c.suite.version}-${S.sel.length}-setups` : 'model-lab');
}

function head() {
  const c = ctx();
  const v = verdictFor();
  const fair = v.kind === 'single' ? null : fairLine(comparison(selectedCfgs()));
  return {
    title: c ? testTitle(c) : 'Model Lab',
    meta: c ? testMeta(c, c.config_ids.length, caseLabel(c)) : '',
    answer: [...v.sentences, ...v.more].join(' '),
    fair: fair ? fair.text : '',
  };
}

const passedWords = (f) => (f.decided ? passedText(f) : f.unchecked ? 'not checked' : '–');
const timeWords = (f) => (f.time === null ? '–' : durText(f.time));
const priceWords = (f) => (f.price === null ? '–' : usdText(f.price));
const errorWords = (f) => (f.errors ? `${f.errors} of ${f.tries}` : 'none');

export function markdown() {
  const h = head();
  const list = shownSetups();
  const marks = bestMarks(list);
  const cell = (v) => String(v).replace(/\|/g, '\\|');
  const best = (on, text) => (on ? `**${text}**` : text);
  const cols = ['Setup', 'Harness', 'Passed', 'Typical time', 'Slow end', 'API price', 'Errors'];
  const rated = list.some((s) => s.facts.ratings > 0);
  if (rated) cols.push('Your rating');
  const lines = [`| ${cols.join(' | ')} |`, `| ${cols.map((_, i) => (i < 2 ? '---' : '---:')).join(' | ')} |`];
  list.forEach((s) => {
    const f = s.facts;
    const row = [
      s.cfg.display_name,
      harnessLine(s.cfg),
      best(marks.passed.has(s.id), passedWords(f)),
      best(marks.time.has(s.id), timeWords(f)),
      f.slow === null || f.timed < 2 ? '–' : durText(f.slow),
      best(marks.price.has(s.id), priceWords(f)),
      errorWords(f),
    ];
    if (rated) row.push(f.ratings ? `${f.rating.toFixed(1)} of 5` : '–');
    lines.push(`| ${row.map(cell).join(' | ')} |`);
  });
  const notes = [h.fair, marks.passed.size || marks.time.size || marks.price.size ? 'Bold: the best value in its column.' : '', PRICE_NOTE].filter(Boolean);
  return `## ${h.title}\n\n${h.meta}\n\n${h.answer}\n\n${lines.join('\n')}\n\n_${notes.join(' ')} Made ${stamp()} by Model Lab from stored runs._\n`;
}

const CSV_HEAD = [
  'setup', 'model', 'harness', 'harness_version', 'effort', 'user_setup',
  'tries', 'passed', 'checked', 'not_checked', 'errors', 'pass_share', 'pass_range_low', 'pass_range_high',
  'typical_time_ms', 'slow_end_ms', 'api_price_usd', 'api_price_usd_per_try', 'api_price_usd_per_pass',
  'tokens_in_per_try', 'tokens_from_cache_per_try', 'tokens_out_per_try', 'your_rating', 'ratings',
];

function csvRows() {
  return shownSetups().map((s) => {
    const f = s.facts;
    const a = aggOf(s.id) || {};
    const range = wilson(f.passed, f.decided);
    const share = f.decided ? f.passed / f.decided : null;
    const n = (v, d = 4) => (isNum(v) ? Number(v.toFixed(d)) : '');
    return [
      s.name, s.cfg.model_key || s.cfg.display_name, s.cfg.harness.name, s.cfg.harness.version, s.cfg.effort || '', s.cfg.user_config || 'loaded',
      f.tries, f.passed, f.decided - f.errors, f.unchecked, f.errors, n(share), range ? n(range[0]) : '', range ? n(range[1]) : '',
      n(f.time, 0), n(f.slow, 0), n(f.price, 6), n(a.mean_cost_usd, 6), n(f.pricePerPass, 6),
      n(a.mean_input_tokens, 1), n(a.mean_cache_read_tokens, 1), n(a.mean_output_tokens, 1), f.ratings ? n(f.rating, 2) : '', f.ratings,
    ];
  });
}

export const csv = () => toCsv([CSV_HEAD, ...csvRows()]);

function jsonExport() {
  const c = ctx();
  const h = head();
  const list = shownSetups();
  return JSON.stringify(
    {
      made_at: stamp(),
      test: h.title,
      answer: h.answer,
      fairness: h.fair || null,
      note: PRICE_NOTE,
      context: c && { key: c.key, suite: c.suite, prompt: c.prompt, cases: c.cases, repeats: c.repeats, partial: c.partial, runs: c.runs },
      comparison: comparison(selectedCfgs()),
      setups: list.map((s) => ({ ...cfgOf(s.id), name: s.name, facts: s.facts, aggregate: aggOf(s.id) })),
    },
    null,
    2,
  );
}

export function saveFile(kind) {
  if (kind === 'csv') {
    download(`${fileBase()}.csv`, csv(), 'text/csv');
    return 'Downloaded the table as CSV.';
  }
  download(`${fileBase()}.json`, jsonExport(), 'application/json');
  return 'Downloaded the result as JSON.';
}

// ---- Picture --------------------------------------------------------------------------------
// The house-style light values, fixed: a shared picture never depends on the viewer's mode.
const P = { paper: '#F6F7F4', card: '#FFFFFF', ink: '#14201C', muted: '#53615B', rule: '#DDE2DC', best: '#1E5B49', bad: '#A63D2A', warn: '#8A5A00' };

function fit(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}
function wrapLines(g, text, maxW) {
  const lines = [];
  let cur = '';
  for (const word of String(text).split(' ')) {
    if (cur && g.measureText(`${cur} ${word}`).width > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  return lines;
}
// The answer on a picture takes 3 lines at most. A long answer is set smaller first, down to 24px
// (16px or more at picture scale); only then does the third line end in an ellipsis.
export function answerLines(g, text, maxW, size, sans) {
  let s = size + 2;
  let lines;
  do {
    s -= 2;
    g.font = `400 ${s}px ${sans}`;
    lines = wrapLines(g, text, maxW);
  } while (lines.length > 3 && s > 24);
  if (lines.length > 3) lines = [...lines.slice(0, 2), fit(g, lines.slice(2).join(' '), maxW)];
  return { lines, size: s };
}

export async function picture(kind) {
  const square = kind === 'square';
  const W = square ? 1080 : 1600;
  const H = square ? 1080 : 900;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  try {
    await Promise.all(['500 56px', '400 28px', '600 28px', '500 24px'].map((f) => document.fonts.load(`${f} "Instrument Sans"`)));
  } catch {
    /* the system font draws instead */
  }
  const sans = '"Instrument Sans", "Segoe UI", system-ui, sans-serif';
  const pad = square ? 64 : 80;
  const inner = W - pad * 2;
  g.fillStyle = P.paper;
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';
  const h = head();
  const list = shownSetups();
  const marks = bestMarks(list);

  let y = pad + 40;
  g.fillStyle = P.muted;
  g.font = `500 24px ${sans}`;
  g.fillText('Model Lab', pad, y);
  y += 58;
  g.fillStyle = P.ink;
  g.font = `500 ${square ? 52 : 56}px ${sans}`;
  g.fillText(fit(g, h.title, inner), pad, y);
  y += 40;
  g.fillStyle = P.muted;
  g.font = `400 24px ${sans}`;
  g.fillText(fit(g, h.meta, inner), pad, y);
  y += 56;
  g.fillStyle = P.ink;
  const say = answerLines(g, h.answer, inner, square ? 30 : 32, sans);
  say.lines.forEach((ln) => {
    g.fillText(ln, pad, y);
    y += say.size + 12;
  });
  y += 24;

  const cols = [
    { t: 'Setup', w: square ? 0.46 : 0.46, v: (s) => s.cfg.display_name, sub: (s) => harnessLine(s.cfg) },
    { t: 'Passed', w: 0.18, v: (s) => passedWords(s.facts), best: (s) => marks.passed.has(s.id) },
    { t: 'Typical time', w: 0.18, v: (s) => timeWords(s.facts), best: (s) => marks.time.has(s.id) },
    { t: 'API price', w: 0.18, v: (s) => priceWords(s.facts), best: (s) => marks.price.has(s.id) },
  ];
  let x = pad;
  g.fillStyle = P.muted;
  g.font = `500 22px ${sans}`;
  cols.forEach((col) => {
    col.x = x;
    col.px = inner * col.w;
    g.fillText(col.t, x, y);
    x += col.px;
  });
  y += 16;
  g.strokeStyle = P.rule;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(pad, y);
  g.lineTo(W - pad, y);
  g.stroke();
  const footTop = H - pad - 64;
  const rowH = Math.min(84, Math.floor((footTop - y - 12) / Math.max(1, list.length)));
  const sub = rowH >= 64;
  const shown = list.slice(0, Math.max(1, Math.floor((footTop - y - 12) / Math.max(rowH, 40))));
  shown.forEach((s) => {
    const base = y + (sub ? rowH * 0.48 : rowH * 0.66);
    g.fillStyle = P.ink;
    g.font = `600 ${square ? 26 : 28}px ${sans}`;
    g.fillText(fit(g, cols[0].v(s), cols[0].px - 24), cols[0].x, base);
    if (sub) {
      g.fillStyle = P.muted;
      g.font = `400 20px ${sans}`;
      g.fillText(fit(g, cols[0].sub(s), cols[0].px - 24), cols[0].x, base + 28);
    }
    cols.slice(1).forEach((col) => {
      const on = col.best(s);
      g.fillStyle = on ? P.best : P.ink;
      g.font = `${on ? 600 : 400} 28px ${sans}`;
      g.fillText(fit(g, col.v(s), col.px - 16), col.x, base);
      if (on) {
        g.fillRect(col.x, base + 10, Math.min(col.px - 24, g.measureText(col.v(s)).width), 3);
      }
    });
    y += rowH;
    g.strokeStyle = P.rule;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(pad, y);
    g.lineTo(W - pad, y);
    g.stroke();
  });
  if (shown.length < list.length) {
    g.fillStyle = P.muted;
    g.font = `400 22px ${sans}`;
    g.fillText(`${list.length - shown.length} more setups in the full result.`, pad, y + 32);
  }

  g.fillStyle = P.muted;
  g.font = `400 22px ${sans}`;
  const foot = [h.fair, marks.passed.size || marks.time.size || marks.price.size ? 'Underlined: the best value in its column.' : ''].filter(Boolean).join(' ');
  if (foot) g.fillText(fit(g, foot, inner), pad, H - pad - 34);
  g.fillText(fit(g, `${PRICE_NOTE} Made ${stamp().slice(0, 10)}.`, inner), pad, H - pad);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not draw the picture.');
  download(`${fileBase()}-${square ? 'square' : 'wide'}.png`, blob, 'image/png');
}

