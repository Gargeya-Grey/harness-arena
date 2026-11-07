# Difficulty ladder

The ladder is 80 tasks in five tiers. Each tier holds more tasks than the one below it, so the hard end of the scale has the most resolution: strong configurations all pass the low tiers, and the comparison is decided in the high ones.

| Level | Tier | Tasks | Expert time (one person, no AI) | Panel mean score target |
|---|---|---|---|---|
| 1 | easy | 5 | up to 2 min | 0.90 or more |
| 2 | medium | 10 | 2 to 8 min | 0.65 to 0.95 |
| 3 | hard | 15 | 8 to 30 min | 0.35 to 0.75 |
| 4 | extra-hard | 20 | 30 min to 2 h | 0.10 to 0.45 |
| 5 | supreme | 30 | 2 to 16 h | 0.20 or less |

`configs/ladder.yaml` holds this table and the share of each task kind per tier. `lab/lib/ladder.mjs` checks every ladder case against it.

## Three kinds, one ladder

A run uses one suite and one prompt, so the ladder is three suites that share the tier field:

| Suite | Prompt | Evaluator | Task |
|---|---|---|---|
| `ladder-answer` | `reasoning-final-answer` | `final-answer@1` | A problem with one exact answer. |
| `ladder-code` | `js-function` | `js-function@1` | One JavaScript function, run against hidden tests. |
| `ladder-agent` | `agent-task` | `workspace-tests@1` | Change a starter project; a hidden check scores the result. |

Agent tasks take the largest share of the top tiers, because long tasks are where configurations differ most (METR).

## Why expert time is the scale

Difficulty is not guessed from how a task looks. It is set in two steps.

1. **A prior from expert time.** Each case records `metadata.tier.human_minutes`: the time a competent professional needs to read the task, solve it and check the result, without AI help. It also records `basis`, one line that says how the estimate was made (a timed solve, the size of the reference solution, or a published anchor below).
2. **A measured position.** A pilot run gives each task a mean score across the panel. A task outside its tier's target band moves tier or is reworked (Calibration).

The professional works under the same conditions as the model:

- **Answer tasks: no computer.** The prompt forbids tools, so the expert time is the time to solve on paper. A short script would solve some tier 4 and 5 answer tasks in 15 to 40 minutes; that is the point of them, because the model has no script either. A harness that lets the model run code in answer mode breaks this condition. The pilot checks each harness's tool calls on answer tasks.
- **Code and agent tasks: normal tools.** An editor, Node and a shell, as in METR's and SWE-bench's human baselines.

Expert time is the scale because it is the best-supported measure of task difficulty for AI systems that we know of:

- **METR time horizons.** METR measures each task by how long skilled humans take, and fits model success against the logarithm of that time. Success falls along a logistic curve, so tiers spaced by a constant factor of time (this ladder uses about 4x) are spaced evenly in difficulty. METR reports the 50% horizon of the best public model at 16 to 20 hours in May 2026, with an 80% horizon near 3 hours. The ladder's panel is mostly smaller models, so the top tier stops at 16 hours, where METR's own suite stops being reliable.
- **SWE-bench Verified.** OpenAI's annotators labelled each issue by the time an experienced developer needs to fix it: under 15 min, 15 min to 1 h, 1 to 4 h, over 4 h. The ladder's agent tiers 3, 4 and 5 use the same notion of time to fix.
- **Competitive programming ratings.** LiveCodeBench Pro groups problems by Codeforces rating: up to 2000, 2000 to 3000, above 3000. In 2025 the best model scored about 83%, 53% and 0% on those groups. The ladder's code tiers use rating-like anchors: tier 3 is around 1600 to 2000, tier 4 around 2000 to 2600, tier 5 above 2600, with huge inputs that rule out the naive method.
- **Graded mathematics.** FrontierMath grades its problems from olympiad and hard undergraduate (tier 1) to research level (tier 4). The ladder's answer tiers rise from word problems with a trap, through multi-step contest problems, to instances that need a search too large to do without a systematic method.

## Calibration

The panel is the targets of the ladder experiments. Each task runs once per target in the pilot.

1. Compute each task's mean score across the panel (a score is the share of hidden tests passed, so partial work counts).
2. A task whose mean is inside its tier's target band stays.
3. A task outside its band moves to the nearest tier whose band holds its mean, as long as its expert time is within a factor of 4 of that tier's range. Otherwise the task is wrong for the scale (too easy for its length, or broken) and is reworked. `node lab ladder --calibrate` applies this rule and prints a verdict per task.
4. A task is checked for a defect before anything else when, for two configurations that both ran it, the one with the higher mean on the other tasks both ran scores under 0.5 on every repeat of it while the other scores 1 on every repeat (`node lab ladder --calibrate` flags it). Item response theory work on public benchmarks finds that such negative discrimination usually means an error in the item (ATLAS, 2025).
5. Moving a task keeps its `case_id`. Its tier changes in a new suite version.

Timing limits. A speed probe in an agent check, and the speed checks in the ladder's own tests, judge by CPU time. The evaluators around them still have wall-clock limits, and a busy machine can reach those:

| Evaluator | Wall-clock limit | What happens past it |
|---|---|---|
| `js-function@1` | 2 s per test | That test fails. |
| `js-function@1` | 30 s for all tests of a case | Every test of the case fails. |
| `workspace-tests@1` | 60 s for a whole check | Every probe has no result; only the file rules count. |

Ladder references stay at least 3x inside each limit (`tests/ladder-code-*.test.mjs` asserts under 0.667 s of CPU per test). A correct but slow answer near a limit can still time out on a busy machine. Score on an idle machine. Scores are derived, so `node lab score` can recompute a doubtful one without new model calls.

Speed probes proved to fail a natural slow solution (tests under `tests/fixtures/ladder-agent-solutions/*/<slug>--slow*/`): build-scheduler, http1-parser (3 of 4), regex-engine (many matches), markdown-renderer (md35, md37), rrule-expander (rr40 to rr44), rga-text-crdt (rg33, rg36), spreadsheet-engine (sp33, sp34). Not proved, because every natural slow method either stays under the threshold or never ends: sql-engine (LIKE), regex-engine (exponential patterns), rga-text-crdt (rg34, rg35), bytecode-vm (vm23), diff-patch (3 probes), log-kv-store (2 probes), http1-parser (long headers). These still check the result at size; a method that never ends meets the 60 s limit.

Four targets are a small panel. The bands are wide on purpose, and a tier needs both its expert-time prior and its measured mean to agree before a task is settled. A frontier configuration in the panel is the next step: without one, the top tier's headroom above the strongest models is not measured.

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
