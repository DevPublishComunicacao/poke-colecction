const path = require('path');
const crypto = require('crypto');

const isPostgres = !!process.env.DATABASE_URL;

function T(name) {
  return isPostgres ? 'pc_' + name : name;
}

function fixSql(sql) {
  return isPostgres ? sql : sql.replace(/\$(\d+)/g, '?');
}

async function initDatabase() {
  if (isPostgres) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await createTablesPg(pool);
    return makePgDb(pool);
  } else {
    const Database = require('better-sqlite3');
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'pokecollection.db');
    const sqlite = new Database(DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    createTablesSqlite(sqlite);
    try { sqlite.exec("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''"); } catch (_) {}
    return makeSqliteDb(sqlite);
  }
}

async function createTablesPg(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T('collections')} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      year INTEGER NOT NULL,
      country TEXT NOT NULL,
      description TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T('cards')} (
      id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      number TEXT NOT NULL,
      total TEXT NOT NULL,
      image TEXT NOT NULL,
      type TEXT NOT NULL,
      hp TEXT NOT NULL,
      rarity TEXT NOT NULL,
      stage TEXT NOT NULL,
      weakness TEXT NOT NULL,
      resistance TEXT NOT NULL,
      retreat TEXT NOT NULL,
      attacks TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (collection_id, id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T('users')} (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T('user_stock')} (
      user_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      finish_none INTEGER NOT NULL DEFAULT 0,
      finish_holo INTEGER NOT NULL DEFAULT 0,
      finish_reverse INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, collection_id, card_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T('user_acquired')} (
      user_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      PRIMARY KEY (user_id, collection_id, card_id)
    )
  `);
}

function createTablesSqlite(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      year INTEGER NOT NULL,
      country TEXT NOT NULL,
      description TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      name TEXT NOT NULL,
      number TEXT NOT NULL,
      total TEXT NOT NULL,
      image TEXT NOT NULL,
      type TEXT NOT NULL,
      hp TEXT NOT NULL,
      rarity TEXT NOT NULL,
      stage TEXT NOT NULL,
      weakness TEXT NOT NULL,
      resistance TEXT NOT NULL,
      retreat TEXT NOT NULL,
      attacks TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (collection_id, id),
      FOREIGN KEY (collection_id) REFERENCES collections(id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_stock (
      user_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      finish_none INTEGER NOT NULL DEFAULT 0,
      finish_holo INTEGER NOT NULL DEFAULT 0,
      finish_reverse INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, collection_id, card_id)
    );
    CREATE TABLE IF NOT EXISTS user_acquired (
      user_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      PRIMARY KEY (user_id, collection_id, card_id)
    );
  `);
}

function makePgDb(pool) {
  return {
    type: 'pg',
    pool,
    all: async (sql, params) => { const r = await pool.query(fixSql(sql), params || []); return r.rows; },
    get: async (sql, params) => { const r = await pool.query(fixSql(sql), params || []); return r.rows[0] || null; },
    run: async (sql, params) => { const r = await pool.query(fixSql(sql), params || []); return { changes: r.rowCount }; },
    transaction(fn) {
      return async (...args) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const tx = {
            all: (sql, p) => client.query(fixSql(sql), p || []).then(r => r.rows),
            get: (sql, p) => client.query(fixSql(sql), p || []).then(r => r.rows[0] || null),
            run: (sql, p) => client.query(fixSql(sql), p || []).then(r => ({ changes: r.rowCount }))
          };
          const result = await fn(tx, ...args);
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      };
    },
    close: () => pool.end(),
    get open() { return true; }
  };
}

function makeSqliteDb(sqlite) {
  const wrap = (fn) => (...args) => {
    try { return Promise.resolve(fn(...args)); }
    catch (e) { return Promise.reject(e); }
  };
  return {
    type: 'sqlite',
    sqlite,
    all: wrap((sql, params) => sqlite.prepare(fixSql(sql)).all(...(params || []))),
    get: wrap((sql, params) => sqlite.prepare(fixSql(sql)).get(...(params || []))),
    run: wrap((sql, params) => sqlite.prepare(fixSql(sql)).run(...(params || []))),
    transaction(fn) {
      return (...args) => {
        const tx = sqlite.transaction((...txArgs) => {
          const inner = {
            all: (s, p) => sqlite.prepare(fixSql(s)).all(...(p || [])),
            get: (s, p) => sqlite.prepare(fixSql(s)).get(...(p || [])),
            run: (s, p) => sqlite.prepare(fixSql(s)).run(...(p || []))
          };
          return fn(inner, ...txArgs);
        });
        try { return Promise.resolve(tx(...args)); }
        catch (e) { return Promise.reject(e); }
      };
    },
    close: wrap(() => sqlite.close()),
    get open() { return sqlite.open; }
  };
}

module.exports = { initDatabase, T, isPostgres };
