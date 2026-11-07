// Hidden probes for ladder-agent-regex-engine; expected.json holds the answers.
// A match is written as "start-end" plus ",from-to" for each group (",x" for a group that took no part).
const api = async (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};
const tag = (m) => (m === null ? 'none' : `${m.start}-${m.end}${m.spans.slice(1).map((s) => (s ? `,${s[0]}-${s[1]}` : ',x')).join('')}`);
const spansOf = (list) => list.map((m) => `${m.start}-${m.end}`);

async function ex(load, pattern, flags = '', text = '', from = 0) {
  const { compile } = await api(load);
  try {
    return tag(compile(pattern, flags).exec(text, from));
  } catch (error) {
    return `!${error.code ?? error.name}`;
  }
}

async function table(load, rows) {
  const out = [];
  for (const row of rows) out.push(await ex(load, ...row));
  return out;
}

async function codes(load, patterns) {
  const { compile } = await api(load);
  return patterns.map((pattern) => {
    try {
      compile(pattern);
      return 'ok';
    } catch (error) {
      return error.code ?? `other:${error.name}`;
    }
  });
}

async function all(load, rows) {
  const { compile } = await api(load);
  return rows.map(([pattern, flags, text]) => {
    try {
      return spansOf(compile(pattern, flags).matchAll(text)).join(' ') || 'none';
    } catch (error) {
      return `!${error.code ?? error.name}`;
    }
  });
}

async function replaced(load, rows) {
  const { compile } = await api(load);
  return rows.map(([pattern, flags, text, replacement, every]) => {
    try {
      return compile(pattern, flags).replace(text, replacement, every);
    } catch (error) {
      return `!${error.code ?? error.name}`;
    }
  });
}

const timed = async (fn, limit = 3000) => {
  const t0 = cpuMs();
  const value = await fn();
  return { value, fast: cpuMs() - t0 < limit };
};

const probes = [
  {
    name: 'keeps the exports',
    run: async ({ load }) => {
      const m = await api(load);
      return { compile: typeof m.compile, isSyntaxError: m.RegexSyntaxError.prototype instanceof SyntaxError, codes: m.CODES.length };
    },
  },
  {
    name: 'literals, escapes and the dot',
    run: async ({ load }) => table(load, [
      ['abc', '', 'xxabcxx'],
      ['a.c', '', 'a\nc abc'],
      ['a.c', 's', 'a\nc'],
      ['.', '', '\r'],
      ['.', '', ' '],
      ['\\.', '', 'a.b'],
      ['\\x41\\u0042\\n\\t', '', 'AB\n\t'],
      ['\\0', '', 'a\u0000'],
      ['a\\/b', '', 'a/b'],
      ['\\é', '', 'é'],
      ['\\$\\^\\(\\)\\[\\]\\|\\*\\+\\?\\{\\}\\\\', '', '$^()[]|*+?{}\\'],
      ['\\f\\v\\r', '', '\f\u000b\r'],
      ['AbC', '', 'abc ABC AbC'],
    ]),
  },
  {
    name: 'braces and brackets that are plain characters',
    run: async ({ load }) => table(load, [
      ['{', '', 'a{b'],
      ['a{', '', 'a{'],
      ['a{,3}', '', 'a{,3}'],
      ['a{x}', '', 'a{x}'],
      ['a{2', '', 'a{2'],
      ['a{3,2', '', 'a{3,2'],
      ['a{ 2}', '', 'a{ 2}'],
      ['}', '', 'a}'],
      [']', '', 'a]'],
      ['x{1,2}{', '', 'xx{'],
      ['', '', 'abc'],
      ['', '', ''],
      ['(?:)', '', 'x'],
      ['()', '', 'x'],
      ['a|', '', 'b'],
      ['|a', '', 'a'],
      ['(|)', '', 'a'],
    ]),
  },
  {
    name: 'priority order between alternatives',
    run: async ({ load }) => table(load, [
      ['a|ab', '', 'ab'],
      ['ab|a', '', 'ab'],
      ['b|ab', '', 'ab'],
      ['(a|ab)(c|bcd)', '', 'abcd'],
      ['(a|ab)(c|bcd)(d*)', '', 'abcd'],
      ['(a|ab)(c|bcd)?', '', 'abcd'],
      ['(a|b)*', '', 'abab'],
      ['(?:a|b|ab)+c', '', 'abbac'],
      ['x(a|b|)y', '', 'xy'],
      ['(|a)+', '', 'aa'],
      ['(a|)+b', '', 'aab'],
      ['(?:cat|category)s?', '', 'categorys'],
      ['(?:category|cat)s?', '', 'categorys'],
    ]),
  },
  {
    name: 'greedy and lazy repeats choose differently',
    run: async ({ load }) => table(load, [
      ['a*', '', 'aaab'],
      ['a*?', '', 'aaab'],
      ['a+?', '', 'aaa'],
      ['a??', '', 'a'],
      ['a?', '', 'a'],
      ['<.+>', '', '<a><b>'],
      ['<.+?>', '', '<a><b>'],
      ['.*x', '', 'aaxbx'],
      ['.*?x', '', 'aaxbx'],
      ['(a+)(a+)', '', 'aaaa'],
      ['(a+?)(a*)', '', 'aaaa'],
      ['(a*?)(a*)', '', 'aaaa'],
      ['(.*?),(.*)', '', 'a,b,c'],
      ['\\d+?\\d', '', '12345'],
      ['(a*?)b', '', 'aab'],
      ['(?:a|ab)*?c', '', 'abac'],
    ]),
  },
  {
    name: 'counted repeats in all their forms',
    run: async ({ load }) => table(load, [
      ['a{2}', '', 'aaa'],
      ['a{2,}', '', 'aaaa'],
      ['a{2,3}', '', 'aaaa'],
      ['a{2,3}?', '', 'aaaa'],
      ['a{2,}?', '', 'aaaa'],
      ['a{2}?', '', 'aaa'],
      ['a{3}', '', 'aa'],
      ['a{0}b', '', 'ab'],
      ['a{0,0}', '', 'a'],
      ['(ab){2,3}', '', 'ababababab'],
      ['(ab){2,3}?', '', 'ababab'],
      ['(ab){1,2}c', '', 'abababc'],
      ['x{0,2}y', '', 'xxxy'],
      ['(a{2}){2}', '', 'aaaaa'],
      ['(?:a{2}){3}b', '', 'aaaaaab'],
      ['a{1,1000}', '', 'a'.repeat(1500)],
      ['a{1000}', '', 'a'.repeat(999)],
      ['\\d{3}-\\d{4}', '', 'call 555-0199 now'],
    ]),
  },
  {
    name: 'an empty iteration of an unbounded loop fails',
    run: async ({ load }) => table(load, [
      ['(a*)*', '', 'b'],
      ['(a*)+', '', 'b'],
      ['(a*)?', '', 'b'],
      ['(a*)*', '', 'aab'],
      ['(a*)+', '', 'aab'],
      ['(a?){0,2}', '', ''],
      ['(a?){2}', '', 'a'],
      ['(a?){3}', '', 'a'],
      ['(a*)*b', '', 'xb'],
      ['(?:a*)*c', '', 'aab'],
      ['(a*)*$', '', 'aab'],
      ['(a|)*', '', 'aab'],
      ['(a{0,2}){2,}', '', 'aaa'],
      ['(a{0,2}){2,}b', '', 'aaab'],
      ['(?:()|a)*', '', 'a'],
      ['(a*)*?b', '', 'aab'],
    ]),
  },
  {
    name: 'a group keeps the span of its last pass',
    run: async ({ load }) => table(load, [
      ['(a)|b', '', 'b'],
      ['(?:(a)|b)*', '', 'ab'],
      ['((a)|b)*', '', 'ba'],
      ['((a)|(b))+', '', 'ab'],
      ['(?:(a)|(b))+', '', 'ab'],
      ['(a){0}b', '', 'b'],
      ['(a){0,0}', '', 'a'],
      ['(a)(b)?(c)', '', 'ac'],
      ['(a*)(b*)', '', 'aabb'],
      ['(\\w+)\\s(\\w+)', '', 'hello world'],
      ['(x*)*y', '', 'xxy'],
      ['(x+x+)+y', '', 'xxxxy'],
      ['((a)*)*', '', 'aa'],
      ['(?:(a)|b)*', '', 'ba'],
      ['(a)*', '', 'aaa'],
      ['(a)*?b', '', 'aab'],
      ['(((a)))', '', 'a'],
      ['(a)|(b)|(c)', '', 'c'],
    ]),
  },
  {
    name: 'group counts, names and the shape of the compiled object',
    run: async ({ load }) => {
      const { compile } = await api(load);
      const show = (pattern, flags) => {
        const re = compile(pattern, flags);
        return { source: re.source, flags: re.flags, groupCount: re.groupCount, names: re.names, keys: Object.keys(re.names) };
      };
      const re = compile('(?<year>\\d{4})-(\\d\\d)-(?<day>\\d\\d)');
      return {
        a: show('(?<a>x)(y)(?<b>z)', ''),
        b: show('(?:x)(y)(?:(z))', 'im'),
        c: show('x', 'sim'),
        d: show('(?<zeta>a)(?<_a1>b)(?<A9>c)', ''),
        e: show('(?<b>a)(?<a>b)', ''),
        exec: re.exec('on 2024-05-17'),
        proto: Object.getPrototypeOf(re.names) === Object.prototype,
      };
    },
  },
  {
    name: 'line and text anchors',
    run: async ({ load }) => table(load, [
      ['^a', '', 'ab'],
      ['^b', '', 'ab'],
      ['b$', '', 'ab'],
      ['b$', '', 'ab\n'],
      ['$', '', 'a\n'],
      ['b$', 'm', 'ab\ncd'],
      ['^c', 'm', 'ab\ncd'],
      ['^c', '', 'ab\ncd'],
      ['^', 'm', 'a\n'],
      ['$', 'm', 'a\nb'],
      ['^$', '', ''],
      ['^$', 'm', 'a\n\nb'],
      ['a^b', '', 'a^b'],
      ['a$b', '', 'a$b'],
      ['(^|,)a', '', ',a'],
      ['(^|,)a', '', 'a'],
      ['^a$', 'm', 'b\na\nc'],
      ['^.+$', 'm', 'ab\ncd'],
      ['^.+$', 's', 'ab\ncd'],
      ['^.+$', 'ms', 'ab\ncd'],
      ['^.+?$', 'ms', 'ab\ncd'],
      ['a$', 'm', 'a\r\nb'],
    ]),
  },
  {
    name: 'boundary assertions around word characters',
    run: async ({ load }) => table(load, [
      ['\\bfoo\\b', '', 'a foo b'],
      ['\\bfoo\\b', '', 'afoo'],
      ['\\Boo', '', 'foo'],
      ['\\b', '', ''],
      ['\\B', '', ''],
      ['\\b', '', ' a'],
      ['\\b$', '', 'a'],
      ['^\\b', '', '-a'],
      ['\\w\\b', '', 'ab cd'],
      ['\\b\\w', '', '  ab'],
      ['\\B\\w\\B', '', 'abc'],
      ['\\b_', '', '-_'],
      ['\\bé', '', ' é'],
      ['\\Bé', '', 'aé'],
      ['a\\b-', '', 'a-'],
    ]),
  },
  {
    name: 'the start position and the text before it',
    run: async ({ load }) => table(load, [
      ['cat', '', 'hot cat, cool cat', 5],
      ['cat', '', 'hot cat', 7],
      ['', '', 'abc', 3],
      ['a', '', 'aa', 1],
      ['^a', '', 'aa', 1],
      ['\\ba', '', 'aa', 1],
      ['\\Ba', '', 'aa', 1],
      ['^a', 'm', 'b\na', 1],
      ['^a', 'm', 'b\na', 2],
      ['(a)|b', '', 'ab', 1],
      ['$', '', 'ab', 2],
      ['\\b', '', 'ab cd', 2],
      ['a*', '', 'baac', 1],
      ['a*', '', 'baac', 2],
    ]),
  },
  {
    name: 'arguments are checked',
    run: async ({ load }) => {
      const { compile } = await api(load);
      const kind = (fn) => {
        try {
          fn();
          return 'ok';
        } catch (error) {
          return error instanceof TypeError ? 'TypeError' : error instanceof RangeError ? 'RangeError' : (error.code ?? error.name);
        }
      };
      const re = compile('a');
      return {
        compile: [kind(() => compile(5)), kind(() => compile('a', 5)), kind(() => compile('a', null)), kind(() => compile(undefined)), kind(() => compile('a', undefined)), kind(() => compile(String('a')))],
        from: [-1, 1.5, 4, '1', NaN, Infinity, null, 3, 0].map((from) => kind(() => re.exec('aaa', from))),
        text: [5, null, undefined, ['a']].map((text) => kind(() => re.exec(text))),
        matchAll: [kind(() => re.matchAll(5)), kind(() => re.matchAll('a'))],
        replace: [kind(() => re.replace(5, 'x')), kind(() => re.replace('a', 5)), kind(() => re.replace('a')), kind(() => re.replace('a', 'b'))],
      };
    },
  },
  {
    name: 'classes and ranges',
    run: async ({ load }) => table(load, [
      ['[abc]+', '', 'xxcabx'],
      ['[^abc]+', '', 'abxyc'],
      ['[a-c]', '', 'd'],
      ['[a-]+', '', 'b-a-'],
      ['[-a]+', '', 'x-a'],
      ['[\\d-]+', '', 'a1-2b'],
      ['[a-b-c]+', '', 'x-abc-'],
      ['[--/]+', '', 'a-./b'],
      ['[a\\-z]+', '', 'a-z b'],
      ['[\\]\\\\^]+', '', 'a]\\^b'],
      ['[a^]+', '', '^a'],
      ['[$.]+', '', 'x$.'],
      ['[]', '', 'a'],
      ['[^]', '', '\n'],
      ['[^]+', '', 'a\nb'],
      ['[\\x41-\\x43]+', '', 'xABCD'],
      ['[\\u0100-\\u0102]', '', 'ā'],
      ['[\\n]', '', 'a\nb'],
      ['[\\0]', '', 'a\u0000'],
      ['[a-z]+', '', 'ABC'],
      ['[a-zA-Z_][a-zA-Z0-9_]*', '', '9lives _x1'],
      ['[b-b]', '', 'abc'],
      ['[ab]{2}', '', 'xabbax'],
    ]),
  },
  {
    name: 'class escapes',
    run: async ({ load }) => table(load, [
      ['[\\w.]+', '', '  a.b_c! '],
      ['[\\D]+', '', '12ab3'],
      ['[\\S\\s]+', '', 'a b\n'],
      ['[^\\d\\s]+', '', '12 ab 3'],
      ['[\\W]', '', 'ab!'],
      ['\\s+', '', 'a \t\n b'],
      ['\\s', '', ' '],
      ['\\s', '', '\u000b\f'],
      ['\\s', '', '﻿'],
      ['\\w+', '', 'é_9'],
      ['\\W+', '', 'ab!?c'],
      ['\\d+', '', '٣12'],
      ['\\D', '', '1x'],
      ['\\S+', '', '  ab  '],
      ['[\\d\\w]+', '', '--a1--'],
      ['\\d\\D\\w\\W\\s\\S', '', '1a_ \t!'],
      ['[^\\W]+', '', '!!ab_1!'],
      ['[^\\D]+', '', 'ab12c'],
      ['\\w', 'i', 'K'],
    ]),
  },
  {
    name: 'ignore case folds ASCII letters only',
    run: async ({ load }) => table(load, [
      ['abc', 'i', 'xABC'],
      ['[a-c]+', 'i', 'xAbC'],
      ['[^a-c]+', 'i', 'ABCdef'],
      ['É', 'i', 'é'],
      ['[é]', 'i', 'É'],
      ['\\w+', 'i', 'AbC'],
      ['k', 'i', 'K'],
      ['s', 'i', 'ſ'],
      ['[A-Z]', 'i', 'z'],
      ['[^A-Z]', 'i', 'z'],
      ['\\x41', 'i', 'a'],
      ['[\\x41]', 'i', 'a'],
      ['[@-[]', 'i', 'a'],
      ['[a-z]+', 'i', '0Q_'],
      ['(?:ab|AB)c', 'i', 'aBC'],
      ['a', '', 'A'],
      ['[_-a]', 'i', 'A'],
      ['[[-`]+', 'i', 'a_`'],
    ]),
  },
  {
    name: 'flags are checked before the pattern',
    run: async ({ load }) => {
      const { compile } = await api(load);
      const kind = (pattern, flags) => {
        try {
          const re = compile(pattern, flags);
          return `ok:${re.flags}`;
        } catch (error) {
          return error.code ?? error.name;
        }
      };
      return [
        kind('a', ''), kind('a', 'i'), kind('a', 'm'), kind('a', 's'), kind('a', 'im'), kind('a', 'mi'), kind('a', 'ims'), kind('a', 'sim'),
        kind('a', 'g'), kind('a', 'x'), kind('a', 'ii'), kind('a', 'mm'), kind('a', 'I'), kind('a', 'i m'), kind('a', ' i'), kind('a', 'iz'), kind('a', 'y'), kind('a', 'u'), kind('a', 'd'), kind('a', 'imss'),
        kind('(', 'x'), kind('(', ''), kind('*', 'gg'), kind('\\q', 'q'),
      ];
    },
  },
  {
    name: 'syntax errors of groups, classes and escapes',
    run: async ({ load }) => codes(load, [
      '(', '(a', '(?:a', '((a)', '(a|b', 'a)', ')', '(a))', '())',
      '[', '[a', '[^', '[a-', '[a-z', '[\\', '[\\d',
      '[b-a]', '[\\d-z]', '[a-\\d]', '[\\w-\\d]', '[z-a]', '[\\x41-\\x40]', '[\\u0062-\\u0061]',
      '\\', 'a\\', '\\q', '\\1', '\\k', '\\p', '\\c', '\\a', '\\e', '\\x4', '\\xZZ', '\\u12', '\\u12G4', '\\x', '\\u', '[\\b]', '[\\B]', '[\\q]', '[\\1]',
      '(?=a)', '(?!a)', '(?<=a)', '(?<!a)', '(?i)', '(?', '(?#c)', '(?P<a>x)', '(?>a)',
      '(?<n', '(?<', '(?<>x)', '(?<1a>x)', '(?<a-b>x)', '(?<a b>x)', '(?<a>x)(?<a>y)', '(?<a>x)(?<b>y)', '(?<_a1>x)',
      '\\-', '\\ ', '\\é', '\\0', '\\x41', '\\u0041', '[]', '[^]', '()', '(|)', '(?:)',
    ]),
  },
  {
    name: 'syntax errors of repeats',
    run: async ({ load }) => codes(load, [
      '*', '+a', '?', '{2}', 'a|*', '(*)', '(?:+)', '|+', '^*', '$+', '\\b?', '\\B{2}', '^{1,2}', 'a|^*',
      'a**', 'a+*', 'a*??', 'a?+', 'a{2}{3}', 'a{2}*', 'a{2}?*', 'a*?+', '(a)**', 'a+?{2}',
      'a{3,2}', 'a{1001}', 'a{0,1001}', 'a{1001,}', 'a{99999999999999999999}', 'a{2,1}', 'a{5,3}?',
      'a{1000}', 'a{1000,}', 'a{0,1000}', 'a{0}', 'a{0,0}', 'a{2,}?', 'a{0,}', 'a{1,1}',
      'a{', 'a{,3}', 'a{2', 'a{3,2', 'a{x}', 'a{ 2}', 'a{2 }', 'a{-1}', 'a{1,2,3}', '}', '{', ']', 'a|', '|', 'a||b', '(|a)', '(a|)',
    ]),
  },
  {
    name: 'the first problem from the left is the one reported',
    run: async ({ load }) => codes(load, [
      '(a{2,1}', 'a)(', '*)', ')*', '\\q)', '(?<a>x', '(?<a>x)(?<a>', '(*', '(?:', '(?<a>', '[a-z', '(a[b-a', '(\\q', '(?i)\\q',
      '(?<a>x)(?<b>', 'a{1001}(', 'a**(', '[b-a](', '[b-a', 'a{2}{', '\\xZ(', '(?=*', '(?<=*', 'a(?<1>x)(?<1>y)', '(?<a>x)(?<A>y)', '(?<a>x)(?<a>y)(',
    ]),
  },
  {
    name: 'the size rule counts every copy',
    run: async ({ load }) => {
      const { compile } = await api(load);
      const t0 = cpuMs();
      const kind = (pattern) => {
        try {
          const re = compile(pattern);
          return `ok:${re.groupCount}`;
        } catch (error) {
          return error.code ?? error.name;
        }
      };
      const cases = [
        '((a{1000}){1000}){1000}', '(a{200}){200}', '(a{50}){50}', 'a{1000}', '(a|b){1000}c{1000}', '(a|b|c|d|e){1000}(f|g|h){1000}',
        'a{1000}b{1000}c{1000}d{1000}e{1000}f{1000}g{1000}h{1000}i{1000}j{1000}k{1000}', '(?:(?:a{1000}){1000}){0}b', '(a{1000}){1000}(', '(a{1000}){1000}\\q', '(a{1000}){1000}{2}',
        '(?:(?:a{1000}){1000}){0,0}', '((((a{10}){10}){10}){10}){10}', '(?:a{10,}){10,}', '[a-z]{1000}[0-9]{1000}',
        '(a?){1000}', '(?:a|b|c|d|e|f|g|h|i|j){900}',
      ];
      const out = cases.map(kind);
      return { out, fast: cpuMs() - t0 < 2500 };
    },
  },
  {
    name: 'a large counted pattern still matches',
    run: async ({ load }) => timed(async () => table(load, [
      ['a{1000}', '', 'a'.repeat(1000)],
      ['(a|b){300}c', '', `${'ab'.repeat(150)}c`],
      ['(?:ab?){100}$', '', 'ab'.repeat(100)],
      ['(a?){500}a{500}', '', 'a'.repeat(500)],
      ['(?:x{10}){10}y', '', `${'x'.repeat(100)}y`],
      ['(\\d{1,3}\\.){3}\\d{1,3}', '', 'ip 10.200.30.4.'],
    ])),
  },
  {
    name: 'matchAll walks past empty matches',
    run: async ({ load }) => all(load, [
      ['a*', '', 'baac'],
      ['', '', 'abc'],
      ['\\b', '', 'ab cd'],
      ['^', 'm', 'a\nb\n'],
      ['$', 'm', 'a\nb\n'],
      ['aa', '', 'aaaaa'],
      ['a|ab', '', 'abab'],
      ['x*?', '', 'xx'],
      ['(?:)', '', ''],
      ['b', '', ''],
      ['\\d+', '', '1 22 333'],
      ['a?', '', 'ba'],
      ['^a', '', 'aaa'],
      ['a*', '', 'aa'],
      ['(?:)', '', 'a'],
      ['\\s*', '', 'a  b'],
      ['[a-c]*', '', 'abdc'],
      ['\\B', '', 'ab c'],
    ]),
  },
  {
    name: 'matchAll results have the shape of exec',
    run: async ({ load }) => {
      const { compile } = await api(load);
      const re = compile('(?<k>\\w)=(\\d)?');
      return { all: re.matchAll('a=1 b= c=3'), none: re.matchAll('zzz ='), first: re.exec('a=1 b= c=3', 1) };
    },
  },
  {
    name: 'replace expands its template',
    run: async ({ load }) => replaced(load, [
      ['(\\d)(\\d)', '', '12 34', '$2$1', true],
      ['(\\d)(\\d)', '', '12 34', '$2$1', false],
      ['(\\d)(\\d)', '', '12 34', '$2$1'],
      ['x', '', 'axbxc', '[$&]', true],
      ['x', '', 'axb', '$$', false],
      ['x', '', 'axb', '$$$&', false],
      ['(?<w>\\w+)', '', 'ab cd', '<$<w>>', true],
      ['(a)|(b)', '', 'ab', '[$1|$2]', true],
      ['a', '', 'a', '$1', false],
      ['a', '', 'a', '$0', false],
      ['(a)', '', 'a', '$10', false],
      ['(a)', '', 'a', '$9', false],
      ['(a)', '', 'a', '$<nope>', false],
      ['(?<n>a)', '', 'a', '$<', false],
      ['(?<n>a)', '', 'a', '$<n', false],
      ['(?<n>a)', '', 'a', '$<n>$<n>', false],
      ['a', '', 'a', 'x$', false],
      ['a', '', 'a', '$x', false],
      ['a', '', 'a', '$&$&', false],
      ['(?<a>.)(?<b>.)', '', 'xy', '$<b>$<a>', false],
      ['b', '', 'aaa', 'x', true],
    ]),
  },
  {
    name: 'replace with empty matches and anchors',
    run: async ({ load }) => replaced(load, [
      ['x*', '', 'abc', '-', false],
      ['x*', '', 'abc', '-', true],
      ['', '', 'ab', '|', true],
      ['\\s+', '', 'a  b\t c', ' ', true],
      ['^', 'm', 'a\nb', '> ', true],
      ['$', 'm', 'a\nb', ';', true],
      ['a*', '', 'baac', 'X', true],
      ['\\b', '', 'ab cd', '|', true],
      ['o', '', 'foo', '0', true],
      ['(a)?b', '', 'b ab', '[$1]', true],
      ['.', 's', 'a\nb', '.', true],
      ['\\d+', '', 'a1b22c333', '<$&>', true],
      ['(?:)', '', '', 'x', true],
      ['(?:)', '', '', 'x', false],
    ]),
  },
  {
    name: 'a character is one code unit',
    run: async ({ load }) => table(load, [
      ['^.$', '', '😀'],
      ['^..$', '', '😀'],
      ['.', '', '😀'],
      ['\\ud83d\\ude00', '', 'x😀'],
      ['[\\ud83d]', '', '😀'],
      ['😀', '', 'a😀'],
      ['😀+', '', '😀😀'],
      ['[😀]', '', 'x😀'],
      ['\\u00e9', '', 'café'],
      ['[à-ÿ]+', '', 'caféè!'],
      ['\\w', '', 'é'],
      ['.{2}', '', '😀'],
    ]),
  },
  {
    name: 'a compiled regex keeps no state',
    run: async ({ load }) => {
      const { compile } = await api(load);
      const re = compile('(a)(b)?');
      const first = re.exec('xxab');
      const second = re.exec('xxab');
      first.spans[1][0] = 99;
      first.spans.push('mutated');
      const third = re.exec('xxab');
      const other = compile('(a)(b)?');
      return { second: tag(second), third: tag(third), same: tag(other.exec('xxab')), fresh: second !== third, matchAllThenExec: [re.matchAll('abab').length, tag(re.exec('ab', 0))], names: Object.keys(re.names) };
    },
  },
  {
    name: 'patterns people really write',
    run: async ({ load }) => table(load, [
      ['(\\d{4})-(\\d{2})-(\\d{2})', '', 'due 2024-05-17!'],
      ['[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+', '', 'mail: a.b+c@ex-ample.co.uk now'],
      ['"((?:[^"\\\\]|\\\\.)*)"', '', 'say "a \\"q\\" b" end'],
      ['\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', '', 'ip 192.168.1.255 x'],
      ['\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', '', 'ip 192.168.1.256 x'],
      ['<(\\w+)[^>]*>(.*?)</\\w+>', '', 'a <b class="x">bold</b> and <i>it</i>'],
      ['#(?:[0-9a-f]{3}){1,2}\\b', 'i', 'color: #FfA500; #abc'],
      ['[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?', 'i', 'x = -1.5E+10;'],
      ['^\\s*(\\w+)\\s*=\\s*(.*?)\\s*$', '', '  key =  some value  '],
      ['(?<h>\\d\\d):(?<m>\\d\\d)(?::(?<s>\\d\\d))?', '', 'at 09:45 and 10:15:30'],
      ['^(?:(?:[a-z0-9-]+)\\.)+[a-z]{2,}$', 'i', 'www.Example.COM'],
      ['\\/\\*[^*]*\\*+(?:[^/*][^*]*\\*+)*\\/', '', 'a /* c1 ** x */ b'],
      ['(\\w+)(?:\\s+\\1)', '', 'a b'],
    ]),
  },
  {
    name: 'matchAll on realistic text',
    run: async ({ load }) => all(load, [
      ['[A-Za-z_]\\w*', '', 'let x1 = _y + 9z'],
      ['(\\w+)=("[^"]*"|\\S+)', '', 'a=1 b="x y" c='],
      ['\\b\\w', '', 'the quick  brown fox'],
      ['[^,]*', '', 'a,,b'],
      ['(?:\\r?\\n|^)[^\\n]*', 'm', 'ab\ncd\n\nef'],
      ['\\$\\{(\\w+)\\}', '', 'x${a}y${bb}${}'],
    ]),
  },
  {
    name: 'exponential patterns stay fast',
    run: async ({ load }) => {
      const { compile } = await api(load);
      return timed(async () => [
        tag(compile('(a|aa)+$').exec(`${'a'.repeat(3000)}b`)),
        tag(compile('(x+x+)+y').exec('x'.repeat(4000))),
        tag(compile('(a?){30}a{30}').exec('a'.repeat(30))),
        tag(compile('(a*)*b').exec('a'.repeat(20000))),
        tag(compile(`${'a?'.repeat(500)}${'a'.repeat(500)}`).exec('a'.repeat(500))),
        tag(compile('(?:a|b|ab)*c').exec('ab'.repeat(5000))),
        tag(compile('^(a+)+$').exec(`${'a'.repeat(5000)}!`)),
        tag(compile('(.*a){20}').exec('a'.repeat(30))),
        tag(compile('(?:(?:a*)*)*b').exec('a'.repeat(3000))),
      ]);
    },
  },
  {
    name: 'a search does not restart from scratch at every start index',
    run: async ({ load }) => {
      const { compile } = await api(load);
      return timed(async () => [
        tag(compile('[a-z]+@[a-z]+\\.com').exec('a'.repeat(100000))),
        tag(compile('a*b').exec('a'.repeat(60000))),
        tag(compile('(?:a|b)*c').exec('ab'.repeat(40000))),
        tag(compile('\\w+\\s+\\d+x').exec('word '.repeat(20000))),
        tag(compile('x.*y').exec(`${'x'.repeat(30000)}`)),
        tag(compile('(a+)+b').exec('a'.repeat(30000))),
      ]);
    },
  },
  {
    name: 'many matches in a long text stay fast',
    run: async ({ load }) => {
      const { compile } = await api(load);
      return timed(async () => {
        const text = 'ab cd '.repeat(5000);
        const re = compile('\\w+');
        const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join('|');
        const big = compile(`\\b(?:${words})\\b`);
        const hay = ' zz word17 qq '.repeat(1500);
        return {
          count: re.matchAll(text).length,
          replaced: re.replace(text, '<$&>', true).length,
          words: big.matchAll(hay).length,
          empty: compile('').matchAll('x'.repeat(10000)).length,
          last: tag(compile('(\\w+) $').exec(text)),
        };
      });
    },
  },
];

export { probes };
