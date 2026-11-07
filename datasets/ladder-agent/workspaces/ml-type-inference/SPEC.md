# Mini-ML type checker

`typeOf(source)` in `src/index.mjs` reads one Mini-ML program (a single expression) and returns its
principal type, or the first error. You build `parser.mjs`, `unify.mjs`, `infer.mjs` and `printer.mjs`.
`lexer.mjs`, `errors.mjs`, `types.mjs` and `index.mjs` are done; read them first.

The result is `{ ok: true, type }` with `type` a string, or `{ ok: false, error: { message, line, col } }`.
Exactly one error is reported: the first one, in the order this spec gives. No type is ever returned
for a program that has an error.

## 1. Positions

`line` and `col` are 1-based. A tab is one column. A newline (`\n`) starts a new line; `\r` is whitespace.
The position of an expression or pattern is the position of its first token (for `(e)` that is the `(`).
The end of input is a token too: its position is just after the last character.

## 2. Tokens (done in `lexer.mjs`)

Keywords: `let rec in fun if then else match with true false`. Identifiers start with a lowercase letter
or `_`; `_` alone is the wildcard and is an identifier token. Integers are digits only (no sign; write
`0 - 3`). Strings are `"…"` on one line with no escapes. Comments are `(* … *)` and do not nest.
The lexer runs over the whole source before the parser starts, so a lexer error is reported even when
a syntax error comes earlier in the text.
Lexer messages: `unexpected character 'c'`, `unterminated string` (at the opening quote),
`unterminated comment` (at the opening `(*`).

## 3. Grammar

```
expr    := 'let' ['rec'] name param* '=' expr 'in' expr
         | 'fun' param+ '->' expr
         | 'if' expr 'then' expr 'else' expr
         | 'match' expr 'with' ['|'] arm ('|' arm)*
         | binary
name    := identifier                      (the wildcard `_` is allowed)
param   := identifier                      (the wildcard `_` is allowed)
arm     := pattern '->' expr
binary  := operand (infix operand)*        (levels in the table below)
operand := application | a let/fun/if/match expression (it runs as far right as it can)
application := atom atom*                  (left associative: `f a b` is `(f a) b`)
atom    := int | string | 'true' | 'false' | '(' ')' | name
         | '(' expr ')' | '(' expr (',' expr)+ ')' | '[' ']' | '[' expr (';' expr)* ']'
pattern := apat '::' pattern | apat        (`::` is right associative)
apat    := '_' | identifier | int | string | 'true' | 'false' | '(' ')' | '[' ']'
         | '(' pattern ')' | '(' pattern (',' pattern)+ ')' | '[' pattern (';' pattern)* ']'
```

`let f x y = e1 in e2` means `let f = fun x y -> e1 in e2`. With `rec`, the same rewrite applies to `e1`.
A `let`, `fun`, `if` or `match` is never an argument of an application without parentheses:
`f fun x -> x` is a syntax error. The last arm of a `match` takes everything to its right, so a `match`
inside an arm needs parentheses. An arm ends at a `|` or at a token that cannot continue it.
The wildcard `_` used as an expression is a variable named `_` (so it is unbound).

Infix operators, from loosest to tightest:

| Level | Operators | Associativity |
|---|---|---|
| 1 | `\|\|` | right |
| 2 | `&&` | right |
| 3 | `=` `<>` `<` `<=` `>` `>=` | left |
| 4 | `::` | right |
| 5 | `^` | right |
| 6 | `+` `-` | left |
| 7 | `*` `/` | left |

Application binds tighter than every infix operator. There are no prefix operators.

## 4. Syntax errors

The parser stops at the first one. `X` below is the token found; it is written `'text'` (the token text
as in the source, quotes included for strings), or `end of input`.

- A token that cannot start the thing the parser needs (an expression, an atom, a pattern) is
  `unexpected X`, at that token.
- A token that is required at this point and is not there is `expected 'T' but found X`, at the token
  found. `T` is the required token text. Where the parser needs a name or a parameter it is
  `expected identifier but found X`.
- Required tokens: after `let` and `let rec` an identifier (the name); after the name, the parser takes
  identifiers as parameters while it sees them, and then needs `=`; `in` after the value of a `let`; after
  `fun` at least one identifier, then any more, then `->`; `->` after an arm pattern; `then`, `else`, `with`
  as the keyword says; `)` after the last element of a parenthesised group (after an element the parser
  accepts `,` for a tuple, else it needs `)`); `]` after the last element of a list (after an element the
  parser accepts `;`, else it needs `]`). Patterns follow the same `)` and `]` rules.
- A `;` or `,` must be followed by an element: `[1; 2;]` is `unexpected ']'`.
- When one complete expression has been parsed and the next token is not the end of input, it is
  `unexpected X` at that token.
- `fun` with no parameter is `expected identifier but found '->'`.

## 5. Typing rules

Types: `int`, `bool`, `string`, `unit`, `t1 -> t2`, `t1 * t2 * …` (2 or more), `t list`.
A type scheme is a type with some variables quantified. The environment starts empty: there are no
built-in names.

Notation: `unify(expected, found) at P` means: apply the current substitution to both types, then unify
them; if that fails, report the error of section 6 at position `P`. Rules run in the order written.

1. **Literals.** `int`, `string`, `true`/`false` (bool), `()` (unit).
2. **Variable `x`.** Not in the environment: error `unbound variable x` at the variable. Else its scheme
   is instantiated with fresh variables.
3. **`fun p1 … pn -> e`.** Each parameter, in order, gets a fresh variable; the wildcard binds nothing.
   A name that is already a parameter of this `fun` is the error `duplicate variable x` at the second
   occurrence. The parameters are monomorphic in `e`. Type: `t1 -> … -> tn -> te`.
4. **Application `f a`** (position = position of `f`). Infer `f`, giving `tf` (substitution applied).
   - `tf` is `p -> r`: infer `a`, then `unify(p, ta) at` the position of `a`. Type `r`.
   - `tf` is a variable: infer `a`, then `unify(tf, ta -> r) at` the application, with `r` fresh. Type `r`.
   - otherwise: the error `not a function: T` at the application, with `T` the printed `tf`. `a` is not inferred.
5. **`let x = e1 in e2`.** Infer `e1` in the current environment, giving `t1`. Generalise: quantify every
   variable of `t1` (after substitution) that is not free in the environment (after substitution). There is
   no value restriction. Infer `e2` with `x` bound to that scheme. The wildcard name binds nothing.
6. **`let rec x = e1 in e2`.** Give `x` a fresh variable `a`, bound monomorphically. Infer `e1` in that
   environment, giving `t1`. `unify(a, t1) at` the position of the name `x`. Then continue as for `let`:
   generalise `t1` against the environment *without* `x`, and infer `e2`.
7. **`if c then a else b`.** Infer `c`, `unify(bool, tc) at` `c`. Infer `a`, infer `b`, `unify(ta, tb) at` `b`.
   Type `ta`.
8. **Tuple `(e1, …, en)`.** Infer left to right. Type: the tuple of the types.
9. **List `[e1; …; en]`.** Infer left to right; `unify(t1, ti) at` `ei` for `i` from 2. Type `t1 list`.
   `[]` is `a list` with `a` fresh.
10. **Operators.** Operands are inferred left to right; each check comes right after its operand.
    - `+ - * /`: `unify(int, tl) at` the left operand, then `unify(int, tr) at` the right operand. Type `int`.
    - `< <= > >=`: the same checks (both `int`). Type `bool`.
    - `&& ||`: both operands `bool`. Type `bool`.
    - `^`: both operands `string`. Type `string`.
    - `= <>`: infer left, infer right, `unify(tl, tr) at` the right operand. Type `bool`.
    - `e1 :: e2`: infer `e1`, infer `e2`, `unify(t1 list, t2) at` the right operand. Type `t2` (after the
      substitution).
11. **`match e with p1 -> b1 | …`.** Infer `e`, giving `ts`. For each arm in order: infer the pattern `p`
    (below), giving `tp` and some bindings; `unify(ts, tp) at` the pattern; infer the body with the bindings
    added to the environment (monomorphic). For the first arm the type of the match is the type of its
    body. For each later arm, `unify(tm, tbody) at` the body. Type `tm`.

Patterns, with their own rules (the pattern of an arm is inferred before it is unified with `ts`):

- `_`: a fresh variable, no binding. A name: a fresh variable, bound. A literal: its type. `()`: unit.
- A name bound twice in one pattern: `duplicate variable x` at the second occurrence (`_` may repeat).
- Tuple pattern: the tuple of the element types. `[]`: `a list` with `a` fresh.
- List pattern `[p1; …; pn]`: like a list expression: `unify(t1, ti) at` `pi`, from 2. Type `t1 list`.
- `p :: q`: infer `p`, infer `q`, `unify(tp list, tq) at` the position of `q`. Type `tq`.

A program that is well typed returns the type of the whole expression with the substitution applied.
Variables that are still free in it are not quantified; they print like any variable (section 7).

## 6. Type errors

Besides the errors named above, `unify(expected, found)` can fail:

- Two different constructors, or the same constructor with a different number of arguments (for example
  `int * int` and `int * int * int`), at any depth: `type mismatch: expected E but found F`. `E` and `F` are
  the two whole types given to that `unify` call (after the substitution was applied, before unification was
  tried), printed with one shared naming (section 7: names are given across `E` first, then `F`).
- A variable against a type that contains it (the occurs check) at any depth: `infinite type: V = T`, with `V`
  the variable and `T` the type that contains it, fully substituted at the moment the check fails, printed
  with one shared naming across `V` then `T`.

The error position is the one the rule of section 5 names. A variable unified with itself is not an error.

## 7. Printing types

- Arrow is the loosest, then tuple (`*`), then `list`, which is a postfix applied to an atom.
- `->` is right associative: `int -> int -> int`. An arrow on the left of an arrow needs parentheses:
  `(int -> int) -> int`. A tuple on either side of an arrow needs none: `int * int -> int * int`.
- Inside a tuple, an element that is an arrow or a tuple needs parentheses: `(int -> int) * bool`,
  `int * (int * int)`, `(int * int) * int`.
- The argument of `list` needs parentheses when it is an arrow or a tuple: `(int -> int) list`,
  `(int * bool) list`. A list of a list is `int list list`. A list is never put in parentheses.
- Variables are named `'a`, `'b`, …, `'z`, then `'a1`, `'b1`, …, `'z1`, `'a2`, … in the order of their first
  appearance when the string is read left to right. For a message with two types, naming continues from the
  first type into the second.

## 8. Limits

Programs of a few thousand tokens must work: a chain of 1500 nested `let`s, a list of 3000 elements, a
tuple nested 300 deep. The checker must finish each in well under a second.

## Files

- `src/index.mjs`, `src/lexer.mjs`, `src/errors.mjs`, `src/types.mjs`: done. Do not change their behaviour.
- `src/parser.mjs`, `src/unify.mjs`, `src/infer.mjs`, `src/printer.mjs`: yours.
- `test/`: the visible tests. Add new test files; do not edit the existing ones.
