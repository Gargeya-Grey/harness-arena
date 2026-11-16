import test from 'node:test';
import assert from 'node:assert/strict';
import { SqlError } from '../src/index.mjs';
import { sample } from './helpers.mjs';

test('a select list gives the declared column names', () => {
  const result = sample().query('SELECT NAME, Age FROM pets');
  assert.deepEqual(result.columns, ['name', 'age']);
  assert.equal(result.rows.length, 4);
});

test('WHERE keeps only the rows for which the condition is true', () => {
  const result = sample().query("SELECT id FROM pets WHERE kind = 'dog' AND age > 1");
  assert.deepEqual(result.rows, [[1]]);
});

test('a NULL comparison is not true', () => {
  const db = sample();
  assert.deepEqual(db.query('SELECT id FROM pets WHERE age <> 5').rows, [[2], [4]]);
  assert.deepEqual(db.query('SELECT id FROM pets WHERE age IS NULL').rows, [[3]]);
});

test('ORDER BY, LIMIT and OFFSET', () => {
  const result = sample().query('SELECT name FROM pets ORDER BY age DESC LIMIT 2 OFFSET 1');
  assert.deepEqual(result.rows, [['tom'], ['kiwi']]);
});

test('an inner join and a left join', () => {
  const db = sample();
  assert.deepEqual(db.query('SELECT name, who FROM pets JOIN owners ON pets.owner = owners.id').rows, [['rex', 'ann'], ['tom', 'ann'], ['bella', 'raj']]);
  assert.deepEqual(db.query('SELECT who, name FROM owners o LEFT JOIN pets p ON p.owner = o.id ORDER BY 1, 2').rows, [['ann', 'rex'], ['ann', 'tom'], ['lee', null], ['raj', 'bella']]);
});

test('GROUP BY with aggregates', () => {
  const result = sample().query('SELECT kind, COUNT(*) AS n, SUM(age) FROM pets GROUP BY kind ORDER BY n DESC, kind');
  assert.deepEqual(result.columns, ['kind', 'n', 'col3']);
  assert.deepEqual(result.rows, [['dog', 2, 5], ['bird', 1, 1], ['cat', 1, 3]]);
});

test('a syntax error has the position of the token', () => {
  assert.throws(
    () => sample().query('SELECT FROM pets'),
    (error) => error instanceof SqlError && error.code === 'syntax' && error.position === 7,
  );
});

test('an unknown column is an error even on an empty result', () => {
  assert.throws(() => sample().query('SELECT nope FROM pets WHERE 1 = 2'), (error) => error.code === 'no-column');
});
