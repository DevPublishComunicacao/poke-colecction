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

  // --- User Preferences ---
  app.get('/api/user/preferences', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const pref = await db.get(`SELECT colecao_id, expansao_id, pais_id FROM ${T('user_preferences')} WHERE user_id = $1`, [req.user.userId]);
      res.json(pref || null);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/user/preferences', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { colecao_id, expansao_id, pais_id } = req.body;
      if (!colecao_id || !expansao_id || !pais_id) return res.status(400).json({ error: 'colecao_id, expansao_id, pais_id required' });
      await db.run(`
        INSERT INTO ${T('user_preferences')} (user_id, colecao_id, expansao_id, pais_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE SET colecao_id = $2, expansao_id = $3, pais_id = $4
      `, [req.user.userId, colecao_id, expansao_id, pais_id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Stock ---
  app.get('/api/user/stock', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { expansao_id, pais_id } = req.query;
      const rows = await db.all(`SELECT card_id, finish_none, finish_holo, finish_reverse FROM ${T('user_stock')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
        [req.user.userId, expansao_id, pais_id]);
      const stock = {};
      for (const r of rows) stock[r.card_id] = { none: r.finish_none, holo: r.finish_holo, reverse: r.finish_reverse };
      res.json(stock);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/user/stock', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { expansao_id, pais_id } = req.query;
      const stock = req.body;
      const txFn = db.transaction(async (tx) => {
        await tx.run(`DELETE FROM ${T('user_stock')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
          [req.user.userId, expansao_id, pais_id]);
        for (const [cardId, finishes] of Object.entries(stock)) {
          await tx.run(`INSERT INTO ${T('user_stock')} (user_id, expansao_id, pais_id, card_id, finish_none, finish_holo, finish_reverse) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [req.user.userId, expansao_id, pais_id, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0]);
        }
      });
      await txFn();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Acquired ---
  app.get('/api/user/acquired', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { expansao_id, pais_id } = req.query;
      const rows = await db.all(`SELECT card_id FROM ${T('user_acquired')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3 ORDER BY card_id`,
        [req.user.userId, expansao_id, pais_id]);
      res.json({ ids: rows.map(r => r.card_id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/user/acquired', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { expansao_id, pais_id } = req.query;
      const { ids } = req.body;
      const userId = req.user.userId;
      const txFn = db.transaction(async (tx) => {
        await tx.run(`DELETE FROM ${T('user_acquired')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
          [userId, expansao_id, pais_id]);
        if (ids && ids.length > 0) {
          for (const cardId of ids) {
            await tx.run(`INSERT INTO ${T('user_acquired')} (user_id, expansao_id, pais_id, card_id) VALUES ($1, $2, $3, $4)`,
              [userId, expansao_id, pais_id, cardId]);
          }
        }
      });
      await txFn();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- All (stock + acquired) ---
  app.get('/api/user/all', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const userId = req.user.userId;
      const { expansao_id, pais_id } = req.query;
      const stockRows = await db.all(`SELECT card_id, finish_none, finish_holo, finish_reverse FROM ${T('user_stock')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
        [userId, expansao_id, pais_id]);
      const stock = {};
      for (const r of stockRows) stock[r.card_id] = { none: r.finish_none, holo: r.finish_holo, reverse: r.finish_reverse };
      const acqRows = await db.all(`SELECT card_id FROM ${T('user_acquired')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3 ORDER BY card_id`,
        [userId, expansao_id, pais_id]);
      res.json({ stock, acquired: acqRows.map(r => r.card_id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/user/all', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { expansao_id, pais_id } = req.query;
      const { stock, acquired } = req.body;
      const userId = req.user.userId;
      const txFn = db.transaction(async (tx) => {
        await tx.run(`DELETE FROM ${T('user_stock')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
          [userId, expansao_id, pais_id]);
        await tx.run(`DELETE FROM ${T('user_acquired')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
          [userId, expansao_id, pais_id]);
        if (stock) {
          for (const [cardId, finishes] of Object.entries(stock)) {
            await tx.run(`INSERT INTO ${T('user_stock')} (user_id, expansao_id, pais_id, card_id, finish_none, finish_holo, finish_reverse) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [userId, expansao_id, pais_id, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0]);
          }
        }
        if (acquired && acquired.length > 0) {
          for (const cardId of acquired) {
            await tx.run(`INSERT INTO ${T('user_acquired')} (user_id, expansao_id, pais_id, card_id) VALUES ($1, $2, $3, $4)`,
              [userId, expansao_id, pais_id, cardId]);
          }
        }
      });
      await txFn();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Migrate (old collectionId → new expansao/pais) ---
  app.post('/api/migrate', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { expansao_id, pais_id, stock, acquired } = req.body;
      const userId = req.user.userId;
      if (!expansao_id || !pais_id) return res.status(400).json({ error: 'expansao_id and pais_id required' });
      const txFn = db.transaction(async (tx) => {
        await tx.run(`DELETE FROM ${T('user_stock')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
          [userId, expansao_id, pais_id]);
        await tx.run(`DELETE FROM ${T('user_acquired')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
          [userId, expansao_id, pais_id]);
        if (stock) {
          for (const [cardId, finishes] of Object.entries(stock)) {
            await tx.run(`INSERT INTO ${T('user_stock')} (user_id, expansao_id, pais_id, card_id, finish_none, finish_holo, finish_reverse) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [userId, expansao_id, pais_id, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0]);
          }
        }
        if (acquired && acquired.length > 0) {
          for (const cardId of acquired) {
            await tx.run(`INSERT INTO ${T('user_acquired')} (user_id, expansao_id, pais_id, card_id) VALUES ($1, $2, $3, $4)`,
              [userId, expansao_id, pais_id, cardId]);
          }
        }
      });
      await txFn();
      res.json({ ok: true, migrated: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Admin: delete expansion ---
  app.delete('/api/admin/expansoes/:id', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;
      const txFn = db.transaction(async (tx) => {
        await tx.run(`DELETE FROM ${T('cards')} WHERE expansao_id = $1`, [id]);
        await tx.run(`DELETE FROM ${T('user_stock')} WHERE expansao_id = $1`, [id]);
        await tx.run(`DELETE FROM ${T('user_acquired')} WHERE expansao_id = $1`, [id]);
        await tx.run(`DELETE FROM ${T('user_preferences')} WHERE expansao_id = $1`, [id]);
        await tx.run(`DELETE FROM ${T('expansoes')} WHERE id = $1`, [id]);
      });
      await txFn();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Admin: create expansion ---
  app.post('/api/admin/expansoes', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { name, colecao_id, year, description, pais_id, copy_cards_from_expansao_id } = req.body;
      if (!name || !colecao_id || !pais_id) return res.status(400).json({ error: 'name, colecao_id, pais_id required' });
      const txFn = db.transaction(async (tx) => {
        const r = await tx.get(`INSERT INTO ${T('expansoes')} (name, colecao_id, year, description) VALUES ($1, $2, $3, $4) RETURNING id`,
          [name, colecao_id, year || new Date().getFullYear(), description || '']);
        const newId = r.id;
        if (copy_cards_from_expansao_id) {
          const cards = await tx.all(`SELECT * FROM ${T('cards')} WHERE expansao_id = $1 AND pais_id = $2`, [copy_cards_from_expansao_id, pais_id]);
          for (const c of cards) {
            await tx.run(`INSERT INTO ${T('cards')} (id, expansao_id, pais_id, name, number, total, image, type, hp, rarity, stage, weakness, resistance, retreat, attacks, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
              [c.id, newId, pais_id, c.name, c.number, c.total, c.image, c.type, c.hp, c.rarity, c.stage, c.weakness, c.resistance, c.retreat, c.attacks, c.sort_order]);
          }
        }
        return newId;
      });
      const newId = await txFn();
      res.json({ ok: true, id: newId });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Admin: countries ---
  app.get('/api/admin/paises', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const rows = await db.all(`SELECT id, name, continent, language FROM ${T('paises')} ORDER BY id`);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Users list ---
  app.get('/api/users', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const rows = await db.all(`SELECT username, name, created_at FROM ${T('users')} ORDER BY created_at`);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Export / Import (per expansao+pais) ---
  app.get('/api/user/export', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { expansao_id, pais_id } = req.query;
      const userId = req.user.userId;
      const stockRows = await db.all(`SELECT card_id, finish_none, finish_holo, finish_reverse FROM ${T('user_stock')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
        [userId, expansao_id, pais_id]);
      const stock = {};
      for (const r of stockRows) stock[r.card_id] = { none: r.finish_none, holo: r.finish_holo, reverse: r.finish_reverse };
      const acqRows = await db.all(`SELECT card_id FROM ${T('user_acquired')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3 ORDER BY card_id`,
        [userId, expansao_id, pais_id]);
      res.json({ expansao_id, pais_id, stock, acquired: acqRows.map(r => r.card_id), exportedAt: new Date().toISOString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/user/import', authRequired, async (req, res) => {
    try {
      const db = getDb();
      const { expansao_id, pais_id, stock, acquired } = req.body;
      const userId = req.user.userId;
      if (!stock && !acquired) return res.status(400).json({ error: 'Forneça stock e/ou acquired no body' });
      const txFn = db.transaction(async (tx) => {
        if (stock) {
          await tx.run(`DELETE FROM ${T('user_stock')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
            [userId, expansao_id, pais_id]);
          for (const [cardId, finishes] of Object.entries(stock)) {
            await tx.run(`INSERT INTO ${T('user_stock')} (user_id, expansao_id, pais_id, card_id, finish_none, finish_holo, finish_reverse) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [userId, expansao_id, pais_id, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0]);
          }
        }
        if (acquired && acquired.length > 0) {
          await tx.run(`DELETE FROM ${T('user_acquired')} WHERE user_id = $1 AND expansao_id = $2 AND pais_id = $3`,
            [userId, expansao_id, pais_id]);
          for (const cardId of acquired) {
            await tx.run(`INSERT INTO ${T('user_acquired')} (user_id, expansao_id, pais_id, card_id) VALUES ($1, $2, $3, $4)`,
              [userId, expansao_id, pais_id, cardId]);
          }
        }
      });
      await txFn();
      res.json({ ok: true, imported: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
