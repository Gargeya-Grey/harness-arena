# Isolated user setup (temp home)

With `user_config: isolated`, Gemini CLI, OpenCode and non-Windows Codex use a temp home that holds a copy of the sign-in only. The CLI discovers no owner config there; filesystem reads elsewhere remain subject to the harness sandbox. The folder is deleted after the call. Native Windows Codex instead retains its initialized sandbox home and applies per-call context controls. Its global AGENTS.md remains loaded, so recorded setup is partly kept out.

## Sub-features

- `iso-doctor` `node lab doctor` lists, for each harness, the mechanism (flags or temp home), the env vars, and whether the sign-in is found.
- `iso-dry` the dry run shows `user setup skipped (CODEX_HOME=<temp home>/.codex ...)`; it never shows a real path.
- `iso-record` `run.json` `harness.settings.user_config_flags` holds the env vars; each row's `metadata.harness_extra.temp_home` holds `removed`, `written_back`, `kept` (file or row names only).
- `iso-auth` a missing sign-in is an `auth` error and the call does not start.
- `iso-writeback` a refreshed token goes back to the real sign-in only when safe (see `docs/strategy.md`).

## How to get to it (user POV)

- Set `user_config: isolated` in the experiment, then `node lab run experiments/<name>.yaml`.

## Driving it with the shell

Preconditions:

- `ROOT=$(node .agents/skills/verify-model-lab/scripts/temp-root.mjs)`.
- For the live step only: the owner approved the calls; each call spends subscription quota.

- **Doctor.** Run `node lab doctor`. After the table there is an `isolation by harness:` block. `codex`, `gemini-cli` and `opencode` say `temp home available`, or `temp home NOT available, sign-in file missing: <name>`. No path and no token is printed.
- **Dry run.** Run `LAB_ROOT=$ROOT node lab run $ROOT/experiments/archive/smoke-opencode.yaml --dry-run`. The `codex` and `opencode` lines say `user setup skipped (HOME=<temp home> ...)`.
- **No live call.** `node --test tests/isolation.test.mjs` proves these points. Only the sign-in is copied; a fake `config.toml`, `AGENTS.md`, `GEMINI.md`, `settings.json` and skills are not. The folder is deleted after success, failure, timeout and a throwing adapter. A missing sign-in gives `auth` and never uses the real home. The env points at the temp home. Records hold no real path or content. A changed valid token goes back; an invalid or raced one does not. The test uses a fake home and never reads real credential files.
- **Live, one case per harness.** Make a temp experiment with `user_config: isolated` and one target for the harness, then `LAB_ROOT=$ROOT node lab run <file> --repeats 1 --cases smoke-001`. Proof: `raw.jsonl` has no error (or a provider error such as a usage limit), `harness_extra.temp_home.removed` is `true`, and input tokens are lower than a stored `loaded` row of the same model and case (Codex: about 15,400 against about 26,000). The OS temp folder holds no `lab-home-*` folder afterwards.

## Gotchas

- Windows Codex is the installed-home exception to the temp-home checks above. Inspect its recorded `--ignore-user-config`, `--ignore-rules`, disabled feature values and skill-catalog controls, plus effective prompt/tool evidence. `--ignore-user-config` alone does not remove global instructions or skills. Require setup `partly kept out`, workspace-write on an isolated case folder and no outside-context reads in the live trace. Missing markers refuse before calling the model; markers do not guarantee that runtime repair can never be needed.

- Never print or commit a credential file. To see that a credential changed, compare hashes, not contents.
- OpenCode 2.x does not read `auth.json`. Its sign-in is in the `credential` table of `opencode.db`. The store needs Node 22.13 or newer (`node:sqlite`).
- A usage limit or a refused account (Gemini `IneligibleTierError`) shows that the request left the CLI; it does not prove the answer path. Do not retry a usage limit.
- A debug command such as `opencode auth list` without `--standalone` starts the background service on a fixed port, and that process keeps the temp folder locked. Always add `--standalone` in a temp home.
