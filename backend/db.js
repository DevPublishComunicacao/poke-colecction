const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

function T(name) {
  return 'pc_' + name;
}

const isLocal = DATABASE_URL.includes('@localhost') || DATABASE_URL.includes('@host.docker.internal');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } })
});

async function createTables() {
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

const db = {
  type: 'pg',
  pool,
  all: async (sql, params) => { const r = await pool.query(sql, params || []); return r.rows; },
  get: async (sql, params) => { const r = await pool.query(sql, params || []); return r.rows[0] || null; },
  run: async (sql, params) => { const r = await pool.query(sql, params || []); return { changes: r.rowCount }; },
  transaction(fn) {
    return async (...args) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx = {
          all: (sql, p) => client.query(sql, p || []).then(r => r.rows),
          get: (sql, p) => client.query(sql, p || []).then(r => r.rows[0] || null),
          run: (sql, p) => client.query(sql, p || []).then(r => ({ changes: r.rowCount }))
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

async function initDatabase() {
  await createTables();
  return db;
}

module.exports = { initDatabase, T, db };
