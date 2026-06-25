const { T } = require('../db');

function authRequired(req, res, next) {
  const auth = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    req.user = req.jwt.verify(token, req.jwtSecret);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = function (app) {
  const getDb = () => app.locals.db;

  app.get('/api/user/stock/:collectionId', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const rows = await db.all(`SELECT card_id, finish_none, finish_holo, finish_reverse FROM ${T('user_stock')} WHERE user_id = $1 AND collection_id = $2`, [req.user.userId, req.params.collectionId]);
      const stock = {};
      for (const r of rows) stock[r.card_id] = { none: r.finish_none, holo: r.finish_holo, reverse: r.finish_reverse };
      res.json(stock);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/user/stock/:collectionId', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { collectionId } = req.params;
      const stock = req.body;
      const txFn = db.transaction(async (tx) => {
        await tx.run(`DELETE FROM ${T('user_stock')} WHERE user_id = $1 AND collection_id = $2`, [req.user.userId, collectionId]);
        for (const [cardId, finishes] of Object.entries(stock)) {
          await tx.run(`INSERT INTO ${T('user_stock')} (user_id, collection_id, card_id, finish_none, finish_holo, finish_reverse) VALUES ($1, $2, $3, $4, $5, $6)`, [req.user.userId, collectionId, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0]);
        }
      });
      await txFn();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/user/acquired/:collectionId', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const rows = await db.all(`SELECT card_id FROM ${T('user_acquired')} WHERE user_id = $1 AND collection_id = $2 ORDER BY card_id`, [req.user.userId, req.params.collectionId]);
      res.json({ ids: rows.map(r => r.card_id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/user/acquired/:collectionId', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { collectionId } = req.params;
      const { ids } = req.body;
      const userId = req.user.userId;
      const txFn = db.transaction(async (tx) => {
        await tx.run(`DELETE FROM ${T('user_acquired')} WHERE user_id = $1 AND collection_id = $2`, [userId, collectionId]);
        if (ids && ids.length > 0) {
          for (const cardId of ids) {
            await tx.run(`INSERT INTO ${T('user_acquired')} (user_id, collection_id, card_id) VALUES ($1, $2, $3)`, [userId, collectionId, cardId]);
          }
        }
      });
      await txFn();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/user/all/:collectionId', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const userId = req.user.userId;
      const stockRows = await db.all(`SELECT card_id, finish_none, finish_holo, finish_reverse FROM ${T('user_stock')} WHERE user_id = $1 AND collection_id = $2`, [userId, req.params.collectionId]);
      const stock = {};
      for (const r of stockRows) stock[r.card_id] = { none: r.finish_none, holo: r.finish_holo, reverse: r.finish_reverse };
      const acqRows = await db.all(`SELECT card_id FROM ${T('user_acquired')} WHERE user_id = $1 AND collection_id = $2 ORDER BY card_id`, [userId, req.params.collectionId]);
      res.json({ stock, acquired: acqRows.map(r => r.card_id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/user/all/:collectionId', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { collectionId } = req.params;
      const { stock, acquired } = req.body;
      const userId = req.user.userId;
      const txFn = db.transaction(async (tx) => {
        await tx.run(`DELETE FROM ${T('user_stock')} WHERE user_id = $1 AND collection_id = $2`, [userId, collectionId]);
        await tx.run(`DELETE FROM ${T('user_acquired')} WHERE user_id = $1 AND collection_id = $2`, [userId, collectionId]);
        if (stock) {
          for (const [cardId, finishes] of Object.entries(stock)) {
            await tx.run(`INSERT INTO ${T('user_stock')} (user_id, collection_id, card_id, finish_none, finish_holo, finish_reverse) VALUES ($1, $2, $3, $4, $5, $6)`, [userId, collectionId, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0]);
          }
        }
        if (acquired && acquired.length > 0) {
          for (const cardId of acquired) {
            await tx.run(`INSERT INTO ${T('user_acquired')} (user_id, collection_id, card_id) VALUES ($1, $2, $3)`, [userId, collectionId, cardId]);
          }
        }
      });
      await txFn();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/migrate', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { collectionId, stock, acquired } = req.body;
      const userId = req.user.userId;
      if (!collectionId) return res.status(400).json({ error: 'collectionId required' });
      const txFn = db.transaction(async (tx) => {
        await tx.run(`DELETE FROM ${T('user_stock')} WHERE user_id = $1 AND collection_id = $2`, [userId, collectionId]);
        await tx.run(`DELETE FROM ${T('user_acquired')} WHERE user_id = $1 AND collection_id = $2`, [userId, collectionId]);
        if (stock) {
          for (const [cardId, finishes] of Object.entries(stock)) {
            await tx.run(`INSERT INTO ${T('user_stock')} (user_id, collection_id, card_id, finish_none, finish_holo, finish_reverse) VALUES ($1, $2, $3, $4, $5, $6)`, [userId, collectionId, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0]);
          }
        }
        if (acquired && acquired.length > 0) {
          for (const cardId of acquired) {
            await tx.run(`INSERT INTO ${T('user_acquired')} (user_id, collection_id, card_id) VALUES ($1, $2, $3)`, [userId, collectionId, cardId]);
          }
        }
      });
      await txFn();
      res.json({ ok: true, migrated: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/users', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const rows = await db.all(`SELECT username, name, created_at FROM ${T('users')} ORDER BY created_at`);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/user/export/:collectionId', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { collectionId } = req.params;
      const userId = req.user.userId;
      const stockRows = await db.all(`SELECT card_id, finish_none, finish_holo, finish_reverse FROM ${T('user_stock')} WHERE user_id = $1 AND collection_id = $2`, [userId, collectionId]);
      const stock = {};
      for (const r of stockRows) stock[r.card_id] = { none: r.finish_none, holo: r.finish_holo, reverse: r.finish_reverse };
      const acqRows = await db.all(`SELECT card_id FROM ${T('user_acquired')} WHERE user_id = $1 AND collection_id = $2 ORDER BY card_id`, [userId, collectionId]);
      res.json({ collectionId, stock, acquired: acqRows.map(r => r.card_id), exportedAt: new Date().toISOString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/user/import/:collectionId', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { collectionId } = req.params;
      const { stock, acquired } = req.body;
      const userId = req.user.userId;
      if (!stock && !acquired) return res.status(400).json({ error: 'Forneça stock e/ou acquired no body' });
      const txFn = db.transaction(async (tx) => {
        if (stock) {
          await tx.run(`DELETE FROM ${T('user_stock')} WHERE user_id = $1 AND collection_id = $2`, [userId, collectionId]);
          for (const [cardId, finishes] of Object.entries(stock)) {
            await tx.run(`INSERT INTO ${T('user_stock')} (user_id, collection_id, card_id, finish_none, finish_holo, finish_reverse) VALUES ($1, $2, $3, $4, $5, $6)`, [userId, collectionId, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0]);
          }
        }
        if (acquired && acquired.length > 0) {
          await tx.run(`DELETE FROM ${T('user_acquired')} WHERE user_id = $1 AND collection_id = $2`, [userId, collectionId]);
          for (const cardId of acquired) {
            await tx.run(`INSERT INTO ${T('user_acquired')} (user_id, collection_id, card_id) VALUES ($1, $2, $3)`, [userId, collectionId, cardId]);
          }
        }
      });
      await txFn();
      res.json({ ok: true, imported: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
