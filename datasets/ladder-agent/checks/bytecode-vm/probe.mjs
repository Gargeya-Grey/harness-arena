// Hidden probes for bytecode-vm; expected.json holds the answers.
// Most probes run a list of programs and return one line per program: its index, then either its output or its error as JSON.
const lib = (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};
const k = String.raw;
const show = (run, source, options) => {
  try {
    return { output: run(source, options).output };
  } catch (error) {
    if (error && error.kind) {
      const { kind, message, line, column, trace, output } = error;
      return { error: { kind, message, at: `${line}:${column}`, trace, output } };
    }
    return { crash: error && error.constructor ? error.constructor.name : String(error) };
  }
};
const programs = (list) => async ({ load }) => {
  const { run } = await lib(load);
  return list.map((entry, index) => {
    const [source, options] = Array.isArray(entry) ? entry : [entry, undefined];
    return `${index}| ${JSON.stringify(show(run, source, options))}`;
  });
};
const prng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomExpressions = (seed, count) => {
  const rnd = prng(seed);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const atoms = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '10', '2.5', '0.5', '9', '12', '"a"', '"b"', 'true', 'false', 'nil', '[1]', 'len("abc")', 'floor(7 / 2)'];
  const binary = ['+', '-', '*', '/', '%', '<', '<=', '>', '>=', '==', '!=', 'and', 'or'];
  const build = (depth) => {
    if (depth === 0 || rnd() < 0.25) return pick(atoms);
    const roll = rnd();
    if (roll < 0.12) return `${pick(['-', '!'])}${build(depth - 1)}`;
    if (roll < 0.2) return `(${build(depth - 1)})`;
    return `${build(depth - 1)} ${pick(binary)} ${build(depth - 1)}`;
  };
  return Array.from({ length: count }, () => `print(${build(3)});`);
};

export const probes = [
  {
    name: 'vm01 arithmetic and number display',
    run: programs([k`print(1 + 2 * 3); print((1 + 2) * 3); print(10 - 4 - 3); print(2 * 3 % 4); print(100 / 8 / 5);`, 'print(7 % 3); print(-7 % 3); print(7 % -3); print(-7 % -3); print(6.5 % 2);', 'print(-5); print(- -5); print(0 - 0); print(-0); print(0 * -1);', 'print(0.1 + 0.2); print(1 / 3); print(2.50); print(100000 * 100000); print(1000000 * 1000000 * 1000000 * 1000000);', 'print(5 - -3); print(5 --3);', 'print(1 + 2 == 3); print(2 * 3 == 6.0);', 'print(10 / 4); print(10 / 5); print(1 / 8);', 'print(floor(2.7)); print(floor(-2.2)); print(floor(5));', 'print(123456789 * 1000); print(0.000001 * 0.001);', 'print(1e3);', 'print(1.5.2);', 'print(3 - 1 - 1); print(2 / 2 / 2); print(8 % 5 % 2);', 'print(1/0);', 'print(5 % 0);', 'print(0 / 0);', 'let x = 1000000; for (let i = 0; i < 6; i = i + 1) { x = x * x; print(x); }']),
  },
  {
    name: 'vm02 comparison and equality',
    run: programs(['print(1 < 2); print(2 <= 2); print(3 > 4); print(4 >= 5);', 'print(1 == 1); print(1 == "1"); print("a" == "a"); print("a" == "b"); print(nil == nil); print(nil == false);', 'print(true == true); print(true == 1); print(false == nil); print(0 == false);', 'let a = [1]; let b = [1]; print(a == b); print(a == a); print(a != b);', 'fn f() {} fn g() {} print(f == f); print(f == g); print(print == print); print(len == print);', 'print("a" < "b");', 'print(1 < "a");', 'print(nil < 1);', 'print(1 < 2 < 3);', 'print(1 == 1 == true); print(1 != 2 == true);', 'print("abc" == "ab" + "c");', 'print(1 + 1 == 2 and 2 * 2 == 4);', 'print([] == []); print("" == "");', 'let f = fn() {}; let g = f; print(f == g);']),
  },
  {
    name: 'vm03 truthiness, and, or, not',
    run: programs([k`if (0) print("zero"); if ("") print("empty"); if (nil) print("nil"); if (false) print("false"); if ([]) print("array"); if (print) print("fn");`, 'print(!nil); print(!false); print(!0); print(!""); print(![]); print(!true); print(!!5);', 'print(1 and 2); print(nil and 2); print(false and 2); print(0 and 2); print("" and 3);', 'print(nil or 3); print(false or nil); print(1 or 2); print(0 or 2); print(nil or false or "z");', 'fn t(x) { print(x); return x; } t(1) and t(2); t(nil) and t(3); t(nil) or t(4); t(5) or t(6);', 'print(1 and nil or 3); print(nil or 1 and 2); print(false or false and true);', 'print(1 and 2 == 2); print(nil or 1 + 1);', 'let a = nil; a = a or "default"; print(a); a = a and "next"; print(a);', 'fn f() { return 1 / 0; } print(false and f()); print(true or f());', 'print(true and f());', 'print(!x);', 'print(-"a");', 'print(-nil);', 'print(-true);', 'print(-[1]);']),
  },
  {
    name: 'vm04 strings',
    run: programs([k`print("a" + "b" + "c"); print("x" + ""); print(len("hello")); print(len(""));`, k`print("tab\there"); print("quote\"inside"); print("back\\slash"); print("line1\nline2");`, 'print("abc"[0]); print("abc"[2]); print("héllo"[1]);', 'print("abc"[3]);', 'print("abc"[-1]);', 'print("abc"[1.5]);', 'print("abc"["a"]);', 'let s = "abc"; s[0] = "x";', 'print("a" + 1);', 'print(1 + "a");', 'print("a" + nil);', 'print("a" * 2);', 'print("multi\nline" == "multi\nline");', 'print("ab" == "a" + "b"); print("a" + "b" == "ab");', 'print(str(12) + "px"); print(str("s")); print(str(nil)); print(str([1, "b"]));', 'let s = ""; for (let i = 0; i < 5; i = i + 1) { s = s + str(i); } print(s); print(len(s));', 'print(len("é")); print(len("😀"));', 'print("a" + "b" + 1);', 'print("unterminated);', k`print("bad \q escape");`, 'print("é" + "ü");', 'print("a"+"b"+"c"+"d");', 'print(type("x"));']),
  },
  {
    name: 'vm05 variables, blocks and shadowing',
    run: programs(['let a = 1; print(a); a = 2; print(a); let b; print(b);', 'let a = 1; { let a = 2; print(a); { let a = 3; print(a); } print(a); } print(a);', 'let a = 1; { a = 5; } print(a);', 'let a = "outer"; fn f() { let a = "inner"; print(a); } f(); print(a);', '{ let x = 1; { let y = x + 1; print(y); } print(x); }', '{ let x = 1; } print(x);', 'let a = 1; let a = 2; print(a);', '{ let a = 1; { let a = 2; } let b = a; print(b); }', 'fn f(a) { { let a = 5; print(a); } print(a); } f(1);', 'let a = 1; { let a = a; }', 'let a = 1; let b = a + 1; { let c = b * 2; print(c); }', '{ let a = 1; let b = 2; { let c = 3; print(a + b + c); } }', 'let a = 1; if (true) { let a = 2; } print(a);', 'let a = a;', 'let a = 5; let a = a + 1; print(a);', 'x = 1;', '{ x = 1; }', 'fn f() { return y; } print(f());', 'fn g(p) { p = p + 1; return p; } let q = 1; print(g(q)); print(q);', 'for (let i = 0; i < 2; i = i + 1) { let i = 10; print(i); }', 'let a = 1; { a = a + 1; { a = a + 1; } } print(a);', 'fn f() { let a = 1; let a = 2; }', 'fn f(a, a) {}', 'fn f(a) { let a = 1; }', 'fn f(a) { { let a = 1; } }']),
  },
  {
    name: 'vm06 globals: redefinition, builtins and order',
    run: programs(['print(f()); fn f() { return 1; }', 'fn f() { return g(); } fn g() { return 2; } print(f());', 'fn f() { return g(); } print(f()); fn g() { return 2; }', 'let print = 5; print = 6;', 'let len = fn(x) { return 42; }; print(len("abc"));', 'fn print2(x) { print(x); } let p = print; p("via alias"); print2("direct");', 'fn f() { return 1; } let a = f; fn f() { return 2; } print(a()); print(f());', 'let a = 1; fn show() { print(a); } show(); a = 2; show(); let a = 3; show();', 'fn f() { x = 1; } f();', 'let x = 1; fn f() { x = x + 1; return x; } f(); print(f()); print(x);', 'fn f() { return f; } print(f()() == f);', 'print(missing);', 'missing();', 'print(missing(1, 2));', 'print(1 + missing);', 'fn f() { return undefinedName; } f();', 'let t = type; print(t(t));', '{ fn local() { return 7; } print(local()); } print(local());', 'let f = fn() { return later; }; let later = 5; print(f());']),
  },
  {
    name: 'vm07 functions: calls, returns and arity',
    run: programs(['fn add(a, b) { return a + b; } print(add(1, 2)); print(add("x", "y"));', 'fn none() {} print(none()); fn bare() { return; } print(bare());', 'fn early(x) { if (x) return "yes"; return "no"; } print(early(true)); print(early(nil));', 'fn f(a, b, c) { return a - b - c; } print(f(10, 3, 2));', 'fn f(a) {} f(1, 2);', 'fn f(a, b) {} f(1);', 'fn f() {} f(nil);', 'let f = fn(x) { return x * 2; }; print(f(4)); print(f);', 'print(fn(a) { return a + 1; }(2));', 'fn f(n) { if (n == 0) return "done"; return f(n - 1); } print(f(50));', 'fn even(n) { if (n == 0) return true; return odd(n - 1); } fn odd(n) { if (n == 0) return false; return even(n - 1); } print(even(10)); print(odd(7)); print(even(7));', 'fn fact(n) { if (n <= 1) return 1; return n * fact(n - 1); } print(fact(10)); print(fact(20));', 'fn ack(m, n) { if (m == 0) return n + 1; if (n == 0) return ack(m - 1, 1); return ack(m - 1, ack(m, n - 1)); } print(ack(2, 3));', 'fn gcd(a, b) { while (b != 0) { let t = a % b; a = b; b = t; } return a; } print(gcd(48, 18));', 'fn f() { return 1; print("unreachable"); } print(f());', 'fn outer() { fn inner() { return "in"; } return inner(); } print(outer());', 'fn f(f) { return f; } print(f(3));', 'fn f() { print("f"); return fn() { print("g"); return 1; }; } print(f()());', 'fn id(x) { return x; } print(id(id(id(5))));', 'print(fn() {});', 'fn a() { return b; } fn b() {} print(a());', 'fn f() { return 1; } print(f() + f() * f());', 'fn f(x) { return x; } print(f(1 + 1, 2));', 'print(1(2));', 'print("s"());', 'print(nil());', 'let a = [fn() { return 1; }]; print(a[0]());', 'fn f() { return fn(x) { return x + 1; }; } print(f()(1));']),
  },
  {
    name: 'vm08 closures: shared variables and lifetime',
    run: programs(['fn make() { let n = 0; fn up() { n = n + 1; return n; } return up; } let a = make(); a(); print(a()); let b = make(); print(b()); print(a());', 'fn pair() { let v = 0; fn get() { return v; } fn set(x) { v = x; } return [get, set]; } let p = pair(); p[1](9); print(p[0]());', 'fn outer() { let x = "o"; fn mid() { fn inner() { return x; } return inner; } return mid; } print(outer()()());', 'fn outer() { let x = 1; fn mid() { let y = 2; fn inner() { x = x + y; return x; } return inner; } return mid(); } let f = outer(); print(f()); print(f());', 'fn counter() { let i = 0; return fn() { i = i + 1; return i; }; } let c1 = counter(); let c2 = counter(); c1(); c1(); print(c1()); print(c2());', 'let fs = []; fn make(i) { return fn() { return i; }; } for (let j = 0; j < 3; j = j + 1) { push(fs, make(j * 10)); } print(fs[0]() + fs[1]() + fs[2]());', 'fn f() { let a = 1; let g = fn() { a = a + 1; }; let h = fn() { return a; }; g(); g(); return h(); } print(f());', 'fn make() { let x = 1; fn a() { return x; } x = 2; fn b() { return x; } return [a, b]; } let r = make(); print(r[0]()); print(r[1]());', 'fn f() { let a = "a"; { let b = "b"; fn g() { return a + b; } return g; } } print(f()());', 'fn gen() { let n = 0; return fn() { n = n + 1; return n * n; }; } let g = gen(); print(g() + g() + g());', 'fn f(a) { return fn(b) { return fn(c) { return a + b + c; }; }; } print(f(1)(2)(3));', 'fn make(n) { fn rec(k) { if (k == 0) return 0; return k + rec(k - 1); } return rec(n); } print(make(10));', 'fn f() { let x = 0; fn a() { x = x + 1; } fn b() { x = x + 10; } a(); b(); a(); return x; } print(f());', 'let g = nil; { let secret = 42; g = fn() { return secret; }; } print(g());', 'let get = nil; let set = nil; { let v = 1; get = fn() { return v; }; set = fn(x) { v = x; }; } set(7); print(get());', 'fn f() { let a = 1; fn g() { let a = 2; return fn() { return a; }; } return g()(); } print(f());', 'fn make() { let list = []; fn add(x) { push(list, x); return len(list); } return add; } let add = make(); add(1); print(add(2));', 'fn f() { let x = 1; return fn() { let y = x; x = x + 1; return y; }; } let a = f(); print(a()); print(a()); let b = f(); print(b());']),
  },
  {
    name: 'vm09 for loops: a new variable for each iteration',
    run: programs(['let fs = []; for (let i = 0; i < 3; i = i + 1) { push(fs, fn() { return i; }); } print(fs[0]()); print(fs[1]()); print(fs[2]());', 'let fs = []; for (let i = 0; i < 3; i = i + 1) { push(fs, fn() { i = i + 10; return i; }); } print(fs[0]()); print(fs[0]()); print(fs[1]()); print(fs[2]());', 'let fs = []; for (let i = 0; i < 4; i = i + 1) { if (i == 1) continue; push(fs, fn() { return i; }); } print(len(fs)); print(fs[0]() + fs[1]() + fs[2]());', 'let fs = []; for (let i = 0; i < 3; i = i + 1) { push(fs, fn() { return i; }); i = i + 0; } print(fs[0]());', 'let fs = []; for (let i = 0; i < 3; i = i + 1) { let j = i * 2; push(fs, fn() { j = j + 1; return j; }); } print(fs[0]()); print(fs[0]()); print(fs[2]());', 'let fs = []; for (let i = 0; i < 2; i = i + 1) { for (let j = 0; j < 2; j = j + 1) { push(fs, fn() { return i * 10 + j; }); } } print(fs[0]()); print(fs[1]()); print(fs[2]()); print(fs[3]());', 'let g = nil; for (let i = 0; i < 5; i = i + 1) { if (i == 2) { g = fn() { return i; }; break; } } print(g());', 'let fs = []; for (let i = 0; i < 3; i = i + 1) { push(fs, fn() { return i; }); i = i + 1; } print(len(fs)); print(fs[0]()); print(fs[1]());', 'let fs = []; for (let i = 0; i < 3; i = i + 1) { push(fs, fn() { return i; }); } print(len(fs));', 'let i = 100; for (i = 0; i < 2; i = i + 1) { print(i); } print(i);', 'for (let i = 0; i < 3; i = i + 1) print(i);', 'for (;;) { print("once"); break; }', 'let n = 0; for (; n < 3;) { n = n + 1; } print(n);', 'for (let i = 0, j = 1; i < 1; i = i + 1) {}', 'for (let i = 0; i < 3; i = i + 1) { let i = "inner"; print(i); }', 'let fs = []; for (let i = 0; i < 2; i = i + 1) { fn f() { return i; } push(fs, f); } print(fs[0]()); print(fs[1]());', 'let fs = []; for (let i = 0; i < 3; i = i + 1) { push(fs, fn() { return fn() { return i; }; }); } print(fs[1]()());', 'for (let i = 0; i < 3; i = i + 1) { i; } print("ok");', 'let r = []; for (let i = 3; i > 0; i = i - 1) { push(r, i); } print(r);', 'for (let i = 0; i < 3; i = i + 1) { if (i == 1) { continue; } print(i); }', 'for (let i = 0; i < 2; i = i + 1) { for (let j = 0; j < 2; j = j + 1) { if (j == 1) break; print(str(i) + str(j)); } }']),
  },
  {
    name: 'vm10 while loops, break, continue and closing scopes',
    run: programs(['let i = 0; while (i < 3) { print(i); i = i + 1; }', 'let fs = []; let j = 0; while (j < 3) { let k = j * 2; push(fs, fn() { return k; }); j = j + 1; } print(fs[0]()); print(fs[1]()); print(fs[2]());', 'let i = 0; while (true) { i = i + 1; if (i == 3) continue; if (i > 5) break; print(i); }', 'let fs = []; let i = 0; while (i < 4) { let v = i; i = i + 1; if (v == 1) continue; if (v == 3) break; push(fs, fn() { return v; }); } print(len(fs)); print(fs[0]() + fs[1]());', 'let i = 0; while (i < 3) { let a = 1; let b = 2; { let c = 3; if (i == 1) break; } i = i + 1; } print(i);', 'fn f() { let i = 0; while (true) { let x = i; i = i + 1; if (i == 3) return x; } } print(f());', 'let i = 0; let n = 0; while (i < 4) { i = i + 1; let a = i; if (a % 2 == 0) continue; n = n + a; } print(n);', 'let out = []; let i = 0; while (i < 3) { let j = 0; while (j < 3) { j = j + 1; if (j == 2) continue; if (i == 1) break; push(out, i * 10 + j); } i = i + 1; } print(out);', 'while (false) { print("never"); } print("after");', 'let i = 0; while (i < 3) i = i + 1; print(i);', 'let x = 0; while (x < 10) { x = x + 1; if (x == 4) break; } print(x);', 'let g = nil; let i = 0; while (i < 3) { let v = i; if (v == 1) { g = fn() { return v; }; break; } i = i + 1; } print(g());', 'let c = 0; { while (c < 3) { let t = c; c = c + 1; } } print(c);', 'break;', 'continue;', 'fn f() { break; }', 'while (true) { fn f() { continue; } }', 'if (true) { break; }', 'for (;;) { fn f() { return 1; } break; } print("ok");', 'while (true) { let a = 1; let a = 2; }', 'let i = 0; while (i < 3) { i = i + 1; { continue; } }']),
  },
  {
    name: 'vm11 arrays',
    run: programs(['let a = [1, 2, 3]; print(a); print(len(a)); print(a[0] + a[2]);', 'let a = []; print(a); push(a, 1); push(a, "two"); push(a, [3]); print(a); print(len(a));', 'let a = [1, 2]; let b = a; b[0] = 9; print(a); push(b, 3); print(len(a));', 'let a = [1, 2, 3]; print(pop(a)); print(a); print(pop(a) + pop(a));', 'let a = []; pop(a);', 'let a = [1]; a[1];', 'let a = [1]; a[-1];', 'let a = [1]; a[0.5];', 'let a = [1]; a["0"];', 'let a = [1]; a[0] = 5; print(a[0]); print(a[0] = 6); print(a);', 'let a = [1]; a[2] = 5;', 'let a = [1]; a[nil] = 5;', 'let n = 5; n[0];', 'let n = nil; n[0] = 1;', 'let m = [[1, 2], [3, 4]]; m[1][0] = 9; print(m); print(m[1][0] + m[0][1]);', 'let a = [1, 2]; push(a, a); print(a); print(len(a));', 'let a = [1]; let b = [a, a]; print(b);', 'let a = [fn() { return 1; }, print, nil, true, "s", 2.5]; print(a);', 'let a = [[], [[]]]; print(a); print(len(a[1]));', 'print([1, 2, 3][1]); print([[1], [2]][1][0]);', 'let a = [1, 2, 3]; a[1] = a[0] + a[2]; print(a);', 'let a = [3, 1, 2]; let i = 0; while (i < len(a)) { a[i] = a[i] * 2; i = i + 1; } print(a);', 'fn sum(a) { let s = 0; for (let i = 0; i < len(a); i = i + 1) { s = s + a[i]; } return s; } print(sum([1, 2, 3, 4]));', 'let a = [1,]; print(a);', 'print([1, 2]', 'let a = [10, 20, 30]; let i = 1; a[i] = a[i + 1]; print(a);', 'fn f() { print("f"); return 0; } fn g() { print("g"); return 1; } fn h() { print("h"); return 2; } let a = [0, 0]; a[f()] = h(); print(a);', 'let a = [1, 2]; a[g()] = 1;', 'print(type([]));']),
  },
  {
    name: 'vm12 builtins and their errors',
    run: programs(['print(len([1, 2])); print(len("abc")); print(len([]));', 'len(5);', 'len(nil);', 'len();', 'len([1], [2]);', 'push([1]);', 'push(1, 2);', 'print(push([1], 2));', 'pop(1);', 'pop("s");', 'print(str(1)); print(str(true)); print(str("x")); print(str([1])); print(str(print)); print(str(nil));', 'print(type(1)); print(type("s")); print(type(true)); print(type(nil)); print(type([])); print(type(print)); print(type(fn() {}));', 'floor("x");', 'floor();', 'print(floor(0.5)); print(floor(-0.5)); print(floor(1000000000000000 + 0.5));', 'print(print(1));', 'let r = print("a"); print(r);', 'print();', 'print(1, 2);', 'print(len);', 'let a = [print, len]; a[0]("via array");', 'print(type(type));', 'fn f() {} print(f); print(fn() {}); print(print);', 'print(str(f));', 'print(len(str(12345)));', 'print([print]);', 'print(str(str));']),
  },
  {
    name: 'vm13 lexical errors',
    run: programs(['print(1) @', 'let a = 1 # 2;', '"abc', 'print("abc', 'print("a\\qb");', 'print("tail\\','print(1);\n\n  $', 'let s = "one\ntwo', 'ok(); `', 'print(1)\n// comment\n^', '"é" ~', 'print(1 & 2);', 'a | b', 'let x = 5;\nlet y = "unterminated;\nprint(y);', 'print("\\t\\x");', k`print("a\nb`, '.5', 'let a = 1.;', 'print(1);\r\nprint(2) ?', '\tprint(1) ?', 'x : 1', '{ "abc ', '/* not a comment */', '1 // fine\n@']),
  },
  {
    name: 'vm14 syntax errors: messages',
    run: programs(['let x = ;', 'let = 5;', 'let x = 1', 'print(1)', 'print(1;', 'print(1, 2', 'print(1,);', '1 +;', '(1 + 2;', '[1, 2;', '[1, 2', 'a[1;', 'a[;', 'fn (', 'fn f {}', 'fn f(a, ) {}', 'fn f(1) {}', 'fn f(a b) {}', 'fn f(a)', 'fn f(a) print(a);', 'fn f(a) {', 'fn(a) { return a; ', 'fn(a;', 'fn(1) {};', 'fn f(a) { let; }', 'if x) {}', 'if (x {}', 'if (x) else {}', 'if (true) let a = 1;', 'if (true) fn f() {}', 'while x {}', 'while (x {}', 'while () {}', 'for let i = 0;;) {}', 'for (let i = 0; i < 3 i = i + 1) {}', 'for (let i = 0; i < 3; i = i + 1 {}', 'for (;;', 'for (let i = 0 i < 3;;) {}', 'for (1 2;;) {}', 'return 1', 'return', 'fn f() { return 1 }', 'break', 'continue', 'break 1;', '{ print(1);', '{', '}', ')', '1 = 2;', 'a + b = 3;', 'f() = 1;', '(a) = 1;', '-a = 1;', 'a = ;', 'a[0] = ;', 'a = b = ;', 'print(1) print(2);', 'let a = 1; let b = 2 let c = 3;', 'else {}', 'let 1 = 2;', 'fn f() {} fn', 'let f = fn;', '[1, 2,, 3]', '(', '', '   ', 'print(,);', 'print(1 2);', 'a.b;', 'let a = fn() {}', 'x = fn() { return 1; }']),
  },
  {
    name: 'vm15 syntax error positions across lines and the end of the input',
    run: programs(['let x = 1;\nlet y = ;\nprint(x);', 'fn f() {\n  return 1\n}', 'print(1);\nprint(2)', 'print(1);\nprint(2)\n', 'print(1);\nprint(2)\n\n\n', 'if (true) {\n  print(1);\n', '{\n  {\n    {\n', 'let a = [\n  1,\n  2\n;', 'let s = "a\nb";\nlet = 1;', '\n\n   )', 'fn f(\n  a,\n  b\n  c\n) {}', 'x = 1 +\n\n  ;', 'while (\n  true\n{ }', '// comment\nlet = 3;', 'let a = 1; // c\n\tlet b = ;', 'for (\n  let i = 0;\n  i < 3\n  i = i + 1\n) {}', 'print("é"); let = 1;', 'print("😀"); let = 1;', 'fn f() { return fn() { return } }', 'f(1,\n  2,\n  3', 'a[\n0\n', 'print(1)\r\nprint(2)\r\n;;']),
  },
  {
    name: 'vm16 the order of errors',
    run: programs(['print("before"); let x = ;', 'print("before"); break;', 'print("before"); let a = a; { let b = b; }', 'let x = ; "unterminated', 'break; let x = ;', 'break; return 1;', 'return 1; break;', '{ let a = 1; let a = 2; } break;', 'fn f() { break; } { let a = 1; let a = 2; }', '{ let a = 1; let a = 2; } fn f() { break; }', 'print("before"); 1/0; break;', 'print("before"); undefinedName; let x = ;', 'fn f() { return g; } print("x"); { let a = a; }', 'fn f(a, a) { return b; break; }', 'fn f() { let q = fn() { let z = z; }; break; }', 'while (false) { fn f() { return 1; } } print(zzz);', 'print("ran"); {let a = 1; let a = 2;}', 'let a = "x" + 1; let b = ;', '@ break;', 'break; @']),
  },
  {
    name: 'vm17 compile errors',
    run: programs(['{ let a = 1; let a = 2; }', 'fn f() { let a = 1; let a = 2; }', 'fn f(a) { let a = 1; }', 'fn f(a, b, a) {}', '{ fn g() {} fn g() {} }', '{ let g = 1; fn g() {} }', '{ fn g() {} let g = 1; }', '{ let a = a; }', '{ let a = a + 1; }', '{ let a = fn() { return a; }; }', '{ let a = 1; { let a = a; } }', 'fn f() { let x = x; }', 'fn f() { let x = 1; { let y = x; let x = y; } }', 'let a = a;', '{ fn r() { return r; } print(r() == r); }', 'fn f(a) { let g = fn() { let a = 1; return a; }; return g(); } print(f(0));', 'return;', 'return 1;', '{ return 1; }', 'if (true) return;', 'fn f() { return 1; } return f();', 'fn f() { if (true) { return 1; } } print(f());', 'break;', 'continue;', 'if (true) { break; }', 'fn f() { while (true) { break; } } f(); print("fine");', 'while (true) { fn f() { break; } }', 'while (true) { fn f() { continue; } }', 'while (true) { let g = fn() { break; }; }', 'for (;;) { { break; } }', 'for (let i = 0; i < 1; i = i + 1) { let i = 5; } print("ok");', '{ let a = 1; } { let a = 2; } print("ok");', '{ let a = 1; { let a = 2; } let a = 3; }', 'fn f() { { let a = 1; } let a = 2; return a; } print(f());', 'fn f() { let a = 1; fn a() {} }', '{ let a; let b; let a; }', 'fn f(a) { fn a() {} }', '{ let x = 1; fn f() { let x = x; } }', '{ fn f() { f(); } }', 'let f = fn() { f(); }; print("ok");', 'fn outer() { let a = 1; fn inner() { let b = a; return b; } return inner(); } print(outer());', 'fn f() { let g = fn() { return g; }; }']),
  },
  {
    name: 'vm18 runtime errors: messages and positions',
    run: programs(['1 + "a";', '"a" + 1;', 'nil + nil;', 'true + 1;', '[1] + [2];', '1 - "a";', '"a" * 2;', 'nil / 1;', '1 / 0;', '1 % 0;', '"a" < "b";', '1 >= nil;', '-"a";', '-nil;', 'let x = 1; x();', 'let x = "s"; x(1, 2);', 'nil();', 'fn f(a) {} f();', 'fn f(a) {} f(1, 2, 3);', 'print(undefinedVar);', 'undefinedVar = 1;', 'undefinedFn();', 'undefinedA + undefinedB;', 'let a = [1]; a[5];', 'let a = [1]; a[5] = 1;', '1[0];', '"s"[1];', '"s"[0] = "x";', 'nil[0];', 'let a = [1]; a[1.5];', 'let a = [1]; a["k"] = 1;', 'len();', 'len(1);', 'push(1, 2);', 'pop([]);', 'floor("a");', 'let x = 1000000;\nfor (let i = 0; i < 6; i = i + 1) {\n  x = x * x;\n}', '\n\n  print(1 +\n  nil);', 'print(1);\nprint("a" -\n 1);', '  1 / (2 - 2);', 'let f = fn() { return 1 / 0; }; f();', 'print(1)(2);', 'print(2)[0];', 'print(1 + 2 * nil);', 'print((1 + 2) * "a");', 'print(1 < 2 < 3);', 'print(-(-"a"));', 'fn f() { return 1; } f()();']),
  },
  {
    name: 'vm19 runtime error traces',
    run: programs(['fn f() { g(); } fn g() { h(); } fn h() { 1/0; } f();', 'fn f() { return 1 / 0; }\nfn g() { return f(); }\nprint(g());', 'let f = fn() { return nil + 1; };\nlet g = fn() { return f(); };\ng();', 'fn a() { return b(); }\nfn b() { return fn() { return missing; }(); }\na();', 'fn make() { return fn() { return 1 / 0; }; }\nlet f = make();\nf();', 'fn f(n) { if (n == 0) return 1 / 0; return f(n - 1); } f(3);', 'fn f(n) { if (n == 0) return 1 / 0; return f(n - 1); } f(20);', 'fn r(n) { return r(n + 1); } r(0);', 'fn f() { print("a"); print("b"); 1/0; } print("x"); f();', 'fn f() { return g(1, 2); } fn g(a) { return a; } f();', 'fn f() { return len(1); } f();', 'fn f() { return print(1/0); } f();', 'fn f(x) { return x(); } f(5);', 'fn f() { f2(); }\nfn f2() {\n  f3();\n}\nfn f3() { nil(); }\nf();', 'fn walk(a, i) { if (i == len(a)) return 0; return a[i] + walk(a, i + 1); } print(walk([1, 2, 3], 0)); print(walk([1, "x", 3], 0));', '{ let f = fn() { 1/0; }; f(); }', 'fn f() { { fn g() { 1/0; } g(); } } f();', 'print("only"); nil + 1;', 'fn f() { print("in f"); } fn g() { f(); undefinedName; } g();', 'fn deep(n) { if (n == 0) { return 1/0; } return deep(n - 1) + 1; } deep(10);', 'fn deep(n) { if (n == 0) { return 1/0; } return deep(n - 1) + 1; } deep(11);']),
  },
  {
    name: 'vm20 call depth',
    run: programs([['fn r(n) { if (n == 0) return 0; return 1 + r(n - 1); } print(r(3));', { maxCallDepth: 3 }], ['fn r(n) { if (n == 0) return 0; return 1 + r(n - 1); } print(r(4));', { maxCallDepth: 3 }], ['fn r(n) { if (n == 0) return 0; return 1 + r(n - 1); } print(r(3));', { maxCallDepth: 2 }], ['fn f() { return 1; } print(f());', { maxCallDepth: 1 }], ['fn f() { return g(); } fn g() { return 1; } print(f());', { maxCallDepth: 1 }], ['fn f() { return len([1]); } print(f());', { maxCallDepth: 1 }], ['print(len([1]));', { maxCallDepth: 0 }], ['fn f() { return 1; } print(f());', { maxCallDepth: 0 }], ['fn r(n) { return r(n + 1); } r(0);', { maxCallDepth: 5 }], ['fn r(n) { return r(n + 1); } r(0);', { maxCallDepth: 14 }], ['fn r(n) { return r(n + 1); } r(0);'], ['fn f() { f(); }\nf();', { maxCallDepth: 2 }], ['let f = fn(n) { if (n > 0) f(n - 1); }; f(5); print("done");', { maxCallDepth: 6 }], ['let f = fn(n) { if (n > 0) f(n - 1); }; f(5); print("done");', { maxCallDepth: 5 }], ['fn a() { b(); } fn b() { a(); } a();', { maxCallDepth: 4 }], ['fn f(n) { if (n > 0) { f(n - 1); } } f(150); print("ok");'], ['fn f(n) { if (n > 0) { f(n - 1); } } f(200); print("ok");'], ['fn f(n) { if (n > 0) { f(n - 1); } } f(201);'], ['fn f(n) { if (n > 0) { f(n - 1); } } f(500); print("ok");', { maxCallDepth: 1000 }], ['fn f() { return 1; } print(f() + f() + f());', { maxCallDepth: 1 }]]),
  },
  {
    name: 'vm21 step limit',
    run: programs([['fn f() {} f(); f(); f(); print("ok");', { maxSteps: 3 }], ['fn f() {} f(); f(); f(); print("ok");', { maxSteps: 2 }], ['fn f() {} f(); f(); f(); f();', { maxSteps: 0 }], ['print(len([1])); print(len([1])); print(len([1]));', { maxSteps: 0 }], ['let i = 0; while (i < 3) { i = i + 1; } print(i);', { maxSteps: 3 }], ['let i = 0; while (i < 3) { i = i + 1; } print(i);', { maxSteps: 2 }], ['for (let i = 0; i < 3; i = i + 1) {} print("ok");', { maxSteps: 3 }], ['for (let i = 0; i < 3; i = i + 1) {} print("ok");', { maxSteps: 2 }], ['for (;;) {}', { maxSteps: 10 }], ['while (true) {}', { maxSteps: 7 }], ['let i = 0;\nwhile (i < 10) {\n  i = i + 1;\n  if (i % 2 == 0) continue;\n}', { maxSteps: 4 }], ['let i = 0; while (true) { i = i + 1; if (i == 3) break; } print(i);', { maxSteps: 2 }], ['let i = 0; while (true) { i = i + 1; if (i == 3) break; } print(i);', { maxSteps: 3 }], ['fn f() { while (true) {} } f();', { maxSteps: 5 }], ['fn f(n) { if (n > 0) f(n - 1); } f(5); print("ok");', { maxSteps: 6 }], ['fn f(n) { if (n > 0) f(n - 1); } f(5); print("ok");', { maxSteps: 5 }], ['fn f() { for (let i = 0; i < 2; i = i + 1) { g(); } } fn g() {} f();', { maxSteps: 3 }], ['fn f() { for (let i = 0; i < 2; i = i + 1) { g(); } } fn g() {} f(); print("ok");', { maxSteps: 5 }], ['fn f() { for (let i = 0; i < 2; i = i + 1) { g(); } } fn g() {} f(); print("ok");', { maxSteps: 4 }], ['print(1); while (true) {}', { maxSteps: 1 }], ['while (true) {}'], ['let n = 0; while (n < 1000) { n = n + 1; } print(n);'], ['let n = 0; for (let i = 0; i < 100; i = i + 1) { for (let j = 0; j < 100; j = j + 1) { n = n + 1; } } print(n);', { maxSteps: 10100 }], ['let n = 0; for (let i = 0; i < 100; i = i + 1) { for (let j = 0; j < 100; j = j + 1) { n = n + 1; } } print(n);', { maxSteps: 10099 }]]),
  },
  {
    name: 'vm22 deep recursion needs a real frame stack',
    run: async ({ load }) => {
      const { run } = await lib(load);
      const deep = (source, options) => show(run, source, options);
      const sum = deep('fn s(n) { if (n == 0) return 0; return n + s(n - 1); } print(s(20000));', { maxCallDepth: 50000 });
      const count = deep('fn c(n) { if (n == 0) return 0; return 1 + c(n - 1); } print(c(30000)); print(c(10));', { maxCallDepth: 100000 });
      const mutual = deep('fn a(n) { if (n == 0) return "a"; return b(n - 1); } fn b(n) { if (n == 0) return "b"; return a(n - 1); } print(a(25001));', { maxCallDepth: 100000 });
      const limit = deep('fn c(n) { if (n == 0) return 0; return 1 + c(n - 1); } print(c(39999));', { maxCallDepth: 40000 });
      const over = deep('fn c(n) { if (n == 0) return 0; return 1 + c(n - 1); } print(c(40000));', { maxCallDepth: 40000 });
      const closure = deep('fn make(n) { if (n == 0) return fn() { return 0; }; let inner = make(n - 1); return fn() { return 1 + inner(); }; } print(make(8000)());', { maxCallDepth: 100000 });
      const unwound = deep('fn c(n) { if (n == 0) return 1 / 0; return c(n - 1); } c(15000);', { maxCallDepth: 100000 });
      return [sum, count, mutual, limit, over, closure, unwound].map((result, index) => `${index}| ${JSON.stringify(result)}`);
    },
  },
  {
    name: 'vm23 speed',
    run: async ({ load }) => {
      const { run } = await lib(load);
      const sizes = [];
      const cases = [
        (n) => `let i = 0; let s = 0; while (i < ${n}) { s = s + i; i = i + 1; } print(s);`,
        (n) => `fn fib(n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); } print(fib(${n}));`,
        (n) => `let a = []; for (let i = 0; i < ${n}; i = i + 1) { push(a, i * 2); } let t = 0; for (let i = 0; i < len(a); i = i + 1) { t = t + a[i]; } print(t);`,
        (n) => `let s = ""; for (let i = 0; i < ${n}; i = i + 1) { s = s + "x"; } print(len(s));`,
        (n) => `fn make() { let c = 0; return fn() { c = c + 1; return c; }; } let f = make(); let r = 0; for (let i = 0; i < ${n}; i = i + 1) { r = f(); } print(r);`,
      ];
      const scales = [[100000, 600000], [20, 25], [50000, 300000], [10000, 60000], [50000, 300000]];
      for (let c = 0; c < cases.length; c += 1) {
        for (const n of scales[c]) {
          const start = cpuMs();
          const out = run(cases[c](n), { maxSteps: 1e9, maxCallDepth: 100000 }).output;
          if (cpuMs() - start > 5000) return { slow: true };
          if (n === scales[c][1]) sizes.push(out[0]);
        }
      }
      return { fast: true, sizes };
    },
  },
  {
    name: 'vm24 whole programs',
    run: programs([k`fn map(a, f) { let r = []; for (let i = 0; i < len(a); i = i + 1) { push(r, f(a[i])); } return r; }
fn filter(a, f) { let r = []; for (let i = 0; i < len(a); i = i + 1) { if (f(a[i])) push(r, a[i]); } return r; }
fn reduce(a, f, z) { let acc = z; for (let i = 0; i < len(a); i = i + 1) { acc = f(acc, a[i]); } return acc; }
let xs = [1, 2, 3, 4, 5, 6];
print(map(xs, fn(x) { return x * x; }));
print(filter(xs, fn(x) { return x % 2 == 0; }));
print(reduce(xs, fn(a, b) { return a + b; }, 0));`, k`fn sieve(n) { let is = []; for (let i = 0; i <= n; i = i + 1) { push(is, true); }
  is[0] = false; is[1] = false;
  for (let i = 2; i * i <= n; i = i + 1) { if (is[i]) { for (let j = i * i; j <= n; j = j + i) { is[j] = false; } } }
  let out = []; for (let i = 0; i <= n; i = i + 1) { if (is[i]) push(out, i); } return out; }
print(sieve(50));`, k`fn sort(a) { let n = len(a); for (let i = 0; i < n; i = i + 1) { for (let j = 0; j < n - i - 1; j = j + 1) { if (a[j] > a[j + 1]) { let t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; } } } return a; }
print(sort([5, 2, 9, 1, 5, 6, 0]));`, k`fn memo() { let cache = []; fn fib(n) { if (n < 2) return n; if (n < len(cache) and cache[n] != nil) return cache[n]; let v = fib(n - 1) + fib(n - 2); while (len(cache) <= n) push(cache, nil); cache[n] = v; return v; } return fib; }
print(memo()(60));`, k`fn account(balance) { let history = [];
  fn deposit(x) { balance = balance + x; push(history, "d" + str(x)); return balance; }
  fn withdraw(x) { if (x > balance) return nil; balance = balance - x; push(history, "w" + str(x)); return balance; }
  return [deposit, withdraw, fn() { return history; }]; }
let acct = account(100); acct[0](50); print(acct[1](500)); print(acct[1](30)); print(acct[2]());`, k`fn compose(f, g) { return fn(x) { return f(g(x)); }; }
fn inc(x) { return x + 1; } fn dbl(x) { return x * 2; }
print(compose(inc, dbl)(5)); print(compose(dbl, inc)(5)); print(compose(compose(inc, inc), compose(dbl, dbl))(1));`, k`fn list(h, t) { return [h, t]; }
fn length(l) { let n = 0; while (l != nil) { n = n + 1; l = l[1]; } return n; }
let l = list(1, list(2, list(3, nil))); print(length(l)); print(l);`, k`fn queens(n) { let cols = []; let count = 0;
  fn ok(r, c) { for (let i = 0; i < r; i = i + 1) { let d = cols[i] - c; if (d == 0 or d == r - i or d == i - r) return false; } return true; }
  fn place(r) { if (r == n) { count = count + 1; return; } for (let c = 0; c < n; c = c + 1) { if (ok(r, c)) { push(cols, c); place(r + 1); pop(cols); } } }
  place(0); return count; }
print(queens(5)); print(queens(6));`, k`fn collatz(n) { let steps = 0; while (n != 1) { if (n % 2 == 0) n = n / 2; else n = 3 * n + 1; steps = steps + 1; } return steps; }
print(collatz(27)); print(collatz(97));`, k`fn rev(s) { let out = ""; for (let i = len(s) - 1; i >= 0; i = i - 1) { out = out + s[i]; } return out; }
fn isPal(s) { return s == rev(s); }
print(rev("hello")); print(isPal("racecar")); print(isPal("kite"));`, k`fn pow(b, e) { if (e == 0) return 1; let h = pow(b, floor(e / 2)); if (e % 2 == 0) return h * h; return h * h * b; }
print(pow(2, 30)); print(pow(3, 13));`, k`let counter = 0; fn tick() { counter = counter + 1; return counter; }
print(tick() + tick() * tick()); print(counter);`, k`fn hanoi(n, a, b, c, moves) { if (n == 0) return moves; moves = hanoi(n - 1, a, c, b, moves); push(moves, a + c); return hanoi(n - 1, b, a, c, moves); }
let m = hanoi(3, "A", "B", "C", []); print(len(m)); print(m);`]),
  },
  {
    name: 'vm25 evaluation order',
    run: programs(['fn t(x) { print(x); return x; } print(t(1) + t(2) * t(3));', 'fn t(x) { print(x); return x; } t(1) < t(2) == t(true);', 'fn t(x) { print(x); return x; } fn f(a, b, c) { return a + b + c; } print(f(t(1), t(2), t(3)));', 'fn t(x) { print(x); return x; } t(print)(t(1), t(2));', 'fn t(x) { print(x); return x; } t(nil)(t(1));', 'fn t(x) { print(x); return x; } fn f(a) {} f(t(1), t(2));', 'fn t(x) { print(x); return x; } let a = [1]; a[t(0)] = t(5);', 'fn t(x) { print(x); return x; } let a = [1]; a[t(3)] = t(5);', 'fn t(x) { print(x); return x; } t("s") + t(1);', 'fn t(x) { print(x); return x; } t(nil)[t(0)];', 'fn t(x) { print(x); return x; } let a = t([1, 2]); a[t(1)];', 'fn t(x) { print(x); return x; } print([t(1), t(2), t(3)]);', 'let x = 1; fn bump() { x = x + 1; return x; } print(x + bump()); x = 1; print(bump() + x);', 'let a = 1; let b = a = 2; print(a); print(b); a = b = 3; print(a + b);', 'let a = [0, 0]; let i = 0; a[i] = i = 1; print(a); print(i);', 'fn t(x) { print(x); return x; } undefinedName(t(1), t(2));', 'fn t(x) { print(x); return x; } t(1)(t(2));', 'fn t(x) { print(x); return x; } t(nil) and t(2); t(0) and t(3); t(false) or t(4);', 'let x = 5; x = x + (x = 1); print(x);', 'fn t(x) { print(x); return x; } print(-t(2) + !t(nil));']),
  },
  {
    name: 'vm26 comments, whitespace and the empty program',
    run: programs(['', '   \n\n\t  ', '// only a comment', 'print(1); // trailing\nprint(2);', 'print(1);\n// c1\n// c2\nprint(2);', 'print( 1 +\n 2 );', 'print(1)\n;', '\r\nprint(1);\r\n\r\nprint(2);\r\n', 'let a=1;let b=2;print(a+b);', ';', ';;', '{}', '{;}', '{ {} {} }', 'fn f(){}f();', 'print("// not a comment");', 'print(1); /', 'print(1 / 2); // half', 'print(1) // no semicolon', 'if (true) ; else ;', 'while (false) ;', 'for (;false;) ;', ' print(1);', 'print("tab\tin\tstring");', 'print("trailing space   ");', 'let   long_name_1 = 1;print(long_name_1);', 'let _under = 2; print(_under);', 'let Upper = 3; let upper = 4; print(Upper + upper);', 'let nilly = 5; print(nilly); let letx = 6; print(letx);', 'let iff = 1; let fnord = 2; print(iff + fnord);']),
  },
  {
    name: 'vm27 assignment is an expression',
    run: programs(['let a = 1; print(a = 2); print(a);', 'let a; let b; a = b = 7; print(a); print(b);', 'let a = [1, 2]; print(a[0] = a[1] = 5); print(a);', 'let x = 1; if ((x = 0) == 0) print("assigned");', 'let a = 1; a = a + 1; a = a * 3; print(a);', 'fn f(p) { p = p + 1; return p; } let q = 1; f(q); print(q);', 'fn f(p) { p[0] = 9; } let q = [1]; f(q); print(q);', 'let a = 1; { let b = a = 2; print(b); } print(a);', 'let i = 0; let j = (i = 5) + (i = 6); print(j); print(i);', 'let a = [0]; let f = fn() { a[0] = a[0] + 1; return a[0]; }; f(); f(); print(a);', 'a = 1;', 'let a = 1; 1 = a;', 'let a = 1; a + 1 = 2;', 'let a; (a) = 1;', 'let a = [1]; (a)[0] = 2; print(a);', 'fn f() {} f() = 1;', 'let a = 1; a == 2 = 3;', 'let a = [1, 2]; a[0] += 1;', 'let s = 1; s++;']),
  },
  {
    name: 'vm28 numbers and strings as printed',
    run: programs(['print(1/3); print(2/3); print(10/3); print(100/3);', 'print(0.1 * 3); print(0.7 + 0.1); print(1.1 * 1.1);', 'print(123456789012345678);', 'print(0.5 - 0.5); print(-0.5 + 0.5); print(0 * -5);', 'print(1000000 * 1000000);', 'print(9007199254740992 + 1);', 'print(2 / 3 * 3);', 'print(5e-1);', 'print(0.1 + 0.2 == 0.3);', 'print(0.5 + 0.25 == 0.75);', 'print(1 / 4 + 1 / 4);', 'print(7 / 2); print(-7 / 2);', 'print(floor(7 / 2)); print(floor(-7 / 2));', 'print(str(1/3) + "!");', 'print(len(str(1/3)));', 'print([0.1 + 0.2, -0, 1/3]);', 'print(str(100 * 1.1));', 'print(10 % 3.5); print(-10 % 3.5);', 'print(0.1 * 0.1); print(3 * 1.1);', 'print(1e21);', 'print(4 * 1000000000000 * 1000000000000 * 1000000);']),
  },
  {
    name: 'vm29 closures and scopes that end early',
    run: programs(['fn f() { let fs = []; for (let i = 0; i < 3; i = i + 1) { let j = i; fs = push2(fs, fn() { return j; }); } return fs; } fn push2(a, x) { push(a, x); return a; } let r = f(); print(r[0]() + r[1]() + r[2]());', 'let g = nil; { let a = 1; { let b = 2; g = fn() { a = a + b; return a; }; } } print(g()); print(g());', 'fn f() { let x = 1; { let y = 2; fn g() { return x + y; } return g; } } print(f()());', 'fn f() { let a = "a"; let r = fn() { return a; }; a = "b"; return r; } print(f()());', 'fn f() { let fs = []; let i = 0; while (i < 3) { let k = i; push(fs, fn() { k = k + 1; return k; }); i = i + 1; } return fs; } let h = f(); print(h[0]()); print(h[0]()); print(h[1]());', 'fn f() { let x = 0; while (true) { let y = x; x = x + 1; if (x == 2) return fn() { return y; }; } } print(f()());', 'let fs = []; { let x = 1; push(fs, fn() { return x; }); x = 2; push(fs, fn() { return x; }); } print(fs[0]() + fs[1]());', 'fn f(a, b) { return fn() { a = a + b; return a; }; } let g = f(1, 10); g(); print(g());', 'fn f() { let a = 1; fn g() { return fn() { a = a + 1; return a; }; } let h = g(); h(); return a; } print(f());', 'fn f() { let n = 0; let g = fn() { n = n + 1; }; g(); g(); { let n = 100; g(); } return n; } print(f());', 'let x = "g"; fn f() { let x = "l"; return fn() { return x; }; } print(f()()); print(x);', 'fn f() { let a = 1; let b = 2; let c = 3; return fn() { return c; }; } print(f()());', 'fn f() { let a = 1; let b = 2; return fn() { return b + a; }; } print(f()());', 'fn f(n) { let fs = []; for (let i = 0; i < n; i = i + 1) { push(fs, fn() { return i * i; }); } return fs; } let r = f(4); print(r[3]() - r[2]());', 'fn once() { let done = false; return fn() { if (done) return "again"; done = true; return "first"; }; } let o = once(); print(o()); print(o());', 'fn a() { let x = 1; fn b() { let y = 2; fn c() { return x + y; } return c; } return b(); } print(a()());', 'fn f() { let x = 1; for (let i = 0; i < 2; i = i + 1) { x = x + i; } return fn() { return x; }; } print(f()());', 'fn f() { for (let i = 0; i < 3; i = i + 1) { if (i == 1) return fn() { return i; }; } } print(f()());', 'let a = nil; for (let i = 0; i < 3; i = i + 1) { let sq = i * i; if (i == 2) a = fn() { return sq; }; } print(a());', 'fn f() { let x = 1; let g = fn() { return x; }; { let x = 2; print(g()); } } f();']),
  },
  {
    name: 'vm30 seeded random expressions, set one',
    run: programs(randomExpressions(7, 45)),
  },
  {
    name: 'vm31 seeded random expressions, set two',
    run: programs(randomExpressions(1234, 45)),
  },
];
