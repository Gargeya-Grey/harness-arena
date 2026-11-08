export default {
  slug: 'build-scheduler',
  tier: {
    level: 5,
    human_minutes: 210,
    basis: 'Reference is about 330 lines in 3 modules; an experienced engineer needs about 3.5 h to read the spec, build the event loop with its tie, retry and stop rules, and test the corner cases.',
  },
  tags: ['build', 'spec'],
  task: 'Build the incremental build scheduler that SPEC.md describes. The stubs in src/graph.mjs, src/staleness.mjs and src/scheduler.mjs throw "not implemented"; the public function is build() in src/index.mjs. Everything the hidden check tests is written in SPEC.md: the validation order and cycle paths, the cache entries and stale reasons, early cutoff, the weight and tie rules, slot choice, retries, keepGoing false, goals, and the exact result shape. Scheduling must stay fast on graphs of a few thousand targets. The files in test/ must pass and must not be edited.',
};
