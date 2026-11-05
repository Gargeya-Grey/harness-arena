// Checks on one raw row that the runner records and the dashboard aggregates:
// who caused an error, and whether the model that answered is the one requested.

// An error is "lost" when the call never had a fair chance: the subscription hit a
// limit, the sign-in failed, or the CLI did not start. A lost row says nothing about
// the configuration, so it leaves the quality score and shows as its own count.
// Every other error (timeout, no answer, harness crash, left_workdir) is the
// configuration's own failure and scores 0.
const LOST_TYPES = new Set(['rate_limit', 'auth', 'not_installed', 'spawn_error']);
const RATE_LIMIT = /rate.?limit|usage.?limit|quota|too many requests|\b429\b|\b529\b|overloaded|resource.?exhausted|chatgpt-limit/i;
const AUTH = /\bauth\b|unauthori[sz]ed|\b401\b|invalid api key|not logged in|log ?in required|please (?:log|sign) in/i;

/** The error type to store: a quota or sign-in failure gets its own type, whatever the harness called it. */
export function normalizeErrorType(error) {
  if (!error) return null;
  const type = String(error.type || 'harness_error');
  if (LOST_TYPES.has(type) || type === 'timeout' || type === 'left_workdir') return type;
  const text = `${type} ${error.message || ''}`;
  if (RATE_LIMIT.test(text)) return 'rate_limit';
  if (AUTH.test(text)) return 'auth';
  return type;
}

/** "lost" (not the configuration's fault), "failed" (scores 0), or null for no error. */
export function errorClass(error) {
  if (!error) return null;
  return LOST_TYPES.has(normalizeErrorType(error)) ? 'lost' : 'failed';
}

function modelName(value) {
  return String(value).trim().toLowerCase().split('#')[0].split('/').pop().replace(/\./g, '-');
}

/**
 * Did the harness report the model that was requested? "unknown" when it reports
 * none. A reported id may carry a date suffix (claude-haiku-5-5-20261001), and Gemini
 * CLI lists every model it used, comma separated: one of them must be the request.
 */
export function modelCheck(requested, reported) {
  if (reported == null || String(reported).trim() === '') return 'unknown';
  const want = modelName(requested);
  const seen = String(reported).split(/,\s*/).filter(Boolean).map(modelName);
  return seen.some((name) => name === want || name.startsWith(`${want}-`)) ? 'match' : 'mismatch';
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Is a run that says "running" still running? "stale" when its runner process is
 * gone or its heartbeat is older than one call can take. A run written before the
 * heartbeat existed is "unknown". Finished runs give null.
 */
export function runLiveness(manifest, now = Date.now(), alive = processAlive) {
  if (manifest?.status !== 'running') return null;
  const runner = manifest.runner;
  if (!runner?.heartbeat_at) return 'unknown';
  const limitMs = (Number(manifest.harness?.settings?.timeout_s) || 300) * 1000 + 5 * 60 * 1000;
  if (now - Date.parse(runner.heartbeat_at) > limitMs) return 'stale';
  return alive(runner.pid) ? 'live' : 'stale';
}
