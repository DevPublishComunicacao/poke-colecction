const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { T } = require('../db');

function generateUserId() { return crypto.randomUUID(); }

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = function (app) {
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
      const db = app.locals.db;
      const { username, password, name } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
      if (username.length < 3) return res.status(400).json({ error: 'Username must have at least 3 characters' });
      const pwErrors = [];
if (password.length < 8) pwErrors.push('8+ caracteres');
if (!/[A-Z]/.test(password)) pwErrors.push('1 letra maiúscula');
if ((password.match(/[a-z]/g) || []).length < 3) pwErrors.push('3 letras minúsculas');
if (!/[^a-zA-Z0-9]/.test(password)) pwErrors.push('1 caractere especial');
if ((password.match(/\d/g) || []).length < 3) pwErrors.push('3 números');
if (pwErrors.length) return res.status(400).json({ error: 'Senha deve ter: ' + pwErrors.join(', ') });
      const displayName = (name || '').trim();
      if (displayName && displayName.length < 3) return res.status(400).json({ error: 'Name must have at least 3 characters' });
      const existing = await db.get(`SELECT id FROM ${T('users')} WHERE username = $1`, [username]);
      if (existing) return res.status(409).json({ error: 'Username already taken' });
      const id = generateUserId();
      const hash = bcrypt.hashSync(password, 10);
      const adminUsers = (process.env.ADMIN_USERNAME || '').split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
      const isAdmin = adminUsers.includes(username.toLowerCase());
      await db.run(`INSERT INTO ${T('users')} (id, username, name, password, is_admin) VALUES ($1, $2, $3, $4, $5)`, [id, username, displayName, hash, isAdmin]);
      const token = req.jwt.sign({ userId: id, username, name: displayName, is_admin: isAdmin }, req.jwtSecret, { expiresIn: '30d' });
      res.status(201).json({ token, user: { id, username, name: displayName, is_admin: isAdmin } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      const db = app.locals.db;
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
      const user = await db.get(`SELECT * FROM ${T('users')} WHERE username = $1`, [username]);
      if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid username or password' });
      const token = req.jwt.sign({ userId: user.id, username: user.username, name: user.name, is_admin: user.is_admin }, req.jwtSecret, { expiresIn: '30d' });
      res.json({ token, user: { id: user.id, username: user.username, name: user.name, is_admin: user.is_admin } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
