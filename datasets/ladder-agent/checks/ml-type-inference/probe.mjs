// Hidden probes for ml-type-inference; expected.json holds the answers.
// Each probe type checks a list of programs through src/index.mjs and returns one
// line per program: its index, then the type or the error with its position.
const show = (result) => (result.ok ? result.type : `${result.error.line}:${result.error.col} ${result.error.message}`);
const many = (sources) => async ({ load }) => {
  const { typeOf } = await load('src/index.mjs');
  return sources.map((source, index) => `${index}| ${show(typeOf(source))}`);
};

const chain = (n) => {
  let text = '';
  for (let i = 1; i <= n; i += 1) text += `let v${i} = ${i === 1 ? '1' : `v${i - 1} + 1`} in `;
  return `${text}v${n}`;
};
const generic = (n) => {
  let text = '';
  for (let i = 1; i <= n; i += 1) text += `let g${i} = fun x -> x in `;
  return `${text}(g1 1, g${n} true)`;
};
const names28 = Array.from({ length: 28 }, (_, i) => `p${i}`);

export const probes = [
  { name: 'ml01 literals, parentheses and comments', run: many(['42', '"hi there"', 'true', 'false', '()', '(* note *) 7', '(1)', '((("x")))', '1 (* a *) + (* b\nc *) 2']) },
  { name: 'ml02 type variables are named in the order they appear', run: many(['fun x -> x', 'fun x y -> x', 'fun x y -> y', 'fun f x -> f x', 'fun f g x -> f (g x)', 'fun x y z -> (z, y, x)', 'fun _ -> 1', 'fun _ _ -> true', 'fun a -> fun b -> (b, a)']) },
  { name: 'ml03 arrows are parenthesised on the left only', run: many(['fun f -> f 1', 'fun f x -> f (f x)', 'fun f g -> fun x -> g (f x)', '(fun x -> x) (fun y -> y)', 'fun f -> f (fun x -> x)', 'fun x -> fun y -> x + y', 'fun f -> f (f 1)', 'fun f -> fun g -> f g']) },
  { name: 'ml04 tuples and lists are parenthesised where they nest', run: many(['(1, true)', '(1, (2, 3))', '((1, 2), 3)', '(fun x -> x, 1)', '[(1, 2)]', '[[1]]', '[fun x -> x]', '[]', '([], [])', '(1, 2, 3)', '[(fun x -> x, 1)]', 'fun x -> (x, [x], [[x]])', '[[]]']) },
  {
    name: 'ml05 let generalises the bound name',
    run: many([
      'let id = fun x -> x in (id 1, id true)',
      'let id x = x in (id 1, id "s", id ())',
      'let const x y = x in (const 1 true, const "s" ())',
      'let pair = fun a -> fun b -> (a, b) in pair 1',
      'let f = fun x -> x in f',
      'let nil = [] in (1 :: nil, true :: nil)',
      'let _ = 1 in true',
      'let x = 1 in let x = true in x',
      'let x = 1 in let f = fun y -> x in let x = true in (f 0, x)',
      'let x = let y = 1 in y in x',
    ]),
  },
  {
    name: 'ml06 a variable of the environment is not generalised',
    run: many([
      'fun x -> let y = x in (y, y)',
      'fun x -> let f = fun y -> (x, y) in (f 1, f true)',
      'fun x -> let g = fun y -> y in (g x, g 1)',
      'fun x -> let y = x + 1 in y',
      'fun x -> let f = fun y -> x in f',
      'fun x -> let x = 1 in x',
    ]),
  },
  {
    name: 'ml07 a lambda parameter has one type',
    run: many(['fun f -> (f 1, f true)', 'fun id -> let a = id 1 in id true', 'fun f -> (f 1, f 2)', 'fun f -> f 1 + f true', '(fun f -> (f 1, f true)) (fun x -> x)', 'match (fun x -> x) with f -> (f 1, f true)']),
  },
  {
    name: 'ml08 let rec',
    run: many([
      'let rec fact n = if n = 0 then 1 else n * fact (n - 1) in fact',
      'let rec length l = match l with [] -> 0 | _ :: t -> 1 + length t in length',
      'let rec map f l = match l with | [] -> [] | x :: xs -> f x :: map f xs in map',
      'let rec fold f acc l = match l with [] -> acc | x :: xs -> fold f (f acc x) xs in fold',
      'let rec id x = x in (id 1, id true)',
      'let rec f x = f in f',
      'let rec loop x = loop x in loop',
      'let rec even n = if n = 0 then true else odd (n - 1) in 1',
      'let rec f = fun x -> f x in f',
      'let rec f x = (f 1, f true) in f',
      'let rec _ = 1 in 2',
    ]),
  },
  {
    name: 'ml09 list functions written with match',
    run: many([
      'let rec append a b = match a with [] -> b | x :: r -> x :: append r b in append',
      'let rec filter p l = match l with [] -> [] | x :: r -> if p x then x :: filter p r else filter p r in filter',
      'let rec rev_onto acc l = match l with [] -> acc | x :: r -> rev_onto (x :: acc) r in rev_onto []',
      'let rec zip a b = match (a, b) with ([], _) -> [] | (_, []) -> [] | (x :: xs, y :: ys) -> (x, y) :: zip xs ys in zip',
      'let rec sum l = match l with [] -> 0 | x :: r -> x + sum r in sum',
      'let rec concat l = match l with [] -> "" | s :: r -> s ^ concat r in concat',
      'let rec last l = match l with [x] -> x | _ :: r -> last r in last',
      'let rec take n l = match l with [] -> [] | x :: r -> if n = 0 then [] else x :: take (n - 1) r in take',
    ]),
  },
  {
    name: 'ml10 an if expression checks its condition and joins its branches',
    run: many(['if true then 1 else 2', 'fun c -> if c then 1 else 2', 'if 1 then 2 else 3', 'if true then 1 else "a"', 'if true then fun x -> x else fun y -> y + 1', 'if (if true then false else true) then 1 else 2', 'fun a b -> if a then b else []', 'if "x" then 1 else true']),
  },
  {
    name: 'ml11 arithmetic and comparison operators',
    run: many(['1 + 2 * 3', '1 < 2', '"a" < "b"', 'true + 1', '1 + true', '(1 + 2) = 3', '1 = true', 'fun a b -> a + b', 'fun a b -> a < b', 'fun a b -> a = b', 'fun a b -> a <> b', '1 - 2 / 3 * 4', 'fun f -> f 1 <= 2', '[1] = [true]']),
  },
  { name: 'ml12 boolean and string operators', run: many(['true && false || true', 'fun a b -> a && b || a', '"a" ^ "b" ^ "c"', '"a" ^ 1', '1 && true', 'true || 1', 'fun a -> a ^ a', 'true && (1 < 2) && "s"']) },
  {
    name: 'ml13 operator precedence and associativity decide what type checks',
    run: many(['1 + 2 :: []', '1 :: 2 + 3 :: []', '"a" ^ "b" :: []', '1 + 2 = 3 && true', 'true && 1 = 1 || false', '1 :: 2 :: []', '[1] = 1 :: []', 'fun f x -> f x + 1', 'fun f x -> f x :: []', '1 = 1 = true', '1 < 2 = true', 'fun a -> a :: a', '(1 :: 2) :: []', '2 * 3 + 4 = 10']),
  },
  {
    name: 'ml14 a let, fun, if or match may be the right operand of an operator',
    run: many(['1 + if true then 2 else 3', '1 + let x = 2 in x', '2 * fun x -> x', 'true && match 1 with _ -> false', 'f fun x -> x', '1 :: if true then [] else [2]', '(fun x -> x) + 1']),
  },
  {
    name: 'ml15 application is left associative and tighter than any operator',
    run: many(['fun f -> f 1 2', 'let add a b = a + b in add 1 2', 'let add a b = a + b in add 1', 'let add a b = a + b in add 1 true', 'let add a b = a + b in add 1 2 3', 'fun f -> f f', '1 2', '(fun x -> x) 1 2', 'fun x -> x x', '[] 1', '(1, 2) 3', 'fun g -> g (g 1) (g true)']),
  },
  { name: 'ml16 infinite types are named with one naming', run: many(['fun x -> x x', 'fun x -> [x; [x]]', '[fun a b -> a; fun c -> c]', 'fun f x -> f (f x) f', 'fun x y -> (x y, y x)', 'let rec f x = f in 1', 'fun x -> x :: x']) },
  {
    name: 'ml17 a mismatch prints both types with one shared naming',
    run: many(['[fun x -> x; 1]', '[(fun a -> a, 1); (fun b -> b, true)]', 'fun x -> [(x, 1); (x, true)]', '[fun a -> fun b -> a; fun c -> 1]', '[(1, fun x -> x); (2, 3)]', '[(1, 2); (1, 2, 3)]', '[[1]; [true]]', '(fun x -> x) 1 :: [true]']),
  },
  {
    name: 'ml18 match patterns',
    run: many([
      'match [1] with [] -> 0 | x :: _ -> x',
      'fun p -> match p with (a, b) -> a + b',
      'fun l -> match l with [a; b] -> a + b | _ -> 0',
      'fun l -> match l with a :: b :: rest -> (a, b, rest) | _ -> (0, 0, [])',
      'fun x -> match x with 0 -> "zero" | 1 -> "one" | _ -> "many"',
      'fun b -> match b with true -> 1 | false -> 0',
      'fun u -> match u with () -> 1',
      'fun s -> match s with "a" -> 1 | _ -> 2',
      'fun x -> match x with y -> y',
      'fun l -> match l with (x, y) :: _ -> x + y | [] -> 0',
      'fun p -> match p with (f, x) -> (f 1, f true)',
      'fun l -> match l with [] -> 0 | [x] -> x | x :: y :: _ -> x + y',
    ]),
  },
  { name: 'ml19 match errors are reported at the pattern or at the arm body', run: many(['match 1 with true -> 1', 'match [1] with [] -> 0 | x :: _ -> "s"', 'match 1 with 0 -> 1 | "a" -> 2', 'match (1, 2) with (a, b, c) -> a', 'match [1] with [true] -> 1', 'match 1 with x :: xs -> x', 'fun x -> match x with [] -> 0 | 1 -> 2', 'match 1 with x -> x | _ -> true']) },
  {
    name: 'ml20 an arm takes everything to its right unless it is parenthesised',
    run: many(['fun x y -> match x with 0 -> match y with true -> 1 | 5 -> 2', 'fun x y -> match x with 0 -> (match y with true -> 1 | false -> 2) | _ -> 3', 'fun x -> match x with 0 -> match x with 1 -> 2 | _ -> 3 | _ -> "s"', 'match 1 with | 1 -> 2 | _ -> 3']),
  },
  {
    name: 'ml21 a name used twice in one binder is an error',
    run: many(['fun x x -> x', 'fun x y x -> x', 'fun _ _ -> 1', 'match (1, 2) with (a, a) -> a', 'match [1] with a :: a :: _ -> 1', 'let f x x = x in f', 'match (1, 2) with (_, _) -> 1', 'let rec f x y x = 1 in f', 'match [1; 2] with [a; a] -> a']),
  },
  {
    name: 'ml22 unbound variables are reported at the variable',
    run: many(['zz', '1 + zz', 'let a = 1 in a + b', 'fun x -> y', 'let f = fun x -> x in\n  f g', '\tq', '_', 'let rec f x = g x in f', 'match 1 with x -> y']),
  },
  {
    name: 'ml23 the first error in the order of the rules is the one reported',
    run: many(['x + y', 'let a = b in c', 'if p then q else r', '(u, v)', '(1 + true) + zz', '1 zz', 'zz 1 2', 'let a = 1 + "s" in a + true', '[1; true; zz]', 'f (g 1)', '1 + 2 + "a" + zz']),
  },
  {
    name: 'ml24 a token that cannot start an expression is unexpected',
    run: many(['', '1 +', 'let x = in 3', ')', '1 )', '(1 + )', 'let x = 1 in', 'if then 1 else 2', '[1; 2;]', '(1, 2,)', 'f fun x -> x', 'fun x -> ', 'match', 'x |', ',']),
  },
  {
    name: 'ml25 a required token that is missing is named',
    run: many(['let x = 1', 'let x 1 in x', 'if true then 1', 'if true 1 else 2', 'fun x x', 'fun -> 1', 'fun 1 -> 1', 'match 1 x -> 1', 'match 1 with 1 2', '(1, 2', '(1 2', '[1; 2', '[1 2]', 'let = 1 in 2', 'let rec in 2', 'let 1 = 2 in 3', 'if true then 1 else', 'match 1 with x -> x | ']),
  },
  { name: 'ml26 patterns follow the same syntax rules', run: many(['match 1 with (a, b -> 1', 'match 1 with [a b] -> 1', 'match 1 with ) -> 1', 'match 1 with a :: -> 1', 'match 1 with fun -> 1', 'match 1 with (a, ) -> 1', 'match 1 with [a;] -> 1', 'match 1 with | | _ -> 1']) },
  { name: 'ml27 the lexer reports its errors before the parser starts', run: many(['1 + #', '"abc', '(* open', 'let x = 1 in x @', 'a\n  "bc', '(1 + ) #', 'if if then then ~', '1 + (* never closed', '"ok" "unterminated\nmore"', "x'", 'let x\' = 1 in x\'', 'a & b']) },
  { name: 'ml28 positions count lines, tabs and comments', run: many(['let a = 1 in\nlet b = true in\na + b', '(* two\nlines *) zz', '\t\tzz', 'let a = 1 in\r\nzz', '1 +\n\n  zz', '"a\nb"', 'let f = fun x ->\n  x + true\nin f 1', '(* a *)(* b *) zz', '1\n\n']) },
  { name: 'ml29 not a function prints the type of the callee', run: many(['1 2', 'true false', '"s" 1', '() 1', '(1, 2) 3', '[1] 2', '[] 1', '(fun x -> (x, x)) 1 2', 'let a = 1 in a a', 'fun f -> f 1 2 3']) },
  { name: 'ml30 higher order functions', run: many(['let twice f x = f (f x) in twice twice', 'let compose f g x = f (g x) in compose', 'fun n f x -> f (n f x)', 'let apply f x = f x in apply apply', 'let k a b = a in let s x y z = x z (y z) in s k k', 'let flip f a b = f b a in flip', 'fun f -> (fun x -> f (x x)) (fun x -> f (x x))']) },
  { name: 'ml31 let with parameters and wildcards', run: many(['let f _ y = y in f 1 2', 'let f _ _ = 1 in f', 'let rec f n = if n = 0 then 0 else f (n - 1) in f', 'let f x y z = (z, y, x) in f', 'let f () = 1 in f', 'let f x = fun y -> (x, y) in f 1', 'let f = 1 in f 2']) },
  {
    name: 'ml32 type variables after z',
    run: async ({ load }) => {
      const { typeOf } = await load('src/index.mjs');
      const source = `fun ${names28.join(' ')} -> (${names28.join(', ')})`;
      const wide = `fun ${names28.join(' ')} -> [${names28.join('; ')}]`;
      return [show(typeOf(source)), show(typeOf(wide)), show(typeOf(`fun ${names28.slice(0, 27).join(' ')} -> (${names28.slice(26, 27).join('')}, p0)`))].map((line, index) => `${index}| ${line}`);
    },
  },
  {
    name: 'ml33 large programs finish quickly',
    run: async ({ load }) => {
      const { typeOf } = await load('src/index.mjs');
      const list = `[${Array.from({ length: 3000 }, (_, i) => i).join('; ')}]`;
      const tuples = `${'(1, '.repeat(300)}1${')'.repeat(300)}`;
      const apps = `${'f ('.repeat(1000)}1${')'.repeat(1000)}`;
      const out = [typeOf(chain(1500)), typeOf(list), typeOf(`let f = fun x -> x in ${apps}`), typeOf(generic(1200))].map(show);
      const tuple = typeOf(tuples);
      out.push(tuple.ok ? `${tuple.type.length}` : show(tuple));
      return out.map((line, index) => `${index}| ${line}`);
    },
  },
];
