export default {
  slug: 'diff-patch',
  tier: {
    level: 5,
    human_minutes: 270,
    basis: 'Reference is about 280 lines in 4 modules (Myers greedy search with the pinned tie rule and trace read-back, a unified diff writer with hunk merging and header rules, a strict patch parser with four error codes, and an applier with offset, fuzz levels and learned shift); an experienced engineer needs about 4.5 h to get the byte-exact output, the search order and the speed on 20000-line inputs right.',
  },
  tags: ['build', 'spec'],
  task: 'Build the line diff, unified diff and patch tool that SPEC.md describes. diffLines(a, b) returns a minimal edit script with the exact tie rule of SPEC.md and stays fast for long lists with few changes. unifiedDiff(oldText, newText, options) prints a unified diff byte for byte (hunk merging, header counts, the no-newline marker). parsePatch(text) reads one file of a unified diff. applyPatch(text, patch, options) applies a patch to text that may have moved or changed around the hunk, with a stated search order, fuzz levels, a shift learned from the previous hunk, and a reverse option. A patch that cannot be read throws PatchError with one of these codes: bad-header, bad-hunk-header, bad-hunk-line and count-mismatch. The stubs in src/myers.mjs, src/format.mjs, src/parse.mjs and src/apply.mjs throw "not implemented"; src/errors.mjs, src/lines.mjs and src/index.mjs are finished. The files in test/ must pass and must not be edited.',
};
