// Harness events describe the machine they ran on. A CLI's start-up report lists the
// user's connectors, plugins, skills and memory folder, and a workspace snapshot can
// hold the `git status` of any repository above the workdir. None of it is needed to
// compare models, so the runner drops it before anything is written to results/.

import os from 'node:os';

export const REDACTED = '[redacted by lab]';

// Keys whose values describe the user's setup wherever they appear.
export const DROP_KEYS = new Set([
  'gitStatus', 'recentCommits', 'additionalDirectories', 'additional_directories',
  'memory_paths', 'mcp_servers', 'messaging_socket_path', 'powershell_path',
]);

// Keys of a start-up report, dropped only at the top of an event. Deeper down the same
// names are real evidence: Gemini's `stats.tools`, or a tool call's own `commands` input.
export const DROP_TOP_KEYS = new Set([
  'plugins', 'skills', 'agents', 'tools', 'slash_commands', 'terminal_slash_commands', 'commands',
]);

// Keys of a workspace snapshot, dropped inside any `workspace` object.
export const DROP_WORKSPACE_KEYS = new Set(['branch']);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A path separator, plain or URL-encoded.
const SEP = '(?:[\\\\/]|%5C|%2F)+';

/** A regular expression for the home folder in the forms a harness may print, or null. */
export function homePattern(home = os.homedir()) {
  if (typeof home !== 'string' || !home) return null;
  const drive = /^([A-Za-z]):/.exec(home);
  const parts = home.slice(drive ? 2 : 0).split(/[\\/]+/).filter(Boolean).map(escape);
  // A home of `C:\` or `/` would match every path on the machine.
  if (!parts.length) return null;
  const rest = `${SEP}${parts.join(SEP)}`;
  const root = drive
    ? [
        `${drive[1]}(?::|%3A)`, // C:\Users\Ann, file:///C:/Users/Ann, C%3A%5CUsers%5CAnn
        `(?:/mnt)?/${drive[1]}`, // Git Bash /c/Users/Ann, WSL /mnt/c/Users/Ann
        `[\\\\/]{2}[^\\\\/\\s]+[\\\\/]+${drive[1]}\\$`, // UNC \\localhost\c$\Users\Ann
      ]
    : [''];
  // The lookarounds stop C:\Users\Ann from matching inside C:\Users\Anna or xC:\Users\Ann.
  return new RegExp(`(?<![\\w.-])(?:${root.join('|')})${rest}(?![\\w.-])`, 'gi');
}

/** Replace the home folder in any text with `~`. */
export function redactPaths(text, home = os.homedir()) {
  if (typeof text !== 'string') return text;
  const re = homePattern(home);
  return re ? text.replace(re, '~') : text;
}

/** A copy of one harness event with setup keys dropped and home paths replaced. */
export function redactEvent(value, home = os.homedir()) {
  const re = homePattern(home);
  const paths = (text) => (re ? text.replace(re, '~') : text);
  const walk = (v, depth, parentKey) => {
    if (typeof v === 'string') return paths(v);
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1, null));
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, item] of Object.entries(v)) {
      const drop = DROP_KEYS.has(k) || (depth === 0 && DROP_TOP_KEYS.has(k)) || (parentKey === 'workspace' && DROP_WORKSPACE_KEYS.has(k));
      out[paths(k)] = drop ? REDACTED : walk(item, depth + 1, k);
    }
    return out;
  };
  return walk(value, 0, null);
}
