const { T } = require('../db');

module.exports = function (app) {
  app.get('/api/collections', async (req, res) => {
    try {
      const db = app.locals.db;
      const rows = await db.all(`SELECT id, name, year, country, description FROM ${T('collections')} ORDER BY id`);
      const counts = await db.all(`SELECT collection_id, COUNT(*) as cnt FROM ${T('cards')} GROUP BY collection_id`);
      const countMap = {};
      for (const c of counts) countMap[c.collection_id] = c.cnt;
      res.json(rows.map(r => ({ ...r, cards: countMap[r.id] || 0 })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/collections/:id', async (req, res) => {
    try {
      const db = app.locals.db;
      const col = await db.get(`SELECT * FROM ${T('collections')} WHERE id = $1`, [req.params.id]);
      if (!col) return res.status(404).json({ error: 'Collection not found' });
      const cards = await db.all(`SELECT * FROM ${T('cards')} WHERE collection_id = $1 ORDER BY sort_order`, [req.params.id]);
      res.json({ ...col, cards: cards.map(c => ({ ...c, attacks: JSON.parse(c.attacks) })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
