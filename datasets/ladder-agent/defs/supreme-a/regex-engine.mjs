export default {
  slug: 'regex-engine',
  tier: {
    level: 5,
    human_minutes: 360,
    basis: 'Reference is about 480 lines in 4 modules (pattern parser with exact error order, compiler with the size rule, a linear-time matcher with priorities and captures, and the exec, matchAll and replace API); an experienced engineer needs about 6 h to build a Pike-style engine that keeps the first-match priority of a backtracking engine, and to test the empty-loop, capture, class and error corner cases.',
  },
  tags: ['build', 'spec'],
  task: 'Build the regular expression engine that SPEC.md describes. compile(pattern, flags) returns an object with exec(text, from), matchAll(text) and replace(text, replacement, all), for a stated pattern syntax (classes, groups, named groups, greedy and lazy repeats, counted repeats, anchors, word boundaries, flags i, m and s). It must give the match a backtracking engine gives (leftmost start, then the first choice in priority order, with the empty-iteration and capture rules of SPEC.md) but must run in time proportional to text length times pattern size, so patterns such as (a|aa)+$ and (x+x+)+y stay fast. Syntax problems throw RegexSyntaxError with one of these codes: unterminated-group, unmatched-paren, unterminated-class, bad-range, nothing-to-repeat, bad-count, bad-escape, unsupported-group, bad-name, dup-name, too-large and bad-flags. The stubs in src/parser.mjs, src/compiler.mjs, src/matcher.mjs and src/regex.mjs throw "not implemented"; src/errors.mjs, src/units.mjs and src/index.mjs are finished. The files in test/ must pass and must not be edited.',
};
