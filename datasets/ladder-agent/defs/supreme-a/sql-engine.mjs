export default {
  slug: 'sql-engine',
  tier: {
    level: 5,
    human_minutes: 420,
    basis: 'Reference is about 700 lines in 5 modules (lexer, parser, evaluator, LIKE matcher, executor); an experienced engineer needs about 7 h to build the grammar, three-valued logic, grouping, ordering and the error order from the spec and to test them.',
  },
  tags: ['build', 'spec'],
  task: 'Build the SQL subset engine that SPEC.md describes. new Database(tables).query(sql) must run one SELECT statement: joins (inner and left), WHERE, GROUP BY with aggregates, HAVING, ORDER BY, LIMIT and OFFSET, with the NULL rules, type errors and error order that SPEC.md states. The stubs in src/lexer.mjs, src/parser.mjs, src/like.mjs, src/evaluator.mjs and src/executor.mjs throw "not implemented"; src/database.mjs and src/errors.mjs are finished. Syntax errors must report the exact position the spec defines, and the LIKE matcher and large queries must stay fast. The files in test/ must pass and must not be edited.',
};
