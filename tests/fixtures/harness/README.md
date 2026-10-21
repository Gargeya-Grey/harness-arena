# Harness output fixtures

Parser tests read these files. Each `*.stdout.jsonl` file is real output from the
2026-10-21 smoke runs, taken from that run's `harness-events.ndjson`. Two kinds of
event are left out: Claude Code `system` events, which list local plugins and paths,
and one Command Code `run_end` event, which held a `git status` of the home folder.

- `gemini-cli.synthetic.stdout.txt` is synthetic. It follows the documented
  `gemini -o json` shape, because no Gemini CLI call succeeded on this account.
- `gemini-cli.auth-error.stderr.txt` is the real refusal, with local paths removed.
