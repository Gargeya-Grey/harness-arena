# SQL subset engine

`new Database(tables).query(sql)` runs one `SELECT` statement over in-memory tables.

```js
const db = new Database({
  Staff: { columns: ['id', 'Name', 'dept'], rows: [[1, 'ann', 10], [2, 'bob', null]] },
  dept:  { columns: ['id', 'title'],        rows: [[10, 'ops']] },
});
db.query('SELECT name, title FROM staff LEFT JOIN dept ON staff.dept = dept.id ORDER BY 1');
// { columns: ['Name', 'title'], rows: [['ann', 'ops'], ['bob', null]] }
```

`src/database.mjs` is finished: it stores the tables and finds one by name. You write the
lexer, parser, evaluator and executor. Errors are `SqlError` (`src/errors.mjs`) with a `code`;
only `syntax` errors also have a `position`.

## Values and names

* A value is a number, a string, a boolean or `null` (SQL NULL). All numbers are JS doubles.
* Keywords, table names, aliases and column names are case-insensitive. Keywords are reserved;
  none can be used as a name. Comparing strings is by UTF-16 code unit and case-sensitive.
* A column keeps the spelling it was declared with in the output.

## Lexical rules

Tokens: names `[A-Za-z_][A-Za-z0-9_]*`; numbers `digits` or `digits.digits` (no sign, no exponent);
strings in single quotes with `''` for a quote; operators `= <> != < <= > >= + - * / % || ( ) , . ;`
(`!=` is `<>`). Spaces, tabs and newlines separate tokens, and `--` starts a comment to the end of the line.
A character that starts no token, or a string that is not closed, is a `syntax` error at that character.
One optional `;` may end the statement.

## Grammar

```
query    := SELECT items FROM source { join } [WHERE expr] [GROUP BY colref {, colref}]
            [HAVING expr] [ORDER BY order {, order}] [LIMIT int [OFFSET int]] [;]
items    := item {, item}
item     := * | name . * | expr [AS name]
source   := name [[AS] name]
join     := [INNER | LEFT [OUTER]] JOIN source ON expr
order    := expr [ASC | DESC]
colref   := name | name . name
```

`int` is a number token without a dot. Reserved words: SELECT FROM WHERE GROUP BY HAVING ORDER LIMIT OFFSET
JOIN INNER LEFT OUTER ON AS AND OR NOT IS NULL TRUE FALSE IN BETWEEN LIKE CASE WHEN THEN ELSE END ASC DESC DISTINCT.
An output alias needs `AS`. A table alias may omit it.

Expressions, from the loosest to the tightest binding:

1. `OR`
2. `AND`
3. `NOT` (prefix)
4. One comparison at most: `a = b`, `<>`, `<`, `<=`, `>`, `>=`, `a IS [NOT] NULL`, `a [NOT] IN (e, ...)`,
   `a [NOT] BETWEEN lo AND hi`, `a [NOT] LIKE pattern`. They cannot be chained: `a = b = c` is a syntax error.
5. `+`, `-`, `||` (left to right)
6. `*`, `/`, `%` (left to right)
7. unary `-`
8. primaries: number, string, `NULL`, `TRUE`, `FALSE`, `( expr )`, a column (`name` or `name.name`), a function call
   `name(expr, ...)`, an aggregate (below), and `CASE WHEN c THEN v {WHEN c THEN v} [ELSE v] END`.

The operands of BETWEEN are of level 5. A syntax error is reported at the first token that cannot continue
a valid statement: `position` is its 0-based offset in the input, or the length of the input at the end.

Functions: `COALESCE(a, b, ...)` (at least one argument), `ABS(x)`, `LENGTH(s)`, `UPPER(s)`, `LOWER(s)`.
Aggregates: `COUNT(*)`, `COUNT([DISTINCT] e)`, `SUM(e)`, `AVG(e)`, `MIN(e)`, `MAX(e)`. A name followed by `(`
that is none of these is a `no-function` error (found when the statement is checked, see Errors).
A call has at least one argument (an empty `()` is a syntax error). `DISTINCT` is allowed only inside `COUNT`.
A wrong number of arguments is a `type` error found at the same time.

## Evaluation of expressions

* Arithmetic (`+ - * / %`, unary `-`) needs numbers. `/` is real division. `%` is the JS remainder.
  A NULL operand gives NULL (checked first). Otherwise, a zero divisor for `/` or `%` is a `div0` error.
  Any operand that is not a number is a `type` error.
* `||` needs two strings and joins them. A NULL operand gives NULL. Anything else is a `type` error.
* Comparison needs two values of the same type (numbers, strings, or booleans with `false < true`); a NULL
  operand gives NULL; two values of different types are a `type` error.
* `AND`, `OR`, `NOT` follow three-valued logic. Their operands must be booleans or NULL, else `type`.
  `AND` and `OR` always evaluate both operands (an error in either one is raised).
* `IS NULL` and `IS NOT NULL` never give NULL.
* `x IN (a, b, ...)`: NULL if `x` is NULL; else TRUE if some element equals `x` (comparison rules above, in list
  order, stopping at the first equal one); else NULL if some element is NULL; else FALSE. `NOT IN` is the logical
  NOT of that.
* `x BETWEEN lo AND hi` is `x >= lo AND x <= hi`. `NOT BETWEEN` is the NOT of it.
* `LIKE` needs two strings (NULL gives NULL, other types `type`). In the pattern `%` matches any run of
  characters (also none) and `_` matches exactly one UTF-16 code unit. There is no escape character.
  The match covers the whole string. It must take time polynomial in the lengths, whatever the pattern.
* `CASE` evaluates the conditions in order up to the first TRUE one (a condition must be boolean or NULL,
  else `type`) and then only that result. No TRUE condition and no ELSE gives NULL.
* `COALESCE` evaluates its arguments left to right and stops at the first non-NULL one; if all are NULL, the
  result is NULL.
* `ABS` needs a number; `LENGTH`, `UPPER`, `LOWER` need a string (`LENGTH` counts UTF-16 code units). NULL gives NULL.
* Aggregates ignore NULL values. `COUNT(*)` counts rows and `COUNT(e)` the non-NULL values of `e`;
  `COUNT(DISTINCT e)` counts the different non-NULL values (a number never equals a string or a boolean).
  `SUM` and `AVG` need numbers; `SUM` adds the values in row order with `+`, `AVG` is that sum divided by the count.
  `MIN` and `MAX` use the comparison order and need values of one type. All of them give NULL for no
  non-NULL value, except `COUNT`, which gives 0. A mix of types is a `type` error.

## Executing a query

1. **Tables.** `FROM` and each `JOIN` name a table (`no-table` if it does not exist). A table is known by its alias
   when it has one, otherwise by its own name; two tables known by the same name are a `dup-alias` error.
2. **Joins.** The rows are built by nested loops: for each row so far, in order, for each row of the next table,
   in table order, keep the pair when `ON` is TRUE (FALSE and NULL both drop it). A `LEFT` join also keeps a
   row that found no partner once, with NULL in every column of the new table. A plain `JOIN` is an `INNER` join.
3. **WHERE** keeps the rows for which the condition is TRUE. It must give a boolean or NULL, else `type`.
4. **Columns.** `name` must belong to exactly one table (`no-column` if none, `ambiguous` if several);
   `t.name` looks in the table known as `t`. `*` is every column of every table in `FROM` order; `t.*` is the columns
   of one table. Their output names are the declared names.
5. **Grouping.** A query is *aggregated* if it has `GROUP BY` or `HAVING`, or an aggregate anywhere in the select list,
   `HAVING` or `ORDER BY`. Rows are put in groups by the values of the `GROUP BY` columns (NULLs are equal
   to each other, a number never equals a string); without `GROUP BY` all rows are one group, even if there are no
   rows. Groups come in the order in which their first row appears. In an aggregated query, a column outside an
   aggregate must be a `GROUP BY` column (same table column, however it is written), else a `group` error. `*` is
   allowed only if every column of the tables is a `GROUP BY` column. An aggregate inside `WHERE`,
   `ON`, or inside another aggregate is an `aggregate` error. Outside aggregates, an expression of a
   group is evaluated on the first row of the group.
6. **HAVING** keeps the groups for which the condition is TRUE (same type rule as `WHERE`).
7. **Select list.** Each item gives one output column. Its name is the `AS` alias, spelled as written, if there is one; else the declared
   name if the item is a plain column; else `col` and the 1-based position of the item in the *expanded* list (the list
   after `*` is replaced by its columns). Example: `SELECT *, 1 + 1` over a table of two columns names the last column `col3`.
8. **ORDER BY.** An item that is an integer literal `n` sorts by output column `n` (`no-column` if outside
   `1..count`). An item that is a bare unqualified name equal to the name of an output column sorts by that output
   column; this wins over an input column of the same name, and if several output columns have that name the
   error is `ambiguous`. Any other item is an expression, evaluated like a select item on the input row (or group).
   NULL sorts before every value; `DESC` reverses the whole order, so NULL comes last. The sort is stable, and several
   items are compared in turn. The non-NULL values of one sort key must have one type, else `type`.
9. **LIMIT / OFFSET.** Skip `OFFSET` rows (default 0), then keep at most `LIMIT` rows. `OFFSET` needs `LIMIT`.

### Errors

Codes: `syntax`, `no-table`, `dup-alias`, `no-column`, `ambiguous`, `no-function`, `group`, `aggregate`,
`type`, `div0`. A `syntax` error is found first, for the whole text. Then the names and the shape of the
statement are checked before any row is read, so these errors happen on empty tables as well: `no-table` and
`dup-alias`, then in this clause order: `ON` conditions (join order), `WHERE`, `GROUP BY`, the select list,
`HAVING`, `ORDER BY`; inside a clause, expression by expression from left to right, and inside one expression
the `no-function`, argument count, `aggregate`, `no-column` and `ambiguous` errors (first from left to right) before a
`group` error. The
errors `no-function`, wrong argument counts, `aggregate`, `group`, `no-column` and `ambiguous` are all part of that check.
`type` and `div0` errors depend on the data and happen when a value is evaluated; if several could happen, the
step order above decides (`ON`, `WHERE`, `HAVING`, the select list row by row and item by item, then the `ORDER BY` keys).

## Result

`{ columns: string[], rows: any[][] }`. Row order is the order of the steps above. The result never shares
arrays with the stored tables.

## Files

* `src/database.mjs`, `src/errors.mjs`: finished.
* `src/lexer.mjs`, `src/parser.mjs`: text to syntax tree.
* `src/evaluator.mjs`: expression rules. `src/like.mjs`: the LIKE matcher.
* `src/executor.mjs`: the steps above.

The tests in `test/` show the shape of results. Do not edit them.
