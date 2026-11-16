// Pure helpers for watching jobs: which jobs just ended, and how far a run has come.
const DONE = new Set(['passed', 'failed', 'stopped']);

export function finishedJobs(before, jobs) {
  if (!before) return [];
  return jobs.filter((job) => {
    if (!DONE.has(job.status)) return false;
    const was = before.get(job.id);
    return was === undefined || was === 'running' || was === 'stopping';
  });
}

// The run log (lab/commands/run.mjs) prints a plan line, one run id per harness, then one line per call:
//   Experiment <id>: suite …, 18 call(s) across 1 harness(es)
//   20261105T060204Z__agentic__opencode-agentic__a4a7c9
//     agentic-slugify-bug r0 beam-free: "Changed …" · 21651 ms · 64017 in / 971 out
//     agentic-csv-quotes r1 pulse-alpha-free: ERROR timeout: … · ? ms · ? in / ? out
const PLAN = /^Experiment \S+: .*, (\d+) call\(s\) (?:across \d+ harness|in \d+ run\(s\))/;
const RUN_ID = /^(\d{8}T\d{6}Z__\S+)$/;
const CALL = /^ {2}(\S+) r\d+ \S+: (.*) · (?:\d+|\?) ms · \S+ in \/ \S+ out$/;

export const emptyProgress = () => ({ total: null, done: 0, errors: 0, incomplete: 0, current: '', runIds: [] });

// A job in words, from its command line: "run experiments/agentic.yaml --repeats 1" -> "agentic run".
const NAMES = { score: 'scoring', validate: 'validation', doctor: 'harness check', report: 'report', runs: 'run list' };
const expOf = (job) => {
  const file = String(job.label || '').split(' ').find((part) => /\.ya?ml$/i.test(part));
  return file ? file.split('/').pop().replace(/\.ya?ml$/i, '') : 'test';
};
export function jobName(job) {
  if (!job) return '';
  if (job.command === 'run') return `${expOf(job)} ${job.dry_run ? 'preview' : 'run'}`;
  return NAMES[job.command] || String(job.command || 'job');
}
// The same name at the start of a line. An experiment id keeps its own spelling: "Preview of agentic-sweep".
export function jobTitle(job) {
  if (!job) return '';
  if (job.command === 'run') return `${job.dry_run ? 'Preview' : 'Run'} of ${expOf(job)}`;
  const name = jobName(job);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function runProgress(lines, from = emptyProgress()) {
  const p = { ...from, incomplete: from.incomplete || 0, runIds: [...from.runIds] };
  for (const line of lines) {
    let m = PLAN.exec(line);
    if (m) {
      p.total = Number(m[1]);
      continue;
    }
    m = RUN_ID.exec(line);
    if (m) {
      if (!p.runIds.includes(m[1])) p.runIds.push(m[1]);
      continue;
    }
    m = CALL.exec(line);
    if (m) {
      p.done += 1;
      if (m[2].startsWith('INCOMPLETE ') || m[2].startsWith('ERROR timeout:')) p.incomplete += 1;
      else if (m[2].startsWith('ERROR ')) p.errors += 1;
      p.current = m[1];
    }
  }
  return p;
}
