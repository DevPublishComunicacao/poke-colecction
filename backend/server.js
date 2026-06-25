const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { initDatabase } = require('./db');
const { seedDatabase } = require('./seed');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const keyFile = path.join(__dirname, '..', '.jwt_secret');
  try {
    if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim();
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, key);
    return key;
  } catch (_) { return crypto.randomBytes(32).toString('hex'); }
})();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

app.use((req, res, next) => {
  req.jwt = jwt;
  req.jwtSecret = JWT_SECRET;
  next();
});

require('./routes/catalogo')(app);
require('./routes/auth')(app);
require('./routes/user')(app);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: !!app.locals.db && app.locals.db.open });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

async function main() {
  const database = await initDatabase();
  global.__db = database;
  app.locals.db = database;
  await seedDatabase(database);
  app.listen(PORT, '0.0.0.0', () => {
    console.log('PokéCollection server running on http://localhost:' + PORT + ' (PostgreSQL)');
  });
}

main().catch(e => { console.error('Failed to start:', e); process.exit(1); });
