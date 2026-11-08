import { t, lcg, draw, reference } from './_util.mjs';

const spec = [
  'Implement runTabula(blocks, query), the query engine of Tabula. blocks is an array of strings; each string is one table in the text form below. query is a string in the pipeline language below. The function never throws. It returns { columns, rows } on success, where columns is an array of strings and rows is an array of rows, each row an array of values (one per column). On a failure it returns { error: code } with one of these codes: "syntax", "data", "unknown-table", "unknown-column", "ambiguous-column", "unknown-function", "dup-column", "type", "div-zero", "overflow". Nothing else is returned.',
  '',
  'VALUES. A value is null or one of: int (a whole number whose absolute value is at most 9007199254740991), dec (an exact decimal number with 4 digits after the point; keep it exactly, not as a binary float), text (a sequence of Unicode code points) and bool. In the result, int and dec are JS numbers, text is a string, bool is true or false and null is null. Whenever a dec is made from a longer exact value, it is rounded to 4 digits after the point, half away from zero (2.00005 gives 2.0001 and -2.00005 gives -2.0001) and the rounding is done on the exact value. A dec whose value times 10000 has an absolute value above 9007199254740991 is an overflow.',
  '',
  'TABLES. Split a block into lines at "\\r\\n", "\\r" or "\\n". Drop the lines that contain only spaces and tabs (or nothing) and the lines whose first character is "#". The first line left must be the name line: the name of the table with "@" in front, such as "@emp" (a name is one lowercase letter, then lowercase letters, digits and "_"). The second line is the header. All later lines are rows. The name line is compared after trimming, to the table name asked for by the query: the first block whose name line is exactly "@" followed by that name is the table; a block whose first line is no such line never matches; blocks that are not used are never read, so they may hold any text. No block matches: "unknown-table". A matching block that has no header line, or that does not follow the rules below, is "data" (the one exception is the int rule of the VALUES paragraph: a number that is too large is "overflow").',
  'Lines of the header and of the rows are cut into cells by "|". A cell is either quoted or not. A quoted cell starts, after any spaces and tabs, with a double quote, and runs up to the next double quote that has no backslash before it; inside it "\\"" is one double quote, "\\\\" is one backslash, and any other backslash is "data"; a missing closing quote is "data"; after the closing quote only spaces and tabs may follow, up to the next "|" or the end of the line (anything else is "data"); "|" is an ordinary character inside quotes. An unquoted cell is everything up to the next "|", trimmed of white space (it may be empty). A line that ends with "|" has an empty last cell.',
  'Each header cell must be unquoted and have the form name:type or name:type? where name is a lowercase letter or "_" followed by lowercase letters, digits and "_", and type is int, dec, text or bool. A "?" after the type makes the column nullable. A column name may not be one of the reserved words (below) and the names of one table must differ. Each row must have as many cells as the header has. An unquoted cell "~" is null, and is allowed only in a nullable column. A quoted "~" is the text "~". For a text column the cell must be quoted. For the other types it must be unquoted: an int is an optional "-" and digits; a dec is an optional "-", digits, and optionally "." with one or more digits (any number of them: round as said above); a bool is exactly "yes" or "no". Anything else is "data".',
  '',
  'THE QUERY TEXT. The query is read in two passes. First it is cut into tokens, then the tokens are parsed; a problem in either pass is "syntax", and no table is read before both passes are done, so "syntax" always wins over any other error. White space (space, tab, newline, carriage return) between tokens is ignored. A number is digits, and a dec literal when "." and at least one more digit follow ("3.50"); a number has no sign (a minus is the unary operator). A name is an ASCII letter or "_" followed by ASCII letters, digits and "_"; names are case-sensitive. These words are reserved, and are matched without regard to case: from join as on left where derive group sort asc desc take skip pick distinct and or not is null in between like yes no. A reserved word is never a name. A string is in double quotes with the escapes \\" and \\\\ only (another backslash, or a missing closing quote, is "syntax"; a string may hold a newline). The symbols are | , ( ) : . = <> < <= > >= + - * / % ||, and the longest one wins (so "||" is always the text join and never two pipes). Any other character is "syntax".',
  '',
  'PIPELINE. A query is a stage "from", then zero or more stages, each one after a "|". A name is called a ref when it is written as name or as alias.name. The stages:',
  '- from table [as alias]: the rows of the table in their order. The alias is the table name when "as" is missing.',
  '- join table [as alias] on expression [left]: see JOIN.',
  '- where expression: keeps the rows for which the expression is true; a false or null result drops the row.',
  '- derive name = expression {, name = expression}: adds columns.',
  '- group [ref {, ref}] : name = aggregate {, name = aggregate}: see GROUP.',
  '- sort ref [asc|desc] {, ref [asc|desc]}: orders the rows.',
  '- take n and skip n: n is an integer literal (a dec literal is "syntax"). take keeps the first n rows; skip drops the first n rows (n may be 0 or larger than the row count).',
  '- pick ref [as name] {, ref [as name]}: keeps only the listed columns, in the listed order.',
  '- distinct: drops each row that has the same values as an earlier row (null equals null here).',
  'A stage that is not in this list, a missing part, a part left over at the end, a second "from", or a query that does not start with "from" is "syntax".',
  '',
  'COLUMNS. During a query the rows have columns. Each column has a name and may have an alias: the columns of a table loaded by "from" or "join" have the alias of that stage. A ref "n" finds the columns named n of any alias; a ref "a.n" finds the columns named n with alias a. A ref that finds no column is "unknown-column" and one that finds more than one is "ambiguous-column". The columns made by "derive" and by the aggregates of "group" have no alias, so only the plain form can find them.',
  '',
  'EXPRESSIONS, from the loosest binding to the tightest. Operators of one level group from the left.',
  '1. or.  2. and.  3. not (a prefix; it may repeat).',
  '4. At most one of: a comparison (= <> < <= > >=); "is null" and "is not null"; "in ( e1, e2, ... )" (at least one item, each a full expression) and "not in (...)"; "between low and high" and "not between low and high"; "like pattern" and "not like pattern". The operands of this level (the left operand, low, high, pattern) are expressions of level 5 or tighter. Two such tests in a row, as in a < b < c, are "syntax" (no level can join them).',
  '5. || (text join).  6. + and -.  7. * / and %.  8. a minus sign in front (it may repeat).',
  '9. A literal (int, dec, string, yes, no, null), a ref, a call "name ( [arguments] )" (a name followed by an opening bracket is a call, also after a space), or an expression in brackets.',
  '',
  'RULES OF THE OPERATORS. Conditions use three values: true, false and null ("unknown"). An operand of not, and, or that is neither a bool nor null is "type". not null is null. For "and": the left side is evaluated first; if it is false the result is false and the right side is not evaluated at all (so nothing in it can fail); otherwise the right side is evaluated, and the result is false if it is false, else null if any side is null, else true. "or" is the mirror: a true left side ends it with true; otherwise the right side is evaluated, and the result is true if it is true, else null if any side is null, else false.',
  'A comparison with a null side is null. Otherwise the two values are compared: numbers (int and dec mixed) by their exact value, text by code point (not by UTF-16 unit; so a character outside the first plane is larger than "z" and than a character at U+FFFF), bool with no smaller than yes. Values of two different kinds (a number and a text, and so on) are "type". "is null" and "is not null" always give true or false.',
  'x in (a, b, ...): null when x is null. Otherwise every item is evaluated and compared with x in order (so a "type" can come from an item after a match). The result is true when one item equals x; else null when one item is null; else false. "not in" turns true to false and false to true and keeps null. x between low and high: the low side is x >= low and the high side is x <= high (each null when one of its values is null; each is compared even when the other is false); the result is false when one side is false, else null when one side is null, else true; "not between" turns true and false round and keeps null. x like pattern: null when a side is null; both must be text, else "type"; in the pattern "%" matches any run of zero or more code points, "_" matches exactly one code point, and every other character matches itself exactly (case matters; there is no escape); the whole text must match. "not like" turns true and false round and keeps null.',
  '+ - * / % : when one side is null the result is null and nothing else is checked. Otherwise both must be numbers, else "type". For two ints, + - * give an int and a result with an absolute value above 9007199254740991 is "overflow"; "/" divides and cuts the result towards zero (-7 / 2 is -3); "%" gives the remainder that has the sign of the left side (-7 % 3 is -1). If one side is a dec, + - * / give an exact dec (rounded as in VALUES; "*" and "/" round the exact product or quotient once). "%" needs two ints, else "type". A zero right side of "/" or "%" (also a dec zero) is "div-zero". A minus sign in front: null stays null, a number changes sign, else "type". a || b: null when a side is null; otherwise both must be text, else "type".',
  '',
  'FUNCTIONS. Function names are matched without regard to case. A call with the wrong number of arguments, and "distinct" in a call to any of these functions, is "syntax"; a name that is neither one of these nor an aggregate is "unknown-function". upper(x), lower(x): the Unicode upper or lower case form of a text (full mapping, so "stra\\u00dfe" has the upper case form "STRASSE"). len(x): the number of code points of a text. abs(x): the absolute value of a number. str(x): the text form of any value: a bool is "yes" or "no", an int is its decimal digits with "-" in front when negative, a dec is its shortest decimal form without trailing zeros (2.5000 gives "2.5", 3.0000 gives "3", -0.0500 gives "-0.05"). substr(text, start, length): the code points from position start (the first code point is position 1) for length code points. If start is below 1 the text still begins at position 1, but the cut-off part counts against the length (substr("abcde", 0, 3) is "ab"); a length of zero or less gives "" (also when start is past the end). round(x, places): rounds a number half away from zero to places digits after the point, where places below 0 counts as 0 and above 4 counts as 4; an int is not changed; a dec stays a dec. For all of these, when an argument is null the result is null, and an argument of the wrong kind (when none is null) is "type": all arguments are evaluated first and the null check comes before the kind check.',
  'coalesce(a, b, ...) (one argument or more): evaluates the arguments from the left and returns the first one that is not null, and then evaluates no more; null when all are null. iif(c, a, b): c must be bool or null (else "type"); only when c is true the result is a, otherwise (false or null) it is b; only the chosen one is evaluated. nullif(a, b): both are evaluated; when a or b is null the result is a; otherwise the result is null when they compare equal (as in a comparison, so two kinds that cannot be compared are "type") and a if not.',
  '',
  'ORDER OF WORK AND ERRORS. The stages run one after another. Inside a stage, the checks that need only the names run before any row is touched, so they win over errors in rows, even when there are no rows: first the table (when the stage loads one), then the other checks of the stage, in the order of the stage text; within an expression the checks go from the left and a call is checked before its arguments; a name that is unknown is "unknown-function", "unknown-column" or "ambiguous-column" as said above. Then the rows are evaluated from the first row to the last (and for a derive, an item is applied to all rows before the next item is read), and the first error stops the query. Details per stage follow.',
  'JOIN. The table is loaded (a "data" or "unknown-table" error comes first). If an alias already exists among the columns, the result is "dup-column". The condition is checked with the columns of both sides. Then for every row of the left side, in order, and for every row of the table, in order, the condition is evaluated on the two rows together; it must be bool or null (else "type") and the pair is kept only when it is true. With "left" at the end of the stage, a left row that has no kept pair is kept once, with null in every column of the table. The columns are the left columns followed by the columns of the table.',
  'DERIVE. Items are applied in order, so an item can use the columns made by earlier items of the same stage, but not its own. A new name that equals the name of any existing column (whatever its alias) is "dup-column". The new column has no alias.',
  'GROUP. The keys are refs (zero or more), and each aggregate is one call of count, sum, avg, min or max (matched without regard to case; the call alone, nothing around it) with a name. The forms are count(), count(e), count(distinct e), sum(e), avg(e), min(e), max(e), where e is an expression that does not hold an aggregate; any other form, such as sum() or sum(distinct e), is "syntax". The rows are put into groups by the values of the keys (null equals null, int and dec do not mix in a key); groups come in the order in which their first row appears. With no key there is exactly one group, also when there are no rows; with keys, no rows means no groups. The result columns are the key columns (same name and alias as before) followed by the aggregate columns (no alias); if two result columns have the same name the result is "dup-column" (checked before any row is read). For each group and then for each aggregate: count() is the number of rows of the group; count(e) the number of rows where e is not null; count(distinct e) the number of different values among them. For sum, avg, min and max the nulls are left out and when no value is left the result is null. sum of ints is an int (every partial sum is checked for "overflow"); if any value is a dec it is a dec; a value that is not a number is "type". avg is always a dec: the exact sum divided by the number of values, rounded once. min and max compare as a comparison does (two kinds that cannot be compared are "type") and give a value of the same kind.',
  'SORT. The rows are ordered by the first ref, then by the next one when equal, and so on; rows that are equal in all refs keep their order. Values compare as in a comparison; a null is smaller than every other value (so nulls come first in asc, which is the default, and last in desc). Two non-null values of different kinds are "type".',
  'PICK. Each item is a column of the current columns. With "as" it gets the new name (and loses its alias); without "as" it keeps its name and its alias. If two result columns have the same name the result is "dup-column".',
  '',
  'THE RESULT. columns holds one name per column. A name that appears more than once among the columns is written as alias.name for the columns that have an alias; all other names are written plainly. Values are as described in VALUES.',
].join('\n');

// ---------------------------------------------------------------------------------------------
// Tables used by the hand-derived tests.

const EMP = [
  '@emp',
  'id:int | name:text | boss:int? | pay:dec | dept:text? | active:bool',
  '1 | "Ann" | ~ | 100.5 | "ops" | yes',
  '2 | "Bo" | 1 | 80.25 | "ops" | yes',
  '3 | "Cy" | 1 | 80.25 | ~ | no',
  '4 | "Di" | 2 | 60.00005 | "dev" | yes',
  '5 | "Ed" | 2 | 70 | "dev" | no',
].join('\n');

const DEPT = ['@dept', 'code:text | label:text | head:int?', '"ops" | "Operations" | 1', '"dev" | "Development" | 2', '"hr" | "People" | ~'].join('\n');

const T = ['@t', 'k:int | x:int? | y:int? | s:text?', '1 | 1 | 5 | "ab"', '2 | 2 | ~ | "a_b"', '3 | ~ | 3 | ~', '4 | 7 | 7 | "AB"', '5 | 3 | 1 | "a%"'].join('\n');

const M = ['@m', 'a:int | b:int | p:dec | q:dec?', '7 | 2 | 2.5 | 0.0003', '-7 | 2 | -2.5 | ~', '9007199254740 | 1000 | 1.0005 | 3'].join('\n');

// Each entry is checked against the reference (see tests/ladder-code-supreme-b.test.mjs). The ones named in HIDDEN are
// hidden tests; the others are small worked examples of single rules.
const worked = [
  {
    edge: 'null-logic',
    args: [
      [T],
      'from t | derive a = x in (1, y), b = x not in (1, y), c = x between y and 6, d = x <> y or y > 2, e = (x > 2 and y is null) or s like "a_%", f = coalesce(x, y, 0) + 1, g = nullif(x, y), h = not x is null and y > 0 | pick k, a, b, c, d, e, f, g, h',
    ],
    returns: {
      columns: ['k', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      rows: [
        [1, true, false, false, true, true, 2, 1, true],
        [2, null, null, null, null, true, 3, 2, null],
        [3, null, null, null, true, null, 4, null, false],
        [4, true, false, false, true, false, 8, null, true],
        [5, false, true, true, true, true, 4, 3, true],
      ],
    },
  },
  {
    edge: 'join-left',
    args: [
      [EMP, DEPT],
      'from emp as e | join dept as d on e.dept = d.code left | join emp as m on e.boss = m.id left | derive up = m.name || "/" || coalesce(d.label, "?") | where e.id <> 1 | sort d.label desc, e.id | pick e.id as id, e.name as who, up, d.head',
    ],
    returns: {
      columns: ['id', 'who', 'up', 'head'],
      rows: [
        [2, 'Bo', 'Ann/Operations', 1],
        [4, 'Di', 'Bo/Development', 2],
        [5, 'Ed', 'Bo/Development', 2],
        [3, 'Cy', 'Ann/?', null],
      ],
    },
  },
  {
    edge: 'group-null',
    args: [
      [EMP],
      'from emp | derive band = iif(pay >= 80, "hi", "lo") | group dept, band: n = count(), tot = sum(pay), mean = avg(pay), people = count(distinct boss), top = max(name) | sort n desc, dept',
    ],
    returns: {
      columns: ['dept', 'band', 'n', 'tot', 'mean', 'people', 'top'],
      rows: [
        ['dev', 'lo', 2, 130.0001, 65.0001, 1, 'Ed'],
        ['ops', 'hi', 2, 180.75, 90.375, 1, 'Bo'],
        [null, 'hi', 1, 80.25, 80.25, 1, 'Cy'],
      ],
    },
  },
  {
    edge: 'rounding',
    args: [
      [M],
      'from m | derive d = a / b, r = a % b, f = p * 0.5, g = p / 3, h = round(p, 0), j = round(p * 1.5, 1), k = -p, l = abs(a) - b * 2, s = str(p) || "|" || str(a), n = coalesce(q, 0) * 10000, o = q / 2 | pick d, r, f, g, h, j, k, l, s, n, o',
    ],
    returns: {
      columns: ['d', 'r', 'f', 'g', 'h', 'j', 'k', 'l', 's', 'n', 'o'],
      rows: [
        [3, 1, 1.25, 0.8333, 3, 3.8, -2.5, 3, '2.5|7', 3, 0.0002],
        [-3, -1, -1.25, -0.8333, -3, -3.8, 2.5, 3, '-2.5|-7', 0, null],
        [9007199254, 740, 0.5003, 0.3335, 1, 1.5, -1.0005, 9007199252740, '1.0005|9007199254740', 30000, 1.5],
      ],
    },
  },
  {
    edge: 'error-order',
    args: [[EMP], 'from nosuch | pick ('],
    returns: { error: 'syntax' },
  },
  {
    edge: 'error-order',
    args: [[EMP, '@bad\nx:int\n"a"'], 'from emp | join bad on 1 = 1 | where zzz > 1'],
    returns: { error: 'data' },
  },
  {
    edge: 'error-order',
    args: [[EMP], 'from emp | where active and id > 0 | derive z = nosuch(1) | where 1 / 0 = 1'],
    returns: { error: 'unknown-function' },
  },
  {
    edge: 'short-circuit',
    args: [[EMP], 'from emp | where id > 100 and name | derive q = id / (id - 3) | where q > 0'],
    returns: { columns: ['id', 'name', 'boss', 'pay', 'dept', 'active', 'q'], rows: [] },
  },
  {
    edge: 'short-circuit',
    args: [[EMP], 'from emp | where id > 0 and name'],
    returns: { error: 'type' },
  },
  {
    edge: 'short-circuit',
    args: [[EMP], 'from emp | derive q = id / (id - 3) | where id > 100'],
    returns: { error: 'div-zero' },
  },
  // ---- small worked examples (not hidden) ----
  {
    edge: 'table-text',
    args: [
      ['# people\n\n@p\r\nid:int | tag:text? | w:bool\n  1 | "a|b" | yes\n2|"say \\"hi\\" \\\\ ok"|no\n# gone\n3 | ~ | yes\n4 | "~" | no\n'],
      'from p',
    ],
    returns: {
      columns: ['id', 'tag', 'w'],
      rows: [[1, 'a|b', true], [2, 'say "hi" \\ ok', false], [3, null, true], [4, '~', false]],
    },
  },
  {
    edge: 'table-text',
    args: [['@p\nid:int\n~'], 'from p'],
    returns: { error: 'data' },
  },
  {
    edge: 'table-text',
    args: [['@p\nid:int | n:text\n1 | "x" |'], 'from p'],
    returns: { error: 'data' },
  },
  {
    edge: 'table-text',
    args: [['@p\nid:int\n9007199254740992'], 'from p'],
    returns: { error: 'overflow' },
  },
  {
    edge: 'like',
    args: [
      ['@w\nw:text\n"cat"\n"Cat"\n"c_t"\n"ct"\n"caat"\n"😀x"'],
      'from w | where w like "c%t" or w like "_x" | derive u = upper(w), n = len(w), sub = substr(w, 0, 2), sub2 = substr(w, 2, 9)',
    ],
    returns: {
      columns: ['w', 'u', 'n', 'sub', 'sub2'],
      rows: [
        ['cat', 'CAT', 3, 'c', 'at'],
        ['c_t', 'C_T', 3, 'c', '_t'],
        ['ct', 'CT', 2, 'c', 't'],
        ['caat', 'CAAT', 4, 'c', 'aat'],
        ['😀x', '😀X', 2, '😀', 'x'],
      ],
    },
  },
  {
    edge: 'sort-nulls',
    args: [
      ['@s\nk:int | v:int?\n1 | 3\n2 | ~\n3 | 1\n4 | 3\n5 | ~'],
      'from s | sort v desc, k desc | skip 1 | take 3',
    ],
    returns: { columns: ['k', 'v'], rows: [[1, 3], [3, 1], [5, null]] },
  },
  {
    edge: 'group-empty',
    args: [['@s\nk:int\n1'], 'from s | where k > 5 | group : n = count(), t = sum(k), a = avg(k), m = max(k)'],
    returns: { columns: ['n', 't', 'a', 'm'], rows: [[0, null, null, null]] },
  },
  {
    edge: 'dup-ambiguous',
    args: [[EMP, DEPT], 'from emp as e | join emp as m on e.boss = m.id | pick e.name, m.name'],
    returns: { error: 'dup-column' },
  },
  {
    edge: 'dup-ambiguous',
    args: [[EMP], 'from emp as e | join emp as m on e.boss = m.id | where id > 1'],
    returns: { error: 'ambiguous-column' },
  },
  {
    edge: 'dup-ambiguous',
    args: [[EMP], 'from emp as e | join emp as m on e.boss = m.id | pick e.id as a, m.id as b, e.name, m.pay | take 2'],
    returns: {
      columns: ['a', 'b', 'name', 'pay'],
      rows: [[2, 1, 'Bo', 100.5], [3, 1, 'Cy', 100.5]],
    },
  },
  {
    edge: 'dup-ambiguous',
    args: [[EMP], 'from emp as e | join emp as m on e.boss = m.id | take 1'],
    returns: {
      columns: ['e.id', 'e.name', 'e.boss', 'e.pay', 'e.dept', 'e.active', 'm.id', 'm.name', 'm.boss', 'm.pay', 'm.dept', 'm.active'],
      rows: [[2, 'Bo', 1, 80.25, 'ops', true, 1, 'Ann', null, 100.5, 'ops', true]],
    },
  },
];

const HIDDEN = new Set(['null-logic', 'join-left', 'group-null', 'rounding', 'error-order']);
const hand = worked.filter((one) => HIDDEN.has(one.edge)).map((one) => t(one.edge, one.args, one.returns));
const examples = worked.filter((one) => !HIDDEN.has(one.edge)).map((one) => ({ edge: one.edge, args: one.args, returns: one.returns }));

// ---------------------------------------------------------------------------------------------
// Seeded random queries over random tables. The expected value comes from the reference.

const ITEMS = ['bolt', 'nut', 'gear', 'Cog', 'ring', 'a|b', 'say "hi"', 'straße', 'naïve', 'bolt'];
const NOTES = ['rush', 'gift', '', 'Rush', 'back|order', 'fraçais'];
const REGIONS = ['north', 'south', 'East', 'west'];
const CNAMES = ['Ines', 'Omar', 'Zoe', 'Yan', 'ada', 'Bruno', 'Cleo', 'Dev'];

const quote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const pick = (next, list) => list[draw(next, list.length)];
const maybe = (next, percent) => draw(next, 100) < percent;

function makeTables(next) {
  const custCount = 5 + draw(next, 4);
  const cust = ['@cust', 'cid:int | cname:text | region:text? | tier:int?'];
  for (let i = 0; i < custCount; i += 1) {
    const region = maybe(next, 25) ? '~' : quote(pick(next, REGIONS));
    const tier = maybe(next, 25) ? '~' : String(1 + draw(next, 3));
    cust.push(`${10 + i} | ${quote(CNAMES[i % CNAMES.length])} | ${region} | ${tier}`);
  }
  const orderCount = 10 + draw(next, 6);
  const ord = ['@ord', 'oid:int | cust:int? | item:text | qty:int | price:dec | note:text? | paid:bool'];
  for (let i = 0; i < orderCount; i += 1) {
    const owner = maybe(next, 12) ? '~' : String(10 + draw(next, custCount + 2));
    const note = maybe(next, 35) ? '~' : quote(pick(next, NOTES));
    const price = `${draw(next, 90)}.${String(draw(next, 10000)).padStart(4, '0').slice(0, 1 + draw(next, 4))}`;
    ord.push(`${100 + i} | ${owner} | ${quote(pick(next, ITEMS))} | ${draw(next, 7)} | ${price} | ${note} | ${maybe(next, 55) ? 'yes' : 'no'}`);
  }
  return [ord.join('\n'), cust.join('\n')];
}

function makeQuery(next) {
  const left = maybe(next, 60) ? ' left' : '';
  const stages = ['from ord as o', `join cust as c on o.cust = c.cid${left}`];
  const cond = [
    () => `o.qty ${pick(next, ['>', '>=', '<>'])} ${draw(next, 5)}`,
    () => `o.price between ${draw(next, 30)} and ${30 + draw(next, 60)}`,
    () => 'o.note is null',
    () => `o.item like ${quote(pick(next, ['b%', '%g%', '_o_t', '%e', '%|%', 'n_t']))}`,
    () => 'not o.paid',
    () => `c.tier in (${draw(next, 3)}, ${1 + draw(next, 3)}, null)`,
    () => `c.tier not in (${1 + draw(next, 3)}, null) or o.paid`,
    () => `o.qty not in (${draw(next, 4)}, null, ${draw(next, 4)})`,
    () => `c.region not in (${quote(pick(next, REGIONS))}, ${quote(pick(next, REGIONS))})`,
    () => `o.cust is not null and c.tier ${pick(next, ['<', '>'])} ${1 + draw(next, 2)}`,
    () => `o.note || "!" ${pick(next, ['=', '<'])} ${quote(pick(next, ['rush!', 'gift!', 'Rush!']))}`,
  ];
  if (maybe(next, 60)) stages.push(`where ${pick(next, cond)()} ${pick(next, ['or', 'or', 'and'])} ${pick(next, cond)()}`);
  const money = ['o.qty * o.price', 'o.price / (o.qty + 1)', 'o.price - c.tier', 'coalesce(c.tier, 0) * o.price', 'round(o.price * 1.5, 1)', 'o.qty % 3 + 1'];
  const flags = ['iif(o.paid, "paid", "open")', 'upper(substr(o.item, 2, 3))', 'coalesce(o.note, c.region, "-")', 'len(o.item) + o.qty', 'str(o.price) || "/" || str(o.qty)'];
  const d1 = pick(next, money);
  const d2 = pick(next, flags);
  stages.push(`derive m = ${d1}, f = ${d2}`);
  const shape = [0, 1, 0, 1, 2, 3][draw(next, 6)];
  if (shape === 0) {
    const key = pick(next, ['c.region', 'c.tier', 'c.region, o.paid', 'c.tier, o.paid']);
    stages.push(`group ${key}: n = count(), s = sum(m), a = avg(m), d = count(distinct o.item), hi = max(o.item), lo = min(c.cname)`);
    stages.push(`sort ${key.split(',')[0]} ${pick(next, ['desc', 'asc'])}, ${pick(next, ['n', 'a desc', 'hi'])}`);
    if (maybe(next, 50)) stages.push(`take ${1 + draw(next, 4)}`);
  } else if (shape === 1) {
    stages.push(`sort ${pick(next, ['c.tier', 'c.tier desc', 'c.region desc', 'o.note', 'm desc'])}, ${pick(next, ['o.oid desc', 'o.oid', 'f'])}`);
    if (maybe(next, 60)) stages.push(`skip ${draw(next, 3)}`);
    stages.push(`take ${8 + draw(next, 5)}`);
    stages.push('pick o.oid, f, c.cname as who, c.tier, m');
  } else if (shape === 2) {
    stages.push(`group : n = count(), s = sum(m), a = avg(m), t = max(c.tier), r = min(c.region), w = count(o.note), dn = count(distinct c.region)`);
  } else {
    stages.push('pick c.region, f, o.paid');
    stages.push('distinct');
    stages.push('sort c.region, f desc, o.paid');
  }
  return stages.join(' | ');
}

// A seed is used when its query runs without an error and returns at least 3 rows, so that every test checks real output.
const runTabula = reference('tabula-query', 'runTabula');
const computed = [];
for (let seed = 301; computed.length < 12 && seed < 700; seed += 1) {
  const next = lcg(seed);
  const blocks = makeTables(next);
  const query = makeQuery(next);
  const result = runTabula(blocks, query);
  if (result.error || result.rows.length < 3) continue;
  computed.push(t('mixed-query', [blocks, query]));
}

export default {
  slug: 'tabula-query',
  tier: {
    level: 5,
    human_minutes: 600,
    basis: 'A query engine with its own table text format and pipeline language: a lexer and a parser with a precedence ladder of eight levels, three-valued logic with short-circuit rules, exact decimal arithmetic with half-away rounding, nulls in joins, groups, sorts and counts, aliases and name clashes, ten error codes with a fixed order of detection, and about fifteen functions. The reference is about 900 lines. An expert needs most of a working day to read the rules closely, write it and check it against worked examples.',
  },
  tags: ['spec'],
  name: 'runTabula',
  signature: 'runTabula(blocks, query) -> { columns, rows } | { error }',
  task: spec,
  edges: {
    'null-logic': 'A comparison with a null side is null.',
    'join-left': 'a left row that has no kept pair is kept once, with null in every column of the table',
    'group-null': 'the nulls are left out and when no value is left the result is null',
    rounding: 'half away from zero',
    'error-order': 'so "syntax" always wins over any other error',
    'mixed-query': 'Details per stage follow.',
  },
  examples,
  tests: [...hand, ...computed],
};
