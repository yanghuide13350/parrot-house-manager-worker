import { DatabaseSync } from 'node:sqlite'

export function createD1(migration) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(migration)
  function prepared(sql, values = []) {
    return {
      sql, values,
      bind(...next) { return prepared(sql, next) },
      async first() { return sqlite.prepare(sql).get(...values) || null },
      async all() { return { results: sqlite.prepare(sql).all(...values) } },
      async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: result.changes } } }
    }
  }
  return {
    prepare: prepared,
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE')
      try { const results=[]; for(const item of statements)results.push(await item.run()); sqlite.exec('COMMIT'); return results }
      catch(error){sqlite.exec('ROLLBACK');throw error}
    },
    close(){sqlite.close()}
  }
}
