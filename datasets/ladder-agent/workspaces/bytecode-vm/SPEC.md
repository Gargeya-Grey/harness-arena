# Bytecode compiler and virtual machine

`run(source, options)` in `src/index.mjs` runs a program in a small language (called *Kite* here). You build the
parser (`src/parser.mjs`), the compiler to bytecode (`src/compiler.mjs`) and the virtual machine
(`src/vm.mjs`). The lexer, the error class, the value helpers and `src/index.mjs` are done; read them first.
The shape of the syntax tree and of the bytecode is yours.

## 1. Interface

- `run(source, options)` returns `{ output }`: an array of strings, one for each call of `print`. It throws a
  `TypeError` when `source` is not a string. `options.maxCallDepth` (default 200) and `options.maxSteps`
  (default 1000000) are described in section 9.
- Every other failure is a `LangError` (`src/errors.mjs`) with `kind` (`'syntax'`, `'compile'` or `'runtime'`),
  `message`, `line`, `column` (both start at 1), `trace` (an array of strings; `[]` unless the kind is `'runtime'`) and
  `output` (the lines `print` wrote before the failure; `[]` for a syntax or compile error).
- **Order.** The whole source is tokenized first, so a lexical error anywhere wins over every other error. Then
  the whole source is parsed (the first syntax error wins), then compiled (the first compile error wins, in
  source order, function bodies where they stand). Only then does the program run, so an error found before the
  run never lets `print` write anything.

## 2. Tokens (done in `src/lexer.mjs`)

Whitespace and `// comments` to the end of the line are skipped. Numbers are `digits` or `digits.digits`
(`1.` and `.5` are not numbers). Strings are `"…"` with the escapes `\n \t \" \\`; a string may span lines.
Identifiers are letters, digits and `_`, not starting with a digit. Keywords: `let fn if else while for return
break continue true false nil and or`. Lexical errors (kind `'syntax'`): `Unexpected character 'c'.`,
`Unterminated string.` (at the opening quote), `Invalid escape '\q'.` (at the backslash). A column counts UTF-16
units from 1; a tab is one column; the `eof` token stands after the last character.

## 3. Grammar

```
program     = declaration* eof
declaration = "fn" IDENT "(" params? ")" block        // function declaration
            | "let" IDENT ("=" expression)? ";"
            | statement
statement   = block | "if" "(" expr ")" statement ("else" statement)?
            | "while" "(" expr ")" statement
            | "for" "(" ( letDecl | exprStmt | ";" ) expr? ";" expr? ")" statement
            | "return" expr? ";" | "break" ";" | "continue" ";" | exprStmt
block       = "{" declaration* "}"        exprStmt = expression ";"
expression  = assignment      assignment = (IDENT | postfix "[" expr "]") "=" assignment | binary
```

A `let` or a function declaration is not a `statement`: it can only stand in a block, at the top level, or
(`let`) as the first clause of `for`. `fn` followed by `(` is a function expression, so `fn(x) { … };` is an
expression statement. Binary operators, from the loosest, all left associative: `or`; `and`; `==` `!=`; `<` `<=`
`>` `>=`; `+` `-`; `*` `/` `%`. Then the unary `!` and `-` (they nest: `!!x`, `- -x`), then the postfix forms call
`f(a, b)` and index `a[i]` (they chain: `f(1)(2)[0]`), then the atoms: number, string, `true`, `false`, `nil`,
a name, `( expr )`, an array literal `[a, b]` (no trailing comma), and a function expression `fn (params) block`.
An assignment's value is the assigned value. Its left side must be a name or an index expression; a
parenthesized name is not one.

## 4. Syntax errors

The error is at the token that was found where something else was expected (at the `eof` token at the end of the
input), unless the table says otherwise. The messages:

| When | Message |
|---|---|
| no expression can start here | `Expect expression.` |
| after an expression statement | `Expect ';' after expression.` |
| after `let` | `Expect variable name.`, then `Expect ';' after variable declaration.` |
| a declaration `fn x` | `Expect '(' after function name.` |
| a function expression | `Expect '(' after 'fn'.` |
| in a parameter list | `Expect parameter name.`, `Expect ')' after parameters.` |
| before a function body | `Expect '{' before function body.` |
| end of a block or body | `Expect '}' after block.` |
| `if`, `while`, `for` | `Expect '(' after 'if'.` (and `'while'`, `'for'`), `Expect ')' after condition.` |
| `for` clauses | `Expect ';' after loop condition.`, `Expect ')' after for clauses.` |
| `return`, `break`, `continue` | `Expect ';' after return value.`, `Expect ';' after 'break'.`, `Expect ';' after 'continue'.` |
| call, index, array, group | `Expect ')' after arguments.`, `Expect ']' after index.`, `Expect ']' after array items.`, `Expect ')' after expression.` |
| a bad assignment target | `Invalid assignment target.` at the `=` token |

`fn` at the start of a statement followed by a name is a declaration; any other `fn` is a function expression.

## 5. Scopes and compile errors

- A block, a function (its parameters and the top level of its body are **one** scope) and a `for` statement (its
  clauses) each open a scope. A name refers to the innermost visible declaration; an inner scope may shadow an
  outer name. At the top level of the program, `let` and `fn` declare **globals**; everything declared in a
  block or a function is **local**. A global may be declared again (the new value replaces the old), and the
  builtins of section 7 are globals too.
- Compile errors (kind `'compile'`, at the token named):
  - `Variable 'x' is already declared in this scope.` for a second local `let`, `fn` or parameter of the same name in
    one scope (at the second name). Not for globals.
  - `Cannot read variable 'x' in its own initializer.` when the initializer of a local `let x` uses `x`, also inside
    a function expression in that initializer (at the use). Not for globals. (A local `fn x` can use its own
    name in its body.)
  - `Cannot use 'return' outside a function.`, `Cannot use 'break' outside a loop.`, `Cannot use 'continue'
    outside a loop.` (at the keyword). A function body starts a new context: `break` in a function in a loop is an error.
- A name that is not a local of any enclosing function is a global, looked up when the program runs.
  Reading or assigning a global that does not exist is the runtime error `Undefined variable 'x'.` at the
  name. A global function is defined when its declaration runs, not before.

## 6. Values and operators

- Values: numbers (JavaScript doubles), strings, `true`/`false`, `nil`, arrays and functions. `src/values.mjs`
  gives `display` (the text `print` and `str` write), `isTruthy` and `typeName`. Only `nil` and `false` are
  false; `0` and `""` are true. `==` and `!=` accept any two values: numbers, strings and booleans are equal
  when they have the same type and value; `nil` equals `nil`; arrays and functions are equal only when they are
  the same object. `and`/`or` give one of their operands (not a boolean) and do not evaluate the right side when
  the left side decides. `!x` is a boolean.
- Operands are evaluated left to right, and both are evaluated before their types are checked.
  `+` needs two numbers or two strings (else `Operands must be two numbers or two strings.`); `-` `*` `/` `%` and
  `<` `<=` `>` `>=` need numbers (else `Operands must be numbers.`); unary `-` needs a number (`Operand must be a number.`).
  `/` and `%` with a right side of 0: `Division by zero.` (after the type check). `%` has the sign of the left
  side, as in JavaScript. A result that is not finite: `Numeric overflow.`. The result `-0` is `0`. All these
  errors are at the operator token.
- A call `f(a, b)` evaluates `f`, then the arguments, then checks: `Can only call functions.`, then
  `Expected N arguments but got M.` (N is the arity), both at the `(`. There are no default or extra arguments.
- Arrays: `[a, b]`, indexing `a[i]` (arrays and strings; a string gives the one-character string at that UTF-16 position) and assignment
  `a[i] = v` (arrays only). The index must be a whole number: errors `Can only index arrays and strings.` (for
  assignment `Can only assign to array elements.`), then `Index must be an integer.`, then `Index out of range.`
  (below 0 or at least the length), at the `[`. For an assignment the value is evaluated before the checks.
- Strings join with `+` only; there is no automatic conversion. Equal strings are equal.

## 7. Builtins

All are globals with a fixed arity, and a call needs exactly that many arguments (section 6). A builtin call
costs no step and adds no entry to the trace; its errors are at the `(`.

| Name | Arity | Result and errors |
|---|---|---|
| `print(x)` | 1 | appends `display(x)` to the output; returns `nil` |
| `len(x)` | 1 | length of an array, or of a string in UTF-16 units; else `Argument must be an array or a string.` |
| `push(a, x)` | 2 | appends and returns the new length; else `First argument must be an array.` |
| `pop(a)` | 1 | removes and returns the last element; `Argument must be an array.`; `Cannot pop from an empty array.` |
| `str(x)` | 1 | `display(x)` as a string |
| `type(x)` | 1 | `typeName(x)` |
| `floor(x)` | 1 | rounds down; else `Argument must be a number.` |

## 8. Functions, closures and loops

- `fn name(a, b) { … }` and `fn (a, b) { … }` make a function. A function without `return` returns `nil`. A
  function declared by name is called by that name in traces and shown as `<fn name>`; a function expression
  is `<anon>` in traces and `<fn>` when shown, also when a variable holds it.
- **Closures capture variables, not values.** A function can read and assign the locals of the functions that
  enclose it, also after they have returned, and two closures over one variable share it. Each time a
  `let` runs, in a block that runs again, it makes a **new variable**; each call makes new parameters.
  ```
  fn make() { let n = 0; fn up() { n = n + 1; return n; } return up; }
  let a = make(); a(); print(a());   // 2
  let b = make(); print(b());        // 1: a new n
  ```
- **`for` makes a new loop variable for each iteration.** The variable declared in the first clause is copied into
  a new variable at the end of each iteration, before the third clause runs. A closure made in an iteration keeps
  the variable of that iteration, with the value it had when the iteration ended (also after `continue`):
  `for (let i = 0; i < 3; i = i + 1) { push(fs, fn() { return i; }); }` gives closures that return 0, 1, 2.
  A variable declared in a loop body is new in every iteration.
- `break` leaves the nearest loop; `continue` goes on with the next iteration (in `for`, with the third clause).
  Both leave the scopes of the loop body properly: closures made there keep their variables.
- `while (c) s` tests `c` before every iteration; `for` runs its first clause once, tests the second before every
  iteration (no second clause means true) and runs the third after each one.

## 9. Runtime errors, trace and limits

- A runtime error (kind `'runtime'`) is at the position the section above names; `trace` lists the active
  calls from the innermost out, at most the first 12, each as `NAME at LINE:COL`. `NAME` is `<script>` for the top
  level, `<anon>` for a function expression, else the declared name. The innermost entry uses the error position;
  every other entry uses the `(` of the call that is running in that frame. The top level is the last entry when the trace is not cut.
- **Call depth.** A call of a function from the language fails with `Stack overflow.` (at its `(`) when it would
  make more than `options.maxCallDepth` such calls active at once. Builtins do not count.
- **Steps.** One *step* is counted for each call of a function from the language and for each iteration of a loop
  (each time control returns from the end of the body, or by `continue`, to the loop test). The count starts at
  zero. Increment it for each such event; if the incremented count exceeds `options.maxSteps`, that same event
  fails with `Step limit exceeded.` at the `(` of the call or at the
  `while` / `for` keyword. For a call the checks go in this order: callable, arity, depth, steps.
  Thus `fn f() {} f();` fails at its first call with `maxSteps: 0`. With `maxSteps: 2`, two calls succeed
  and a third call fails. Builtin calls do not increment this count.
- The program must run on a virtual machine with its own frame stack and its own value stack: a recursion of
  20 000 calls (with a larger `maxCallDepth`) must work, which a recursive tree walker in JavaScript cannot do.
  A loop of a million iterations must take well under a second or two.

## Files

- `src/errors.mjs`, `src/lexer.mjs`, `src/values.mjs`, `src/index.mjs`: done.
- `src/parser.mjs`, `src/compiler.mjs`, `src/vm.mjs`: yours; add modules as you like.
- `test/`: the visible tests. Add new test files; do not edit the existing ones.
