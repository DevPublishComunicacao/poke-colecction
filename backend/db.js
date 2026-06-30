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
    CREATE TABLE IF NOT EXISTS ${T('colecoes')} (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T('expansoes')} (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      colecao_id INTEGER NOT NULL REFERENCES ${T('colecoes')}(id),
      year INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT ''
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T('paises')} (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    )
  `);
  // Add continent / language columns if missing
  for (const col of ['continent', 'language']) {
    try {
      await pool.query(`ALTER TABLE ${T('paises')} ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    } catch (_) { /* column already exists */ }
  }
  // Fill existing rows
  await pool.query(`UPDATE ${T('paises')} SET continent = 'América do Norte', language = 'Inglês' WHERE name = 'EUA (Inglês)' AND (continent IS NULL OR continent = '')`);
  await pool.query(`UPDATE ${T('paises')} SET continent = 'América do Sul', language = 'Português' WHERE name = 'Brasil (Pt-BR)' AND (continent IS NULL OR continent = '')`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T('users')} (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Ensure is_admin column exists (for existing databases)
  try {
    await pool.query(`ALTER TABLE ${T('users')} ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE`);
  } catch (_) {}

  const hasOld = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
    [T('collections')]
  ).then(r => r.rows[0].exists);

  if (hasOld) {
    console.log('Migrating from old schema...');
    const oldStock = await pool.query(`SELECT * FROM ${T('user_stock')}`).then(r => r.rows);
    const oldAcquired = await pool.query(`SELECT * FROM ${T('user_acquired')}`).then(r => r.rows);

    await pool.query(`DROP TABLE IF EXISTS ${T('collections')} CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ${T('cards')} CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ${T('user_stock')} CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ${T('user_acquired')} CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ${T('user_preferences')} CASCADE`);

    await pool.query(`
      CREATE TABLE ${T('cards')} (
        id TEXT NOT NULL,
        expansao_id INTEGER NOT NULL REFERENCES ${T('expansoes')}(id),
        pais_id INTEGER NOT NULL REFERENCES ${T('paises')}(id),
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
        PRIMARY KEY (expansao_id, pais_id, id)
      )
    `);
    await pool.query(`
      CREATE TABLE ${T('user_stock')} (
        user_id TEXT NOT NULL,
        expansao_id INTEGER NOT NULL,
        pais_id INTEGER NOT NULL,
        card_id TEXT NOT NULL,
        finish_none INTEGER NOT NULL DEFAULT 0,
        finish_holo INTEGER NOT NULL DEFAULT 0,
        finish_reverse INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, expansao_id, pais_id, card_id)
      )
    `);
    await pool.query(`
      CREATE TABLE ${T('user_acquired')} (
        user_id TEXT NOT NULL,
        expansao_id INTEGER NOT NULL,
        pais_id INTEGER NOT NULL,
        card_id TEXT NOT NULL,
        PRIMARY KEY (user_id, expansao_id, pais_id, card_id)
      )
    `);
    await pool.query(`
      CREATE TABLE ${T('user_preferences')} (
        user_id TEXT PRIMARY KEY REFERENCES ${T('users')}(id),
        colecao_id INTEGER NOT NULL REFERENCES ${T('colecoes')}(id),
        expansao_id INTEGER NOT NULL REFERENCES ${T('expansoes')}(id),
        pais_id INTEGER NOT NULL REFERENCES ${T('paises')}(id)
      )
    `);

    global.__migrate_stock = oldStock;
    global.__migrate_acquired = oldAcquired;
    console.log('Migration: backed up ' + oldStock.length + ' stock, ' + oldAcquired.length + ' acquired');
  } else {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${T('cards')} (
        id TEXT NOT NULL,
        expansao_id INTEGER NOT NULL REFERENCES ${T('expansoes')}(id),
        pais_id INTEGER NOT NULL REFERENCES ${T('paises')}(id),
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
        PRIMARY KEY (expansao_id, pais_id, id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${T('user_stock')} (
        user_id TEXT NOT NULL,
        expansao_id INTEGER NOT NULL,
        pais_id INTEGER NOT NULL,
        card_id TEXT NOT NULL,
        finish_none INTEGER NOT NULL DEFAULT 0,
        finish_holo INTEGER NOT NULL DEFAULT 0,
        finish_reverse INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, expansao_id, pais_id, card_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${T('user_acquired')} (
        user_id TEXT NOT NULL,
        expansao_id INTEGER NOT NULL,
        pais_id INTEGER NOT NULL,
        card_id TEXT NOT NULL,
        PRIMARY KEY (user_id, expansao_id, pais_id, card_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${T('user_preferences')} (
        user_id TEXT PRIMARY KEY REFERENCES ${T('users')}(id),
        colecao_id INTEGER NOT NULL REFERENCES ${T('colecoes')}(id),
        expansao_id INTEGER NOT NULL REFERENCES ${T('expansoes')}(id),
        pais_id INTEGER NOT NULL REFERENCES ${T('paises')}(id)
      )
    `);
  }
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
