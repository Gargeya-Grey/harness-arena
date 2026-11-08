export default {
  slug: "markdown-renderer",
  tier: {
    level: 5,
    human_minutes: 240,
    basis: "Estimated from the size of the reference: a block parser with quotes, nested lists and a loose/tight rule, an inline scanner with code spans, a delimiter-run emphasis matcher and a bracket stack for links, about 540 lines in 4 files, from a 214-line spec that replaces CommonMark. An expert reads the spec, builds the three modules and debugs container nesting, the rule of three and bracket handling.",
  },
  tags: ["spec", "language"],
  task: "This project renders a Markdown subset to HTML. The text helpers (src/text.mjs) and the public entry point (render in src/index.mjs) are done. The block parser (src/blocks.mjs), the HTML writer (src/html.mjs) and the inline renderer (src/inline.mjs) are stubs. You may add modules, for example for emphasis.\n\nBuild them so that render(source) gives exactly the HTML that SPEC.md in the project root defines. The spec is not CommonMark: it fixes its own rules for what starts a block and what interrupts a paragraph, for list items (content column, no lazy continuation, tight and loose), for fenced and indented code, for code spans, for emphasis delimiter runs (flanking, the rule of three, nesting), for inline links, reference links and images (a link never contains a link, unsafe destinations), and for line breaks. Where it differs from CommonMark, follow the spec. Large inputs must stay fast: do not rescan the text for each delimiter run.\n\nRead the helper modules and the visible tests in test/ first. The visible tests cover only the basics; the hidden check covers every rule of the spec. Do not edit SPEC.md or the existing files in test/; put any new tests in new files. Do not install packages.",
};
