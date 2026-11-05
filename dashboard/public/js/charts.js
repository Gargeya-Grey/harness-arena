// Charts: hand-rolled inline SVG. No per-configuration palette: every configuration carries its lineup
// letter and its name, marks are ink, the best value is leaf-ink, errors are clay.
// Row charts share one frame: a label column on the left, the plot on the right; narrow charts stack them.
import { S, ctx, selectedCfgs, aggOf, chartNames, letterOf } from './model.js';
import { html, esc, setHtml, isNum, msText, tokText, fixed, clamp, toCsv, download, slug, NA } from './util.js';

const LH = 17;
const CHAR = 6.9; // average width of a 13px Instrument Sans character, weight 500
const MONO = 7.25; // width of a 12px Plex Mono character
const textW = (s, mono = false) => String(s).length * (mono ? MONO : CHAR);
const BADGE = 26; // letter badge plus its gap

const exportsById = {};
let drawToken = 0;

function niceStep(span, target) {
  const rawStep = span / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(rawStep));
  const m = rawStep / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
function linearTicks(max, target) {
  const step = niceStep(max, target);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

// Fewest decimals that show every tick exactly.
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

// Full identities on separate lines: model first, then harness/effort. Never
// truncate two configurations of the same model to an indistinguishable name.
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

// The letter badge, drawn with its top-left corner at (x, y).
const badge = (x, y, letter) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="19" height="19" rx="5" class="chart-lt-bg"/>${t(x + 9.5, y + 13.4, 'chart-lt', letter || '?', 'middle')}`;

// One configuration label, wrapping at word boundaries to its allotted width.
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

function emptyChart(message) {
  return { svg: null, message };
}

// ---- Quality vs cost ----------------------------------------------------------------------------
function drawScatter(w, cfgs, names) {
  const items = [];
  const skipped = [];
  cfgs.forEach((c) => {
    const a = aggOf(c.id);
    if (!a || !isNum(a.mean_quality)) skipped.push(`${letterOf(c.id)} ${names.get(c.id)} (no quality scores)`);
    else if (!isNum(a.mean_cost_usd)) skipped.push(`${letterOf(c.id)} ${names.get(c.id)} (no cost data)`);
    else items.push({ c, a, name: names.get(c.id) });
  });
  const n = items.reduce((s, i) => s + (i.a.counted_n ?? i.a.scored_n ?? 0), 0);
  const meta = { n: `n = ${n} counted observation${n === 1 ? '' : 's'} (failed calls score 0) across ${items.length} configuration${items.length === 1 ? '' : 's'}`, note: skipped.length ? `Not plotted: ${skipped.join('; ')}.` : '', csv: [['configuration', 'mean_cost_usd_per_observation', 'mean_quality', 'quality_ci_low', 'quality_ci_high', 'counted_n']].concat(items.map((i) => [i.name, i.a.mean_cost_usd, i.a.mean_quality, i.a.quality_ci ? i.a.quality_ci[0] : null, i.a.quality_ci ? i.a.quality_ci[1] : null, i.a.counted_n ?? i.a.scored_n])) };
  if (!items.length) return { ...emptyChart('Nothing to plot. A point needs a mean quality and a mean cost; both come from scored runs with token pricing.'), meta };

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
    const ticks = linearTicks(maxC * 1.08 || 1, Math.max(2, Math.floor(pw / 90)));
    const top = ticks[ticks.length - 1] || 1;
    xOf = (v) => m.l + (v / top) * pw;
    xTicks = ticks;
  }
  const tickD = decimalsFor(xTicks);
  const yOf = (v) => m.t + (1 - clamp(v, 0, 1)) * ph;
  const bestQ = Math.max(...items.map((i) => i.a.mean_quality));
  const bestItems = items.filter((i) => i.a.mean_quality === bestQ && items.some((o) => o.a.mean_quality !== bestQ));
  const bestCost = bestItems.length ? Math.min(...bestItems.map((i) => i.a.mean_cost_usd)) : null;
  const best = new Set(bestItems.filter((i) => i.a.mean_cost_usd === bestCost).map((i) => i.c.id));

  const legend = rowLayout(items, w, 12);
  let g = svgStart(w, h + 16 + legend.height, `Quality against mean cost per observation for ${items.length} configurations`);
  g += t(0, 11, 'chart-axis-text', 'quality');
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => {
    g += line(m.l, yOf(v), w - m.r, yOf(v), 'chart-line');
    g += t(m.l - 8, yOf(v) + 4, 'chart-axis-text', v.toFixed(2), 'end');
  });
  xTicks.forEach((v) => {
    const x = xOf(v);
    g += line(x, m.t + ph, x, m.t + ph + 4, 'chart-line-dark');
    g += t(x, m.t + ph + 18, 'chart-axis-text', `$${v.toFixed(tickD)}`, x < m.l + 24 ? 'start' : x > w - 30 ? 'end' : 'middle');
  });
  g += t(w - m.r, h - 4, 'chart-axis-text', `Mean cost / observation (USD${logScale ? ', log' : ''})`, 'end');

  // Keep names in the legend, outside the plotting area. Callout letters avoid
  // both points AND the full confidence whiskers, not just the point centres.
  const marks = items.map((i) => {
    const q = i.a.quality_ci || [i.a.mean_quality, i.a.mean_quality];
    return { x: xOf(i.a.mean_cost_usd) - 7, y: Math.min(yOf(q[1]), yOf(i.a.mean_quality)) - 7, w: 14, h: Math.abs(yOf(q[0]) - yOf(q[1])) + 14 };
  });
  const hit = (a, b, pad = 3) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  const blocks = items.map((i, k) => {
    return { i, k, bw: 20, bh: 20, px: xOf(i.a.mean_cost_usd), py: yOf(i.a.mean_quality) };
  });
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
        const inside = rect.x >= 2 && rect.x + rect.w <= w - 2 && rect.y >= m.t - 12 && rect.y + rect.h <= m.t + ph + 6;
        if (!inside) continue;
        const clash = placed.filter((p) => hit(rect, p)).length * 2 + marks.filter((mk) => hit(rect, mk, 0)).length;
        if (!fallback || clash < fallback.clash) fallback = { rect, right, dy, clash };
        if (!placed.some((p) => hit(rect, p)) && !marks.some((mk) => hit(rect, mk, 0))) {
          pick = { rect, right, dy };
          break;
        }
      }
      if (pick) break;
    }
    pick = pick || fallback || { rect: { x: b.px + 10, y: b.py - b.bh / 2, w: b.bw, h: b.bh }, right: true, dy: 0 };
    b.rect = pick.rect;
    b.right = pick.right;
    placed.push(pick.rect);
  });
  blocks.forEach((b) => {
    const q = b.i.a.quality_ci;
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
  return { svg: g, meta, note: 'Whiskers show the 95% interval of mean quality when a configuration has 3 or more scored observations. Up and to the left is better.' };
}

// ---- Latency ------------------------------------------------------------------------------------
function drawLatency(w, cfgs, names) {
  const model = S.lat === 'model';
  const pick = (a) => (model ? { p50: a.p50_model_latency_ms, p95: a.p95_model_latency_ms } : { p50: a.p50_latency_ms, p95: a.p95_latency_ms });
  const rows = cfgs.map((c) => {
    const a = aggOf(c.id);
    const v = a ? pick(a) : { p50: null, p95: null };
    return { c, a, name: names.get(c.id), ...v };
  });
  const have = rows.filter((r) => isNum(r.p50));
  const n = model ? null : rows.reduce((s, r) => s + (r.a && isNum(r.a.latency_n) ? r.a.latency_n : 0), 0);
  const meta = {
    n: model ? 'Model request time, successful calls only. n is not reported per configuration.' : `n = ${n} successful call${n === 1 ? '' : 's'} across ${have.length} configuration${have.length === 1 ? '' : 's'}. Failed calls are excluded.`,
    csv: [['configuration', 'mode', 'p50_ms', 'p95_ms', 'latency_n']].concat(rows.map((r) => [r.name, model ? 'model request' : 'harness end-to-end', r.p50, r.p95, r.a ? r.a.latency_n : null])),
  };
  if (!have.length) return { ...emptyChart(model ? 'No model request times. This harness did not report them; switch to harness end-to-end.' : 'No latency data for the selected configurations.'), meta };
  const maxV = Math.max(...have.map((r) => (isNum(r.p95) ? r.p95 : r.p50)));
  const f = frame(w);
  const { layout, height } = rowLayout(rows, f.stacked ? w : f.labelW, f.stacked ? 62 : 34);
  const h = height + 26;
  const ticks = linearTicks(maxV * 1.05, Math.max(2, Math.floor(f.pw / 90)));
  const top = ticks[ticks.length - 1] || 1;
  const xOf = (v) => f.px + (v / top) * f.pw;
  const bestP50 = have.length > 1 ? Math.min(...have.map((r) => r.p50)) : null;
  const allEqual = have.every((r) => r.p50 === have[0].p50);
  let g = svgStart(w, h, `${model ? 'Model request' : 'Harness end-to-end'} latency, p50 to p95, per configuration`);
  ticks.forEach((v) => {
    const x = xOf(v);
    g += line(x, 0, x, height, 'chart-line');
    g += t(x, height + 17, 'chart-axis-text', v === 0 ? '0 s' : msText(v), v === 0 ? 'start' : x > w - 30 ? 'end' : 'middle');
  });
  rows.forEach((r, k) => {
    const { y, labelH } = layout[k];
    const isBest = bestP50 !== null && !allEqual && r.p50 === bestP50;
    const values = isNum(r.p50) ? `p50 ${msText(r.p50)} · p95 ${isNum(r.p95) ? msText(r.p95) : NA}` : (model ? 'not reported' : 'no successful calls');
    if (f.stacked) {
      g += nameLabel(0, y + 16, r.c, r.name, w, isBest);
      g += t(BADGE, y + labelH + 18, 'chart-num', values);
    } else {
      g += nameLabel(0, y + 18, r.c, r.name, f.labelW, isBest);
      g += t(BADGE, y + labelH + 18, 'chart-num', values);
    }
    if (!isNum(r.p50)) return;
    const hi = isNum(r.p95) ? r.p95 : r.p50;
    const cy = f.stacked ? y + labelH + 40 : y + labelH / 2;
    g += line(xOf(r.p50), cy, xOf(hi), cy, isBest ? 'chart-range-best' : 'chart-range');
    // The p95 ring goes first, so a p50 dot close to it stays visible on top.
    if (hi !== r.p50) g += `<circle cx="${xOf(hi).toFixed(1)}" cy="${cy}" r="5" class="${isBest ? 'chart-ring-best' : 'chart-ring'}"/>`;
    g += `<circle cx="${xOf(r.p50).toFixed(1)}" cy="${cy}" r="5" class="${isBest ? 'chart-mark-best' : 'chart-mark'}"/>`;
  });
  g += '</svg>';
  return { svg: g, meta, note: 'Filled dot: p50. Open dot: p95. The line between them is the typical spread. Left is faster.' };
}

// ---- Tokens -------------------------------------------------------------------------------------
function drawTokens(w, cfgs, names) {
  const rows = cfgs.map((c) => ({ c, a: aggOf(c.id), name: names.get(c.id) }));
  const metrics = [
    { key: 'mean_input_tokens', label: 'input' },
    { key: 'mean_cache_read_tokens', label: 'cache read' },
    { key: 'mean_output_tokens', label: 'output' },
  ];
  const n = rows.reduce((s, r) => s + (r.a && isNum(r.a.ok_n) ? r.a.ok_n : 0), 0);
  const have = rows.filter((r) => r.a && isNum(r.a.mean_input_tokens));
  const meta = {
    n: `n = ${n} successful call${n === 1 ? '' : 's'} across ${have.length} configuration${have.length === 1 ? '' : 's'}`,
    csv: [['configuration', 'mean_input_tokens', 'mean_cache_read_tokens', 'mean_cache_write_tokens', 'mean_output_tokens']].concat(rows.map((r) => [r.name, r.a && r.a.mean_input_tokens, r.a && r.a.mean_cache_read_tokens, r.a && r.a.mean_cache_write_tokens, r.a && r.a.mean_output_tokens])),
  };
  if (!have.length) return { ...emptyChart('No token counts for the selected configurations.'), meta };
  const maxOf = Object.fromEntries(metrics.map((mt) => [mt.key, Math.max(0, ...rows.map((r) => (r.a && isNum(r.a[mt.key]) ? r.a[mt.key] : 0)))]));
  const f = frame(w);
  const bar = (x, y, bw, v, key) => {
    let s = `<rect x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="6" rx="3" class="chart-track"/>`;
    if (isNum(v) && maxOf[key] > 0) s += `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(v > 0 ? 3 : 0, (v / maxOf[key]) * bw).toFixed(1)}" height="6" rx="3" class="chart-bar"/>`;
    return s;
  };
  let g;
  if (f.stacked) {
    const { layout, height } = rowLayout(rows, w, metrics.length * 22 + 18);
    const lw = 76;
    const vw = 56;
    g = svgStart(w, height, 'Mean input, cache read and output tokens per call, each on its own scale');
    rows.forEach((r, k) => {
      const { y, labelH } = layout[k];
      g += nameLabel(0, y + 16, r.c, r.name, w);
      metrics.forEach((mt, j) => {
        const by = y + labelH + 12 + j * 22;
        const v = r.a ? r.a[mt.key] : null;
        g += t(0, by + 11, 'chart-axis-text', mt.label);
        g += bar(lw, by + 4, Math.max(30, w - lw - vw - 8), v, mt.key);
        g += t(w, by + 11, 'chart-num', isNum(v) ? tokText(v) : NA, 'end');
      });
    });
  } else {
    const headH = 22;
    const { layout, height } = rowLayout(rows, f.labelW, 18);
    const gap = 18;
    const colW = (w - f.px - gap * (metrics.length - 1)) / metrics.length;
    g = svgStart(w, headH + height, 'Mean input, cache read and output tokens per call, each on its own scale');
    metrics.forEach((mt, j) => { g += t(f.px + j * (colW + gap), 12, 'chart-axis-text', mt.label); });
    g += line(0, headH - 4, w, headH - 4, 'chart-line');
    rows.forEach((r, k) => {
      const y = headH + layout[k].y;
      g += nameLabel(0, y + 24, r.c, r.name, f.labelW);
      metrics.forEach((mt, j) => {
        const x = f.px + j * (colW + gap);
        const v = r.a ? r.a[mt.key] : null;
        g += t(x, y + 18, 'chart-num', isNum(v) ? tokText(v) : NA);
        g += bar(x, y + 25, colW, v, mt.key);
      });
    });
  }
  g += '</svg>';
  return { svg: g, meta, note: 'Each token type has its own scale, so compare bars within one column only. Input counts every prompt token, cached ones included.' };
}

// ---- Reliability --------------------------------------------------------------------------------
function drawReliability(w, cfgs, names) {
  const rows = cfgs.map((c) => ({ c, a: aggOf(c.id), name: names.get(c.id) }));
  const firm = rows.filter((r) => r.a && r.a.reliability_sufficient && isNum(r.a.reliability_agreement));
  const n = rows.reduce((s, r) => s + (r.a && isNum(r.a.reliability_cases) ? r.a.reliability_cases : 0), 0);
  const meta = {
    n: `n = ${n} case${n === 1 ? '' : 's'} with repeats across ${firm.length} configuration${firm.length === 1 ? '' : 's'}`,
    csv: [['configuration', 'reliability_agreement', 'reliability_cases', 'repeats', 'sufficient']].concat(rows.map((r) => [r.name, r.a && r.a.reliability_agreement, r.a && r.a.reliability_cases, r.a && r.a.repeats, r.a && r.a.reliability_sufficient])),
  };
  if (!rows.length) return { ...emptyChart('No configurations selected.'), meta };
  const valueW = 48;
  const f = frame(w, valueW);
  const { layout, height } = rowLayout(rows, f.stacked ? w : f.labelW, f.stacked ? 36 : 18);
  const top = firm.length > 1 ? Math.max(...firm.map((r) => r.a.reliability_agreement)) : null;
  const allEqual = firm.every((r) => r.a.reliability_agreement === firm[0].a.reliability_agreement);
  let g = svgStart(w, height, 'Agreement across repeats per configuration');
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
      g += t(w, by + 8, isBest ? 'chart-num chart-best' : 'chart-num', fixed(r.a.reliability_agreement, 2), 'end');
    } else {
      g += t(f.px, by + 8, 'chart-num', 'insufficient repeats');
    }
  });
  g += '</svg>';
  return { svg: g, meta, note: 'Agreement across repeats of the same case: 1.00 means every repeat gave the same outcome. It needs 2 or more repeats of at least 1 case. Higher is better.' };
}

// ---- Errors -------------------------------------------------------------------------------------
function drawErrors(w, cfgs, names) {
  const count = (v) => (isNum(v) ? v : 0);
  const rows = cfgs.map((c) => {
    const a = aggOf(c.id);
    return { c, a, name: names.get(c.id), total: a ? count(a.n) : 0, err: a ? count(a.errors_n) : 0, uns: a ? count(a.unscored_n) : 0, ok: a ? count(a.scored_n) : 0 };
  });
  const n = rows.reduce((s, r) => s + r.total, 0);
  const meta = {
    n: `n = ${n} attempt${n === 1 ? '' : 's'} across ${rows.length} configuration${rows.length === 1 ? '' : 's'}. The denominator is every attempt, failures included.`,
    csv: [['configuration', 'attempts', 'ok_scored', 'error', 'unscored']].concat(rows.map((r) => [r.name, r.total, r.ok, r.err, r.uns])),
  };
  if (!rows.length || !n) return { ...emptyChart('No attempts recorded for the selected configurations.'), meta };
  const countText = (r) => `${r.ok} scored · ${r.err} error · ${r.uns} unscored`;
  const valueW = Math.ceil(Math.max(...rows.map((r) => textW(countText(r), true)))) + 8;
  const f = frame(w, valueW);
  const { layout, height } = rowLayout(rows, f.stacked ? w : f.labelW, f.stacked ? 58 : 18);
  let g = svgStart(w, height, 'Outcome counts per configuration: scored, error, unscored');
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
      seg(r.ok, 'chart-bar');
      seg(r.err, 'chart-error');
      seg(r.uns, 'chart-hatch-rect', ' fill="url(#hatch-uns)"');
    }
    g += `<text x="${f.stacked ? 0 : w}" y="${f.stacked ? y + labelH + 18 : y + labelH / 2 + 9}" class="chart-num" text-anchor="${f.stacked ? 'start' : 'end'}">${r.ok} scored · <tspan class="${r.err ? 'chart-num chart-error-text' : 'chart-num'}">${r.err} error</tspan> · ${r.uns} unscored</text>`;
  });
  g += '</svg>';
  const legend = html`<div class="chart-legend"><span><span class="swatch"></span>scored</span><span><span class="swatch swatch-error"></span>error</span><span><span class="swatch swatch-unscored"></span>unscored</span></div>`;
  return { svg: g, meta, note: 'Each bar shows all attempts for one configuration. An error is a failed call; unscored means no evaluator verdict.', after: legend };
}

const CHARTS = [
  { id: 'scatter', title: 'Quality against cost', draw: drawScatter, file: 'quality-vs-cost', overview: true },
  { id: 'latency', title: 'Latency', draw: drawLatency, file: 'latency', toggle: true, overview: true },
  { id: 'tokens', title: 'Tokens per call', draw: drawTokens, file: 'tokens' },
  { id: 'reliability', title: 'Reliability', draw: drawReliability, file: 'reliability' },
  { id: 'errors', title: 'Errors', draw: drawErrors, file: 'errors', wide: true },
];

// The Overview shows the two charts that answer "which is best for the money". The Charts view shows all five.
function chartHost() {
  if (S.view === 'overview') return { host: document.getElementById('charts-body'), list: CHARTS.filter((ch) => ch.overview), other: document.getElementById('charts-all') };
  if (S.view === 'charts') return { host: document.getElementById('charts-all'), list: CHARTS, other: document.getElementById('charts-body') };
  return null;
}

export function renderCharts() {
  const target = chartHost();
  if (!target) return;
  const { host, list, other } = target;
  if (other) other.innerHTML = '';
  const c = ctx();
  const cfgs = selectedCfgs();
  if (!c) {
    setHtml(host, html`<div class="empty chart-wide">No runs yet. Run <code>node lab run experiments/smoke-harness-sweep.yaml</code>, then Refresh.</div>`);
    return;
  }
  if (!cfgs.length) {
    setHtml(host, html`<div class="empty chart-wide">No configurations selected. Add configurations to the lineup to draw the charts.</div>`);
    return;
  }
  const token = ++drawToken;
  const names = chartNames(cfgs);
  const shell = list.map((ch) => html`<section class="chart${ch.wide ? ' chart-wide' : ''}" id="chart-${ch.id}" aria-labelledby="chart-${ch.id}-h">
    <div class="chart-head">
      <div class="chart-title"><h3 id="chart-${ch.id}-h">${ch.title}</h3><span class="chart-n" data-slot="n"></span></div>
      <div class="chart-tools">
        <button type="button" class="link-btn" data-act="chart-svg" data-chart="${ch.id}" data-fk="chart:${ch.id}:svg" aria-label="Download ${ch.title} as SVG">SVG</button>
        <button type="button" class="link-btn" data-act="chart-csv" data-chart="${ch.id}" data-fk="chart:${ch.id}:csv" aria-label="Download ${ch.title} as CSV">CSV</button>
      </div>
    </div>
    ${ch.toggle ? html`<div class="chart-toggle" role="group" aria-label="Latency measure">
      <button type="button" class="ctl" data-act="lat" data-lat="harness" data-fk="lat:harness" aria-pressed="${String(S.lat === 'harness')}">Harness end-to-end</button>
      <button type="button" class="ctl" data-act="lat" data-lat="model" data-fk="lat:model" aria-pressed="${String(S.lat === 'model')}">Model request</button></div>` : ''}
    <div class="chart-body" data-slot="body"></div>
    <div class="chart-note" data-slot="note"></div>
  </section>`);
  setHtml(host, html`${shell}`);
  requestAnimationFrame(() => {
    if (token !== drawToken) return;
    list.forEach((ch) => {
      const fig = document.getElementById(`chart-${ch.id}`);
      if (!fig) return;
      const body = fig.querySelector('[data-slot="body"]');
      const w = Math.max(220, Math.floor(body.clientWidth));
      const out = ch.draw(w, cfgs, names);
      exportsById[ch.id] = { csv: out.meta.csv, file: ch.file };
      fig.querySelector('[data-slot="n"]').textContent = out.meta.n;
      const noteParts = [out.note, out.meta.note].filter(Boolean).join(' ');
      fig.querySelector('[data-slot="note"]').textContent = noteParts;
      if (out.svg) {
        body.innerHTML = out.svg;
        if (out.after) body.insertAdjacentHTML('beforeend', String(out.after));
      } else {
        body.innerHTML = String(html`<div class="empty">${out.message}</div>`);
      }
      const svgBtn = fig.querySelector('[data-act="chart-svg"]');
      if (svgBtn) svgBtn.disabled = !out.svg;
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

// ---- Export -------------------------------------------------------------------------------------
function exportStyle() {
  const root = getComputedStyle(document.documentElement);
  const resolve = (s) => s.replace(/var\((--[a-z0-9-]+)\)/g, (_, name) => root.getPropertyValue(name).trim() || '#000');
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of list) {
      if (rule.selectorText && /\.chart-(text|num|axis-text|best|line|mark|ring|range|track|bar|error|hatch|whisker|lt)/.test(rule.selectorText)) rules.push(resolve(rule.cssText));
    }
  }
  return rules.join('\n');
}

export function chartSvgString(id) {
  const svg = document.querySelector(`#chart-${id} svg`);
  if (!svg) return null;
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--paper-raised').trim() || '#fff';
  const w = clone.getAttribute('width');
  const h = clone.getAttribute('height');
  clone.insertAdjacentHTML('afterbegin', `<style>${exportStyle()}</style><rect width="${w}" height="${h}" fill="${bg}"/>`);
  return new XMLSerializer().serializeToString(clone);
}

export function downloadChart(id, kind) {
  const entry = exportsById[id];
  if (!entry) return false;
  const ctxPart = slug(ctx() ? ctx().key.split('::')[0] : 'model-lab');
  if (kind === 'svg') {
    const s = chartSvgString(id);
    if (!s) return false;
    download(`${ctxPart}-${entry.file}.svg`, s, 'image/svg+xml');
  } else {
    download(`${ctxPart}-${entry.file}.csv`, toCsv(entry.csv), 'text/csv');
  }
  return true;
}
