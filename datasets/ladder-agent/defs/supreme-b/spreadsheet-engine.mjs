export default {
  slug: "spreadsheet-engine",
  tier: {
    level: 5,
    human_minutes: 240,
    basis: "Estimated from the size of the reference: a formula parser, a coercing evaluator, a function library, an incremental dependency graph with cycle detection and a stated recalculation order, about 800 lines in 6 files, from a 176-line spec. An expert reads the spec, builds the six modules and debugs coercion, error order, cycles and the recompute list.",
  },
  tags: ["spec", "build"],
  task: "This project is a spreadsheet engine: a grid of cells that hold numbers, text, booleans or formulas. When a cell changes, the sheet recomputes only the formulas that depend on it, each exactly once, in dependency order, and reports which. The cell references (src/refs.mjs), the error values (src/values.mjs) and the public entry point (src/index.mjs) are done. The formula parser (src/parser.mjs), the evaluator (src/evaluator.mjs), the function library (src/functions.mjs), the dependency graph (src/graph.mjs) and the sheet (src/sheet.mjs) are stubs.\n\nBuild createSheet() as SPEC.md in the project root specifies: cell input rules, the formula grammar and precedence, value coercion, error values and which error wins, the functions and their argument rules, dependencies through single references and ranges, the recompute set and its order, cycles with #CYCLE!, and the evaluation counter. Follow the spec to the letter, including the order of the returned lists. Large sheets must stay fast: a change must not recompute the whole sheet, and long chains and deep nesting must not overflow the stack.\n\nRead the helper modules and the visible tests in test/ first. The visible tests cover only the basics; the hidden check covers every rule of the spec. Do not edit SPEC.md or the existing files in test/; put any new tests in new files. Do not install packages.",
};
