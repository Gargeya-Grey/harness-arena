// OpenCode 2.x keeps its provider sign-ins (OAuth tokens and API keys) in the
// `credential` table of its SQLite database, next to every session and message.
// It no longer reads auth.json (checked on 2.2.5: `opencode auth list` in a home
// with a copy of auth.json says "No authenticated integrations").
//
// So the sign-in store copies the `credential` rows, and nothing else, into the
// new database that OpenCode makes in the temp home. After the call, a refreshed
// OAuth token goes back to the real database with one guarded UPDATE:
//   UPDATE credential SET value = <new> WHERE id = <id> AND value = <value we copied>
// If another process changed the row meanwhile, the UPDATE matches no row and the
// real row stays as it is. Only the `value` and `time_updated` columns are written.
//
// The database is read with node:sqlite (Node 22.13 or newer). Without it the
// isolated call returns an error; it never falls back to the real home.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export const DB_PARTS = ['.local', 'share', 'opencode', 'opencode.db'];
export const LABEL = 'opencode.db credential rows';

// node:sqlite is loaded on first use, so a Node without it only affects OpenCode isolation.
let loaded;
function sqlite() {
  if (loaded === undefined) {
    try {
      loaded = createRequire(import.meta.url)('node:sqlite').DatabaseSync;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

const open = (Database, file, options = {}) => new Database(file, options);

// The rows of the credential table, or [] when there is no database, no table or no node:sqlite.
async function readCredentials(file) {
  const Database = sqlite();
  if (!Database || !fs.existsSync(file)) return [];
  let db;
  try {
    db = open(Database, file, { readOnly: true });
    return db.prepare('SELECT * FROM credential').all();
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/**
 * Build the store for temp-home isolation.
 *   init({ dir, env })  makes OpenCode create its (empty) database in the temp home
 */
export function createOpenCodeSignIn({ init }) {
  const dbFile = (root) => path.join(root, ...DB_PARTS);
  return {
    label: LABEL,

    // Names only: what is missing, never a path or a value.
    missing(homeDir) {
      const file = dbFile(homeDir);
      if (!fs.existsSync(file)) return [LABEL];
      // The database must hold a non-empty credential table.
      const Database = sqlite();
      if (!Database) return [`${LABEL} (needs Node 22.13 or newer)`];
      let db;
      try {
        db = open(Database, file, { readOnly: true });
        return db.prepare('SELECT COUNT(*) AS n FROM credential').get().n > 0 ? [] : [LABEL];
      } catch {
        return [LABEL];
      } finally {
        db?.close();
      }
    },

    async seed({ homeDir, dir, env }) {
      const rows = await readCredentials(dbFile(homeDir));
      if (!rows.length) return { error: { type: 'auth', message: `Isolated mode needs the sign-in rows of ${LABEL}. Sign in inside OpenCode once, then run again. The real home is not used as a fallback.` } };
      const made = await init({ dir, env });
      if (made?.error) return { error: made.error };
      const Database = sqlite();
      const target = dbFile(dir);
      if (!Database || !fs.existsSync(target)) return { error: { type: 'harness_error', message: 'OpenCode did not create its database in the temp home, so the sign-in could not be placed there.' } };
      const db = open(Database, target);
      try {
        const columns = new Set(db.prepare('PRAGMA table_info(credential)').all().map((column) => column.name));
        const names = Object.keys(rows[0]).filter((name) => columns.has(name));
        if (!columns.size || !names.includes('id') || !names.includes('value')) {
          return { error: { type: 'harness_error', message: 'The OpenCode credential table has a layout this lab does not know; the isolated call did not start.' } };
        }
        const insert = db.prepare(`INSERT OR REPLACE INTO credential (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`);
        for (const row of rows) insert.run(...names.map((name) => row[name]));
      } finally {
        db.close();
      }
      return { before: new Map(rows.map((row) => [row.id, row.value])) };
    },

    async writeBack({ homeDir, dir, state, home }) {
      const Database = sqlite();
      const target = dbFile(dir);
      if (!Database || !state?.before || !fs.existsSync(target)) return;
      const now = new Map((await readCredentials(target)).map((row) => [row.id, row]));
      for (const [id, before] of state.before) {
        const row = now.get(id);
        if (!row || row.value === before) continue;
        const name = `credential ${String(id).replace(/[^\w.-]/g, '_').slice(0, 40)}`;
        if (typeof row.value !== 'string' || typeof before !== 'string') {
          home.kept.push(`${name} (not text; not written back)`);
          continue;
        }
        let wasJson = true;
        try {
          JSON.parse(before);
        } catch {
          wasJson = false;
        }
        if (wasJson) {
          try {
            JSON.parse(row.value);
          } catch {
            home.kept.push(`${name} (changed value is not valid JSON; not written back)`);
            continue;
          }
        }
        let db;
        try {
          db = open(Database, dbFile(homeDir));
          db.exec('PRAGMA busy_timeout = 5000');
          const changed = db.prepare('UPDATE credential SET value = ?, time_updated = COALESCE(?, time_updated) WHERE id = ? AND value = ?').run(row.value, row.time_updated ?? null, id, before).changes;
          if (Number(changed) === 1) home.written_back.push(name);
          else home.kept.push(`${name} (real row changed during the call; not overwritten)`);
        } catch {
          home.kept.push(`${name} (write back failed)`);
        } finally {
          db?.close();
        }
      }
    },
  };
}
