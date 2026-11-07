export default {
  slug: "ml-type-inference",
  tier: {
    level: 5,
    human_minutes: 210,
    basis: "Estimated from the size of the reference: a parser, unifier, let-polymorphic inference and printer, about 490 lines in 4 files, from a 179-line spec with exact error messages and positions. An expert reads the spec, writes the four modules and debugs the positions and naming rules.",
  },
  tags: ["spec", "language"],
  task: "This project is a type checker for a small ML-like language. The lexer, the error class, the type terms and the public entry point (typeOf in src/index.mjs) are done. The parser (src/parser.mjs), the unifier (src/unify.mjs), the inference (src/infer.mjs) and the type printer (src/printer.mjs) are stubs.\n\nBuild them so that typeOf(source) gives the principal type of a program, or its first error with the exact message and position. SPEC.md in the project root is the full specification: the grammar and operator table, the syntax error messages, the typing rule for every construct (with the order in which they run, the unify call each one makes and the position of its error), the two unification errors, and how types are printed. Follow it to the letter: a different rule order or position gives different errors.\n\nRead the lexer, index.mjs and the visible tests in test/ first. The visible tests cover only a few cases; the hidden check covers every rule of the spec, including syntax errors, positions on later lines, shared type variable naming in messages, and large programs. Do not edit SPEC.md or the existing files in test/; put any new tests in new files. Do not install packages.",
};
