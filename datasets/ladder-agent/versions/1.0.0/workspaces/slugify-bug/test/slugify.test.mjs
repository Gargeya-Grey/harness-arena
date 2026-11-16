import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.mjs';

test('lowercases and joins words with one dash', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('drops punctuation and extra spaces', () => {
  assert.equal(slugify('  Hello,   World!  '), 'hello-world');
});

test('keeps digits', () => {
  assert.equal(slugify('Top 10 Tips'), 'top-10-tips');
});
