import { SqlError } from './errors.mjs';
import { compare, evaluate, keyOf } from './evaluator.mjs';

const ARITY = { coalesce: [1, Infinity], abs: [1, 1], length: [1, 1], upper: [1, 1], lower: [1, 1] };

const hasAggregate = (e) => {
  if (e === null || typeof e !== 'object') return false;
  if (e.t === 'agg') return true;
  return Object.values(e).some((value) => (Array.isArray(value) ? value.some(hasAggregate) : hasAggregate(value)));
};

/** Resolves names to row positions and checks the shape of one expression. */
function bind(e, scope, allowAggregate) {
  switch (e.t) {
    case 'lit': return e;
    case 'col': return { t: 'ref', i: resolve(e, scope) };
    case 'un': return { ...e, e: bind(e.e, scope, allowAggregate) };
    case 'bin': return { ...e, l: bind(e.l, scope, allowAggregate), r: bind(e.r, scope, allowAggregate) };
    case 'isnull': return { ...e, e: bind(e.e, scope, allowAggregate) };
    case 'in': return { ...e, e: bind(e.e, scope, allowAggregate), list: e.list.map((item) => bind(item, scope, allowAggregate)) };
    case 'between': return { ...e, e: bind(e.e, scope, allowAggregate), lo: bind(e.lo, scope, allowAggregate), hi: bind(e.hi, scope, allowAggregate) };
    case 'like': return { ...e, e: bind(e.e, scope, allowAggregate), pattern: bind(e.pattern, scope, allowAggregate) };
    case 'case':
      return {
        ...e,
        whens: e.whens.map((when) => ({ c: bind(when.c, scope, allowAggregate), v: bind(when.v, scope, allowAggregate) })),
        otherwise: e.otherwise === null ? null : bind(e.otherwise, scope, allowAggregate),
      };
    case 'fn': {
      const arity = ARITY[e.name];
      if (!arity) throw new SqlError('no-function', `unknown function ${e.name}`);
      const args = e.args.map((arg) => bind(arg, scope, allowAggregate));
      if (e.args.length < arity[0] || e.args.length > arity[1]) throw new SqlError('type', `${e.name} takes another number of arguments`);
      return { ...e, args };
    }
    case 'agg':
      if (!allowAggregate) throw new SqlError('aggregate', 'aggregate not allowed here');
      return { ...e, arg: e.arg === null ? null : bind(e.arg, scope, false) };
    default: throw new Error(`unknown node ${e.t}`);
  }
}

function resolve(col, scope) {
  if (col.table !== null) {
    const entry = scope.find((item) => item.ref === col.table);
    const at = entry ? entry.columns.findIndex((name) => name.toLowerCase() === col.name) : -1;
    if (at < 0) throw new SqlError('no-column', `no column ${col.table}.${col.name}`);
    return entry.offset + at;
  }
  const found = [];
  for (const entry of scope) entry.columns.forEach((name, at) => name.toLowerCase() === col.name && found.push(entry.offset + at));
  if (found.length === 0) throw new SqlError('no-column', `no column ${col.name}`);
  if (found.length > 1) throw new SqlError('ambiguous', `column ${col.name} is in several tables`);
  return found[0];
}

function checkGroup(e, grouped) {
  if (e === null || typeof e !== 'object' || e.t === 'agg') return;
  if (e.t === 'ref' && !grouped.has(e.i)) throw new SqlError('group', 'column is not grouped');
  for (const value of Object.values(e)) {
    if (Array.isArray(value)) value.forEach((item) => (item && item.c ? (checkGroup(item.c, grouped), checkGroup(item.v, grouped)) : checkGroup(item, grouped)));
    else checkGroup(value, grouped);
  }
}

const keyOfRow = (values) => values.map(keyOf).join('|');

function sortRows(entries, keyCount, descs) {
  for (let k = 0; k < keyCount; k += 1) {
    const types = new Set(entries.map((entry) => entry.keys[k]).filter((value) => value !== null).map((value) => typeof value));
    if (types.size > 1) throw new SqlError('type', 'mixed types in an ORDER BY key');
  }
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      for (let k = 0; k < keyCount; k += 1) {
        const x = a.entry.keys[k];
        const y = b.entry.keys[k];
        let order = 0;
        if (x === null || y === null) order = x === y ? 0 : x === null ? -1 : 1;
        else order = compare(x, y);
        if (order !== 0) return descs[k] ? -order : order;
      }
      return a.index - b.index;
    })
    .map((item) => item.entry);
}

export function execute(statement, db) {
  const sources = [statement.from, ...statement.joins];
  const scope = [];
  let width = 0;
  for (const source of sources) {
    const table = db.getTable(source.table);
    if (!table) throw new SqlError('no-table', `no table ${source.table}`);
    const ref = source.alias ?? source.table;
    if (scope.some((entry) => entry.ref === ref)) throw new SqlError('dup-alias', `${ref} is used twice`);
    scope.push({ ref, table, columns: table.columns, offset: width });
    width += table.columns.length;
  }
  const declared = scope.flatMap((entry) => entry.columns);

  // Checks, in clause order.
  const ons = statement.joins.map((join, k) => bind(join.on, scope.slice(0, k + 2), false));
  const where = statement.where ? bind(statement.where, scope, false) : null;
  const groupIdx = statement.groupBy.map((col) => resolve(col, scope));
  const aggregated =
    groupIdx.length > 0 || statement.having !== null || statement.items.some((item) => !item.star && hasAggregate(item.expr)) || statement.orderBy.some((item) => hasAggregate(item.expr));
  const grouped = new Set(groupIdx);
  const items = [];
  for (const item of statement.items) {
    if (item.star) {
      const chosen = item.table === null ? scope : scope.filter((entry) => entry.ref === item.table);
      if (chosen.length === 0) throw new SqlError('no-column', `no table ${item.table}`);
      for (const entry of chosen) {
        entry.columns.forEach((name, at) => {
          const expr = { t: 'ref', i: entry.offset + at };
          if (aggregated) checkGroup(expr, grouped);
          items.push({ expr, name });
        });
      }
    } else {
      const expr = bind(item.expr, scope, true);
      if (aggregated) checkGroup(expr, grouped);
      const name = item.alias ?? (expr.t === 'ref' ? declared[expr.i] : `col${items.length + 1}`);
      items.push({ expr, name });
    }
  }
  const having = statement.having ? bind(statement.having, scope, true) : null;
  if (having && aggregated) checkGroup(having, grouped);
  const orders = statement.orderBy.map((item) => {
    const e = item.expr;
    if (e.t === 'lit' && e.int) {
      if (e.v < 1 || e.v > items.length) throw new SqlError('no-column', `no output column ${e.v}`);
      return { out: e.v - 1, desc: item.desc };
    }
    if (e.t === 'col' && e.table === null) {
      const named = items.flatMap((entry, at) => (entry.name.toLowerCase() === e.name ? [at] : []));
      if (named.length > 1) throw new SqlError('ambiguous', `output column ${e.name} is ambiguous`);
      if (named.length === 1) return { out: named[0], desc: item.desc };
    }
    const expr = bind(e, scope, true);
    if (aggregated) checkGroup(expr, grouped);
    return { expr, desc: item.desc };
  });

  // Rows.
  let rows = statement.from ? db.getTable(statement.from.table).rows.map((row) => [...row]) : [];
  for (let k = 0; k < statement.joins.length; k += 1) {
    const right = scope[k + 1].table;
    const nulls = right.columns.map(() => null);
    const next = [];
    for (const left of rows) {
      let matched = false;
      for (const partner of right.rows) {
        const combined = [...left, ...partner];
        if (evaluate(ons[k], combined, null) === true) {
          next.push(combined);
          matched = true;
        }
      }
      if (!matched && statement.joins[k].kind === 'left') next.push([...left, ...nulls]);
    }
    rows = next;
  }
  if (where) {
    rows = rows.filter((row) => {
      const v = evaluate(where, row, null);
      if (v !== null && typeof v !== 'boolean') throw new SqlError('type', 'WHERE needs a boolean');
      return v === true;
    });
  }

  let units;
  if (aggregated) {
    if (groupIdx.length === 0) units = [rows];
    else {
      const byKey = new Map();
      for (const row of rows) {
        const key = keyOfRow(groupIdx.map((i) => row[i]));
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(row);
      }
      units = [...byKey.values()];
    }
    if (having) {
      units = units.filter((group) => {
        const v = evaluate(having, group[0] ?? [], group);
        if (v !== null && typeof v !== 'boolean') throw new SqlError('type', 'HAVING needs a boolean');
        return v === true;
      });
    }
  } else units = rows;

  const entries = units.map((unit) => {
    const row = aggregated ? unit[0] ?? [] : unit;
    const group = aggregated ? unit : null;
    const out = items.map((item) => evaluate(item.expr, row, group));
    return { out, keys: orders.map((order) => (order.expr ? evaluate(order.expr, row, group) : out[order.out])) };
  });
  let sorted = entries;
  if (orders.length) sorted = sortRows(entries, orders.length, orders.map((order) => order.desc));
  let result = sorted.map((entry) => entry.out);
  const skip = statement.offset ?? 0;
  result = statement.limit === null ? result : result.slice(skip, skip + statement.limit);
  return { columns: items.map((item) => item.name), rows: result };
}
