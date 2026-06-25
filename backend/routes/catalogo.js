const { T } = require('../db');

module.exports = function (app) {
  app.get('/api/colecoes', async (req, res) => {
    try {
      const db = app.locals.db;
      const rows = await db.all(`SELECT * FROM ${T('colecoes')} ORDER BY id`);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/expansoes', async (req, res) => {
    try {
      const db = app.locals.db;
      const { colecao_id } = req.query;
      const rows = await db.all(`SELECT e.* FROM ${T('expansoes')} e WHERE e.colecao_id = $1 ORDER BY e.id`, [colecao_id]);
      for (const row of rows) {
        const cnt = await db.get(`SELECT COUNT(*) as cnt FROM ${T('cards')} WHERE expansao_id = $1`, [row.id]);
        row.cards = parseInt(cnt.cnt);
      }
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/paises', async (req, res) => {
    try {
      const db = app.locals.db;
      const { expansao_id } = req.query;
      const rows = await db.all(`
        SELECT DISTINCT p.id, p.name FROM ${T('paises')} p
        JOIN ${T('cards')} c ON c.pais_id = p.id
        WHERE c.expansao_id = $1
        ORDER BY p.id
      `, [expansao_id]);
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/cards', async (req, res) => {
    try {
      const db = app.locals.db;
      const { expansao_id, pais_id } = req.query;
      if (!expansao_id || !pais_id) return res.status(400).json({ error: 'expansao_id and pais_id required' });
      const cards = await db.all(`SELECT * FROM ${T('cards')} WHERE expansao_id = $1 AND pais_id = $2 ORDER BY sort_order`, [expansao_id, pais_id]);
      res.json(cards.map(c => ({ ...c, attacks: JSON.parse(c.attacks) })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
