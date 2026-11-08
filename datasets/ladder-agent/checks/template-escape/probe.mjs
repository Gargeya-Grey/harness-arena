// Hidden probes for ladder-agent-template-escape; expected.json holds the answers.
// Every probe renders through render()/compile() from src/index.mjs.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch {
    return 'threw';
  }
};

export const probes = [
  {
    name: 'keeps the basic escapes',
    run: async ({ load }) => {
      const { render } = await lib(load);
      return [render('{{x}}', { x: '<b>&"x"</b>' }), render('{{{x}}}', { x: '<b>&' }), render('{{x}}|{{y}}|{{z}}', { x: null, y: undefined, z: 0 })];
    },
  },
  {
    name: 'an apostrophe is escaped as &#39;',
    run: async ({ load }) => {
      const { render } = await lib(load);
      return [render("<a title='{{t}}'>", { t: "it's" }), render('{{t}}', { t: "'&'" }), render('{{{t}}}', { t: "it's" })];
    },
  },
  {
    name: 'keeps nested loops escaping once',
    run: async ({ load }) => {
      const { render } = await lib(load);
      return render('{{#each rows}}{{#each this}}{{.}}{{/each}}|{{/each}}', { rows: [['a&b', '<'], ['c']] });
    },
  },
  {
    name: 'a partial without an argument gets the context of the loop item',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const partials = { row: '<li>{{name}}</li>' };
      return [render('{{#each items}}{{> row}}{{/each}}', { name: 'page', items: [{ name: 'A&B' }, { name: 'C' }] }, { partials }), render('{{> row}}', { name: 'x' }, { partials })];
    },
  },
  {
    name: 'keeps a partial with an argument',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const partials = { card: '[{{title}}]' };
      return [render('{{> card item}}', { item: { title: 'T&1' } }, { partials }), render('{{#each xs}}{{> card owner}}{{/each}}', { xs: [{ owner: { title: 'a' } }, { owner: { title: 'b' } }] }, { partials }), render('{{> card this}}', { title: 'me' }, { partials })];
    },
  },
  {
    name: 'a partial written as a function writes its markup as it is',
    run: async ({ load }) => {
      const { render, SafeString } = await lib(load);
      const partials = { badge: (ctx) => `<b>${ctx.n}</b>`, safe: (ctx) => new SafeString(`<i>${ctx.n}</i>`), none: () => undefined };
      return [render('{{> badge}}', { n: 1 }, { partials }), render('{{> safe}}', { n: 2 }, { partials }), render('[{{> none}}]', {}, { partials }), render('{{#each xs}}{{> badge}}{{/each}}', { xs: [{ n: 3 }, { n: 4 }] }, { partials })];
    },
  },
  {
    name: 'the parent context is reached from inside an if',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const ctx = { title: 'T', items: [{ show: true, name: 'a' }, { show: false, name: 'b' }, { show: true, name: 'c' }] };
      return [render('{{#each items}}{{#if show}}{{../title}}:{{name}} {{/if}}{{/each}}', ctx), render('{{#each items}}{{#unless show}}{{../title}}:{{name}}{{/unless}}{{/each}}', ctx)];
    },
  },
  {
    name: 'the parent context is reached through an if and a second loop',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const ctx = { site: 'S', groups: [{ name: 'g1', on: true, items: [{ n: 1 }, { n: 2 }] }, { name: 'g2', on: false, items: [{ n: 3 }] }] };
      return render('{{#each groups}}{{#if on}}{{#each items}}{{../../site}}/{{../name}}/{{n}} {{/each}}{{else}}{{../site}}-{{name}} {{/if}}{{/each}}', ctx);
    },
  },
  {
    name: 'keeps ../ in plain nested loops',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const ctx = { a: [{ n: 'x', b: [{ m: 1 }, { m: 2 }] }, { n: 'y', b: [{ m: 3 }] }] };
      return render('{{#each a}}{{#each b}}{{../n}}{{m}} {{/each}}{{/each}}', ctx);
    },
  },
  {
    name: 'an outer @index survives an inner loop',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const rows = [{ cells: [1, 2, 3] }, { cells: [1] }, { cells: [] }];
      return [
        render('{{#each rows}}{{@index}}[{{#each cells}}{{@index}}{{/each}}]{{@index}};{{/each}}', { rows }),
        render('{{#each rows}}{{#each cells}}{{#if @last}}L{{/if}}{{/each}}{{#if @first}}F{{/if}}{{#if @last}}E{{/if}};{{/each}}', { rows }),
        render('{{#each o}}{{@key}}{{#each .}}{{@key}}{{/each}}{{@key}} {{/each}}', { o: { p: ['x', 'y'], q: ['z'] } }),
      ];
    },
  },
  {
    name: 'keeps @index, @first, @last and @key in one loop',
    run: async ({ load }) => {
      const { render } = await lib(load);
      return [render('{{#each xs}}{{@index}}{{#if @first}}F{{/if}}{{#if @last}}L{{/if}} {{/each}}', { xs: ['a', 'b', 'c'] }), render('{{#each o}}{{@key}}={{.}},{{/each}}', { o: { a: 1, b: 2 } })];
    },
  },
  {
    name: 'if and unless treat empty lists and zero as false',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const values = [[], [0], 0, 1, '', 'a', null, undefined, {}, false, NaN];
      return values.map((v) => render('{{#if v}}Y{{else}}N{{/if}}{{#unless v}}n{{else}}y{{/unless}}', { v }));
    },
  },
  {
    name: 'each falls back to its else part on empty and missing lists',
    run: async ({ load }) => {
      const { render } = await lib(load);
      return [
        render('{{#each xs}}x{{else}}<i>none</i>{{/each}}', { xs: [] }),
        render('{{#each xs}}x{{else}}{{msg}}{{/each}}', { msg: 'a&b' }),
        render('{{#each xs}}x{{else}}{{msg}}{{/each}}', { xs: 5, msg: "it's" }),
        render('{{#each xs}}{{.}}{{/each}}', { xs: 'abc' }),
      ];
    },
  },
  {
    name: 'keeps helper results escaped, and safe results raw',
    run: async ({ load }) => {
      const { render } = await lib(load);
      return [render('{{upper t}}|{{safe t}}|{{join xs ", "}}', { t: 'a&b', xs: ['<', '>'] }), render('{{#each xs}}{{safe .}}{{upper .}}{{/each}}', { xs: ['<i>', '&'] }), render('{{#if eq a b}}same{{else}}diff{{/if}}', { a: 1, b: 1 })];
    },
  },
  {
    name: 'a partial inside a loop reaches the parent context',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const partials = { line: '{{../title}}-{{name}};' };
      return render('{{#each items}}{{> line}}{{/each}}', { title: "T'", items: [{ name: 'a' }, { name: 'b' }] }, { partials });
    },
  },
  {
    name: 'a partial calls itself on the children of each node',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const partials = { tree: '<ul>{{#each children}}<li>{{name}}{{> tree}}</li>{{/each}}</ul>' };
      const data = { children: [{ name: 'a&b', children: [{ name: 'c', children: [] }, { name: 'd', children: [{ name: 'e', children: [] }] }] }, { name: 'f', children: [] }] };
      return render('{{> tree}}', data, { partials });
    },
  },
  {
    name: 'keeps endless partial recursion an error',
    run: async ({ load }) => {
      const { render } = await lib(load);
      return [attempt(() => render('{{> a}}', {}, { partials: { a: 'x{{> a}}' } })), attempt(() => render('{{> a}}', {}, { partials: { a: '{{> b}}', b: '{{> a}}' } }))];
    },
  },
  {
    name: 'an option element built from a partial in a loop',
    run: async ({ load }) => {
      const { render } = await lib(load);
      const partials = { opt: "<option value='{{v}}'{{#if sel}} selected{{/if}}>{{label}}</option>" };
      return render('<select>{{#each opts}}{{> opt}}{{/each}}</select>', { v: 'root', opts: [{ v: "o'1", label: 'One & only', sel: true }, { v: 'o2', label: '<Two>', sel: false }] }, { partials });
    },
  },
  {
    name: 'keeps values, paths and falsy values',
    run: async ({ load }) => {
      const { render } = await lib(load);
      return render('{{a.b.c}}|{{a.x}}|{{n}}|{{f}}|{{e}}|{{#each xs}}{{this.k}}{{/each}}|{{xs.1.k}}', { a: { b: { c: 'deep' } }, n: 0, f: false, e: '', xs: [{ k: 1 }, { k: 2 }] });
    },
  },
  {
    name: 'keeps broken templates and unknown names an error',
    run: async ({ load }) => {
      const { render } = await lib(load);
      return [attempt(() => render('{{#if x}}open', {})), attempt(() => render('{{/if}}', {})), attempt(() => render('{{> nope}}', {})), attempt(() => render('{{nope x}}', { x: 1 })), attempt(() => render('{{else}}', {}))];
    },
  },
  {
    name: 'a compiled template renders again with other data',
    run: async ({ load }) => {
      const { compile } = await lib(load);
      const partials = { li: '<li>{{.}}</li>' };
      const template = compile('{{#each xs}}{{> li this}}{{/each}}', { partials });
      return [template({ xs: ["a'"] }), template({ xs: ['b', 'c'] }), template({ xs: [] })];
    },
  },
];
