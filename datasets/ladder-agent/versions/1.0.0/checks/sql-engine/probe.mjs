// Hidden probes for ladder-agent-sql-engine; expected.json holds the answers.
const lib = (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};

const DATA = () => ({
  emp: {
    columns: ['id', 'Name', 'dept', 'salary', 'boss', 'city'],
    rows: [
      [1, 'Ada', 10, 5200, null, 'Oslo'],
      [2, 'Ben', 10, 4100, 1, 'Rome'],
      [3, 'Cy', 20, 4100, 1, null],
      [4, 'Dee', 20, null, 3, 'Oslo'],
      [5, 'Eli', null, 3900, 3, 'Rome'],
      [6, 'Fay', 30, 6100, 2, 'Oslo'],
      [7, 'Gus', 10, 3300, 2, 'Rome'],
    ],
  },
  dept: { columns: ['id', 'title', 'floor'], rows: [[10, 'Ops', 1], [20, 'Dev', 2], [30, 'Law', null], [40, 'Art', 3]] },
  t: { columns: ['a', 'b', 's'], rows: [[1, 2, 'x'], [null, 3, 'y'], [2, null, null], [3, 3, 'xy'], [null, null, '']] },
  mixed: { columns: ['k'], rows: [[1], ['1'], [true], [1], [null], [null]] },
  words: { columns: ['w'], rows: [['b'], ['B'], ['a'], ['Ab'], [''], ['a b'], ['_x'], ['10'], ['9']] },
  flags: { columns: ['f'], rows: [[true], [false], [null], [true]] },
  empty: { columns: ['v'], rows: [] },
  one: { columns: ['x'], rows: [[0]] },
});

async function q(load, sql, data = DATA()) {
  const { Database } = await lib(load);
  try {
    return new Database(data).query(sql);
  } catch (error) {
    return { error: error.code ?? error.constructor.name, ...(error.position !== undefined ? { position: error.position } : {}) };
  }
}
const rows = async (load, sql, data) => {
  const r = await q(load, sql, data);
  return r.error ? r : r.rows;
};
const many = async (load, list, data) => {
  const out = [];
  for (const sql of list) out.push(await rows(load, sql, data));
  return out;
};
const one = (expression) => `SELECT ${expression} FROM one`;
const ones = async (load, list) => {
  const out = [];
  for (const e of list) {
    const r = await rows(load, one(e));
    out.push(r.error ? r : r[0][0]);
  }
  return out;
};

export const probes = [
  {
    name: 'keeps the exports and the table store',
    run: async ({ load }) => {
      const mod = await lib(load);
      const db = new mod.Database({ T1: { columns: ['A', 'b'], rows: [[1, 2]] } });
      return { exports: Object.keys(mod).sort(), table: db.getTable('t1').columns, none: db.getTable('zz') ?? null };
    },
  },
  {
    name: 'keywords names and tables ignore case and the output keeps the declared spelling',
    run: async ({ load }) => {
      const a = await q(load, 'select NAME, Dept as Boss2, ID from EMP where ID = 2');
      const b = await q(load, 'SeLeCt e.NaMe aS WhO FrOm eMp E wHeRe E.Id = 3');
      return [a, b];
    },
  },
  {
    name: 'comments semicolons and doubled quotes',
    run: async ({ load }) => {
      return many(load, ["SELECT name -- the name\n FROM emp -- table\n WHERE id = 1;", "SELECT 'it''s', '', '''' FROM one;", "SELECT\t\r\n1\r\nFROM\none", "SELECT 1 FROM one;;", "SELECT 1 FROM one -- last"]);
    },
  },
  {
    name: 'syntax errors in the statement structure have the position of the first bad token',
    run: async ({ load }) => {
      return many(load, ['SELECT FROM emp', 'SELECT id FROM', 'SELECT id emp', 'FROM emp', 'SELECT id, FROM emp', 'SELECT id FROM emp WHERE', 'SELECT id FROM emp ORDER id', 'SELECT id FROM emp GROUP BY', 'SELECT id FROM emp LIMIT', 'SELECT id FROM emp LIMIT 1.5', 'SELECT id FROM emp OFFSET 1', 'SELECT id FROM emp LIMIT 1 OFFSET', 'SELECT id FROM emp LIMIT -1', 'SELECT id FROM emp e JOIN dept', 'SELECT id FROM emp JOIN dept d USING (id)', 'SELECT id FROM emp CROSS JOIN dept', 'SELECT id FROM emp, dept', 'SELECT id FROM emp WHERE id = 1 WHERE id = 2']);
    },
  },
  {
    name: 'syntax errors in expressions have the position of the first bad token',
    run: async ({ load }) => {
      return many(load, [one('1 = 2 = 3'), one('1 < 2 < 3'), one('x NOT 5'), one('x IN ()'), one('x IN 1'), one('ABS()'), one('(1 + 2'), one('1 +'), one('.5'), one('1.'), one('1 @ 2'), one("'open"), one('1 ! 2'), one('x NOT'), one('x BETWEEN 1 2'), one('x IS 5'), one('CASE END'), one('CASE WHEN x THEN 1'), one('SUM(*)'), one('SUM(DISTINCT x)'), one('COUNT(DISTINCT *)'), one('COUNT()'), one('1 + x.*'), one('select')]);
    },
  },
  {
    name: 'a select alias needs AS and keywords are never names',
    run: async ({ load }) => {
      return many(load, ['SELECT id x FROM emp', 'SELECT id AS FROM emp', 'SELECT id AS select FROM emp', 'SELECT id FROM select', 'SELECT left FROM emp', 'SELECT id FROM emp e WHERE e.id = 1', 'SELECT id FROM emp AS e WHERE e.id = 1', 'SELECT id FROM emp as WHERE id = 1', 'SELECT 1 + FROM emp', 'SELECT emp.* FROM emp WHERE id = 1', 'SELECT id FROM emp ORDER BY id DESC ASC']);
    },
  },
  {
    name: 'arithmetic precedence and associativity',
    run: async ({ load }) => ones(load, ['2 + 3 * 4', '(2 + 3) * 4', '10 - 4 - 3', '100 / 10 / 5', '2 * 3 % 4', '7 % 4 * 2', '-2 * -3', '- - 4', '1 - -1', '10 / 4', '-7 % 3', '7 % -3', '2 - 3 * 4 + 5', '-(2 + 3)', '1.5 + 2.25', '0.1 + 0.2', '3 * 0.5']),
  },
  {
    name: 'boolean precedence puts NOT above AND above OR and comparison above NOT',
    run: async ({ load }) => ones(load, ['NOT 1 = 2', 'NOT TRUE OR TRUE', 'TRUE OR FALSE AND FALSE', 'FALSE AND FALSE OR TRUE', 'NOT FALSE AND FALSE', 'NOT NOT TRUE', '1 = 1 AND 2 = 2 OR 3 = 4', "NOT 'a' = 'b' AND 1 < 2", '1 + 1 = 2 AND NOT 2 * 2 = 5', 'NOT 1 IN (2, 3)', 'NOT 5 BETWEEN 1 AND 3 OR FALSE', "NOT 'ab' LIKE 'a%'", '1 = 1 IS NULL']),
  },
  {
    name: 'the concatenation operator binds like plus and minus',
    run: async ({ load }) => ones(load, ["'a' || 'b' || 'c'", "'a' || 'b' = 'ab'", "'a' || LOWER('B') || UPPER('c')", "'x' || '' || 'y'", "1 + 2 || 'a'", "'a' || 1", "'a' || NULL", "NULL || NULL", "'1' || '2' = '12'"]),
  },
  {
    name: 'three valued logic truth tables',
    run: async ({ load }) => {
      const v = ['TRUE', 'FALSE', 'NULL'];
      const out = { and: [], or: [], not: [] };
      for (const a of v) {
        out.not.push((await ones(load, [`NOT ${a}`]))[0]);
        for (const b of v) {
          out.and.push((await ones(load, [`${a} AND ${b}`]))[0]);
          out.or.push((await ones(load, [`${a} OR ${b}`]))[0]);
        }
      }
      return out;
    },
  },
  {
    name: 'NULL propagates through arithmetic comparison and concatenation but IS NULL never gives NULL',
    run: async ({ load }) => ones(load, ['NULL = NULL', 'NULL <> 1', '1 + NULL', 'NULL * 0', 'NULL < 5', "NULL || 'a'", 'NULL IS NULL', '1 IS NOT NULL', 'NULL IS NOT NULL', "'' IS NULL", 'NULL + 1 > 0', 'NULL / 0', 'NULL % 0', "NULL + 'x'", "NULL = 'x'", 'ABS(NULL)', 'LENGTH(NULL)', 'UPPER(NULL)', '-NULL', 'NOT NULL']),
  },
  {
    name: 'IN follows the NULL rules and stops at the first equal element',
    run: async ({ load }) => ones(load, ['2 IN (1, 2, 3)', '4 IN (1, 2, 3)', '4 IN (1, NULL, 3)', '1 IN (1, NULL)', 'NULL IN (1, 2)', 'NULL IN (NULL)', '4 NOT IN (1, NULL, 3)', '4 NOT IN (1, 3)', '1 NOT IN (1, NULL)', 'NULL NOT IN (1)', "'a' IN ('b', 'a')", '1 IN (1, 1 / 0)', '2 IN (1, 1 / 0)', '1 IN (1, \'a\')', '2 IN (1, \'a\')', 'TRUE IN (FALSE, TRUE)']),
  },
  {
    name: 'a NOT IN list with a NULL keeps no rows',
    run: async ({ load }) =>
      many(load, ['SELECT a FROM t WHERE a NOT IN (1, NULL)', 'SELECT a FROM t WHERE a NOT IN (1, 5)', 'SELECT a FROM t WHERE a IN (1, NULL, 3)', 'SELECT s FROM t WHERE NOT (a IN (1, 2))', 'SELECT s FROM t WHERE a = b', 'SELECT s FROM t WHERE NOT a = b']),
  },
  {
    name: 'BETWEEN is two comparisons joined by AND',
    run: async ({ load }) => ones(load, ['5 BETWEEN 1 AND 10', '1 BETWEEN 1 AND 1', '3 BETWEEN 5 AND 1', '5 NOT BETWEEN 1 AND 10', '0 NOT BETWEEN 1 AND 10', 'NULL BETWEEN 1 AND 2', '5 BETWEEN NULL AND 10', '5 BETWEEN NULL AND 3', '5 BETWEEN 6 AND NULL', '5 NOT BETWEEN NULL AND 3', "'b' BETWEEN 'a' AND 'c'", '2 + 2 BETWEEN 1 + 1 AND 2 * 2', '3 BETWEEN 1 AND 2 + 5', '1 BETWEEN 2 AND 1 / 0', "1 BETWEEN 0 AND 'z'", '2 BETWEEN 1 AND 3 AND 4 BETWEEN 5 AND 6']),
  },
  {
    name: 'LIKE matches the whole string with percent and underscore and nothing else',
    run: async ({ load }) =>
      ones(load, ["'abc' LIKE 'abc'", "'abc' LIKE 'ab'", "'abc' LIKE 'a%'", "'abc' LIKE '%c'", "'abc' LIKE '%b%'", "'abc' LIKE '%'", "'' LIKE '%'", "'' LIKE '_'", "'abc' LIKE 'a_c'", "'abc' LIKE '___'", "'abc' LIKE '____'", "'ABC' LIKE 'abc'", "'a.c' LIKE 'a.c'", "'abc' LIKE 'a.c'", "'a%c' LIKE 'a\\%c'", "'a_c' LIKE 'a_c'", "'abcabc' LIKE '%abc'", "'aXbXc' LIKE 'a%b%c'", "'abc' LIKE '%%%%a%%%%c%%'", "'abc' NOT LIKE 'a%'", "'abc' NOT LIKE 'b%'", 'NULL LIKE \'a\'', "'a' LIKE NULL", "NULL NOT LIKE NULL", "'ab\ncd' LIKE 'ab_cd'", "'mississippi' LIKE 'm%iss%ppi'", "'mississippi' LIKE 'm%iss%ppx'"]),
  },
  {
    name: 'LIKE needs strings',
    run: async ({ load }) => ones(load, ["1 LIKE '1'", "'1' LIKE 1", 'TRUE LIKE TRUE']),
  },
  {
    name: 'CASE picks the first true condition and evaluates only the chosen result',
    run: async ({ load }) => {
      const r = await ones(load, ['CASE WHEN 1 = 2 THEN 1 WHEN 2 = 2 THEN 2 WHEN 3 = 3 THEN 3 END', 'CASE WHEN FALSE THEN 1 END', 'CASE WHEN NULL THEN 1 ELSE 2 END', 'CASE WHEN x = 0 THEN 0 ELSE 1 / x END', 'CASE WHEN x <> 0 THEN 1 / x ELSE -1 END', 'CASE WHEN TRUE THEN 1 WHEN 1 / 0 = 1 THEN 2 END', "CASE WHEN 1 THEN 1 END", 'CASE WHEN FALSE THEN 1 WHEN 1 THEN 2 END', "CASE WHEN TRUE THEN 'a' ELSE 1 / 0 END", 'CASE WHEN NULL THEN 1 END']);
      const grouped = await rows(load, "SELECT id, CASE WHEN salary IS NULL THEN 'none' WHEN salary >= 5000 THEN 'high' WHEN salary >= 4000 THEN 'mid' ELSE 'low' END FROM emp");
      return { r, grouped };
    },
  },
  {
    name: 'COALESCE stops at the first value and the string functions work on strings only',
    run: async ({ load }) => ones(load, ['COALESCE(NULL, NULL, 3, 1 / 0)', 'COALESCE(NULL, NULL)', 'COALESCE(5)', 'COALESCE(NULL, 1 / 0)', "COALESCE(NULL, 'a', 'b')", 'COALESCE(0, 1)', "UPPER('mIx3')", "LOWER('MiX3')", "LENGTH('abc')", "LENGTH('')", "LENGTH('\u{1F600}')", 'ABS(-3.5)', 'ABS(0)', 'ABS(-0)', 'abs(2 - 5)', "ABS('x')", 'LENGTH(5)', 'UPPER(TRUE)', 'ABS(1, 2)', 'UPPER()', 'NOPE(1)', 'COALESCE(1, \'a\')']),
  },
  {
    name: 'operations on the wrong types are type errors',
    run: async ({ load }) => ones(load, ["1 + 'a'", "'a' - 1", "'a' * 'b'", 'TRUE + 1', "-'a'", '-TRUE', "1 < 'a'", "'a' = 1", 'TRUE = 1', 'TRUE < FALSE', "'a' < 'b'", 'FALSE < TRUE', 'NOT 1', "NOT 'a'", '1 AND TRUE', "TRUE OR 'x'", 'NULL AND 1', 'NULL OR 0', "'a' IN (1)", '1 IS NULL']),
  },
  {
    name: 'AND and OR evaluate both operands so an error on either side is raised',
    run: async ({ load }) => ones(load, ['FALSE AND 1 / 0 = 1', 'TRUE OR 1 / 0 = 1', '1 / 0 = 1 AND FALSE', "FALSE AND 'a' < 1", 'NULL AND 1 / 0 = 1', 'FALSE AND NULL', 'TRUE OR NULL', 'FALSE AND 1 + 1 = 2']),
  },
  {
    name: 'division by zero is raised after the NULL check and only when evaluated',
    run: async ({ load }) => {
      const direct = await ones(load, ['1 / 0', '1 % 0', '0 / 5', '0.0 / 0', 'NULL / 0', '5 / 0 * NULL', '1 / (2 - 2)', '5 / 2', '-5 / 2', '5 % 2.5', '1 / 3 * 3']);
      const lazy = await many(load, ['SELECT 1 / 0 FROM empty', 'SELECT v FROM empty WHERE 1 / 0 = 1', 'SELECT 1 / x FROM one WHERE x <> 0', 'SELECT id / (dept - 10) FROM emp WHERE id = 1', 'SELECT id / (dept - 10) FROM emp WHERE id = 6']);
      return { direct, lazy };
    },
  },
  {
    name: 'the select list names columns by alias then declared name then position',
    run: async ({ load }) => {
      const out = [];
      for (const sql of ['SELECT id, NAME, e.dept, e.salary AS Pay FROM emp e', 'SELECT 1 + 1, dept, COUNT(*) FROM emp GROUP BY dept', 'SELECT *, 1 + 1 FROM dept', 'SELECT 1 AS One, 2 AS one FROM one', 'SELECT dept.*, 7 FROM dept LIMIT 1', 'SELECT id AS id FROM dept', 'SELECT x + 1 AS Total, x FROM one', "SELECT -id, id + 0, ABS(id), 'x', NULL, id > 1 FROM dept"]) {
        const r = await q(load, sql);
        out.push(r.error ? r : r.columns);
      }
      return out;
    },
  },
  {
    name: 'star expands every table in FROM order and t.star one table',
    run: async ({ load }) => {
      const a = await q(load, 'SELECT * FROM dept d JOIN emp e ON e.dept = d.id WHERE e.id <= 2');
      const b = await q(load, 'SELECT e.*, d.title FROM dept d JOIN emp e ON e.dept = d.id WHERE e.id <= 2');
      const c = await q(load, 'SELECT d.*, 0 FROM emp e LEFT JOIN dept d ON e.dept = d.id WHERE e.id IN (4, 5)');
      const d = await q(load, 'SELECT zz.* FROM emp');
      const e = await q(load, 'SELECT emp.* FROM emp e');
      return { a, b, c, d: d.error, e: e.error };
    },
  },
  {
    name: 'comparison and logic results come out as booleans and NULL',
    run: async ({ load }) => rows(load, 'SELECT salary > 4000, salary IS NULL, NOT (salary > 4000), city LIKE \'O%\', dept IN (10, 20) FROM emp'),
  },
  {
    name: 'a result does not share arrays with the stored tables',
    run: async ({ load }) => {
      const { Database } = await lib(load);
      const db = new Database(DATA());
      const first = db.query('SELECT id, name FROM emp');
      first.rows[0][1] = 'changed';
      first.rows.pop();
      const star = db.query('SELECT * FROM dept');
      star.rows[0][0] = 99;
      return [db.query('SELECT name FROM emp WHERE id = 1').rows, db.query('SELECT id FROM dept LIMIT 1').rows, db.query('SELECT id FROM emp').rows.length];
    },
  },
  {
    name: 'WHERE keeps true rows and drops false and NULL rows',
    run: async ({ load }) =>
      many(load, ["SELECT id FROM emp WHERE salary > 4000", "SELECT id FROM emp WHERE NOT salary > 4000", "SELECT id FROM emp WHERE city = 'Oslo' OR salary < 4000", "SELECT id FROM emp WHERE dept IS NULL OR city IS NULL", "SELECT id FROM emp WHERE city LIKE '%o%' AND salary IS NOT NULL", "SELECT id FROM emp WHERE TRUE", "SELECT id FROM emp WHERE NULL", "SELECT id FROM emp WHERE id % 2 = 0 AND name <> 'Dee'", "SELECT id FROM emp WHERE 1", "SELECT id FROM emp WHERE 'x'", "SELECT id FROM emp WHERE salary"]),
  },
  {
    name: 'an inner join pairs rows in nested loop order',
    run: async ({ load }) =>
      many(load, ['SELECT e.id, d.id FROM emp e JOIN dept d ON e.dept = d.id', 'SELECT e.id, d.title FROM emp e INNER JOIN dept d ON e.dept = d.id AND d.floor IS NOT NULL', 'SELECT a.id, b.id FROM dept a JOIN dept b ON a.id < b.id', 'SELECT a.id, b.id FROM dept a JOIN dept b ON a.floor = b.floor', 'SELECT d.id, e.id FROM dept d JOIN emp e ON e.salary > d.floor * 2000 WHERE d.id = 10', 'SELECT t.a, u.a FROM t JOIN t u ON t.a = u.a']),
  },
  {
    name: 'a left join keeps rows without a partner once with NULL fill',
    run: async ({ load }) =>
      many(load, ['SELECT d.id, e.id FROM dept d LEFT JOIN emp e ON e.dept = d.id', 'SELECT d.title, e.name FROM dept d LEFT OUTER JOIN emp e ON e.dept = d.id AND e.salary > 4500', 'SELECT e.id, d.title FROM emp e LEFT JOIN dept d ON e.dept = d.id WHERE d.id IS NULL', 'SELECT e.id, d.title FROM emp e LEFT JOIN dept d ON e.dept = d.id WHERE d.floor IS NULL', 'SELECT e.id, d.title FROM emp e LEFT JOIN dept d ON NULL', 'SELECT e.id, d.title FROM emp e LEFT JOIN dept d ON FALSE WHERE e.id < 3', 'SELECT t.a, u.b FROM t LEFT JOIN t u ON t.a = u.a ORDER BY 1, 2']),
  },
  {
    name: 'joins chain left to right and the ON of a join sees only the tables before it',
    run: async ({ load }) => {
      const chain = await rows(load, 'SELECT e.name, m.name, d.title FROM emp e LEFT JOIN emp m ON e.boss = m.id JOIN dept d ON e.dept = d.id ORDER BY e.id');
      const mixed = await rows(load, 'SELECT d.id, e.id, m.id FROM dept d LEFT JOIN emp e ON e.dept = d.id LEFT JOIN emp m ON m.boss = e.id WHERE d.id <= 20 ORDER BY 1, 2, 3');
      const later = await q(load, 'SELECT 1 FROM emp e JOIN dept d ON d.id = x.id JOIN emp x ON x.id = e.id');
      const later2 = await q(load, 'SELECT 1 FROM emp e JOIN dept d ON x.id = e.id JOIN emp x ON x.id = e.id');
      const self = await rows(load, 'SELECT e.name FROM emp e JOIN emp b ON e.boss = b.id WHERE b.city = \'Oslo\'');
      return { chain, mixed, later: later.error, later2: later2.error, self };
    },
  },
  {
    name: 'names resolve to one table or fail as unknown or ambiguous',
    run: async ({ load }) =>
      many(load, ['SELECT id FROM emp JOIN dept ON emp.dept = dept.id', 'SELECT emp.id, dept.id FROM emp JOIN dept ON emp.dept = dept.id WHERE emp.id = 1', 'SELECT title FROM emp JOIN dept ON emp.dept = dept.id WHERE emp.id = 1', 'SELECT nope FROM emp', 'SELECT emp.nope FROM emp', 'SELECT x.id FROM emp', 'SELECT emp.id FROM emp e', 'SELECT e.id FROM emp e WHERE emp.id = 1', 'SELECT id FROM emp e JOIN emp f ON e.id = f.id', 'SELECT 1 FROM emp JOIN emp ON TRUE', 'SELECT 1 FROM emp e JOIN dept e ON TRUE', 'SELECT 1 FROM nope', 'SELECT 1 FROM emp JOIN nope ON TRUE', 'SELECT * FROM empty WHERE zz = 1', 'SELECT zz FROM empty', 'SELECT a FROM t, empty']),
  },
  {
    name: 'a name error is found on an empty table and before any data error',
    run: async ({ load }) =>
      many(load, ['SELECT v FROM empty WHERE nope = 1', 'SELECT nope FROM empty', 'SELECT 1 / 0, nope FROM one', 'SELECT 1 / 0 FROM empty WHERE nope = 1', 'SELECT FOO(1) FROM empty', 'SELECT ABS(1, 2) FROM empty', 'SELECT ABS(1, 2), FOO(1) FROM one', 'SELECT 1 FROM empty e JOIN one o ON e.zzz = o.x', 'SELECT COALESCE() FROM empty']),
  },
  {
    name: 'the clause order decides which error is reported',
    run: async ({ load }) =>
      many(load, ['SELECT FOO(1) FROM emp WHERE nope = 1', 'SELECT nope FROM emp WHERE COUNT(*) > 1', 'SELECT name, COUNT(*) FROM emp GROUP BY zz', 'SELECT id, FOO(1) FROM emp GROUP BY dept', 'SELECT dept, name FROM emp GROUP BY dept HAVING nope > 1', 'SELECT dept FROM emp GROUP BY dept HAVING SUM(nope) > 1 ORDER BY FOO(1)', 'SELECT dept FROM emp GROUP BY dept ORDER BY name', 'SELECT dept FROM emp GROUP BY dept ORDER BY 9', 'SELECT COUNT(*) FROM emp JOIN nope ON nope.x = 1', 'SELECT 1 FROM emp JOIN dept ON COUNT(*) > 1 JOIN nope ON TRUE', 'SELECT SUM(nope), name FROM emp', 'SELECT name, SUM(nope) FROM emp']),
  },
  {
    name: 'aggregate functions count sum average minimum and maximum',
    run: async ({ load }) => rows(load, 'SELECT COUNT(*), COUNT(salary), COUNT(city), SUM(salary), AVG(salary), MIN(salary), MAX(salary), MIN(name), MAX(name), COUNT(DISTINCT salary), COUNT(DISTINCT dept) FROM emp'),
  },
  {
    name: 'aggregates over no rows and over only NULL values',
    run: async ({ load }) => {
      const none = await rows(load, 'SELECT COUNT(*), COUNT(v), SUM(v), AVG(v), MIN(v), MAX(v), COUNT(DISTINCT v) FROM empty');
      const nulls = await rows(load, 'SELECT COUNT(*), COUNT(a), SUM(a), AVG(a), MIN(a), MAX(a) FROM t WHERE a IS NULL');
      const filtered = await rows(load, 'SELECT COUNT(*), SUM(salary) FROM emp WHERE id > 100');
      const grouped = await rows(load, 'SELECT dept, COUNT(*) FROM emp WHERE id > 100 GROUP BY dept');
      const having = await many(load, ['SELECT COUNT(*) FROM empty HAVING COUNT(*) = 0', 'SELECT COUNT(*) FROM empty HAVING COUNT(*) > 0', 'SELECT 1 FROM empty HAVING TRUE', 'SELECT COUNT(*), 5 FROM emp WHERE id < 0 HAVING SUM(salary) IS NULL']);
      return { none, nulls, filtered, grouped, having };
    },
  },
  {
    name: 'sum adds in row order with plain addition and average divides by the non NULL count',
    run: async ({ load }) => {
      const data = { f: { columns: ['x'], rows: [[0.1], [0.2], [null], [0.3]] }, g: { columns: ['x'], rows: [[1], [2]] } };
      return [await rows(load, 'SELECT SUM(x), AVG(x), COUNT(x), COUNT(*) FROM f', data), await rows(load, 'SELECT AVG(x), SUM(x) / COUNT(*) FROM g', data)];
    },
  },
  {
    name: 'min max and sum check their value types',
    run: async ({ load }) =>
      many(load, ['SELECT MIN(w), MAX(w) FROM words', 'SELECT MIN(f), MAX(f) FROM flags', 'SELECT MIN(k) FROM mixed', 'SELECT MIN(k), MAX(k), SUM(k), AVG(k), COUNT(k) FROM mixed WHERE k IS NULL', 'SELECT SUM(w) FROM words', 'SELECT AVG(f) FROM flags', 'SELECT SUM(k) FROM mixed', 'SELECT COUNT(w), COUNT(DISTINCT w) FROM words', "SELECT MAX(salary), MIN(salary), MAX(city) FROM emp WHERE city = 'Oslo'"]),
  },
  {
    name: 'count distinct treats numbers strings and booleans as different values',
    run: async ({ load }) => rows(load, 'SELECT COUNT(*), COUNT(k), COUNT(DISTINCT k) FROM mixed'),
  },
  {
    name: 'groups come in the order of their first row and NULL is one group',
    run: async ({ load }) =>
      many(load, ['SELECT dept, COUNT(*), SUM(salary) FROM emp GROUP BY dept', 'SELECT city, COUNT(*) FROM emp GROUP BY city', 'SELECT dept, city, COUNT(*) FROM emp GROUP BY dept, city', 'SELECT city, dept, COUNT(*) FROM emp GROUP BY city, dept', 'SELECT a, COUNT(*) FROM t GROUP BY a', 'SELECT e.dept, COUNT(*) FROM emp e GROUP BY e.dept', 'SELECT d.title, COUNT(e.id) FROM dept d LEFT JOIN emp e ON e.dept = d.id GROUP BY d.title', 'SELECT boss, COUNT(*), MIN(name) FROM emp GROUP BY boss']),
  },
  {
    name: 'group keys keep types apart and NULLs together',
    run: async ({ load }) => many(load, ['SELECT k, COUNT(*) FROM mixed GROUP BY k', 'SELECT COUNT(*) FROM mixed GROUP BY k']),
  },
  {
    name: 'HAVING filters groups and may use aggregates and grouped columns',
    run: async ({ load }) =>
      many(load, ['SELECT dept, COUNT(*) FROM emp GROUP BY dept HAVING COUNT(*) > 1', 'SELECT dept FROM emp GROUP BY dept HAVING SUM(salary) > 9000', 'SELECT dept FROM emp GROUP BY dept HAVING dept > 10', 'SELECT dept FROM emp GROUP BY dept HAVING dept IS NULL OR MAX(salary) IS NULL', 'SELECT city FROM emp GROUP BY city HAVING COUNT(DISTINCT dept) = 2', 'SELECT dept FROM emp GROUP BY dept HAVING 1', 'SELECT dept FROM emp GROUP BY dept HAVING NULL', 'SELECT COUNT(*) FROM emp HAVING COUNT(*) > 5', 'SELECT 1 FROM emp HAVING TRUE', "SELECT dept FROM emp GROUP BY dept HAVING COUNT(*) > 1 AND MIN(name) < 'C'"]),
  },
  {
    name: 'expressions may combine aggregates group columns and constants',
    run: async ({ load }) =>
      many(load, ['SELECT dept, SUM(salary) / COUNT(salary), MAX(salary) - MIN(salary) FROM emp GROUP BY dept', 'SELECT dept * 2 + COUNT(*) FROM emp GROUP BY dept', 'SELECT COALESCE(SUM(salary), 0) FROM emp GROUP BY dept', "SELECT CASE WHEN COUNT(*) > 1 THEN 'many' ELSE 'one' END, dept FROM emp GROUP BY dept", 'SELECT COUNT(*) + 1, 2 * 3 FROM emp', 'SELECT UPPER(MIN(name)), LENGTH(MAX(name)) FROM emp', 'SELECT SUM(salary + 100), SUM(COALESCE(salary, 0)) FROM emp', 'SELECT COUNT(salary > 4000), SUM(id * 2) FROM emp', 'SELECT dept, name FROM emp GROUP BY dept, name ORDER BY 2 DESC LIMIT 2']),
  },
  {
    name: 'a column outside an aggregate must be grouped',
    run: async ({ load }) =>
      many(load, ['SELECT dept, name FROM emp GROUP BY dept', 'SELECT name, COUNT(*) FROM emp', 'SELECT * FROM emp GROUP BY id', 'SELECT * FROM one GROUP BY x', 'SELECT dept FROM emp GROUP BY dept ORDER BY name', 'SELECT dept FROM emp GROUP BY dept HAVING name = \'x\'', 'SELECT emp.dept FROM emp GROUP BY dept', 'SELECT dept FROM emp e GROUP BY e.dept', 'SELECT COUNT(*) FROM emp ORDER BY name', 'SELECT name FROM emp HAVING COUNT(*) > 0', 'SELECT name FROM emp ORDER BY COUNT(*)', 'SELECT dept + 1 FROM emp GROUP BY dept', 'SELECT CASE WHEN dept = 10 THEN name END FROM emp GROUP BY dept', 'SELECT MAX(name), dept FROM emp GROUP BY dept']),
  },
  {
    name: 'aggregates are not allowed in WHERE or ON or inside aggregates',
    run: async ({ load }) =>
      many(load, ['SELECT id FROM emp WHERE salary > AVG(salary)', 'SELECT 1 FROM emp e JOIN dept d ON COUNT(*) > 1', 'SELECT SUM(COUNT(*)) FROM emp', 'SELECT MAX(MIN(id)) FROM emp', 'SELECT COUNT(SUM(id)) FROM emp', 'SELECT COUNT(*) FROM emp WHERE COUNT(*) > 1', 'SELECT dept FROM emp GROUP BY COUNT(*)', 'SELECT SUM(id + COUNT(*)) FROM emp']),
  },
  {
    name: 'NULL sorts first and DESC reverses the whole order',
    run: async ({ load }) =>
      many(load, ['SELECT id, salary FROM emp ORDER BY salary', 'SELECT id, salary FROM emp ORDER BY salary DESC', 'SELECT id, city FROM emp ORDER BY city ASC, id DESC', 'SELECT w FROM words ORDER BY w', 'SELECT w FROM words ORDER BY w DESC', 'SELECT f FROM flags ORDER BY f', 'SELECT f FROM flags ORDER BY f DESC', 'SELECT a, b FROM t ORDER BY a DESC, b', 'SELECT a, b FROM t ORDER BY b, a DESC']),
  },
  {
    name: 'the sort is stable and compares the keys in turn',
    run: async ({ load }) =>
      many(load, ['SELECT id FROM emp ORDER BY salary', 'SELECT id FROM emp ORDER BY dept DESC', 'SELECT id, dept, salary FROM emp ORDER BY dept, salary DESC', 'SELECT id FROM emp ORDER BY city, dept', 'SELECT id FROM emp ORDER BY 1 - 1', 'SELECT id FROM emp ORDER BY -1', 'SELECT id FROM emp ORDER BY 1.0', "SELECT id FROM emp ORDER BY 'x', id DESC", 'SELECT id FROM emp ORDER BY id % 3, id DESC']),
  },
  {
    name: 'ORDER BY accepts positions output names and input expressions',
    run: async ({ load }) =>
      many(load, ['SELECT name, salary FROM emp ORDER BY 2 DESC, 1', 'SELECT name FROM emp ORDER BY 0', 'SELECT name FROM emp ORDER BY 2', 'SELECT salary AS id, id AS sal FROM emp ORDER BY id', 'SELECT salary AS id, id AS sal FROM emp ORDER BY emp.id', 'SELECT id AS x, name AS x FROM emp ORDER BY x', 'SELECT name AS N FROM emp ORDER BY n DESC', 'SELECT name FROM emp ORDER BY salary DESC, id', 'SELECT name, 5 AS salary FROM emp ORDER BY salary DESC, id DESC', 'SELECT * FROM dept ORDER BY 3 DESC, 1', 'SELECT name, id * 2 FROM emp ORDER BY col2 DESC', 'SELECT name AS who FROM emp ORDER BY LENGTH(who)', 'SELECT dept, COUNT(*) AS n FROM emp GROUP BY dept ORDER BY n DESC, dept', 'SELECT dept FROM emp GROUP BY dept ORDER BY COUNT(*) DESC, dept DESC', 'SELECT dept FROM emp GROUP BY dept ORDER BY MAX(salary)', 'SELECT COUNT(*) FROM emp ORDER BY COUNT(*)']),
  },
  {
    name: 'sorting values of different types is a type error',
    run: async ({ load }) => many(load, ['SELECT k FROM mixed ORDER BY k', 'SELECT k FROM mixed WHERE k IS NULL ORDER BY k', 'SELECT k FROM mixed WHERE k = 1 ORDER BY k', 'SELECT k FROM mixed ORDER BY k LIMIT 1', 'SELECT 1 FROM mixed ORDER BY k DESC', 'SELECT id FROM emp ORDER BY id, city']),
  },
  {
    name: 'LIMIT and OFFSET cut the ordered rows',
    run: async ({ load }) =>
      many(load, ['SELECT id FROM emp ORDER BY id DESC LIMIT 3', 'SELECT id FROM emp LIMIT 0', 'SELECT id FROM emp LIMIT 2 OFFSET 5', 'SELECT id FROM emp LIMIT 5 OFFSET 5', 'SELECT id FROM emp LIMIT 100', 'SELECT id FROM emp LIMIT 2 OFFSET 0', 'SELECT id FROM emp LIMIT 2 OFFSET 100', 'SELECT dept, COUNT(*) FROM emp GROUP BY dept ORDER BY dept LIMIT 2 OFFSET 1', 'SELECT id FROM emp WHERE id > 3 LIMIT 2', 'SELECT COUNT(*) FROM emp LIMIT 1 OFFSET 1']),
  },
  {
    name: 'a pathological LIKE pattern and a large query finish fast',
    run: async ({ load }) => {
      const { Database } = await lib(load);
      const t0 = cpuMs();
      const big = { columns: ['id', 'g', 's'], rows: [] };
      for (let i = 0; i < 6000; i += 1) big.rows.push([i, i % 37 === 0 ? null : i % 37, `row${i % 101}`]);
      const lt = { columns: ['id', 'k'], rows: [] };
      const rt = { columns: ['id', 'k'], rows: [] };
      for (let i = 0; i < 700; i += 1) {
        lt.rows.push([i, i % 50]);
        rt.rows.push([i, (i * 7) % 50]);
      }
      const text = 'a'.repeat(4000);
      const db = new Database({ big, lt, rt, tx: { columns: ['x'], rows: [[text], [`${text}b`]] } });
      const like = db.query("SELECT COUNT(*) FROM tx WHERE x LIKE '%a%a%a%a%a%a%a%a%a%a%a%a%a%a%a%a%a%a%a%a%b'").rows;
      const group = db.query('SELECT g, COUNT(*), SUM(id), MAX(s) FROM big GROUP BY g ORDER BY 2 DESC, 1 LIMIT 3').rows;
      const join = db.query('SELECT COUNT(*), SUM(l.id) FROM lt l JOIN rt r ON l.k = r.k').rows;
      const sorted = db.query('SELECT id FROM big ORDER BY s, id DESC LIMIT 2 OFFSET 10').rows;
      const lefty = db.query('SELECT COUNT(*) FROM lt l LEFT JOIN rt r ON l.k = r.k AND r.id < 10').rows;
      return { like, group, join, sorted, lefty, fast: cpuMs() - t0 < 3500 };
    },
  },
];
