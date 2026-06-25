const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { T } = require('../db');

function generateUserId() { return crypto.randomUUID(); }

module.exports = function (app) {
  app.post('/api/auth/register', async (req, res) => {
    try {
      const db = app.locals.db;
      const { username, password, name } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
      if (username.length < 3) return res.status(400).json({ error: 'Username must have at least 3 characters' });
      if (password.length < 4) return res.status(400).json({ error: 'Password must have at least 4 characters' });
      const displayName = (name || '').trim();
      if (displayName && displayName.length < 3) return res.status(400).json({ error: 'Name must have at least 3 characters' });
      const existing = await db.get(`SELECT id FROM ${T('users')} WHERE username = $1`, [username]);
      if (existing) return res.status(409).json({ error: 'Username already taken' });
      const id = generateUserId();
      const hash = bcrypt.hashSync(password, 10);
      await db.run(`INSERT INTO ${T('users')} (id, username, name, password) VALUES ($1, $2, $3, $4)`, [id, username, displayName, hash]);
      const token = req.jwt.sign({ userId: id, username, name: displayName }, req.jwtSecret, { expiresIn: '30d' });
      res.status(201).json({ token, user: { id, username, name: displayName } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const db = app.locals.db;
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
      const user = await db.get(`SELECT * FROM ${T('users')} WHERE username = $1`, [username]);
      if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid username or password' });
      const token = req.jwt.sign({ userId: user.id, username: user.username, name: user.name }, req.jwtSecret, { expiresIn: '30d' });
      res.json({ token, user: { id: user.id, username: user.username, name: user.name } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
