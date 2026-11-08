export default {
  slug: "bytecode-vm",
  tier: {
    level: 5,
    human_minutes: 300,
    basis: "Estimated from the size of the reference: a parser, a single-pass compiler to bytecode with locals, upvalues and loop scopes, and a stack virtual machine with its own frames, about 780 lines in 3 files, from a 176-line spec with exact error messages, positions and traces. An expert reads the spec, writes the three modules and debugs closure capture, per-iteration loop variables, break and continue scope cleanup, and error positions.",
  },
  tags: ["spec", "language"],
  task: "This project is a small programming language that runs on a virtual machine. The lexer, the error class, the value helpers and the public entry point (run in src/index.mjs) are done. The parser (src/parser.mjs), the compiler to bytecode (src/compiler.mjs) and the virtual machine (src/vm.mjs) are stubs.\n\nBuild them so that run(source, options) behaves exactly as SPEC.md in the project root defines: the grammar and the syntax errors with their messages and positions, scopes and the compile errors, values and operators, the builtins, closures that capture variables, a fresh loop variable in each iteration of a for loop, break and continue, runtime errors with positions and a call trace, the call-depth limit and the step limit. The program must be compiled to bytecode and run on a virtual machine with its own frame stack: a recursion 20 000 calls deep has to work, and a loop of a million iterations has to be fast. Follow the spec to the letter, including the order in which errors are found.\n\nRead the lexer, the value helpers and the visible tests in test/ first. The visible tests cover only the basics; the hidden check covers every rule of the spec. Do not edit SPEC.md or the existing files in test/; put any new tests in new files. Do not install packages.",
};
