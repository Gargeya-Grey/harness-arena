import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/index.mjs';

test('emphasis and strong', () => {
  assert.equal(render('*a* and **b** and ***c***'), '<p><em>a</em> and <strong>b</strong> and <em><strong>c</strong></em></p>\n');
  assert.equal(render('snake_case_name and 2 * 3 * 4'), '<p>snake_case_name and 2 * 3 * 4</p>\n');
});

test('code spans and escapes', () => {
  assert.equal(render('use `a < b` here \\*not em\\*'), '<p>use <code>a &lt; b</code> here *not em*</p>\n');
  assert.equal(render('1 & 2 <b>'), '<p>1 &amp; 2 &lt;b&gt;</p>\n');
});

test('links and images', () => {
  assert.equal(render('[text](/url "title") ![alt](/img.png)'), '<p><a href="/url" title="title">text</a> <img src="/img.png" alt="alt"></p>\n');
  assert.equal(render('[docs] and [more][m]\n\n[docs]: /docs\n[m]: /more'), '<p><a href="/docs">docs</a> and <a href="/more">more</a></p>\n');
});

test('line breaks', () => {
  assert.equal(render('one  \ntwo\\\nthree\nfour'), '<p>one<br>\ntwo<br>\nthree\nfour</p>\n');
});
