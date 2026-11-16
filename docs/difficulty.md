# Difficulty ladder

The ladder is 80 tasks in five tiers. Each tier holds more tasks than the one below it, so the hard end of the scale has the most resolution: strong configurations all pass the low tiers, and the comparison is decided in the high ones.

| Level | Tier | Tasks | Expert time (one person, no AI) |
|---|---|---|---|
| 1 | easy | 5 | up to 2 min |
| 2 | medium | 10 | 2 to 8 min |
| 3 | hard | 15 | 8 to 30 min |
| 4 | extra-hard | 20 | 30 min to 2 h |
| 5 | supreme | 30 | 2 to 16 h |

`configs/ladder.yaml` holds this table and the share of each task kind per tier. `lab/lib/ladder.mjs` checks every ladder case against it.

**A tier is a label of an estimate.** It says how long an expert needs for the task. It does not say how often a model solves it. The lab states no target score for a tier and gives no verdict on a task. Only stored runs speak about models, and only as far as they reach (Evidence).

## Three kinds, one ladder

A run uses one suite and one prompt, so the ladder is three suites that share the tier field:

| Suite | Prompt | Evaluator | Task |
|---|---|---|---|
| `ladder-answer` | `reasoning-final-answer` | `final-answer@2` | A problem with one exact answer. |
| `ladder-code` | `js-function@2` | `js-function@3` | One JavaScript function, run against hidden tests. |
| `ladder-agent` | `agent-task@2` | `workspace-tests@3` | Change a starter project; a hidden check scores the result. |

Agent tasks take the largest share of the top tiers, because long tasks are where configurations differ most (METR).

## Why expert time is the scale

Difficulty is not guessed from how a task looks. It is set in two steps.

1. **A prior from expert time.** Each case records `metadata.tier.human_minutes`: the time a competent professional needs to read the task, solve it and check the result, without AI help. It also records `basis`, one line that says how the estimate was made (a timed solve, the size of the reference solution, or a published anchor below).
2. **What the runs show.** A pilot run tells, for each task, whether the configurations that ran it solved it (Evidence). That is a prompt to look at the task. It does not change the tier.

The professional works under the same conditions as the model:

- **Answer tasks: no computer.** The prompt forbids tools, so the expert time is the time to solve on paper. A short script would solve some tier 4 and 5 answer tasks in 15 to 40 minutes; that is the point of them, because the model has no script either. A harness that lets the model run code in answer mode breaks this condition. The pilot checks each harness's tool calls on answer tasks.
- **Code tasks: no tools.** The frozen function prompt forbids code execution, file creation and tool calls. A human timing study must use that same restriction. The old normal-tools estimate is not a matched human baseline.
- **Agent tasks: normal tools.** An editor, Node and a shell are allowed in the supplied workspace.

Expert time is the scale because it is the best-supported measure of task difficulty for AI systems that we know of:

- **METR time horizons.** METR measures each task by how long skilled humans take, and fits model success against the logarithm of that time. Success falls along a logistic curve, so tiers spaced by a constant factor of time (this ladder uses about 4x) are spaced evenly in difficulty. METR reports the 50% horizon of the best public model at 16 to 20 hours in May 2026, with an 80% horizon near 3 hours. The ladder's panel is mostly smaller models, so the top tier stops at 16 hours, where METR's own suite stops being reliable.
- **SWE-bench Verified.** OpenAI's annotators labelled each issue by the time an experienced developer needs to fix it: under 15 min, 15 min to 1 h, 1 to 4 h, over 4 h. The ladder's agent tiers 3, 4 and 5 use the same notion of time to fix.
- **Competitive programming ratings.** LiveCodeBench Pro groups problems by Codeforces rating: up to 2000, 2000 to 3000, above 3000. In 2025 the best model scored about 83%, 53% and 0% on those groups. The ladder's code tiers use rating-like anchors: tier 3 is around 1600 to 2000, tier 4 around 2000 to 2600, tier 5 above 2600, with huge inputs that rule out the naive method.
- **Graded mathematics.** FrontierMath grades its problems from olympiad and hard undergraduate (tier 1) to research level (tier 4). The ladder's answer tiers rise from word problems with a trap, through multi-step contest problems, to instances that need a search too large to do without a systematic method.

## Evidence

The panel is the targets of the ladder experiments. Each task runs once per target in the pilot. A configuration **solves** a task when its mean score over its counted repeats is 1 (a score is the share of hidden tests passed, so partial work does not solve).

`node lab ladder --calibrate` prints, per task, how much the runs can tell. Each task is in one class:

| Class | Meaning |
|---|---|
| `no-data` | No configuration has a counted result. |
| `one-config` | One configuration has a result. A comparison is not possible. |
| `all-solved` | Two or more configurations ran it and all solved it. It does not separate them. |
| `all-unsolved` | Two or more configurations ran it and none solved it. A partial score does not make it solved. Check the task for a defect. |
| `disagree` | Two or more configurations ran it; some solved it and some did not. Only these tasks separate configurations. |

For each pair of configurations it also prints the tasks both ran (`shared`), the tasks only the first solved, the tasks only the second solved, and an exact two-sided sign test on those two counts. With few such tasks the test cannot reject chance, and the output says what it is: a count and a p value, not a ranking.

Runs of different setup states never pool. A run is `loaded`, `kept out`, `partly kept out`, `leaked` or `unknown`, from the flags the run recorded. Each state is its own configuration. A leaked run (the harness loaded the owner's own instructions although the experiment asked to keep them out) is shown, and is never mixed with a clean run of the same model.

Rules for a task that the runs flag:

1. A task in `all-unsolved` is checked for a defect before anything else.
2. A task with negative discrimination is checked for a defect too: for two configurations that both ran it, the one with the higher mean on the other tasks both ran scores under 0.5 on every repeat of it while the other scores 1 on every repeat. Item response theory work on public benchmarks finds that such negative discrimination usually means an error in the item (ATLAS, 2025).
3. A tier does not change because of a score. A tier changes when the expert-time estimate was wrong. The new tier's expert-time range must be within a factor of 4 of the task's `human_minutes`.
4. Moving a task keeps its `case_id`. Its tier changes in a new suite version. Before the change, run `node lab freeze <suite>` (`docs/strategy.md`, Frozen suite versions), so the old runs keep their cases and tiers. The definition sets the new `tier.level`, keeps its `human_minutes`, and adds `tier.moved: { from: <old level>, evidence: '<why the estimate was wrong>' }`.
5. A task that leaves the suite is retired, not deleted: its slug goes into `datasets/<suite>/defs/_retired.mjs` with the reason. Its definition and its proofs stay, so its `case_id` stays taken and the task can come back by deleting one line. `generate.mjs` leaves retired tasks out of `cases.jsonl`; `buildCases({ includeRetired: true })` keeps them for the tests.

### Pilot history

- **Pilot 1 (8 Nov 2026, suites 1.0.0).** Claude Haiku, Claude Opus, DeepSeek and Codex at low effort, one repeat. Tiers 3 to 5 were far too easy: answer means 0.50 to 1.00 except `route-twelve-towns` (0.0), code means 0.57 to 1.00, with Opus solving all ten supreme code tasks in one reply. Two levers worked: exact optimisation, where strong models stop at a near optimum (every model gave 186 for `route-twelve-towns`, whose optimum is 180), and code whose every test depends on many rules. Limit: the Claude Code runs of this pilot and of the first minutes of pilot 2 say `isolated`, but they loaded the owner's global `CLAUDE.md` and the auto memory of the home folder's project. The call folder is under the home folder, and the isolation flags did not cover instruction files. Some answers begin with a tier line from those instructions. The fix (8 Nov 2026) sets `CLAUDE_CODE_DISABLE_CLAUDE_MDS` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, and later runs list both in `user_config_flags`, so a run without them in that list had the leak.
- **Suites 2.0.0 (calibration round 2).** Tiers 1 and 2 and the tier-3 tasks stay. The old tier 4 and 5 answer and code tasks are retired (their reasons and pilot-1 means are in `_retired.mjs`), except `route-twelve-towns`. New tasks take the slots: 13 answer tasks of exact optimisation in seven families (`defs/round2/`), 7 tier-4 code tasks (`defs/extra-hard-b/`), and 10 tier-5 code tasks: long single-reply programs with dense rules (`defs/supreme-b/`) and deep algorithms with a CPU margin of at least 10x (`defs/supreme-c/`). Pilot 2 measures them; a task that the runs flag is checked by the rules above.

### Execution and verification limits

Model generation and code verification are separate. The repaired effort-explicit presets set timeout_s to zero, so model generation has no deadline. An explicitly configured generation cutoff is incomplete execution, never a wrong-answer score; its elapsed time remains measurable.

New comparisons use final-answer@2, js-function@3 and workspace-tests@3. New code and agent prompts disclose their verification resource allowances. final-answer@2 compares a complete decimal scalar exactly, including equivalent decimal/scientific notation, and rejects expressions or trailing units. Text answers retain the declared normalization. The scalar grammar/tolerance of final-answer@1 stays available for historical runs.

| Evaluator | Declared allowance | Interpretation |
|---|---|---|
| js-function@3 | 2000 ms loading-plus-call CPU per fresh test; 30000 ms CPU per case; 256 MB heap | Record CPU/resource noncompliance separately from a wrong returned value. |
| workspace-tests@3 | 60000 ms CPU in the check process, tested between probes; 256 MB heap | Finished probe observations remain available. Executable-test rules, when declared, run in a separate restricted process. |

The function sandbox starts with two times the CPU allowance as wall headroom and follows measured wall/CPU load, up to ten times. A stopped attempt at or below its full loading-plus-call CPU allowance retries, including the former 95%-100% gap and a stable load ratio. After three attempts, a wall-clock stop with no proven CPU noncompliance leaves that check unjudged. Workspace operational wall/probe timeouts follow the same rule. If another check has established a failure, the case scores zero as a proven case failure while unfinished checks remain individually unjudged. Without a definite failure, the scorer prints a skip reason and writes no case quality score. These operational guards are finite; they are not a guarantee that host load cannot affect execution.

Historical js-function@1, js-function@2, workspace-tests@1 and workspace-tests@2 retain their implementations and scores. In particular, version 2's old 95% retry rule does not provide the previously claimed universal CPU-only guarantee. A changed policy is a new evaluator and experiment, never a rewrite of historical scores. The ladder refuses to mix evaluator versions in one comparison.

Ladder references stay at least three times inside the nominal CPU allowance. A reference passing the allowance does not establish the human-time tier or guarantee that every valid implementation meets the same performance requirement.

### Human timing protocol

Every current tier is an unmeasured prior unless its basis records an actual timed solve. Time a competent person from reading the supplied task and starter, using the same permitted tools, to a correct final answer or implementation. Record that receipt and validation result. For optimization, record time to a checkable optimality certificate separately; a final-number-only score does not require a model to supply that certificate. Report multiple solvers and variation near tier boundaries. Do not derive a human time from a model score, a fast script, a search-node count or a relaxation gap.

### Repair release

The audited packing-13, packing-17 and building-14 instances had short certifying bounds contrary to their recorded proof-work premises. They are retired with their original definitions and historical suite versions preserved. Three new IDs fill the same tier slots. Their expected values have independent exact-method agreement, feasible witnesses and positive gaps for the named simple bounds. That closes those known shortcuts only; it does not calibrate their replacement human-time priors. The quota remains 80 tasks across the five tiers.

See [the repair contract](benchmark-repairs.md) for current versions, outcome interpretation and retained regression evidence.

Speed probes proved to fail a natural slow solution (tests under `tests/fixtures/ladder-agent-solutions/*/<slug>--slow*/`): build-scheduler, http1-parser (2 of 4: a body in one-byte pieces, tiny chunks), regex-engine (many matches), markdown-renderer (md35, md37), rrule-expander (rr40 to rr43), spreadsheet-engine (sp33, sp34). Not proved, because every natural slow method either stays under the threshold or never ends: sql-engine (LIKE), regex-engine (exponential patterns), rga-text-crdt (rg33 to rg36: the slow method stays within 1.2 times each limit, and at rg33 the reference is quadratic too), bytecode-vm (vm23), diff-patch (3 probes), log-kv-store (2 probes), http1-parser (long headers). Not claimed, because the natural slow method is under 2 times the limit and passed on a faster CI runner: http1-parser (many pipelined requests), rrule-expander (rr44). These still check the result at size. A never-ending method may hit an operational backstop without a CPU measurement; that check remains unjudged and does not erase other proven failures.

Four targets are a small panel. Most tasks are run by few configurations, so many pairs share only some tasks and the sign test is weak. A frontier configuration in the panel is the next step: without one, the top tier's headroom above the strongest models is not measured.

## Rules for a task at any tier

- One correct result, checked by a machine. No judgement calls in the check.
- Every expected value comes from code: a solver, a reference solution, or a check that runs the reference. Tests prove that the reference passes and that a plausible wrong answer does not.
- The task text states every rule the check tests. Difficulty comes from the work, never from a hidden convention.
- New tasks are fresh: new names, numbers and specs, not copied from a public benchmark, so a model cannot have seen the answer.
- A folded task (taken from an older suite) records `metadata.tier.origin`, the old `case_id`.

## Sources

- METR, [Measuring AI Ability to Complete Long Tasks](https://arxiv.org/html/2503.14499v3), and [Time Horizon 1.1](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/).
- METR, [Frontier Risk Report, February to March 2026](https://metr.org/blog/2026-05-19-frontier-risk-report/).
- OpenAI, [Introducing SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/); difficulty shares in [SWE-bench Multimodal](https://arxiv.org/pdf/2410.03859), table 21.
- Zheng et al., [LiveCodeBench Pro](https://arxiv.org/abs/2506.11928v1).
- Epoch AI, [FrontierMath tiers 1 to 4](https://epoch.ai/frontiermath/tiers-1-4).
- [Lost in Benchmarks? Rethinking LLM Benchmarking with Item Response Theory](https://arxiv.org/pdf/2505.15055); [ATLAS: Adaptive Testing for LLM Evaluation](https://arxiv.org/html/2511.04689v1).
