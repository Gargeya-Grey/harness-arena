// Builds the dashboard's view of the evidence: contexts, configurations,
// observations, runs, cases and aggregates. Read-only over results/.

import fs from 'node:fs';
import path from 'node:path';
import { listDirs, listFiles, readJson, readJsonl, resolveInside, safeSegment, isoNow } from './fsutil.mjs';
import { paths, loadRegistry, loadCases, runDirs } from './repo.mjs';
import { SchemaSet } from './schema.mjs';
import { clusteredInterval, mean, percentile, sum, variance } from './metrics.mjs';
import { errorClass, modelCheck, runLiveness } from './checks.mjs';
import { ledgerPath, loadLedger, runCounts, scoreFileNames, trustRun } from './ledger.mjs';

const TEXT_INLINE_LIMIT = 2 * 1024 * 1024;

export function humanizeModel(value) {
  return String(value || '')
    .split('/')
    .pop()
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * `<model_key>__<harness>-<version>__<effort or default>`, plus `__isolated` when the
 * harness ran without the user's own setup, plus `__no-tools` when an answer run turned the
 * harness's tools off through its config. Computed, never stored.
 */
export function configId(modelKey, harness, effort, userConfig = 'loaded', answerTools = 'default') {
  return [
    safeSegment(modelKey),
    `${safeSegment(harness?.name)}-${safeSegment(harness?.version)}`,
    safeSegment(effort || 'default'),
    ...(userConfig === 'isolated' ? ['isolated'] : []),
    ...(answerTools === 'off' ? ['no-tools'] : []),
  ].join('__');
}

/** Runs written before the setting existed loaded the user's setup. */
export function userConfigOf(manifest) {
  return manifest?.harness?.settings?.user_config === 'isolated' ? 'isolated' : 'loaded';
}

/**
 * "off" when an answer run recorded access flags: the env vars that turn the harness's tools
 * off (OpenCode). Such a run is not a repeat of an earlier run of the same harness that
 * could use tools, so it gets its own configuration. Edit runs and older runs: "default".
 */
export function answerToolsOf(manifest) {
  const settings = manifest?.harness?.settings || {};
  return settings.access !== 'edit' && (settings.access_flags || []).length ? 'off' : 'default';
}

export function contextKey(manifest, caseIds) {
  const evaluators = (manifest.evaluators || [])
    .map((item) => `${item.id}@${item.version}`)
    .sort()
    .join('|');
  return [
    `${manifest.suite.id}@${manifest.suite.version}`,
    `${manifest.prompt.id}@${manifest.prompt.version}`,
    evaluators,
    [...caseIds].sort().join(','),
    String(manifest.repeats),
  ].join('::');
}

/** Which configuration axes vary across a set of configurations. */
export function comparisonMode(configs) {
  if (!configs.length) return { mode: 'empty', axes: [] };
  if (configs.length === 1) return { mode: 'single', axes: [] };
  const axes = [];
  const varies = (pick) => new Set(configs.map(pick)).size > 1;
  if (varies((c) => c.model_key)) axes.push('model');
  if (varies((c) => `${c.harness.name}@${c.harness.version}`)) axes.push('harness');
  if (varies((c) => c.effort || 'default')) axes.push('effort');
  if (varies((c) => `${c.params?.temperature ?? ''}|${c.params?.max_tokens ?? ''}`)) axes.push('decoding');
  if (varies((c) => c.user_config || 'loaded')) axes.push('setup');
  if (varies((c) => c.answer_tools || 'default')) axes.push('answer tools');
  if (!axes.length) return { mode: 'replicate', axes };
  return { mode: axes.length === 1 ? 'controlled' : 'descriptive', axes };
}

function buildConfig(manifest, modelKey, raw, registry) {
  const entry = (manifest.models || []).find((item) => item.model_key === modelKey) || {};
  const registered = registry[modelKey] || {};
  const harness = manifest.harness || {};
  const effort = entry.reasoning_effort || raw?.request?.params?.reasoning_effort || null;
  const displayName = registered.display_name || humanizeModel(entry.model || modelKey);
  const userConfig = userConfigOf(manifest);
  const answerTools = answerToolsOf(manifest);
  const setup = `${userConfig === 'isolated' ? ' · isolated' : ''}${answerTools === 'off' ? ' · no tools' : ''}`;
  return {
    id: configId(modelKey, harness, effort, userConfig, answerTools),
    model_key: modelKey,
    display_name: displayName,
    short_label: `${displayName} · ${harness.name || 'unknown'}${effort ? ` · ${effort}` : ''}${setup}`,
    label: `${displayName} · ${harness.name || 'unknown'} ${harness.version || ''}${effort ? ` · ${effort}` : ''}${setup}`.replace(/\s+/g, ' ').trim(),
    user_config: userConfig,
    user_config_flags: harness.settings?.user_config_flags || [],
    answer_tools: answerTools,
    provider: entry.provider || registered.provider || 'unknown',
    model: entry.model || registered.model || modelKey,
    harness: {
      name: harness.name || 'unknown',
      version: harness.version || 'unknown',
      entrypoint: harness.entrypoint || null,
      access_method: harness.access_method || null,
    },
    effort,
    context_window: entry.context_window ?? registered.context_window ?? null,
    params: { ...(entry.params || {}), ...(raw?.request?.params || {}) },
    pricing: entry.pricing || null,
    // A free alias such as opencode/beam-free can point at a new model at any time.
    pinned: registered.pinned !== false,
    access_method: harness.access_method || 'unknown',
  };
}

export function mimeKind(mime) {
  if (!mime) return 'binary';
  if (mime.includes('svg')) return 'svg';
  if (mime.startsWith('text/html')) return 'html';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'binary';
}

function buildArtifacts(runDir, manifest, raw) {
  const artifacts = [];
  for (const item of Array.isArray(raw.artifacts) ? raw.artifacts : []) {
    const abs = item.path ? resolveInside(runDir, item.path) : null;
    const exists = Boolean(abs && fs.existsSync(abs) && fs.statSync(abs).isFile());
    const kind = mimeKind(item.mime);
    let content = null;
    if (exists && kind === 'text' && fs.statSync(abs).size <= TEXT_INLINE_LIMIT) content = fs.readFileSync(abs, 'utf8');
    artifacts.push({
      artifact_id: item.artifact_id || null,
      role: item.role || 'raw',
      mime: item.mime || 'application/octet-stream',
      kind,
      path: item.path || null,
      sha256: item.sha256 || null,
      derived: Boolean(item.derived),
      available: exists,
      content,
      url: exists ? `/api/artifact?run_id=${encodeURIComponent(manifest.run_id)}&path=${encodeURIComponent(item.path)}` : null,
    });
  }
  if (!artifacts.length && typeof raw.response?.text === 'string') {
    artifacts.push({
      artifact_id: `${safeSegment(raw.case_id)}__${safeSegment(raw.model_key)}__r${raw.repeat}__text`,
      role: 'raw',
      mime: 'text/plain',
      kind: 'text',
      path: null,
      sha256: null,
      derived: false,
      available: true,
      content: raw.response.text,
      url: null,
    });
  }
  return artifacts;
}

function observationStatus(raw, quality) {
  if (raw.error) return 'error';
  if (quality == null) return 'unscored';
  return 'ok';
}

/**
 * The rows that count for quality: every scored row, plus every error the
 * configuration caused, at 0. A lost row (quota, sign-in, CLI missing) does not
 * count; it shows as lost_n. Without a quality evaluator nothing counts. A run that
 * is still running, or was never scored (halted by the guard), counts nothing: its
 * answers have no score yet, so its errors alone would pull the mean down.
 */
export function countedRows(rows, hasQuality) {
  if (!hasQuality) return [];
  return rows.flatMap((row) => {
    if (!row.run_scored) return [];
    if (row.error) return row.error_class === 'failed' ? [{ case_id: row.case_id, value: 0, passed: false }] : [];
    return row.quality == null ? [] : [{ case_id: row.case_id, value: row.quality, passed: Boolean(row.passed) }];
  });
}

function byCaseValues(counted, pick) {
  const groups = new Map();
  for (const row of counted) {
    if (!groups.has(row.case_id)) groups.set(row.case_id, []);
    groups.get(row.case_id).push(pick(row));
  }
  return [...groups.values()];
}

function aggregate(rows, config, { hasQuality = true } = {}) {
  const ok = rows.filter((row) => !row.error);
  const scored = rows.filter((row) => row.quality != null);
  const counted = countedRows(rows, hasQuality);
  const passed = counted.filter((row) => row.passed);
  const qualities = counted.map((row) => row.value);
  const latencies = ok.map((row) => row.latency_ms).filter((v) => typeof v === 'number');
  const modelLatencies = ok.map((row) => row.model_request_duration_ms).filter((v) => typeof v === 'number');
  const costs = rows.map((row) => row.cost_usd).filter((v) => typeof v === 'number');
  const pick = (key) => rows.map((row) => row.usage?.[key]).filter((v) => typeof v === 'number');
  const speeds = ok.map((row) => row.tokens_per_second).filter((v) => typeof v === 'number');
  const human = rows.map((row) => row.human?.value).filter((v) => typeof v === 'number');
  const formatScores = rows.flatMap((row) => row.scores).filter((score) => score.dimension === 'format');

  const byCase = new Map();
  for (const row of rows) {
    if (!byCase.has(row.case_id)) byCase.set(row.case_id, []);
    byCase.get(row.case_id).push(row);
  }
  const agreements = [];
  const caseVariances = [];
  for (const caseRows of byCase.values()) {
    if (caseRows.length < 2) continue;
    const counts = {};
    for (const row of caseRows) {
      const outcome = row.error ? 'error' : row.passed == null ? 'unscored' : row.passed ? 'pass' : 'fail';
      counts[outcome] = (counts[outcome] || 0) + 1;
    }
    agreements.push(Math.max(...Object.values(counts)) / caseRows.length);
    const values = caseRows.map((row) => row.quality).filter((v) => v != null);
    const v = variance(values);
    if (v != null) caseVariances.push(v);
  }

  const totalCost = costs.length ? sum(costs) : null;
  return {
    id: config.id,
    n: rows.length,
    ok_n: ok.length,
    scored_n: scored.length,
    counted_n: counted.length,
    cases_n: new Set(counted.map((row) => row.case_id)).size,
    unscored_n: ok.filter((row) => row.quality == null).length,
    passed_n: passed.length,
    errors_n: rows.length - ok.length,
    failed_n: rows.filter((row) => row.error_class === 'failed').length,
    lost_n: rows.filter((row) => row.error_class === 'lost').length,
    // Quality counts the configuration's own errors as 0; answered_quality leaves them out.
    mean_quality: mean(qualities),
    answered_quality: mean(scored.map((row) => row.quality)),
    quality_ci: clusteredInterval(byCaseValues(counted, (row) => row.value), config.id),
    pass_rate: counted.length ? passed.length / counted.length : null,
    pass_rate_ci: clusteredInterval(byCaseValues(counted, (row) => (row.passed ? 1 : 0)), `${config.id}|pass`),
    model_mismatch_n: rows.filter((row) => row.model_check === 'mismatch').length,
    model_unknown_n: rows.filter((row) => row.model_check === 'unknown').length,
    total_cost_usd: totalCost,
    mean_cost_usd: costs.length ? totalCost / costs.length : null,
    cost_per_passed_case: passed.length && totalCost != null ? totalCost / passed.length : null,
    p50_latency_ms: percentile(latencies, 0.5),
    p95_latency_ms: percentile(latencies, 0.95),
    max_latency_ms: latencies.length ? Math.max(...latencies) : null,
    latency_n: latencies.length,
    p50_model_latency_ms: percentile(modelLatencies, 0.5),
    p95_model_latency_ms: percentile(modelLatencies, 0.95),
    error_rate: rows.length ? (rows.length - ok.length) / rows.length : null,
    mean_input_tokens: mean(pick('input_tokens')),
    mean_output_tokens: mean(pick('output_tokens')),
    mean_cache_read_tokens: mean(pick('cache_read_tokens')),
    mean_cache_write_tokens: mean(pick('cache_write_tokens')),
    mean_tokens_per_second: mean(speeds),
    mean_tool_calls: mean(rows.map((row) => row.tool_calls || 0)),
    human_mean: mean(human),
    human_n: human.length,
    reliability_agreement: mean(agreements),
    reliability_cases: agreements.length,
    reliability_sufficient: agreements.length > 0,
    quality_variance: mean(caseVariances),
    repeats: rows.length ? Math.max(...rows.map((row) => row.repeat)) + 1 : 0,
    format_pass_rate: formatScores.length ? mean(formatScores.map((score) => score.value)) : null,
  };
}

/** A run that stopped before its last row and can continue: stale, or stopped by the user, never halted by the guard. */
export function resumable(manifest, trust = null) {
  if (manifest?.harness?.settings?.halted) return false;
  if (trust && (trust.state === 'halted' || trust.state === 'untrusted')) return false;
  if (manifest?.status === 'running') return runLiveness(manifest) === 'stale';
  return manifest?.status === 'failed' && Boolean(manifest.runner?.interrupted);
}

function latestAnnotations(list) {
  const map = new Map();
  for (const item of list) {
    if (!item.config_id || item.value == null) continue;
    const key = `${item.run_id}|${item.case_id}|${item.config_id}|${item.repeat}`;
    const previous = map.get(key);
    if (!previous || String(item.created_at) >= String(previous.created_at)) map.set(key, item);
  }
  return map;
}

export function buildState(root, { validate = true } = {}) {
  const p = paths(root);
  const schemas = validate ? new SchemaSet(p.schemas) : null;
  const problems = [];
  const note = (file, message) => problems.push({ file: path.relative(root, file).replace(/\\/g, '/'), message });
  const check = (schema, record, file) => {
    if (!schemas) return;
    const errors = schemas.validate(schema, record);
    if (errors.length) note(file, `${schema}: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`);
  };

  const registry = (() => {
    try {
      return loadRegistry(root);
    } catch (error) {
      note(p.registry, error.message);
      return {};
    }
  })();

  const annotationFile = path.join(p.annotations, 'human@1.jsonl');
  const { rows: annotations, problems: annotationProblems } = readJsonl(annotationFile);
  annotationProblems.forEach((item) => note(annotationFile, `line ${item.line}: ${item.message}`));
  const latest = latestAnnotations(annotations);

  const contexts = new Map();
  const configs = {};
  const observations = [];
  const runs = [];
  const suitesSeen = new Set();
  const cases = {};
  // One load per suite version for the whole build: an agent suite load reads every workspace file.
  const suiteLoads = new Map();
  const casesAt = (suiteId, version) => {
    const key = `${suiteId}@${version ?? ''}`;
    if (!suiteLoads.has(key)) suiteLoads.set(key, loadCases(root, suiteId, version));
    return suiteLoads.get(key);
  };

  // The evidence ledger (lab/lib/ledger.mjs): a run that does not match it is listed,
  // flagged, and its scores do not count.
  const ledger = loadLedger(ledgerPath(root));
  for (const item of ledger?.problems || []) note(ledgerPath(root), `line ${item.line}: ${item.message}`);
  if (ledger?.unreadable) note(ledgerPath(root), `cannot read the evidence ledger (${ledger.unreadable}); no run is trusted until it can be read`);

  for (const { dir: runDir } of runDirs(root)) {
    const manifestPath = path.join(runDir, 'run.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch (error) {
      note(manifestPath, `Invalid JSON: ${error.message}`);
      continue;
    }
    check('run.schema.json', manifest, manifestPath);
    if (!manifest?.run_id || !manifest.suite || !manifest.prompt) continue;
    let trust;
    try {
      trust = trustRun(ledger, manifest.run_id, runDir);
    } catch (error) {
      trust = { state: 'untrusted', reason: `its files cannot be read (${error.code || error.message})` };
    }
    if (trust.state === 'untrusted') note(manifestPath, `does not match the evidence ledger: ${trust.reason}; it is left out of every aggregate`);
    else if (trust.scores === 'mismatch' && listFiles(path.join(runDir, 'scores'), '.jsonl').length) note(manifestPath, `its scores do not match the evidence ledger (${trust.scores_reason}); they do not count until node lab score ${manifest.run_id} recomputes them`);

    const rawPath = path.join(runDir, 'raw.jsonl');
    const { rows: rawRows, problems: rawProblems } = readJsonl(rawPath);
    rawProblems.forEach((item) => note(rawPath, `line ${item.line}: ${item.message}`));
    rawRows.forEach((row, index) => {
      if (!schemas) return;
      const errors = schemas.validate('result.schema.json', row);
      if (errors.length) note(rawPath, `line ${index + 1}: ${errors[0]}`);
    });

    const scoresByKey = new Map();
    const scoresDir = path.join(runDir, 'scores');
    // Only the files of the run's own evaluators are read; anything else in scores/ is not a score.
    const ownScores = scoreFileNames(manifest);
    for (const file of listFiles(scoresDir, '.jsonl').filter((name) => ownScores.has(`scores/${name}`))) {
      const scorePath = path.join(scoresDir, file);
      const { rows, problems: scoreProblems } = readJsonl(scorePath);
      scoreProblems.forEach((item) => note(scorePath, `line ${item.line}: ${item.message}`));
      for (const score of rows) {
        const key = `${score.case_id}|${score.model_key}|${score.repeat}`;
        if (!scoresByKey.has(key)) scoresByKey.set(key, []);
        scoresByKey.get(key).push(score);
      }
    }

    const declared = Array.isArray(manifest.experiment?.cases) ? manifest.experiment.cases : [];
    let caseIds = declared;
    // The case list of the version the run recorded: the suite now, or its frozen copy
    // (datasets/<suite>/versions/<version>/). Neither: the cases the run has rows for.
    const versionCases = casesAt(manifest.suite.id, manifest.suite.version);
    if (!caseIds.length) {
      const suiteCases = versionCases.map((item) => item.case_id);
      caseIds = suiteCases.length ? suiteCases : [...new Set(rawRows.map((row) => row.case_id))].sort();
    }
    if (!suitesSeen.has(manifest.suite.id)) {
      suitesSeen.add(manifest.suite.id);
      for (const item of casesAt(manifest.suite.id)) cases[item.case_id] = { ...item, suite: manifest.suite.id };
    }
    // A case only an older version has (a retired task) keeps its text from that version's copy.
    for (const item of versionCases) if (!cases[item.case_id]) cases[item.case_id] = { ...item, suite: manifest.suite.id };

    const key = contextKey(manifest, caseIds);
    if (!contexts.has(key)) {
      // `cases` holds one entry per case id. A context (one suite version) whose own text of a case
      // differs from that entry carries it in `case_data`, so an old run shows the case it answered.
      const caseData = {};
      for (const item of versionCases) {
        const own = { ...item, suite: manifest.suite.id };
        if (JSON.stringify(own) !== JSON.stringify(cases[item.case_id])) caseData[item.case_id] = own;
      }
      contexts.set(key, {
        key,
        suite: manifest.suite,
        prompt: manifest.prompt,
        cases: [...caseIds],
        case_data: caseData,
        repeats: manifest.repeats,
        evaluators: manifest.evaluators || [],
        partial: declared.length > 0,
        runs: [],
        config_ids: [],
      });
    }
    const ctx = contexts.get(key);
    ctx.runs.push(manifest.run_id);

    const runConfigIds = new Set();
    let errors = 0;
    // A halted run is never scored, whatever score file sits in its folder.
    // So is a run that does not match the evidence ledger, or that the ledger says was halted.
    // A run.json that still says running (an adopted stale run) never counts.
    const counts = runCounts(trust) && manifest.status !== 'running';
    // A run that counts has every declared evaluator's scores recorded (runCounts).
    const runScored = counts && !manifest.harness?.settings?.halted && ownScores.size > 0;
    for (const raw of rawRows) {
      const config = buildConfig(manifest, raw.model_key, raw, registry);
      if (!configs[config.id]) {
        configs[config.id] = { ...config, run_ids: [], latest_run_at: null };
      }
      const stored = configs[config.id];
      if (!stored.run_ids.includes(manifest.run_id)) stored.run_ids.push(manifest.run_id);
      if (!stored.latest_run_at || String(manifest.created_at) > stored.latest_run_at) stored.latest_run_at = manifest.created_at;
      if (!ctx.config_ids.includes(config.id)) ctx.config_ids.push(config.id);
      runConfigIds.add(config.id);

      const scores = scoresByKey.get(`${raw.case_id}|${raw.model_key}|${raw.repeat}`) || [];
      const qualityScore = scores.find((score) => score.dimension === 'quality') || null;
      const quality = raw.error ? null : qualityScore ? qualityScore.value : null;
      const passed = quality == null ? null : typeof qualityScore.passed === 'boolean' ? qualityScore.passed : quality >= 0.5;
      const formatScores = scores.filter((score) => score.dimension === 'format');
      const human = latest.get(`${manifest.run_id}|${raw.case_id}|${config.id}|${raw.repeat}`) || null;
      if (raw.error) errors += 1;
      observations.push({
        id: `${manifest.run_id}|${raw.case_id}|${config.id}|${raw.repeat}`,
        context_key: key,
        run_id: manifest.run_id,
        config_id: config.id,
        model_key: raw.model_key,
        case_id: raw.case_id,
        repeat: raw.repeat,
        status: observationStatus(raw, quality),
        started_at: raw.started_at || manifest.created_at || null,
        finished_at: manifest.finished_at || null,
        latency_ms: raw.latency_ms ?? null,
        model_request_duration_ms: raw.metadata?.model_request_duration_ms ?? null,
        tokens_per_second: raw.tokens_per_second ?? null,
        tool_calls: raw.tool_calls ?? 0,
        skills_used: raw.skills_used || [],
        request: raw.request || null,
        response: raw.response || null,
        usage: raw.usage || null,
        cost_usd: raw.cost_usd ?? null,
        error: raw.error || null,
        error_class: errorClass(raw.error),
        run_scored: runScored,
        // From the evidence ledger: false leaves the row out of every aggregate.
        // All or nothing (lab/lib/ledger.mjs): a run that is open, halted, changed or
        // mis-scored is listed and counts in no aggregate.
        trusted: counts,
        model_check: raw.metadata?.model_check ?? modelCheck(raw.metadata?.harness_model ?? config.model, raw.metadata?.model_reported),
        metadata: raw.metadata || null,
        scores,
        quality,
        passed,
        format_pass: formatScores.length ? formatScores.every((score) => score.value >= 0.5) : null,
        artifacts: buildArtifacts(runDir, manifest, raw),
        human: human
          ? { annotation_id: human.annotation_id, value: human.value, notes: human.notes || '', created_at: human.created_at, reviewer: human.reviewer }
          : null,
      });
    }

    runs.push({
      run_id: manifest.run_id,
      created_at: manifest.created_at,
      finished_at: manifest.finished_at ?? null,
      status: manifest.status,
      // live, stale (the runner is gone: resume it) or unknown, for a run that says running.
      liveness: runLiveness(manifest),
      resumable: resumable(manifest, trust),
      // From the evidence ledger: legacy (no ledger yet), trusted, open, halted or untrusted.
      trust,
      context_key: key,
      suite: manifest.suite,
      prompt: manifest.prompt,
      experiment_id: manifest.experiment?.id ?? null,
      experiment_description: manifest.experiment?.description ?? null,
      harness: manifest.harness || null,
      models: (manifest.models || []).map((item) => item.model_key),
      config_ids: [...runConfigIds],
      rows: rawRows.length,
      expected_rows: (manifest.models || []).length * caseIds.length * (manifest.repeats || 1),
      errors,
      notes: manifest.notes || '',
    });
  }

  for (const ctx of contexts.values()) {
    // A run that does not match the evidence ledger counts in no aggregate: no n, cost, errors or scores.
    const ctxRows = observations.filter((item) => item.context_key === ctx.key && item.trusted !== false);
    const hasQuality = ctx.evaluators.some((item) => item.dimension === 'quality');
    ctx.aggregates = {};
    for (const id of ctx.config_ids) {
      ctx.aggregates[id] = aggregate(ctxRows.filter((row) => row.config_id === id), configs[id], { hasQuality });
    }
    ctx.comparison = comparisonMode(ctx.config_ids.map((id) => configs[id]));
    ctx.latest_run_at = ctx.runs
      .map((id) => runs.find((run) => run.run_id === id)?.created_at)
      .filter(Boolean)
      .sort()
      .pop() ?? null;
  }

  const boards = [];
  for (const file of listFiles(p.boards, '.json')) {
    const boardPath = path.join(p.boards, file);
    try {
      const board = readJson(boardPath);
      check('board.schema.json', board, boardPath);
      boards.push(board);
    } catch (error) {
      note(boardPath, `Invalid JSON: ${error.message}`);
    }
  }
  boards.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  runs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  return {
    generated_at: isoNow(),
    contexts: [...contexts.values()].sort((a, b) => String(b.latest_run_at).localeCompare(String(a.latest_run_at))),
    configs,
    observations,
    cases,
    runs,
    annotations,
    boards,
    problems,
    meta: {
      root: path.basename(root),
      results_dir: 'results',
      annotation_file: 'annotations/human@1.jsonl',
    },
  };
}
