/**
 * The small part of SQLite the app uses. The app uses the SQLite that is built into Electron's Node
 * (node:sqlite), so there is no native module to rebuild when installing.
 */
import { DatabaseSync } from 'node:sqlite'
export interface SqlStmt {
  run(...args: unknown[]): unknown
  get(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
}

export interface SqlDb {
  prepare(sql: string): SqlStmt
  exec(sql: string): void
  close(): void
}

export type OpenDb = (file: string) => SqlDb

/** Run fn in one transaction. */
export function tx<T>(db: SqlDb, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* already rolled back */
    }
    throw e
  }
}

export function userVersion(db: SqlDb): number {
  const r = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  return r?.user_version ?? 0
}

export const openSqlite: OpenDb = (file) => {
  const db = new DatabaseSync(file)
  return {
    prepare: (sql: string) => {
      const st = db.prepare(sql)
      return {
        run: (...a: unknown[]) => st.run(...(a as never[])),
        get: (...a: unknown[]) => st.get(...(a as never[])),
        all: (...a: unknown[]) => st.all(...(a as never[]))
      }
    },
    exec: (sql: string) => db.exec(sql),
    close: () => db.close()
  }
}
