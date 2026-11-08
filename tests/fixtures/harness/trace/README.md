# Trace fixtures

Each `<harness>.events.jsonl` file is one row of a real `harness-events.ndjson`: the
`ladder-agent-slugify-bug` task of the 2026-11-07 and 2026-11-08 ladder runs. They
are redacted. The call folder is `<workdir>`, every session, message, tool-call and
request id is a counter (`uuid-1`, `call-2`), long text is cut at 400 characters, and
the setup events (`system/init`, plugin and skill lists), rate-limit events,
signatures and message metadata are removed. So is every field that names an account, a
credential or its expiry (the Claude Code result line had one), a billing plan, an
e-mail address or a home folder. The step list that `traceSteps` reads from each file
does not change by this. `tests/trajectory.test.mjs` scans every `.jsonl` file in this folder for
those values; add a field to its pattern when a new harness version adds one.

- `claude-code.events.jsonl`: one `ls`/`cat` call (a read), one edit, one test run piped to `tail`.
- `opencode.events.jsonl`: reads, one `cd <workdir> && node --test` that PowerShell refused
  (a parse error, exit 1: not a test run), one failed `node --test` run (exit 1), a write,
  a passing run. Two test runs.
- `command-code.events.jsonl`: tool events plus the streamed noise (`thinking_delta`,
  `text_delta`, `message_end`, `turn_end`) that gives no step. One `tool_errored`.
- `codex.events.jsonl`: the real events of a Codex agent row. Codex could not read
  the workspace in that run, so the row has **no tool event**. It proves only that the
  parser gives no step for a row without tools.
- `codex.synthetic.events.jsonl` is **synthetic**. No successful Codex agent row is
  stored yet, so this file follows the `codex exec --json` item shapes the adapter
  already names (`command_execution` with `exit_code`, `file_change` with `changes`).
  When a real Codex agent row exists, replace it with a redacted real row.
