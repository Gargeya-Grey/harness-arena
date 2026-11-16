// Hidden probes for markdown-renderer; expected.json holds the answers.
// Most probes render a list of small documents and return one line per document: its index, then the HTML as JSON.
const lib = (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};
const docs = (list) => async ({ load }) => {
  const { render } = await lib(load);
  return list.map((source, index) => {
    let html;
    try {
      html = render(source);
    } catch (error) {
      html = `throws ${error.constructor.name}`;
    }
    return `${index}| ${JSON.stringify(html)}`;
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

const FRAGMENTS = ['# head', 'text', 'more text', '- item', '  - nested', '1. one', '2. two', '> quote', '```', '    code', '---', '', '', '* star', '===', '[r]: /u', '*em* and `c`', '   - three', '- ', '    - four', '> - q', '~~~ js', 'a  ', '[r] [x](y)', '10. ten', '+ plus'];
const randomDocs = (seed, count) => {
  const rnd = prng(seed);
  return Array.from({ length: count }, () => {
    const lines = Array.from({ length: 4 + Math.floor(rnd() * 9) }, () => FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)]);
    return lines.join('\n');
  });
};

export const probes = [
  {
    name: 'maximal reference destinations take adjacent quotes before optional titles',
    run: docs(["[a]: /u't'\n[a]", "[a]: /u 't'\n[a]", "[a]: </u>'t'\n[a]", "[a]: </u> 't'\n[a]"]),
  },
  {
    name: 'md01 paragraphs, escaping and line ends',
    run: docs(['plain', 'a\nb\n\nc', '  lead\n   spaces\n', '1 < 2 & 3 > 2 "q"', '&copy; &amp; &#35;', '<b>bold</b> <!-- x -->', 'a\r\nb\rc', '\n\n\n', '   ', 'tab\tinside', 'line  ', 'a \nb', 'a   \nb', 'text\n\n\n\nmore', 'x\n    y\n  z', 'caf\u00e9 \u{1F600} <\u00e9>', '', '\r\n', 'a\n \nb', 'one\n\n \t\ntwo']),
  },
  {
    name: 'md02 backslash escapes',
    run: docs(['\\*not\\*', '\\# not heading', '\\\\', '\\a', 'a\\', '\\`x\\`', '\\[a\\](u)', '\\_x\\_', 'a\\\nb', '\\!\\[a](u)', '\\<b\\>', '\\& \\"', '\\\\*a*', '\\\\\\*a*', '`a\\`b`', '*a\\*b*', '\\ x', '\\\t', '1\\. not a list', '\\- item']),
  },
  {
    name: 'md03 ATX headings',
    run: docs(['# h', '###### six', '####### seven', '#nospace', '#\tx', '   # three', '    # four', '# foo ##', '# foo #bar', '## ', '#', '# # ', '# *em* `c`', '#  spaced   out  ', '# foo \\#', '## a ## b', '###', '# foo#', '### foo ###   ', '#\n# x\n#', 'a\n# h\nb', '# h\n# h2']),
  },
  {
    name: 'md04 setext headings and thematic breaks',
    run: docs(['Foo\n---', 'Foo\n===', 'Foo\nbar\n---', 'Foo\n  ===  ', 'Foo\n= =', 'Foo\n-', '---\n', '***', '_ _ _', '- - -', '--\n', '-- -', 'a\n***', 'a\n- - -', '+++', '===', 'Foo\n\n---', '   ---', '    ---', 'Foo\n    ---', 'Foo\n    ===', '-*-', 'Foo\n***\nbar', ' ***  ', '* * * *', '**', '_ __', 'Foo *bar*\n=========', 'a\n=\nb', 'a\n---\nb\n---']),
  },
  {
    name: 'md05 fenced code',
    run: docs(['```\ncode\n```', '~~~\ncode\n~~~', '```js extra words\nx\n```', '```\nunclosed\nstill', '  ```\n  indented\n    more\n x\n  ```', '````\n```\nnot closed yet\n````', '```\na\n``\n```', '``` `x`\ny\n```', '~~~ `x`\ny\n~~~', 'para\n```\ncode\n```\nafter', '```\n```', '```\n\n\n```', '~~~\n```\nx\n```\n~~~', '```<b>\nx\n```', '```\n<b> & "x"\n```', '```\na\n```  \nb', '```\na\n``` x\n```', '   ```\na\n```', '    ```\n    x\n    ```', '~~~~\n~~~\n~~~~', '```', '```a\\*b\nx\n```']),
  },
  {
    name: 'md06 indented code',
    run: docs(['    code', '    a\n\n    b', '    a\n\n\n\n    b\n\n\nc', 'para\n    continued', '    a\n  b', '     five', '    a\n    \n    b', '    <x> & "y"', '\n    code\n', '    a\n    ', '    a\n- b', '>     code', '- a\n\n      code', '    one\ntwo']),
  },
  {
    name: 'md07 block quotes',
    run: docs(['> a', '>a', '>  two spaces', '> a\n> b', '> a\nb', '> a\n\n> b', '>', '> # head\n> text', '> - a\n> - b', '> ```\n> x\n> ```', '> > a\n> b', '>> a', '   > a\n  > b', '    > code', '> a\n>\n> b', '> a\n>b\n> c', '> ---', '> a\n> ---', '> 1. x\n> 2. y', '>\n>\n> a', '> a\n\n\n> b\n> c', '> [r]: /u\n\n[r]', 'a\n> b\nc']),
  },
  {
    name: 'md08 lists: tight and loose',
    run: docs(['- a\n- b', '- a\n\n- b', '- a\n- b\n\n- c', '* a\n* b', '+ a\n+ b', '1. a\n2. b', '5. a\n6. b', '0. a\n1. b', '007. a', '1) a\n2) b', '- a\n\n\n\n- b', '- a\n- b\n\n\ntext', '- one\n- two\n\npara', '2. a\n\n3. b', '999999999. x', '1234567890. x', '-a', '-\ta', '- a\n\n- b\n- c', '- a\n- b\n\n- c\n- d']),
  },
  {
    name: 'md09 list items: content column and continuation',
    run: docs(['1. a\n   - b', '- a\n - b', '- a\n  b', '- a\nb', '-  a', '-     code', '-      six', '10. x\n    y', '10. x\n   y', '- a\n\n  b', '- a\n  - b\n\n  - c', '- \n  a', '-\n\n  a', '- a\n    deep', '1.  a\n    b\n\n    c', '*   a\n    b', '- a\n  - b\n    - c\n- d', '  - a\n  - b', '   - a\n    - b', '- a\n\n\n  b', '- a\n  # h\n  text', '- # h', '- > q\n  > r']),
  },
  {
    name: 'md10 list kinds, ends and neighbours',
    run: docs(['- a\n* b', '1. a\n1) b', '1. a\n3. b\n2. c', 'a\n- b', '- a\n---', '* a\n* * *', '- a\n- - -', '- a\n\n---', '- a\n# h', '- a\n> q', '- a\n```\nx\n```', '- a\n\n  ```\n  x\n  ```', '1. a\n- b', '- a\n+ b\n* c', '1. a\n\n2) b', '- a\n    - b', '- a\n\n    b', '1. a\n2. b\n   3. c', '- x\n\n\n\ny', '* * *\n* a']),
  },
  {
    name: 'md11 what interrupts a paragraph',
    run: docs(['a\n1. b', 'a\n2. b', 'a\n-', 'a\n- b', 'a\n01. b', 'a\n1.', 'a\n10. b', 'a\n> b', 'a\n# b', 'a\n```\nb\n```', 'a\n~~~', 'a\n    b', 'a\n***', 'a\n[r]: /u', 'a\n   - b', 'a\n    - b', 'a\n1) b', 'a\n* b\n* c', 'a\n+ \nb', 'a\n```x`y\nb', 'a\n=\n- b', 'a\n2019. b', 'a\n\n2. b']),
  },
  {
    name: 'md12 loose and tight edge cases',
    run: docs(['- a\n  - b\n\n  - c\n- d', '- a\n\n  b', '- a\n  ```\n  x\n\n  y\n  ```\n- b', '- a\n- b\n\n  c', '- a\n\n  - b\n- c', '- a\n  - b\n- c\n\n  d', '- a\n\n  - b\n\n  - c', '1. a\n   b\n2. c', '- a\n  # h\n\n  t', '- a\n\n- b\n\n  c', '- a\n  - b\n\n\n- c', '- a\n    code?\n\n      real code', '> - a\n>\n> - b', '- > a\n\n  > b', '- a\n  b\n\n- c\n  d']),
  },
  {
    name: 'md13 empty list items',
    run: docs(['-', '- \n- b', '1.', '-\n  a', '- a\n-\n- b', '-\n-', '1.\n2.', '-\n\n-', '- a\n\n-\n- b', '- \n\n  b', '*\n  *\n    *', '- a\n  -']),
  },
  {
    name: 'md14 link reference definitions',
    run: docs(['[a]: /u\n\n[a]', '[a]: /u "t"\n[a]', ' [A  b]: /u\n[a B]', '[a]: /one\n[a]: /two\n[a]', 'x\n[a]: /u\n[a]', '[a]: <b c>\n[a]', '[a]: /u\'t\'\n[a]', '[a]: /u "t" x\n[a]', '> [a]: /u\n\n[a]', '- [a]: /u\n\n[a]', '[a\\]]: /u\n[a\\]]', '[a]\n\n[a]: /late', '[a]: /u "q\\"x"\n[a]', '[ ]: /u\n[ ]', '[a]:/u\n[a]', '[a]:\n[a]', '   [a]: /u\n[a]', '    [a]: /u\n\n[a]', '[a]: /u (t)\n[a]', '[a]: \\*x\n[a]', '[Ünï]: /u\n[ÜNÏ]']),
  },
  {
    name: 'md15 code spans',
    run: docs(['`a`', '``a`b``', '` a `', '`  a  `', '` `` `', '`a\nb`', '`a', '``a`', '```a``', '`a``b`', '`*a*`', '`\\*`', '\\`a`', '` `', '`  `', '`a `', '` a`', '`<b>&`', '`a`b`c`', '`` ` ``', '`a  \nb`', 'x`y`z', '*`a*`', '`a\\`b`', '` a  b `']),
  },
  {
    name: 'md16 emphasis: the basics',
    run: docs(['*a*', '**a**', '***a***', '_a_', '__a__', '___a___', '*a **b** c*', '**a *b* c**', '***a** b*', '***a* b**', '*a* *b*', '**a** **b**', '*a*b', 'a*b*c', '* a*', '*a *', '**a*', '*a**', '*a', 'a*', '**', '_a', '*a*_b_', '**a**b**c**', '*a\nb*', '*a  \nb*', '* a *', '_ a _', '*\\**', '****', '*****a*****']),
  },
  {
    name: 'md17 emphasis: underscores inside words',
    run: docs(['snake_case_name', 'a_b_c', '_a_b', 'a_b_', '_a_b_', 'foo_bar_', '_foo_bar_baz_', '__init__', 'a__b__c', '__a__b', '5_000_000', '_(a)_', 'a_(b)_', '(_a_)', '_a_.', '"_a_"', 'x _a_ y', '_a b_c_', '__a_b__', 'a_', '_a_ _b_', '__a__b__c__', '_a__b_', '__a_b_', 'ab_cd_ef_gh']),
  },
  {
    name: 'md18 emphasis: punctuation and flanking',
    run: docs(['*(a)*', '**"a"**', 'a*"b"*c', '*a*.', 'a*(b)*c', '*"a"*', '**(**a)', '(**a)', '*a*(b)', '_"a"_', 'a**b**', '**a**!', '!**a**', '*a.*', '*.a*', '* a*b*', '*a *b*', 'a * b * c', '**:)**', '*a*:*b*', '_a_:_b_', '*:a*', '\u201c*a*\u201d', '*\u00e9*', '*a\u00e9*b', '*\t*', '**a**\t**b**', '*(*', '*)*a']),
  },
  {
    name: 'md19 emphasis: the rule of three',
    run: docs(['*foo**bar*', '**foo*bar**', '*foo**bar**baz*', '**foo*bar*baz**', 'foo***bar***baz', 'foo******bar*********baz', '*foo **bar *baz* bim** bop*', '***foo** bar*', '*foo*bar**', '**foo***', '***foo**', '***foo*', '*foo***', '**foo*bar***', '__foo_bar__', '_foo__bar_', '*a**b***c*', '***a***b***c***', '*a*b**c**', '**a**b*c*', '*a**b*c**', '**a*b**c*', '*a***b*', '**a***b**', '***a*b**', '***a**b*']),
  },
  {
    name: 'md20 emphasis: runs that stay literal and nesting depth',
    run: docs(['**a *b**', '*a **b*', '*a _b* c_', '_a *b_ c*', '*a**b**c*', '**a*b*c', 'a***b', '***', '* * *a* * *', '*a*b*c*d*', '**a*b**c*', '*a*b**c**d*', '**a*b**', '*_a_*', '_*a*_', '**_a_**', '__*a*__', '*__a__*', '_**a**_', '*a _b **c** d_ e*', '**a [b*](u) c**', '*a [b](u*) c*', '*[a*](u)', '[*a](u)*', '*a `b*` c*']),
  },
  {
    name: 'md21 inline links',
    run: docs(['[a](/u)', '[a](/u "t")', "[a](/u 't')", '[a]( /u )', '[a](/u\n"t")', '[a](/u"t")', '[a](/u "t" x)', '[a]()', '[a](<>)', '[a](<b c>)', '[a](<b>c)', '[a](<b\nc>)', '[a](b(c)d)', '[a](b(c)', '[a](b)c)', '[a](b\\)c)', '[a](b\\ c)', '[a](/u "t\\"x")', '[a](/u "a&b <c>")', '[a&b](/u?x=1&y=2)', '[*a* `b`](u)', '[a](u)[b](v)', '[a] (u)', '[a]\n(u)', '[a](u', '[a](', '[a](u "t)', '[a]("t")', '[](u)', '[ ](u)', '[a](/u "")', '[a](/u (t))', '[a](u\t"t")']),
  },
  {
    name: 'md22 reference links',
    run: docs(['[a][r]\n\n[r]: /u', '[a][R]\n\n[r]: /u "t"', '[a][]\n\n[a]: /u', '[a]\n\n[a]: /u', '[a][ r ]\n\n[r]: /u', '[a][x]\n\n[a]: /u', '[a][x] [x]\n\n[x]: /u', '[a][]\n\n[A]: /u', '[a b]\n\n[a  B]: /u', '[a]\n[b]\n\n[a]: /1\n[b]: /2', '[*a*][]\n\n[*a*]: /u', '[a][r', '[a][r]x\n\n[r]: /u', '[a](x)\n\n[a]: /u', '[a](x y)\n\n[a]: /u', '[a][][b]\n\n[a]: /1\n[b]: /2', '[a]: /u\n\n[a][b]', '[a\\]]\n\n[a\\]]: /u', '![a][r]\n\n[r]: /i "t"', '![a]\n\n[a]: /i', '[a][\n\n[a]: /u', '[x][r][y]\n\n[r]: /u\n[y]: /v', '[ ]\n\n[ ]: /u', '[]\n\n[]: /u', '[a][b][c]\n\n[b]: /u']),
  },
  {
    name: 'md23 images and alt text',
    run: docs(['![a](/i)', '![a](/i "t")', '![*a* **b**](/i)', '![a `b`](/i)', '![a [b](u)](/i)', '![![x](/j)](/i)', '![a\nb](/i)', '![a  \nb](/i)', '![](/i)', '![a &amp; <b>](/i)', '![\\*a\\*](/i)', '![a*b*c](/i)', '![a ![b](/j) c](/i)', '![a]', '!\\[a](/i)', '![a] (/i)', '![a](/i )x', '[![a](/i)](/u)', '![a](/i)![b](/j)', '! [a](/i)', '!![a](/i)', '![a\\](/i)', '![a *b](/i)*', '![a]()', '![_a_ __b__ ___c___](/i)']),
  },
  {
    name: 'md24 links inside links, and brackets that stay literal',
    run: docs(['[a [b](u1)](u2)', '[a ![b](i)](u)', '[[a]](u)', '[[a](u)]', '[a][', '[]', 'a]', '[a', '[a]', '[[a]]', '[a](u)(v)', '[a [b] c](u)', '[a [b](v) c](u) [d](w)', '[a [b [c](x)](y)](z)', '[a]( [b](c) )', '*[a](u)*', '[*a*](u)', '[a*](u)*', '*[a*](u)', '[a `]` b](u)', '[a \\] b](u)', '[a]](u)', '[[a](u)', '[a]{u}', '[a]<u>', '[a](u)]', ']', '][', '[](', '[a][b]c', '[[a][b]]']),
  },
  {
    name: 'md25 unsafe link destinations',
    run: docs(['[a](javascript:alert(1))', '[a](JavaScript:x)', '[a](vbscript:x)', '[a](data:text/html;base64,AAAA)', '[a](DATA:x)', '[a](<javascript:x>)', '[a](java\\script:x)', '[a](javascript\\:x)', '![a](javascript:x)', '[a](xjavascript:x)', '[a](/javascript:x)', '[a](http://x)', '[a](mailto:me@x.org)', '[a](data)', '[a](javascript&#58;x)', '[a]\n\n[a]: javascript:x', '[a](\\javascript:x)', '[a](datax:y)']),
  },
  {
    name: 'md26 line breaks inside paragraphs',
    run: docs(['a  \nb', 'a \nb', 'a\\\nb', 'a   \n   b', 'a\n\n  b', 'a  \n', 'a\\', 'a\\\n', '*a  \nb*', '[a  \nb](u)', '`a  \nb`', 'a  \n  \nb', 'a  \nb  \nc', 'a\\\n\\\nb', 'a \\\nb', 'a  \\\nb', 'a\n b  \n c', '# a  ', 'a\tb  \nc', 'a  \n# b', 'a  \n> b', 'one\\\ntwo\\\nthree']),
  },
  {
    name: 'md27 headings with inline markup and setext content',
    run: docs(['# *a* **b** `c` [d](e)', '# a\\\nb', '# [a][r]\n\n[r]: /u', 'a *b\nc* d\n===', 'a\nb\n===', '*a\n---', 'a\\\nb\n===', '[a](u)\n---', '`a\n---', 'a  \nb\n---', '  Foo\n  ---', 'a\n b\n  c\n---', '> a\n> ===', '- a\n  ===', '- a\n  b\n  ---', '# a\n===', '```\nx\n```\n---', '> a\n---']),
  },
  {
    name: 'md28 containers inside containers',
    run: docs(['> - a\n> - b', '- > a\n  > b', '1. - a\n   - b', '> 1. a\n> 2. b', '- ```\n  x\n  ```', '> ```\n> x', '- a\n  > q\n  > r\n- b', '> - a\n>   - b\n> - c', '> # h\n>\n> - a', '- - a', '- - - a', '1. 2. a', '> > > a', '- > - a', '- a\n  1. b\n  2. c', '> a\n> - b\n> c', '>     code\n>\n> text', '- ```\n  a\n\n  b\n  ```\n- c', '1. a\n   > b\n   ```\n   c\n   ```', '- \t- a', '-\t- a']),
  },
  {
    name: 'md29 tabs and blank-line handling',
    run: docs(['\tcode', '\t\ttwo', ' \tmixed', '\t- a', '- a\n\t- b', '- a\n\tb', '> \ta', '>\ta', 'a\n\tb', '\t', 'a\t\n\tb', '\t# h', '- \ta', '1.\ta', '\t> q', '\t```\n\tx\n\t```', '- a\n\n\tb', '#\th', 'a\n\t---', '* * *\t', '- - -\t-', '\n\t\n']),
  },
  {
    name: 'md30 documents of mixed blocks',
    run: docs([
      '# Title\n\nIntro with *em*, **strong** and `code`.\n\n- one\n- two\n  - two-a\n  - two-b\n- three\n\n> quote\n> more\n\n```js\nconst a = 1;\n```\n\nEnd.',
      'Heading\n=======\n\n1. first\n2. second\n\n   continued\n3. third\n\n---\n\n[link][r] and ![img](/i.png "T")\n\n[r]: https://example.org/?a=1&b=2 "Example"',
      '> # Quote heading\n>\n> 1. one\n> 2. two\n>\n> ```\n> code\n> ```\n\n    indented\n\n* * *\n\nlast line  \nhard break',
      '- a\n\n      code in item\n\n  text after\n- b\n\n  > quote in item\n\n- c',
      '# A *very* **long** heading with `code`, a [link](/x), and ![an image](/y)\n\nA paragraph that has _underscored_ words, snake_case names, 2 * 3 * 4 sums, and a \\* star.\n\n1. [x](x)\n1. [y](y)\n1. [z](z)',
    ]),
  },
  {
    name: 'md31 seeded random documents, set one',
    run: docs(randomDocs(11, 30)),
  },
  {
    name: 'md32 seeded random documents, set two',
    run: docs(randomDocs(2025, 30)),
  },
  {
    name: 'md33 inputs that must not throw',
    run: docs(['[', ']', '![', '`', '```', '~~~', '>', '-', '*', '_', '\\', '[]()', '[a](', '[a](<', '1.', '&', '<', '"', '[a]: ', '[a]:', '![]', '![](', '**', '__', '*_*_', '_*_*', '\u0000', '\u2028', '\ud83d', '[a](\\', '[a][\\', '`\\', '> ', '>>>>', '- - - - -', '1) 1) 1)', '# ', '####### ', '[\\]', '\\[\\]', '[a]\\']),
  },
  {
    name: 'md34 types and the empty document',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const attempt = (value) => {
        try {
          return render(value);
        } catch (error) {
          return error.constructor.name;
        }
      };
      return [attempt(''), attempt('x'), attempt(undefined), attempt(null), attempt(5), attempt({}), attempt(['a']), typeof render('a')].map((v, i) => `${i}| ${JSON.stringify(v)}`);
    },
  },
  {
    name: 'md35 emphasis stays fast on long runs',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const shapes = [(n) => 'a* '.repeat(n), (n) => '*a '.repeat(n), (n) => '*a** '.repeat(n / 2), (n) => '*a* '.repeat(n), (n) => '*a '.repeat(n / 2) + 'b* '.repeat(n / 2), (n) => '**a*** '.repeat(n / 4), (n) => '_a '.repeat(n / 2) + 'b_ '.repeat(n / 2)];
      const sizes = [];
      for (const shape of shapes) {
        let last = null;
        for (const n of [10000, 30000, 60000]) {
          const start = cpuMs();
          last = render(shape(n));
          if (cpuMs() - start > 1500) return { slow: true };
        }
        sizes.push(last.length);
      }
      return { fast: true, sizes };
    },
  },
  {
    name: 'md36 deep nesting does not overflow',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const count = (html, tag) => html.split(tag).length - 1;
      const quotes = render('> '.repeat(500) + 'x');
      const lists = render(Array.from({ length: 120 }, (_, i) => `${'  '.repeat(i)}- n${i}`).join('\n'));
      const emphasis = render('*a '.repeat(3000) + 'b' + '* c'.repeat(3000));
      const brackets = render('['.repeat(2000) + 'a' + '](u)'.repeat(2000));
      const mixed = render('> - '.repeat(100) + 'x');
      return {
        quotes: [count(quotes, '<blockquote>'), count(quotes, '</blockquote>'), count(quotes, '<p>x</p>')],
        lists: [count(lists, '<ul>'), count(lists, '<li>n119</li>')],
        emphasis: [count(emphasis, '<em>'), count(emphasis, '</em>')],
        brackets: brackets.length > 0,
        mixed: [count(mixed, '<blockquote>'), count(mixed, '<ul>')],
      };
    },
  },
  {
    name: 'md37 a long document renders in linear time',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const piece = [
        '# h',
        '',
        '- a *b* `c`',
        '- [d](e) ![f](g)',
        '  - nested',
        '',
        '> q **r**',
        '',
        '```',
        'code',
        '```',
        '',
        '1. x',
        '2. y',
        '',
        'text line one',
        'text line two  ',
        'end',
        '',
        '[r]: /u',
        '',
        '',
      ].join('\n');
      let html = '';
      for (const n of [200, 1000, 6000]) {
        const start = cpuMs();
        html = render(piece.repeat(n));
        if (cpuMs() - start > 3000) return { slow: true };
      }
      const lineStart = cpuMs();
      const lineHtml = render('word '.repeat(100000));
      const list = Array.from({ length: 30000 }, (_, i) => `- item ${i}`).join('\n');
      const listHtml = render(list);
      return { fast: cpuMs() - lineStart < 3000, count: html.split('<h1>h</h1>').length - 1, lineLength: lineHtml.length, items: listHtml.split('<li>').length - 1 };
    },
  },
];
