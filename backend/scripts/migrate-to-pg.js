const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'pokecollection.db');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Set DATABASE_URL to the target PostgreSQL');
  process.exit(1);
}

const T = (name) => 'pc_' + name;

async function main() {
  console.log('Connecting to SQLite:', DB_PATH);
  const sqlite = new Database(DB_PATH);

  console.log('Connecting to PostgreSQL...');
  const isLocal = DATABASE_URL.includes('@localhost') || DATABASE_URL.includes('@host.docker.internal');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } })
  });

  // Check if SQLite has data
  const userCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const stockCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM user_stock').get().cnt;
  const acqCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM user_acquired').get().cnt;
  console.log(`SQLite has: ${userCount} users, ${stockCount} stock, ${acqCount} acquired`);

  if (userCount === 0) {
    console.log('No data to migrate.');
    sqlite.close();
    await pool.end();
    return;
  }

  // Migrate users
  const users = sqlite.prepare('SELECT * FROM users').all();
  console.log(`Migrating ${users.length} users...`);
  for (const u of users) {
    await pool.query(
      `INSERT INTO ${T('users')} (id, username, name, password, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [u.id, u.username, u.name, u.password, u.created_at]
    );
  }

  // Migrate user_stock
  const stock = sqlite.prepare('SELECT * FROM user_stock').all();
  console.log(`Migrating ${stock.length} stock entries...`);
  for (const s of stock) {
    await pool.query(
      `INSERT INTO ${T('user_stock')} (user_id, collection_id, card_id, finish_none, finish_holo, finish_reverse) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, collection_id, card_id) DO NOTHING`,
      [s.user_id, s.collection_id, s.card_id, s.finish_none, s.finish_holo, s.finish_reverse]
    );
  }

  // Migrate user_acquired
  const acq = sqlite.prepare('SELECT * FROM user_acquired').all();
  console.log(`Migrating ${acq.length} acquired entries...`);
  for (const a of acq) {
    await pool.query(
      `INSERT INTO ${T('user_acquired')} (user_id, collection_id, card_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, collection_id, card_id) DO NOTHING`,
      [a.user_id, a.collection_id, a.card_id]
    );
  }

  sqlite.close();
  await pool.end();
  console.log('Migration complete!');
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
