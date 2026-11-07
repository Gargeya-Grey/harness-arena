import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, render, SafeString } from '../src/index.mjs';

test('values are escaped, triple braces are not', () => {
  assert.equal(render('<p>{{x}}</p>', { x: '<b>&"' }), '<p>&lt;b&gt;&amp;&quot;</p>');
  assert.equal(render('{{{x}}}', { x: '<b>' }), '<b>');
});

test('paths, missing values and falsy values', () => {
  const ctx = { user: { name: 'Ann' }, zero: 0, no: false, empty: '' };
  assert.equal(render('{{user.name}}|{{user.age}}|{{zero}}|{{no}}|{{empty}}|{{nope.deeper}}', ctx), 'Ann||0|false||');
});

test('comments and text', () => {
  assert.equal(render('a{{! ignore me }}b', {}), 'ab');
});

test('each with @index, @first and @last', () => {
  const out = render('{{#each xs}}{{@index}}:{{.}}{{#if @first}}!{{/if}}{{#if @last}}.{{/if}} {{/each}}', { xs: ['a', 'b', 'c'] });
  assert.equal(out, '0:a! 1:b 2:c. ');
});

test('each over an object gives @key; each with else', () => {
  assert.equal(render('{{#each o}}{{@key}}={{.}};{{/each}}', { o: { a: 1, b: 2 } }), 'a=1;b=2;');
  assert.equal(render('{{#each xs}}x{{else}}none{{/each}}', { xs: [] }), 'none');
});

test('if, else and unless', () => {
  assert.equal(render('{{#if ok}}yes{{else}}no{{/if}}', { ok: true }), 'yes');
  assert.equal(render('{{#if ok}}yes{{else}}no{{/if}}', { ok: false }), 'no');
  assert.equal(render('{{#unless ok}}hidden{{/unless}}', { ok: false }), 'hidden');
});

test('nested loops', () => {
  const out = render('{{#each rows}}[{{#each this}}{{.}}{{/each}}]{{/each}}', { rows: [['a', 'b'], ['c']] });
  assert.equal(out, '[ab][c]');
});

test('helpers', () => {
  assert.equal(render('{{upper name}} {{join xs ", "}}', { name: 'ann', xs: [1, 2] }), 'ANN 1, 2');
  assert.equal(render('{{safe html}}', { html: '<i>' }), '<i>');
  assert.equal(render('{{shout name}}', { name: 'ann' }, { helpers: { shout: (v) => `${v}!` } }), 'ann!');
  assert.throws(() => render('{{nothing x}}', { x: 1 }), /unknown helper/);
});

test('a partial with the same context, and one with an argument', () => {
  const partials = { name: '<b>{{name}}</b>', card: '{{title}}' };
  assert.equal(render('{{> name}}', { name: 'Ann' }, { partials }), '<b>Ann</b>');
  assert.equal(render('{{> card item}}', { item: { title: 'T' } }, { partials }), 'T');
  assert.throws(() => render('{{> missing}}', {}, { partials }), /unknown partial/);
});

test('a compiled template can be used many times', () => {
  const template = compile('Hi {{who}}');
  assert.equal(template({ who: 'a' }), 'Hi a');
  assert.equal(template({ who: 'b' }), 'Hi b');
  assert.ok(new SafeString('x') instanceof SafeString);
});

test('broken templates are refused', () => {
  assert.throws(() => compile('{{#if x}}open'), /unclosed/);
  assert.throws(() => compile('{{/if}}'), /unexpected/);
});
