// Export: Markdown table, CSV, JSON and share cards (PNG drawn on a canvas, always in the light theme).
import { S, ctx, selectedCfgs, comparison, ctxLabel, chartNames } from './model.js';
import { leaderTable, leaderRows, verdictParts } from './leaderboard.js';
import { isNum, msText, usdText, fixed, pctText, tokText, toCsv, download, copyText, slug, NA } from './util.js';

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

function fileBase() {
  const c = ctx();
  return slug(c ? `${c.suite.id}-${c.prompt.id}-${S.sel.length}-configs` : 'model-lab');
}

function mdRows() {
  const rows = leaderRows();
  const names = chartNames(rows.map((r) => r.cfg));
  const cell = (v) => String(v).replace(/\|/g, '\\|');
  const head = ['Configuration', 'Quality (CI, n)', 'Pass rate (Wilson CI)', 'Errors', 'Latency p50 / p95', 'Cost total / per pass (API-equivalent, not billed)', 'Tokens in / cache read / out', 'tok/s', 'Human'];
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  rows.forEach((r) => {
    const a = r.agg || {};
    const q = isNum(a.mean_quality) ? `${fixed(a.mean_quality)} (${a.quality_ci ? `${fixed(a.quality_ci[0])}–${fixed(a.quality_ci[1])}` : 'insufficient repeats'}, n=${a.scored_n})` : 'unscored';
    const p = isNum(a.pass_rate) ? `${pctText(a.pass_rate)} (${a.pass_rate_ci ? `${pctText(a.pass_rate_ci[0])}–${pctText(a.pass_rate_ci[1])}` : 'insufficient repeats'})` : 'unscored';
    const cost = isNum(a.total_cost_usd) ? `${usdText(a.total_cost_usd)} / ${isNum(a.cost_per_passed_case) ? usdText(a.cost_per_passed_case) : NA}` : NA;
    lines.push(`| ${[
      `${names.get(r.cfg.id)} (${r.cfg.harness.name} ${r.cfg.harness.version}, ${r.cfg.effort || 'default'} effort, ${r.cfg.access_method})`,
      q, p, `${a.errors_n ?? NA}/${a.n ?? NA}`,
      `${msText(a.p50_latency_ms)} / ${msText(a.p95_latency_ms)}`, cost,
      `${tokText(a.mean_input_tokens)} / ${tokText(a.mean_cache_read_tokens)} / ${tokText(a.mean_output_tokens)}`,
      isNum(a.mean_tokens_per_second) ? fixed(a.mean_tokens_per_second, 1) : NA,
      isNum(a.human_mean) ? `${fixed(a.human_mean, 1)} (n=${a.human_n})` : 'no ratings',
    ].map(cell).join(' | ')} |`);
  });
  return lines;
}

export function markdown() {
  const c = ctx();
  const cmp = comparison(selectedCfgs());
  const head = `**Model Lab** · ${c ? ctxLabel(c) : 'no context'} · ${cmp.text || 'no selection'}`;
  return `${head}\n\n${mdRows().join('\n')}\n\n_Cost is API-equivalent and not billed. Generated ${stamp()} from stored runs._\n`;
}

export function csv() {
  const t = leaderTable();
  return toCsv([t.header, ...t.data]);
}

export function jsonExport() {
  const c = ctx();
  const cfgs = selectedCfgs();
  return JSON.stringify(
    {
      generated_at: stamp(),
      note: 'Cost is API-equivalent and not billed.',
      context: c && { key: c.key, suite: c.suite, prompt: c.prompt, cases: c.cases, repeats: c.repeats, partial: c.partial, runs: c.runs },
      comparison: comparison(cfgs),
      configurations: cfgs.map((x) => ({ ...x, aggregate: c && c.aggregates ? c.aggregates[x.id] : null })),
    },
    null,
    2,
  );
}

export function exportText(kind) {
  if (kind === 'csv') {
    download(`${fileBase()}.csv`, csv(), 'text/csv');
    return 'Downloaded CSV.';
  }
  if (kind === 'json') {
    download(`${fileBase()}.json`, jsonExport(), 'application/json');
    return 'Downloaded JSON.';
  }
  return null;
}

export async function copyMarkdown() {
  const ok = await copyText(markdown());
  return ok;
}

// ---- Share card -----------------------------------------------------------------------------
const LIGHT = { paper: '#F6F7F4', raised: '#FFFFFF', ink: '#14201C', ink2: '#53615B', rule: '#DDE2DC', leaf: '#0B7A55', clay: '#B4472F' };

function fit(ctx2, text, maxW) {
  if (ctx2.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx2.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

export async function shareCard(kind) {
  const square = kind === 'png11';
  const W = square ? 1080 : 1600;
  const H = square ? 1080 : 900;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  try {
    await Promise.all([
      document.fonts.load('500 40px "Instrument Sans"'),
      document.fonts.load('400 26px "Instrument Sans"'),
      document.fonts.load('600 28px "Instrument Sans"'),
      document.fonts.load('400 26px "IBM Plex Mono"'),
    ]);
  } catch {
    /* fall back to the system fonts */
  }
  const sans = '"Instrument Sans", system-ui, sans-serif';
  const mono = '"IBM Plex Mono", ui-monospace, monospace';
  const pad = square ? 64 : 80;
  g.fillStyle = LIGHT.paper;
  g.fillRect(0, 0, W, H);

  const c = ctx();
  const rows = leaderRows();
  const names = chartNames(rows.map((r) => r.cfg));
  const cmp = comparison(selectedCfgs());

  g.fillStyle = LIGHT.ink;
  g.font = `500 ${square ? 52 : 56}px ${sans}`;
  g.textBaseline = 'alphabetic';
  g.fillText('Model Lab', pad, pad + 44);
  g.fillStyle = LIGHT.ink2;
  g.font = `400 26px ${sans}`;
  g.fillText(fit(g, c ? ctxLabel(c) : 'No context', W - pad * 2), pad, pad + 92);
  g.fillText(cmp.text ? `${cmp.text}${cmp.mode === 'descriptive' ? '. Causal claims are not supported.' : ''}` : '', pad, pad + 128);

  // table
  const top = pad + 170;
  const cols = square
    ? [{ k: 'name', t: 'Configuration', w: 0.36 }, { k: 'q', t: 'Quality', w: 0.15 }, { k: 'p', t: 'Pass', w: 0.15 }, { k: 'l', t: 'p50', w: 0.16 }, { k: 'c', t: 'Cost / pass', w: 0.18 }]
    : [{ k: 'name', t: 'Configuration', w: 0.3 }, { k: 'q', t: 'Quality (95% CI)', w: 0.25 }, { k: 'p', t: 'Pass rate', w: 0.13 }, { k: 'l', t: 'Latency p50', w: 0.15 }, { k: 'c', t: 'Cost per pass', w: 0.17 }];
  const tw = W - pad * 2;
  let x = pad;
  g.fillStyle = LIGHT.ink2;
  g.font = `500 22px ${sans}`;
  cols.forEach((col) => {
    col.x = x;
    col.px = tw * col.w;
    g.fillText(col.t, x, top);
    x += col.px;
  });
  g.strokeStyle = LIGHT.rule;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(pad, top + 16);
  g.lineTo(W - pad, top + 16);
  g.stroke();
  const rowH = Math.min(square ? 92 : 70, Math.floor((H - top - 240) / Math.max(1, rows.length)));
  rows.forEach((r, i) => {
    const y = top + 16 + (i + 1) * rowH - rowH * 0.3;
    const a = r.agg || {};
    g.fillStyle = LIGHT.ink;
    g.font = `600 ${square ? 26 : 28}px ${sans}`;
    g.fillText(fit(g, names.get(r.cfg.id), cols[0].px - 24), cols[0].x, y - (rowH > 60 ? 8 : 0));
    if (rowH > 60) {
      g.fillStyle = LIGHT.ink2;
      g.font = `400 20px ${mono}`;
      g.fillText(fit(g, `${r.cfg.harness.name} ${r.cfg.harness.version} · ${r.cfg.effort || 'default'}`, cols[0].px - 24), cols[0].x, y + 20);
    }
    const put = (col, text, best) => {
      g.fillStyle = best ? LIGHT.leaf : LIGHT.ink;
      g.font = `${best ? 500 : 400} 26px ${mono}`;
      g.fillText(fit(g, text + (best ? ' ▲' : ''), col.px - 12), col.x, y);
    };
    put(cols[1], isNum(a.mean_quality) ? `${fixed(a.mean_quality)}${!square && a.quality_ci ? ` (${fixed(a.quality_ci[0])}–${fixed(a.quality_ci[1])})` : ''}` : 'unscored', r.best.quality);
    put(cols[2], isNum(a.pass_rate) ? pctText(a.pass_rate) : 'unscored', r.best.pass);
    put(cols[3], isNum(a.p50_latency_ms) ? msText(a.p50_latency_ms) : NA, r.best.p50);
    put(cols[4], isNum(a.cost_per_passed_case) ? usdText(a.cost_per_passed_case) : NA, r.best.cpp);
    g.strokeStyle = LIGHT.rule;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(pad, top + 16 + (i + 1) * rowH);
    g.lineTo(W - pad, top + 16 + (i + 1) * rowH);
    g.stroke();
  });

  // verdict
  const parts = verdictParts(rows);
  g.fillStyle = LIGHT.ink;
  g.font = `400 24px ${sans}`;
  const verdict = parts.map((p) => `${p.title}: ${p.text}`).join('. ');
  if (verdict) {
    const words = `${verdict}.`.split(' ');
    const lines = [];
    let cur = '';
    words.forEach((word) => {
      if (cur && g.measureText(`${cur} ${word}`).width > W - pad * 2) {
        lines.push(cur);
        cur = word;
      } else cur = cur ? `${cur} ${word}` : word;
    });
    if (cur) lines.push(cur);
    lines.slice(0, 3).forEach((ln, i) => g.fillText(ln, pad, H - pad - 78 - (Math.min(lines.length, 3) - 1 - i) * 32));
  }

  // provenance footer
  g.fillStyle = LIGHT.ink2;
  g.font = `400 20px ${mono}`;
  const runCount = c ? c.runs.length : 0;
  g.fillText(fit(g, c ? `${c.suite.id}@${c.suite.version} · ${c.prompt.id}@${c.prompt.version} · ${c.cases.length} cases · ${c.repeats} repeats · ${runCount} run${runCount === 1 ? '' : 's'}` : '', W - pad * 2), pad, H - pad - 38);
  g.font = `400 22px ${sans}`;
  g.fillText(fit(g, `Cost is API-equivalent and not billed. Generated ${stamp()} from stored runs.`, W - pad * 2), pad, H - pad - 8);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not draw the card.');
  download(`${fileBase()}-${square ? '1x1' : '16x9'}.png`, blob, 'image/png');
}
