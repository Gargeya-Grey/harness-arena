---
name: verify-model-lab
description: Launch, drive and prove Model Lab - the `node lab` CLI (run, validate, report) and the local comparison dashboard at http://127.0.0.1:<port>. Use before claiming any change to lab/, dashboard/, schemas/ or the stored-record format works, and to collect screenshot or transcript evidence.
---

# Verify Model Lab

Model Lab has two user surfaces:

- the **CLI**, `node lab <command>`, run from the repository root;
- the **dashboard**, a static page served by `dashboard/server.mjs`, which reads `/api/state`.

Both read a **data root**. The default data root is this repository. `LAB_ROOT=<dir>` points them at another one. Verification always uses a disposable data root, because this repository's `results/` is append-only evidence.

The feature map is in [features/README.md](features/README.md). Read it, then use the matching feature file as the recipe.

## Launch

1. Make a disposable data root. It is a copy of `tests/fixtures/repo` (9 runs, 77 observations, 3 contexts) plus the real experiments, prompts and registry:

   ```bash
   ROOT=$(node .agents/skills/verify-model-lab/scripts/temp-root.mjs)
   ```

2. CLI: no build and no install. Every command is `LAB_ROOT=$ROOT node lab <command>`.

3. Dashboard: pick a free port (not 4317, which the owner uses), start it in the background, and keep its PID:

   ```bash
   PORT=4391
   LAB_ROOT=$ROOT node lab dashboard --port $PORT > "$ROOT/dashboard.log" 2>&1 &
   echo $! > "$ROOT/dashboard.pid"
   ```

   Ready means `curl -s http://127.0.0.1:$PORT/api/state` returns JSON with 3 `contexts`. The log line `Model Lab dashboard: http://127.0.0.1:<port>` alone is not enough.

Two instances can run side by side on different ports and data roots.

## Doctor

Run before driving, and whenever something looks wrong:

```bash
curl -s http://127.0.0.1:$PORT/api/health          # {"ok":true,"root":"verify-model-lab-…"}
node -e "fetch('http://127.0.0.1:$PORT/api/state').then(r=>r.json()).then(s=>console.log(s.contexts.length,'contexts',s.observations.length,'observations',s.problems.length,'problems'))"
LAB_ROOT=$ROOT node lab validate                     # last line: All inputs and records are valid.
node lab doctor                                      # live harnesses only: which CLIs and keys are ready
```

`root` in `/api/health` must be the temp folder name. If it is `Model-Testing`, you are driving the owner's real data; stop.

## Drive

- **CLI**: run the commands in the feature files and keep stdout, stderr and the exit code.
- **Dashboard**: drive it with `agent-browser` (installed globally). Use roles and accessible names, not coordinates:

  ```bash
  agent-browser open http://127.0.0.1:$PORT/results.html   # one test; / is Home, Run and Lab
  agent-browser snapshot -i                   # interactive elements with refs
  agent-browser find role button click --name "Change test"
  agent-browser screenshot "$EVIDENCE/change-test.png"
  ```

  The Chrome browser tools (`mcp__claude-in-chrome__*`) also work when the session has them.
- **Layout and theme**: for a visual change, run the owner's checker on the page in light and dark: `~/.claude/design/checks/measure-layout.html` (its header gives the command). Every FAIL line is a finding.

## Evidence

Put evidence in `.cache/verify/<date>-<feature>/` in this repository (`.cache/` is ignored by git). Set `EVIDENCE=.cache/verify/$(date +%Y%m%d)-<feature>` and `mkdir -p "$EVIDENCE"`.

Proof standards:

- Exercise the real user path: the CLI command or the visible control. Do not call internal functions for a proof.
- Capture the action and the resulting state: a screenshot before and after, or the command and its output.
- Verify side effects in a second view: after a review rating, read `$ROOT/annotations/human@1.jsonl`; after a run, read `run.json` and run `node lab validate`.
- `--dry-run` writes nothing. Prove that with `ls $ROOT/results` before and after.
- Live model calls cost quota or money. Make one only when the owner asked. A one-case run is `--repeats 1 --cases smoke-001`.

## Cleanup

Stop only the server you started, then remove the data root. Evidence stays in `.cache/verify/`.

```bash
kill "$(cat "$ROOT/dashboard.pid")"
rm -rf "$ROOT"
ls "$EVIDENCE"        # the proof is still there
```

Never stop a process by name: the owner may have a dashboard running on port 4317.

## Helpers

- `scripts/temp-root.mjs` - prints the path of a new disposable data root. Usage: `ROOT=$(node .agents/skills/verify-model-lab/scripts/temp-root.mjs)`.
- `npm test` - the node:test suite, including a fake-harness run of the whole runner.
- `npm run fixtures` - regenerates `tests/fixtures/repo` after a change to `tests/fixtures/make-fixtures.mjs`.
