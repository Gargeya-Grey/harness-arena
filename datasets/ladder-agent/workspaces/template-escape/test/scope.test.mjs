import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/index.mjs';

test('../ reaches the context outside a loop', () => {
  const out = render('{{#each items}}{{../title}}:{{name}} {{/each}}', { title: 'T', items: [{ name: 'a' }, { name: 'b' }] });
  assert.equal(out, 'T:a T:b ');
});

test('../../ reaches two loops out', () => {
  const ctx = { site: 'S', groups: [{ name: 'g', items: [{ n: 1 }, { n: 2 }] }] };
  assert.equal(render('{{#each groups}}{{#each items}}{{../../site}}/{{../name}}/{{n}} {{/each}}{{/each}}', ctx), 'S/g/1 S/g/2 ');
});

test('each item gets its own @index in a nested loop', () => {
  const out = render('{{#each rows}}{{#each cells}}{{@index}}{{/each}};{{/each}}', { rows: [{ cells: [1, 2, 3] }, { cells: [1, 2] }] });
  assert.equal(out, '012;01;');
});
