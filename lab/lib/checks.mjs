// Checks on one raw row that the runner records and the dashboard aggregates:
// who caused an error, whether the model that answered is the one requested, and
// whether a run that says "running" still runs.

// An error is "lost" when the call never had a fair chance: the subscription hit a
// limit, the sign-in failed, or the CLI did not start. A lost row says nothing about
// the configuration, so it leaves the quality score and shows as its own count.
// Every other error (timeout, no answer, harness crash, left_workdir) is the
// configuration's own failure and scores 0.
const LOST_TYPES = new Set(['rate_limit', 'auth', 'not_installed', 'spawn_error']);
// Whole phrases only: these run on stderr tails, where a stack line such as
// cli.js:429:15 or a path such as /auth/ must not turn a crash into "lost".
const RATE_LIMIT = /rate[ _-]?limit|usage[ _-]?limit|quota (?:exceeded|reached|exhausted)|exceeded (?:your |the )?quota|too many requests|(?:status|http|error|code)\W{0,3}(?:429|529)\b|\boverloaded(?:_error)?\b|resource[ _-]?exhausted|chatgpt-limit/i;
const AUTH = /unauthori[sz]ed|(?:status|http|error|code)\W{0,3}401\b|invalid (?:api|x-api) key|not logged in|log ?in required|please (?:log|sign) in|authentication (?:failed|required)/i;

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

// Only a snapshot date or "latest" may follow the requested id: gemini-3-8-flash-lite
// is another model than gemini-3-8-flash.
const SNAPSHOT_SUFFIX = /^-(?:\d{8}|\d{4}-\d{2}-\d{2}|latest)$/;

/**
 * Did the harness report the model that was requested? "unknown" when it reports
 * none. A reported id may carry a snapshot date (claude-haiku-5-5-20261001), and
 * Gemini CLI lists every model it used, comma separated: one of them must be the request.
 */
export function modelCheck(requested, reported) {
  if (reported == null || String(reported).trim() === '') return 'unknown';
  const want = modelName(requested);
  const seen = String(reported).split(/,\s*/).filter(Boolean).map(modelName);
  const same = (name) => name === want || (name.startsWith(want) && SNAPSHOT_SUFFIX.test(name.slice(want.length)));
  return seen.some(same) ? 'match' : 'mismatch';
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

const REUSED_PID_MS = 24 * 60 * 60 * 1000;

/**
 * Is a run that says "running" still running? "live" while its runner process is
 * alive: a run that waits for the other harnesses of its experiment can go long
 * without a call of its own. "stale" when the process is gone, or when the
 * heartbeat is a day old (the process id belongs to another program by then). A
 * run written before the heartbeat existed is "unknown". Finished runs give null.
 */
export function runLiveness(manifest, now = Date.now(), alive = processAlive) {
  if (manifest?.status !== 'running') return null;
  const runner = manifest.runner;
  if (!runner?.heartbeat_at) return 'unknown';
  if (now - Date.parse(runner.heartbeat_at) > REUSED_PID_MS) return 'stale';
  return alive(runner.pid) ? 'live' : 'stale';
}
