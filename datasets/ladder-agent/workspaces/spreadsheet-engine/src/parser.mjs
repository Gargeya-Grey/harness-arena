// parseFormula(text) -> { ok: true, ast } | { ok: false }.  `text` is the formula without the leading '='.
// SPEC.md section 3. The shape of the AST is yours; evaluator.mjs and graph.mjs read it.
export function parseFormula(text) {
  void text;
  throw new Error('not implemented: parseFormula');
}

// references(ast) -> { cells: [{ col, row }], ranges: [{ c1, r1, c2, r2 }] }  in-grid mentions only (SPEC.md section 6)
export function references(ast) {
  void ast;
  throw new Error('not implemented: references');
}
