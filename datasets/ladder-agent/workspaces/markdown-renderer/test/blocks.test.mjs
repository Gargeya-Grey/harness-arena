import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/index.mjs';

test('paragraphs, headings and breaks', () => {
  assert.equal(render('# Title\n\nsome text\nmore text\n\n## Sub ##'), '<h1>Title</h1>\n<p>some text\nmore text</p>\n<h2>Sub</h2>\n');
  assert.equal(render('Title\n=====\n\n---'), '<h1>Title</h1>\n<hr>\n');
  assert.equal(render(''), '');
});

test('code blocks', () => {
  assert.equal(render('```js\nlet a = 1 < 2;\n```'), '<pre><code class="language-js">let a = 1 &lt; 2;\n</code></pre>\n');
  assert.equal(render('    indented\n    code'), '<pre><code>indented\ncode\n</code></pre>\n');
});

test('block quotes nest', () => {
  assert.equal(render('> one\n> > two\n\nthree'), '<blockquote>\n<p>one</p>\n<blockquote>\n<p>two</p>\n</blockquote>\n</blockquote>\n<p>three</p>\n');
});

test('tight and loose lists', () => {
  assert.equal(render('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n');
  assert.equal(render('- a\n\n- b'), '<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>\n');
  assert.equal(render('3. a\n4. b'), '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>\n');
});

test('nested lists', () => {
  assert.equal(render('- a\n  - b\n- c'), '<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n<li>c</li>\n</ul>\n');
});
