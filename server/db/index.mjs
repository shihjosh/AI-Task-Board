import * as sqliteDriver from './sqlite.mjs'
import * as postgresDriver from './postgres.mjs'

const driverName = (process.env.DB_DRIVER || 'sqlite').toLowerCase()

if (driverName !== 'sqlite' && driverName !== 'postgres') {
  throw new Error(`未知的 DB_DRIVER: "${driverName}"（僅支援 'sqlite' 或 'postgres'）`)
}

if (driverName === 'postgres' && !process.env.DATABASE_URL) {
  throw new Error(
    'DB_DRIVER=postgres 需要設定 DATABASE_URL 環境變數（例如 postgres://user:pass@host:5432/dbname）',
  )
}

// 統一用 SQLite 風格的 `?` positional placeholder 撰寫查詢語句，
// Postgres 驅動在執行前自動轉成 `$1, $2, ...`。
function toPgSql(sql) {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

let readyPromise

function ensureReady() {
  if (!readyPromise) {
    readyPromise =
      driverName === 'postgres' ? postgresDriver.init() : sqliteDriver.getDb().then(() => {})
  }
  return readyPromise
}

/** 回傳所有符合的資料列（陣列） */
export async function all(sql, params = []) {
  await ensureReady()
  if (driverName === 'postgres') {
    const result = await postgresDriver.query(toPgSql(sql), params)
    return result.rows
  }
  const db = await sqliteDriver.getDb()
  return db.prepare(sql).all(...params)
}

/** 回傳第一筆符合的資料列，或 undefined */
export async function get(sql, params = []) {
  await ensureReady()
  if (driverName === 'postgres') {
    const result = await postgresDriver.query(toPgSql(sql), params)
    return result.rows[0]
  }
  const db = await sqliteDriver.getDb()
  return db.prepare(sql).get(...params)
}

/** 執行 INSERT / UPDATE / DELETE，回傳 { changes } */
export async function run(sql, params = []) {
  await ensureReady()
  if (driverName === 'postgres') {
    const result = await postgresDriver.query(toPgSql(sql), params)
    return { changes: result.rowCount }
  }
  const db = await sqliteDriver.getDb()
  const info = db.prepare(sql).run(...params)
  return { changes: info.changes }
}

export function getDriverName() {
  return driverName
}
