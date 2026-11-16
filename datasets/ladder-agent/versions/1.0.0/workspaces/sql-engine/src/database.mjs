import { execute } from './executor.mjs';
import { parse } from './parser.mjs';

export class Database {
  #tables = new Map();

  constructor(tables = {}) {
    for (const [name, def] of Object.entries(tables)) {
      const key = name.toLowerCase();
      if (this.#tables.has(key)) throw new Error(`table ${name} is declared twice`);
      if (!def || !Array.isArray(def.columns) || !Array.isArray(def.rows)) throw new TypeError(`table ${name} needs columns and rows`);
      const columns = def.columns.map(String);
      if (new Set(columns.map((column) => column.toLowerCase())).size !== columns.length) throw new Error(`table ${name} has a column twice`);
      for (const row of def.rows) if (!Array.isArray(row) || row.length !== columns.length) throw new Error(`table ${name} has a row of the wrong length`);
      this.#tables.set(key, { name, columns, rows: def.rows.map((row) => [...row]) });
    }
  }

  /** { name, columns, rows } of a table, or undefined. The name is not case-sensitive. */
  getTable(name) {
    return this.#tables.get(String(name).toLowerCase());
  }

  query(sql) {
    return execute(parse(sql), this);
  }
}
