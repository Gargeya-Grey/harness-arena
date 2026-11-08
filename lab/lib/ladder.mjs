// The difficulty ladder (configs/ladder.yaml, docs/difficulty.md): five tiers over
// three suites. This file turns case definitions into ladder cases and checks
// ladder cases against the tier table.
//
// A definition is one file under datasets/<suite>/defs/ (any depth). Its default
// export is a definition, an array of them, or a function (sync or async) that
// returns either. Every definition has
//   slug   lowercase words joined by dashes; the case_id is <suite>-<slug>
//   tier   { level, human_minutes, basis, origin? }
//   tags   optional extra tags
// plus the fields its suite's generate.mjs turns into input and expected.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadYamlFile, paths } from './repo.mjs';
import { readJsonl } from './fsutil.mjs';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function loadLadder(root) {
  const ladder = loadYamlFile(path.join(root, 'configs', 'ladder.yaml'));
  ladder.byLevel = new Map(ladder.tiers.map((tier) => [tier.level, tier]));
  return ladder;
}

export const tierTag = (tier) => `tier-${tier.level}-${tier.name}`;

/** Every definition file under dir, in a stable order. Files whose name starts with _ are helpers. */
export function definitionFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...definitionFiles(full));
    else if (entry.name.endsWith('.mjs') && !entry.name.startsWith('_')) out.push(full);
  }
  return out;
}

export async function loadDefinitions(dir) {
  const defs = [];
  for (const file of definitionFiles(dir)) {
    let value = (await import(pathToFileURL(file).href)).default;
    if (typeof value === 'function') value = await value();
    for (const def of [value].flat()) defs.push({ ...def, file: path.relative(dir, file).replaceAll('\\', '/') });
  }
  return defs;
}

/**
 * The tasks a suite has retired: defs/_retired.mjs default-exports { <slug>: <reason> }.
 * A retired task keeps its definition, so its slug stays taken (a case_id is never reused)
 * and its proofs keep running, but it is not in cases.jsonl. Bringing it back is one line.
 */
export async function loadRetired(dir) {
  const file = path.join(dir, '_retired.mjs');
  if (!fs.existsSync(file)) return new Map();
  const list = (await import(pathToFileURL(file).href)).default || {};
  for (const [slug, reason] of Object.entries(list)) {
    if (typeof reason !== 'string' || reason.trim().length < 10) throw new Error(`_retired.mjs: "${slug}" needs a reason`);
  }
  return new Map(Object.entries(list));
}

/**
 * Ladder cases from definitions. toCase(def) returns { input, expected, tags?, metadata? }
 * for one definition; this adds the case_id, the tier tag and metadata.tier, and sorts by
 * tier, then slug. Throws on a bad slug or tier, a slug used twice, or a retired slug that
 * no definition has. Retired definitions are checked and left out, unless includeRetired
 * (for the tests that prove them); then metadata.tier.retired holds the reason.
 */
export async function assembleCases({ suiteId, defs, ladder, toCase, retired = new Map(), includeRetired = false }) {
  const seen = new Set();
  const cases = [];
  for (const def of defs) {
    if (!SLUG.test(def.slug || '')) throw new Error(`${def.file}: bad slug "${def.slug}"`);
    if (seen.has(def.slug)) throw new Error(`${def.file}: slug "${def.slug}" is used twice`);
    seen.add(def.slug);
    const tier = ladder.byLevel.get(def.tier?.level);
    if (!tier) throw new Error(`${def.file}: tier.level must be one of ${[...ladder.byLevel.keys()].join(', ')}`);
    if (retired.has(def.slug) && !includeRetired) continue;
    const made = await toCase(def);
    const metadata = { ...(made.metadata || {}), tier: { level: tier.level, name: tier.name, human_minutes: def.tier.human_minutes, basis: def.tier.basis } };
    if (def.tier.origin) metadata.tier.origin = def.tier.origin;
    if (def.tier.moved !== undefined) metadata.tier.moved = def.tier.moved;
    if (retired.has(def.slug)) metadata.tier.retired = retired.get(def.slug);
    cases.push({
      case_id: `${suiteId}-${def.slug}`,
      input: made.input,
      expected: made.expected,
      tags: [tierTag(tier), ...new Set([...(def.tags || []), ...(made.tags || [])])],
      metadata,
    });
  }
  const unknown = [...retired.keys()].filter((slug) => !seen.has(slug));
  if (unknown.length) throw new Error(`_retired.mjs names ${unknown.join(', ')}, which no definition has`);
  return cases.sort((a, b) => a.metadata.tier.level - b.metadata.tier.level || a.case_id.localeCompare(b.case_id));
}

export const casesText = (cases) => cases.map((item) => `${JSON.stringify(item)}\n`).join('');

// Calibration rule 3 (docs/difficulty.md): a task may move to a tier whose expert-time range is
// within this factor of the task's own expert time.
export const MOVE_FACTOR = 4;
export const withinMoveRange = (minutes, tier) =>
  typeof minutes === 'number' && minutes >= tier.minutes[0] / MOVE_FACTOR && minutes <= tier.minutes[1] * MOVE_FACTOR;

/**
 * Problems with one ladder case: tier fields, tag, and expert time inside the tier's range.
 * A case that calibration moved (metadata.tier.moved = { from, evidence }) keeps its expert
 * time, which then only has to be within a factor of MOVE_FACTOR of the new tier's range.
 */
export function caseProblems(item, ladder) {
  const problems = [];
  const at = item.case_id;
  const meta = item.metadata?.tier;
  const tier = ladder.byLevel.get(meta?.level);
  if (!tier) return [`${at}: metadata.tier.level is missing or unknown`];
  if (meta.name !== tier.name) problems.push(`${at}: tier name "${meta.name}" is not "${tier.name}"`);
  if (item.tags?.[0] !== tierTag(tier)) problems.push(`${at}: first tag must be "${tierTag(tier)}"`);
  const [low, high] = tier.minutes;
  const moved = meta.moved;
  if (moved !== undefined) {
    if (!moved || !ladder.byLevel.has(moved.from) || moved.from === tier.level) problems.push(`${at}: tier.moved.from must be the level of another tier`);
    if (typeof moved?.evidence !== 'string' || moved.evidence.trim().length < 10) problems.push(`${at}: tier.moved.evidence must name the pilot that moved the task`);
    if (!withinMoveRange(meta.human_minutes, tier)) {
      problems.push(`${at}: human_minutes ${meta.human_minutes} is more than a factor of ${MOVE_FACTOR} outside ${tier.name} (${low} to ${high}), too far for a moved task`);
    }
  } else if (!(typeof meta.human_minutes === 'number' && meta.human_minutes > low && meta.human_minutes <= high)) {
    problems.push(`${at}: human_minutes ${meta.human_minutes} is outside ${tier.name} (more than ${low}, at most ${high})`);
  }
  if (typeof meta.basis !== 'string' || meta.basis.trim().length < 10) problems.push(`${at}: metadata.tier.basis must say how the time was estimated`);
  return problems;
}

/** The ladder as stored: cases per suite and tier, and every problem against configs/ladder.yaml. */
export function ladderStatus(root) {
  const ladder = loadLadder(root);
  const problems = [];
  const counts = new Map(ladder.tiers.map((tier) => [tier.level, Object.fromEntries(Object.keys(ladder.suites).map((kind) => [kind, 0]))]));
  const cases = [];
  for (const [kind, suiteId] of Object.entries(ladder.suites)) {
    const file = path.join(paths(root).datasets, suiteId, 'cases.jsonl');
    const { rows, problems: lineProblems } = readJsonl(file);
    for (const line of lineProblems) problems.push(`${suiteId}/cases.jsonl:${line.line}: ${line.message}`);
    for (const item of rows) {
      cases.push({ kind, suite: suiteId, item });
      problems.push(...caseProblems(item, ladder));
      const level = item.metadata?.tier?.level;
      if (counts.has(level)) counts.get(level)[kind] += 1;
    }
  }
  for (const tier of ladder.tiers) {
    const kinds = Object.values(tier.kinds).reduce((sum, n) => sum + n, 0);
    if (kinds !== tier.tasks) problems.push(`configs/ladder.yaml: ${tier.name} kinds add up to ${kinds}, not ${tier.tasks}`);
    for (const [kind, want] of Object.entries(tier.kinds)) {
      const have = counts.get(tier.level)[kind];
      if (have !== want) problems.push(`${tier.name}: ${have} ${kind} task(s), the ladder asks for ${want}`);
    }
  }
  return { ladder, cases, counts, problems };
}
