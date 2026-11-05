// Charts: hand-rolled inline SVG. No colour per setup: each setup carries its letter and its name,
// marks are ink, the best value is the accent, no answer is the danger colour.
// A chart shows only when it carries a result; the others wait under "More charts".
import { ctx, shownSetups, aggOf, chartNames, letterOf, selectedCfgs } from './model.js';
import { bestMarks, facts, wilson } from './verdict.js';
import { durText } from './words.js';
import { html, esc, setHtml, isNum, tokText, clamp } from './util.js';

const LH = 17;
const CHAR = 6.9; // average width of a 13px Instrument Sans character, weight 500
const BADGE = 26; // letter badge plus its gap
// On a phone a chart is drawn narrower and shown larger, so its smallest text (12px) reads at 16px or more.
const PHONE = 440;
const ZOOM = 1.35; // 12px x 1.35 = 16.2px; exactly 16/12 rounds to 15.99px

let drawToken = 0;

function niceStep(span, target) {
  const rawStep = span / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(rawStep));
  const m = rawStep / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
function linearTicks(max, target) {
  // An axis of zeros still needs a span: a zero step would never reach the end.
  const step = niceStep(max > 0 && Number.isFinite(max) ? max : 1, target);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}
// Width of a 12px tick label, measured on Instrument Sans: digits 7.6px, a dot 3.1, a space 2.4.
const tickW = (s) => [...String(s)].reduce((sum, ch) => sum + (/\d/.test(ch) ? 7.6 : ch === '.' ? 3.1 : ch === ' ' ? 2.4 : 7), 0);
// Ticks for an axis of this width. The first label starts at the axis start, the last ends at its end,
// the others are centred; no two labels come closer than 6px. About one tick per 90px, more when the
// last tick would leave a third of the axis empty. label(v, ticks) is the text the chart draws.
function fitTicks(max, width, label) {
  const fits = (ticks) => {
    const top = ticks[ticks.length - 1] || 1;
    let end = -Infinity;
    return ticks.every((v, i) => {
      const x = (v / top) * width;
      const lw = tickW(label(v, ticks));
      const left = i === 0 ? x : i === ticks.length - 1 ? x - lw : x - lw / 2;
      const ok = left >= end + 6;
      end = left + lw;
      return ok;
    });
  };
  let target = Math.max(2, Math.floor(width / 90));
  let ticks = linearTicks(max, target);
  while (!fits(ticks) && target > 1) ticks = linearTicks(max, --target);
  while (ticks[ticks.length - 1] > max * 1.3 && target < 40) {
    const next = linearTicks(max, ++target);
    if (!fits(next)) break;
    ticks = next;
  }
  return ticks;
}
function decimalsFor(values) {
  for (let d = 0; d <= 6; d += 1) if (values.every((v) => Math.abs(Number(v.toFixed(d)) - v) < 1e-12)) return d;
  return 6;
}

function wrap(text, maxChars) {
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Model on the first line, harness and effort on the next: two setups of one model never read the same.
function identityLines(c, name, maxW) {
  const model = c.display_name || name;
  const detail = name.startsWith(`${model} · `) ? name.slice(model.length + 3) : c.harness.name;
  const maxChars = Math.max(8, Math.floor((maxW - BADGE) / CHAR));
  const breakLong = (text) => String(text).replace(/(\S{8,})/g, (word) => word.match(new RegExp(`.{1,${maxChars}}`, 'gu')).join(' '));
  return [model, detail].flatMap((s) => wrap(breakLong(s), maxChars));
}

const svgStart = (w, h, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">`;
const t = (x, y, cls, text, anchor = 'start') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="${cls}" text-anchor="${anchor}">${esc(text)}</text>`;
const line = (x1, y1, x2, y2, cls) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${cls}"/>`;
const badge = (x, y, letter) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="19" height="19" rx="5" class="chart-lt-bg"/>${t(x + 9.5, y + 13.4, 'chart-lt', letter || '?', 'middle')}`;

function nameLabel(x, y, c, name, maxW, best = false) {
  const lines = identityLines(c, name, maxW);
  return `<g class="chart-identity">${badge(x, y - 14, letterOf(c.id))}${lines.map((s, i) => t(x + BADGE, y + i * LH, best ? 'chart-text chart-best' : 'chart-text', s)).join('')}</g>`;
}

// Row-chart frame. Wide: label column then plot. Narrow: label on its own line above the plot.
function frame(w, valueW = 0) {
  const stacked = w < 620 || w - valueW < 420;
  const labelW = stacked ? 0 : clamp(Math.round(w * 0.34), 200, 280);
  const px = stacked ? 0 : labelW + 16;
  return { stacked, labelW, px, pw: Math.max(60, w - px - valueW - (valueW ? 12 : 0)) };
}

function rowLayout(rows, labelW, extra, minHeight = 0) {
  let height = 0;
  const layout = rows.map((r) => {
    const labelH = identityLines(r.c, r.name, labelW).length * LH;
    const y = height;
    const h = Math.max(minHeight, labelH + extra);
    height += h;
    return { y, h, labelH };
  });
  return { layout, height };
}

const pct = (v) => `${Math.round(v * 100)}%`;

// ---- Passed against price -------------------------------------------------------------------------
function drawPrice(w, cfgs, names, marks) {
  const items = [];
  const skipped = [];
  // The share passed is the table's: passed of the decided tries, so a try with no answer counts as not passed.
  cfgs.forEach((c) => {
    const a = aggOf(c.id);
    const f = facts(a);
    if (f.rate === null) skipped.push(`${names.get(c.id)} (no checked answers)`);
    else if (!isNum(a.mean_cost_usd)) skipped.push(`${names.get(c.id)} (no price)`);
    else items.push({ c, a, name: names.get(c.id), q: f.rate, ci: wilson(f.passed, f.decided) });
  });
  const costs = items.map((i) => i.a.mean_cost_usd);
  const minC = Math.min(...costs);
  const maxC = Math.max(...costs);
  const logScale = minC > 0 && maxC / minC > 10;
  const h = clamp(Math.round(w * 0.5), 240, 340);
  const m = { l: 44, r: 10, t: 22, b: 44 };
  const pw = w - m.l - m.r;
  const ph = h - m.t - m.b;
  let xOf;
  let xTicks;
  if (logScale) {
    const lo = Math.floor(Math.log10(minC));
    const hi = Math.ceil(Math.log10(maxC));
    const span = Math.max(1, hi - lo);
    xOf = (v) => m.l + ((Math.log10(v) - lo) / span) * pw;
    xTicks = [];
    for (let k = lo; k <= hi; k += 1) xTicks.push(10 ** k);
    while (xTicks.length > Math.max(2, Math.floor(pw / 84))) xTicks = xTicks.filter((_, i) => i % 2 === 0);
  } else {
    const ticks = fitTicks(maxC * 1.08 || 1, pw, (v, all) => `$${v.toFixed(decimalsFor(all))}`);
    const top = ticks[ticks.length - 1] || 1;
    xOf = (v) => m.l + (v / top) * pw;
    xTicks = ticks;
  }
  // A log axis spans powers of ten, so each tick keeps its own decimals: "$0.000001" and "$0.01".
  const tickText = (v) => `$${v.toFixed(decimalsFor(logScale ? [v] : xTicks))}`;
  const yOf = (v) => m.t + (1 - clamp(v, 0, 1)) * ph;
  const best = new Set(items.filter((i) => marks.passed.has(i.c.id)).map((i) => i.c.id));
  const legend = rowLayout(items, w, 12);
  let g = svgStart(w, h + 16 + legend.height, `Share passed against API price per try for ${items.length} setups`);
  g += t(0, 11, 'chart-axis-text', 'passed');
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    g += line(m.l, yOf(v), w - m.r, yOf(v), 'chart-line');
    g += t(m.l - 8, yOf(v) + 4, 'chart-axis-text', pct(v), 'end');
  });
  xTicks.forEach((v) => {
    const x = xOf(v);
    g += line(x, m.t + ph, x, m.t + ph + 4, 'chart-line-dark');
    g += t(x, m.t + ph + 18, 'chart-axis-text', tickText(v), x < m.l + 24 ? 'start' : x > w - 30 ? 'end' : 'middle');
  });
  g += t(w - m.r, h - 4, 'chart-axis-text', 'API price per try (USD)', 'end');
  // Letters sit beside their points and avoid the points and the full whiskers.
  const markBoxes = items.map((i) => {
    const q = i.ci || [i.q, i.q];
    return { x: xOf(i.a.mean_cost_usd) - 7, y: Math.min(yOf(q[1]), yOf(i.q)) - 7, w: 14, h: Math.abs(yOf(q[0]) - yOf(q[1])) + 14 };
  });
  const hit = (a, b, pad = 3) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  const blocks = items.map((i) => ({ i, bw: 20, bh: 20, px: xOf(i.a.mean_cost_usd), py: yOf(i.q) }));
  blocks.sort((a, b) => a.py - b.py || a.px - b.px);
  const placed = [];
  blocks.forEach((b) => {
    const rightFirst = w - 6 - (b.px + 10) >= b.bw || w - 6 - (b.px + 10) >= b.px - 10 - m.l;
    const sides = rightFirst ? [true, false] : [false, true];
    const shifts = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8].map((n) => n * LH);
    let pick = null;
    let fallback = null;
    for (const dy of shifts) {
      for (const right of sides) {
        const rect = { x: right ? b.px + 10 : b.px - 10 - b.bw, y: b.py - b.bh / 2 + dy, w: b.bw, h: b.bh };
        const inside = rect.x >= m.l + 2 && rect.x + rect.w <= w - 2 && rect.y >= m.t - 12 && rect.y + rect.h <= m.t + ph + 6;
        if (!inside) continue;
        const clash = placed.filter((p) => hit(rect, p)).length * 2 + markBoxes.filter((mk) => hit(rect, mk, 0)).length;
        if (!fallback || clash < fallback.clash) fallback = { rect, right, clash };
        if (!placed.some((p) => hit(rect, p)) && !markBoxes.some((mk) => hit(rect, mk, 0))) {
          pick = { rect, right };
          break;
        }
      }
      if (pick) break;
    }
    pick = pick || fallback || { rect: { x: b.px + 10, y: b.py - b.bh / 2, w: b.bw, h: b.bh }, right: true };
    b.rect = pick.rect;
    b.right = pick.right;
    placed.push(pick.rect);
  });
  blocks.forEach((b) => {
    const q = b.i.ci;
    if (!q) return;
    const cls = best.has(b.i.c.id) ? 'chart-whisker-best' : 'chart-whisker';
    g += line(b.px, yOf(q[0]), b.px, yOf(q[1]), cls) + line(b.px - 4, yOf(q[0]), b.px + 4, yOf(q[0]), cls) + line(b.px - 4, yOf(q[1]), b.px + 4, yOf(q[1]), cls);
  });
  blocks.forEach((b) => {
    const isBest = best.has(b.i.c.id);
    const cy = b.rect.y + b.bh / 2;
    const edge = b.right ? b.rect.x : b.rect.x + b.rect.w;
    g += line(b.px + (b.right ? 5 : -5), b.py, b.right ? edge - 3 : edge + 3, cy, 'chart-line-dark');
    g += `<circle cx="${b.px.toFixed(1)}" cy="${b.py.toFixed(1)}" r="5" class="${isBest ? 'chart-mark-best' : 'chart-mark'}"/>`;
    g += `<g class="chart-callout">${badge(b.rect.x, b.rect.y, letterOf(b.i.c.id))}</g>`;
  });
  items.forEach((i, k) => { g += nameLabel(0, h + 30 + legend.layout[k].y, i.c, i.name, w, best.has(i.c.id)); });
  g += '</svg>';
  const note = `Up and to the left is better: more passed for less money. Whiskers show the likely range.${logScale ? ' The price axis is a log scale: each step is 10 times the one before.' : ''}${skipped.length ? ` Not drawn: ${skipped.join('; ')}.` : ''}`;
  return { svg: g, note };
}

// ---- Time per try -----------------------------------------------------------------------------------
function drawTime(w, cfgs, names, marks) {
  const rows = cfgs.map((c) => {
    const a = aggOf(c.id) || {};
    return { c, name: names.get(c.id), p50: isNum(a.p50_latency_ms) ? a.p50_latency_ms : null, p95: isNum(a.p95_latency_ms) ? a.p95_latency_ms : null, n: a.latency_n || 0 };
  });
  const have = rows.filter((r) => r.p50 !== null);
  const maxV = Math.max(...have.map((r) => (r.p95 !== null ? r.p95 : r.p50)));
  const f = frame(w);
  const { layout, height } = rowLayout(rows, f.stacked ? w : f.labelW, f.stacked ? 62 + LH : 18, f.stacked ? 0 : 56);
  const h = height + 26;
  // Ticks in one unit: minutes from 2 minutes up, seconds from 2 seconds up, else milliseconds.
  const unit = maxV >= 120000 ? { ms: 60000, word: 'min' } : maxV >= 2000 ? { ms: 1000, word: 's' } : { ms: 1, word: 'ms' };
  const ticks = fitTicks((maxV * 1.05) / unit.ms, f.pw, (v, all) => `${v.toFixed(decimalsFor(all))} ${unit.word}`).map((v) => v * unit.ms);
  const tickD = decimalsFor(ticks.map((v) => v / unit.ms));
  const top = ticks[ticks.length - 1] || 1;
  const xOf = (v) => f.px + (v / top) * f.pw;
  let g = svgStart(w, h, 'Typical time and slow end per setup');
  ticks.forEach((v) => {
    const x = xOf(v);
    g += line(x, 0, x, height, 'chart-line');
    g += t(x, height + 17, 'chart-axis-text', `${(v / unit.ms).toFixed(tickD)} ${unit.word}`, v === 0 ? 'start' : x > w - 30 ? 'end' : 'middle');
  });
  rows.forEach((r, k) => {
    const { y, labelH } = layout[k];
    const isBest = marks.time.has(r.c.id);
    const spread = r.p95 !== null && r.n > 1 && r.p95 !== r.p50;
    const values = r.p50 === null ? ['no answer to time'] : spread ? [`typical ${durText(r.p50)}`, `slow end ${durText(r.p95)}`] : [`typical ${durText(r.p50)}`];
    g += nameLabel(0, y + (f.stacked ? 16 : 18), r.c, r.name, f.stacked ? w : f.labelW, isBest);
    // Stacked (a phone): one value per line. Wide: one line beside the plot.
    if (f.stacked) values.forEach((v, i) => { g += t(BADGE, y + labelH + 18 + i * LH, 'chart-num', v); });
    else g += t(f.px, y + 38, 'chart-num', values.join(' · '));
    if (r.p50 === null) return;
    const hi = spread ? r.p95 : r.p50;
    const cy = f.stacked ? y + labelH + 40 + LH : y + 13;
    g += line(xOf(r.p50), cy, xOf(hi), cy, isBest ? 'chart-range-best' : 'chart-range');
    if (hi !== r.p50) g += `<circle cx="${xOf(hi).toFixed(1)}" cy="${cy}" r="5" class="${isBest ? 'chart-ring-best' : 'chart-ring'}"/>`;
    g += `<circle cx="${xOf(r.p50).toFixed(1)}" cy="${cy}" r="5" class="${isBest ? 'chart-mark-best' : 'chart-mark'}"/>`;
  });
  g += '</svg>';
  return { svg: g, note: 'Dot: typical time, half the tries were faster. Ring: slow end, 1 try in 20 was slower. Left is faster.' };
}

// ---- Tokens per try --------------------------------------------------------------------------------
function drawTokens(w, cfgs, names) {
  const rows = cfgs.map((c) => ({ c, a: aggOf(c.id), name: names.get(c.id) }));
  const metrics = [
    { key: 'mean_input_tokens', label: 'in' },
    { key: 'mean_cache_read_tokens', label: 'from cache' },
    { key: 'mean_output_tokens', label: 'out' },
  ];
  const maxOf = Object.fromEntries(metrics.map((mt) => [mt.key, Math.max(0, ...rows.map((r) => (r.a && isNum(r.a[mt.key]) ? r.a[mt.key] : 0)))]));
  const f = frame(w);
  const bar = (x, y, bw, v, key) => {
    let s = `<rect x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="6" rx="3" class="chart-track"/>`;
    if (isNum(v) && maxOf[key] > 0) s += `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(v > 0 ? 3 : 0, (v / maxOf[key]) * bw).toFixed(1)}" height="6" rx="3" class="chart-bar"/>`;
    return s;
  };
  const val = (v) => (isNum(v) ? tokText(v) : '–');
  let g;
  if (f.stacked) {
    const { layout, height } = rowLayout(rows, w, metrics.length * 22 + 18);
    const lw = 84;
    const vw = 56;
    g = svgStart(w, height, 'Tokens in, from cache and out per try, each on its own scale');
    rows.forEach((r, k) => {
      const { y, labelH } = layout[k];
      g += nameLabel(0, y + 16, r.c, r.name, w);
      metrics.forEach((mt, j) => {
        const by = y + labelH + 12 + j * 22;
        const v = r.a ? r.a[mt.key] : null;
        g += t(0, by + 11, 'chart-axis-text', mt.label);
        g += bar(lw, by + 4, Math.max(30, w - lw - vw - 8), v, mt.key);
        g += t(w, by + 11, 'chart-num', val(v), 'end');
      });
    });
  } else {
    const headH = 22;
    const { layout, height } = rowLayout(rows, f.labelW, 18);
    const gap = 18;
    const colW = (w - f.px - gap * (metrics.length - 1)) / metrics.length;
    g = svgStart(w, headH + height, 'Tokens in, from cache and out per try, each on its own scale');
    metrics.forEach((mt, j) => { g += t(f.px + j * (colW + gap), 12, 'chart-axis-text', mt.label); });
    g += line(0, headH - 4, w, headH - 4, 'chart-line');
    rows.forEach((r, k) => {
      const y = headH + layout[k].y;
      g += nameLabel(0, y + 24, r.c, r.name, f.labelW);
      metrics.forEach((mt, j) => {
        const x = f.px + j * (colW + gap);
        const v = r.a ? r.a[mt.key] : null;
        g += t(x, y + 18, 'chart-num', val(v));
        g += bar(x, y + 25, colW, v, mt.key);
      });
    });
  }
  g += '</svg>';
  return { svg: g, note: 'Each kind has its own scale: compare bars within one column. Tokens in count every prompt token, cached ones too.' };
}

// ---- Consistency --------------------------------------------------------------------------------
function drawConsistency(w, cfgs, names) {
  const rows = cfgs.map((c) => ({ c, a: aggOf(c.id), name: names.get(c.id) }));
  const firm = rows.filter((r) => r.a && r.a.reliability_sufficient && isNum(r.a.reliability_agreement));
  const valueW = 48;
  const f = frame(w, valueW);
  const { layout, height } = rowLayout(rows, f.stacked ? w : f.labelW, f.stacked ? 36 : 18);
  const top = firm.length > 1 ? Math.max(...firm.map((r) => r.a.reliability_agreement)) : null;
  const allEqual = firm.every((r) => r.a.reliability_agreement === firm[0].a.reliability_agreement);
  let g = svgStart(w, height, 'How often the tries of one case agreed, per setup');
  rows.forEach((r, k) => {
    const { y, labelH } = layout[k];
    const ok = firm.includes(r);
    const isBest = ok && top !== null && !allEqual && r.a.reliability_agreement === top;
    const by = f.stacked ? y + labelH + 14 : y + labelH / 2;
    g += nameLabel(0, y + 16, r.c, r.name, f.stacked ? w : f.labelW, isBest);
    if (ok) {
      const v = clamp(r.a.reliability_agreement, 0, 1);
      g += `<rect x="${f.px}" y="${by}" width="${f.pw.toFixed(1)}" height="8" rx="4" class="chart-track"/>`;
      g += `<rect x="${f.px}" y="${by}" width="${Math.max(4, v * f.pw).toFixed(1)}" height="8" rx="4" class="${isBest ? 'chart-bar-best' : 'chart-bar'}"/>`;
      g += t(w, by + 8, isBest ? 'chart-num chart-best' : 'chart-num', pct(r.a.reliability_agreement), 'end');
    } else {
      g += t(f.px, by + 8, 'chart-num', 'too few tries');
    }
  });
  g += '</svg>';
  return { svg: g, note: 'How often the tries of one case gave the same result. 100% means every try agreed.' };
}

// ---- Outcomes -----------------------------------------------------------------------------------
function drawOutcomes(w, cfgs, names) {
  const count = (v) => (isNum(v) ? v : 0);
  const rows = cfgs.map((c) => {
    const a = aggOf(c.id) || {};
    const passed = count(a.passed_n);
    return { c, name: names.get(c.id), total: count(a.n), passed, failed: count(a.scored_n) - passed, err: count(a.errors_n), uns: count(a.unscored_n) };
  });
  const words = (r) => [`${r.passed} passed`, r.failed ? `${r.failed} failed` : null, r.err ? `${r.err} no answer` : null, r.uns ? `${r.uns} not checked` : null].filter(Boolean).join(' · ');
  const valueW = Math.ceil(Math.max(...rows.map((r) => words(r).length * CHAR))) + 8;
  const f = frame(w, valueW);
  const { layout, height } = rowLayout(rows, f.stacked ? w : f.labelW, f.stacked ? 58 : 18);
  let g = svgStart(w, height, 'Every try per setup: passed, failed, no answer, not checked');
  g += '<defs><pattern id="hatch-uns" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="chart-hatch-bg"/><line x1="0" y1="0" x2="0" y2="5" class="chart-hatch-line"/></pattern></defs>';
  rows.forEach((r, k) => {
    const { y, labelH } = layout[k];
    const by = f.stacked ? y + labelH + 34 : y + labelH / 2;
    const bw = f.stacked ? w : f.pw;
    g += nameLabel(0, y + 16, r.c, r.name, f.stacked ? w : f.labelW);
    g += `<rect x="${f.px}" y="${by}" width="${bw.toFixed(1)}" height="10" rx="3" class="chart-track"/>`;
    if (r.total > 0) {
      let x = f.px;
      const seg = (cnt, cls, extra = '') => {
        if (!cnt) return;
        const sw = (cnt / r.total) * bw;
        g += `<rect x="${x.toFixed(1)}" y="${by}" width="${sw.toFixed(1)}" height="10" class="${cls}"${extra}/>`;
        x += sw;
      };
      seg(r.passed, 'chart-mark');
      seg(r.failed, 'chart-bar');
      seg(r.err, 'chart-error');
      seg(r.uns, 'chart-hatch-rect', ' fill="url(#hatch-uns)"');
    }
    g += t(f.stacked ? 0 : w, f.stacked ? y + labelH + 18 : y + labelH / 2 + 9, r.err ? 'chart-num chart-error-text' : 'chart-num', words(r), f.stacked ? 'start' : 'end');
  });
  g += '</svg>';
  const legend = html`<div class="chart-legend"><span><span class="key-swatch key-swatch-pass"></span>passed</span><span><span class="key-swatch"></span>failed</span><span><span class="key-swatch key-swatch-error"></span>no answer</span><span><span class="key-swatch key-swatch-unscored"></span>not checked</span></div>`;
  return { svg: g, note: 'Every try of each setup.', after: legend };
}

const timed = (s) => s.facts.time !== null;
const priced = (s) => { const a = aggOf(s.id); return Boolean(a && isNum(a.mean_cost_usd) && s.facts.rate !== null); };
const steady = (s) => { const a = aggOf(s.id); return Boolean(a && a.reliability_sufficient); };
const tokened = (s) => { const a = aggOf(s.id); return Boolean(a && isNum(a.mean_input_tokens)); };

// main: the chart carries a result on its own. any: it has something to draw at all.
const CHARTS = [
  { id: 'time', title: 'Time per try', draw: drawTime, main: (l) => l.filter(timed).length >= 2, any: (l) => l.some(timed) },
  { id: 'price', title: 'Passed against price', draw: drawPrice, main: (l) => l.filter(priced).length >= 2, any: (l) => l.some(priced) },
  { id: 'consistency', title: 'Consistency', draw: drawConsistency, main: (l, c) => c.repeats >= 2 && new Set(l.filter(steady).map((s) => aggOf(s.id).reliability_agreement)).size >= 2, any: (l, c) => c.repeats >= 2 && l.some(steady) },
  { id: 'tokens', title: 'Tokens per try', draw: drawTokens, main: () => false, any: (l) => l.some(tokened) },
  { id: 'outcomes', title: 'Outcomes', draw: drawOutcomes, main: () => false, any: (l) => l.some((s) => s.facts.tries > 0) },
];

export function chartPlan(list = shownSetups(), c = ctx()) {
  if (!c || !list.length) return { main: [], more: [] };
  const main = CHARTS.filter((ch) => ch.main(list, c));
  const more = CHARTS.filter((ch) => !main.includes(ch) && ch.any(list, c));
  return { main, more };
}

const card = (ch) => html`<section class="chart-card" id="chart-${ch.id}" aria-labelledby="chart-${ch.id}-h">
  <h3 class="chart-h" id="chart-${ch.id}-h">${ch.title}</h3>
  <div class="chart chart-body" data-slot="body"></div>
  <p class="chart-note" data-slot="note"></p>
</section>`;

export function renderCharts() {
  const sect = document.getElementById('charts-sect');
  const main = document.getElementById('charts-main');
  const more = document.getElementById('charts-more');
  const moreBody = document.getElementById('charts-more-body');
  if (!sect) return;
  const plan = chartPlan();
  sect.hidden = !plan.main.length && !plan.more.length;
  if (sect.hidden) return;
  main.hidden = !plan.main.length;
  more.hidden = !plan.more.length;
  const label = document.getElementById('charts-more-label');
  if (label) setHtml(label, html`${plan.main.length ? 'More charts' : 'All charts'} <span class="count">${plan.more.length}</span>`);
  setHtml(main, html`${plan.main.map(card)}`);
  const open = more.open && plan.more.length > 0;
  setHtml(moreBody, open ? html`${plan.more.map(card)}` : '');
  const list = [...plan.main, ...(open ? plan.more : [])];
  const cfgs = selectedCfgs();
  const names = chartNames(cfgs);
  const marks = bestMarks(shownSetups());
  const token = ++drawToken;
  requestAnimationFrame(() => {
    if (token !== drawToken) return;
    list.forEach((ch) => {
      const fig = document.getElementById(`chart-${ch.id}`);
      if (!fig) return;
      const body = fig.querySelector('[data-slot="body"]');
      const w = Math.max(220, Math.floor(body.clientWidth));
      const zoom = w < PHONE ? ZOOM : 1;
      const out = ch.draw(Math.floor(w / zoom), cfgs, names, marks);
      body.innerHTML = zoom === 1 ? out.svg : out.svg.replace(/ width="(\d+)" height="(\d+)"/, (_, sw, sh) => ` width="${w}" height="${Math.round((sh * w) / sw)}"`);
      if (out.after) body.insertAdjacentHTML('beforeend', String(out.after));
      fig.querySelector('[data-slot="note"]').textContent = out.note || '';
    });
  });
}

let lastWidth = 0;
export function watchChartWidth() {
  const host = document.getElementById('main');
  if (!host || typeof ResizeObserver === 'undefined') return;
  let timer = 0;
  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (!lastWidth) {
      lastWidth = w;
      return;
    }
    if (Math.abs(w - lastWidth) < 2) return;
    lastWidth = w;
    clearTimeout(timer);
    timer = setTimeout(renderCharts, 140);
  });
  ro.observe(host);
}
