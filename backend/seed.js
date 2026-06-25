const path = require('path');
const fs = require('fs');
const { T } = require('./db');

const CACHE_FILE = path.join(__dirname, '..', 'seed-cache.json');

function escapeJs(s) {
  if (!s) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').replace(/\r/g, '');
}

function formatWeakness(w) {
  if (!w || !w.type) return 'Nenhuma';
  return w.type + ' ×' + (w.value || '2');
}

function formatResistance(r) {
  if (!r || !r.type) return 'Nenhuma';
  return r.type + ' -' + (r.value || '30');
}

function formatRetreat(n) {
  if (n === null || n === undefined || n === 0 || n === '') return '0';
  return '★'.repeat(parseInt(n, 10));
}

const CARD_IDS = Array.from({ length: 122 }, (_, i) => (i + 1).toString().padStart(3, '0'));

function loadCardCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (data && data.en && data.pt) return data;
    }
  } catch (_) {}
  return null;
}

function saveCardCache(enCards, ptCards) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ en: enCards, pt: ptCards }));
  } catch (_) {}
}

async function fetchSingleCard(lang, lid) {
  const resp = await fetch(`https://api.tcgdex.net/v2/${lang}/cards/me04-${lid}`);
  if (!resp.ok) return null;
  const c = await resp.json();
  const attacks = [];
  if (c.abilities) {
    for (const ab of c.abilities) {
      attacks.push({ name: escapeJs(ab.name) + ' (Habilidade)', damage: '', desc: escapeJs(ab.effect) });
    }
  }
  if (c.attacks) {
    for (const at of c.attacks) {
      attacks.push({ name: escapeJs(at.name), damage: at.damage || '', desc: escapeJs(at.effect || '—') });
    }
  }
  return {
    id: 'me4-' + lid,
    name: c.name || '',
    number: lid,
    total: lang === 'pt' ? '86' : '122',
    image: 'assets/me4' + (lang === 'pt' ? '-pt' : '') + '-' + lid + '.webp',
    type: c.types && c.types.length > 0 ? c.types[0] : '—',
    hp: c.hp != null ? String(c.hp) : '-',
    rarity: c.rarity || 'Comum',
    stage: c.stage || '—',
    weakness: c.weaknesses && c.weaknesses[0] ? formatWeakness(c.weaknesses[0]) : 'Nenhuma',
    resistance: c.resistances && c.resistances[0] ? formatResistance(c.resistances[0]) : 'Nenhuma',
    retreat: c.retreat != null ? formatRetreat(c.retreat) : '0',
    attacks
  };
}

async function fetchTcgdexCards(lang) {
  const batchSize = 30;
  const results = [];
  for (let i = 0; i < CARD_IDS.length; i += batchSize) {
    const batch = CARD_IDS.slice(i, i + batchSize);
    const cards = await Promise.all(batch.map(lid =>
      fetchSingleCard(lang, lid).catch(() => null)
    ));
    results.push(...cards.filter(Boolean));
  }
  return results;
}

async function seedDatabase(db) {
  // Check if already seeded on new schema
  const col = await db.get(`SELECT COUNT(*) as cnt FROM ${T('colecoes')}`);
  if (col.cnt > 0) {
    // Already seeded — just ensure cache exists
    if (!loadCardCache()) {
      const enCards = await db.all(`SELECT * FROM ${T('cards')} WHERE expansao_id = 1 AND pais_id = 1 ORDER BY sort_order`);
      const ptCards = await db.all(`SELECT * FROM ${T('cards')} WHERE expansao_id = 1 AND pais_id = 2 ORDER BY sort_order`);
      if (enCards.length && ptCards.length) {
        const mapCard = c => ({ ...c, attacks: JSON.parse(c.attacks) });
        saveCardCache(enCards.map(mapCard), ptCards.map(mapCard));
      }
    }
    return;
  }

  const COLEAO_ID = 1;
  const EXPANSAO_ID = 1;
  const PAIS_EUA = 1;
  const PAIS_BRASIL = 2;

  console.log('Fetching card data from TCGDex API...');
  const cached = loadCardCache();
  let enCards, ptCards;
  if (cached) {
    console.log('Using cached seed data');
    enCards = cached.en;
    ptCards = cached.pt;
  } else {
    [enCards, ptCards] = await Promise.all([
      fetchTcgdexCards('en').catch(e => { console.error('Failed to fetch EN cards:', e.message); return []; }),
      fetchTcgdexCards('pt').catch(e => { console.error('Failed to fetch PT cards:', e.message); return []; })
    ]);
    saveCardCache(enCards, ptCards);
  }

  const txFn = db.transaction(async (tx) => {
    await tx.run(`INSERT INTO ${T('colecoes')} (id, name) VALUES ($1, $2)`, [COLEAO_ID, 'Megaevoluções']);
    await tx.run(`INSERT INTO ${T('expansoes')} (id, name, colecao_id, year, description) VALUES ($1, $2, $3, $4, $5)`,
      [EXPANSAO_ID, 'Caos Ascendente', COLEAO_ID, 2026, 'Caos Ascendente apresenta novas Megaevoluções com ilustrações impressionantes de Kalos.']);
    await tx.run(`INSERT INTO ${T('paises')} (id, name) VALUES ($1, $2)`, [PAIS_EUA, 'Estados Unidos']);
    await tx.run(`INSERT INTO ${T('paises')} (id, name) VALUES ($1, $2)`, [PAIS_BRASIL, 'Brasil']);

    for (let idx = 0; idx < enCards.length; idx++) {
      const c = enCards[idx];
      await tx.run(`INSERT INTO ${T('cards')} (id, expansao_id, pais_id, name, number, total, image, type, hp, rarity, stage, weakness, resistance, retreat, attacks, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [c.id, EXPANSAO_ID, PAIS_EUA, c.name, c.number, c.total, c.image, c.type, c.hp, c.rarity, c.stage, c.weakness, c.resistance, c.retreat, JSON.stringify(c.attacks || []), idx]);
    }
    for (let idx = 0; idx < ptCards.length; idx++) {
      const c = ptCards[idx];
      await tx.run(`INSERT INTO ${T('cards')} (id, expansao_id, pais_id, name, number, total, image, type, hp, rarity, stage, weakness, resistance, retreat, attacks, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [c.id, EXPANSAO_ID, PAIS_BRASIL, c.name, c.number, c.total, c.image, c.type, c.hp, c.rarity, c.stage, c.weakness, c.resistance, c.retreat, JSON.stringify(c.attacks || []), idx]);
    }
  });
  await txFn();

  const totalCards = enCards.length + ptCards.length;
  console.log('Database seeded: 1 coleção, 1 expansão, 2 países, ' + totalCards + ' cards');

  // Restore migrated user data from old schema
  if (global.__migrate_stock && global.__migrate_stock.length > 0) {
    console.log('Restoring ' + global.__migrate_stock.length + ' stock entries...');
    for (const row of global.__migrate_stock) {
      const paisId = row.collection_id === 'chaos-rising-ptbr' ? PAIS_BRASIL : PAIS_EUA;
      await db.run(`INSERT INTO ${T('user_stock')} (user_id, expansao_id, pais_id, card_id, finish_none, finish_holo, finish_reverse) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [row.user_id, EXPANSAO_ID, paisId, row.card_id, row.finish_none, row.finish_holo, row.finish_reverse]);
    }
    global.__migrate_stock = null;
  }
  if (global.__migrate_acquired && global.__migrate_acquired.length > 0) {
    console.log('Restoring ' + global.__migrate_acquired.length + ' acquired entries...');
    for (const row of global.__migrate_acquired) {
      const paisId = row.collection_id === 'chaos-rising-ptbr' ? PAIS_BRASIL : PAIS_EUA;
      await db.run(`INSERT INTO ${T('user_acquired')} (user_id, expansao_id, pais_id, card_id) VALUES ($1,$2,$3,$4)`,
        [row.user_id, EXPANSAO_ID, paisId, row.card_id]);
    }
    global.__migrate_acquired = null;
  }
}

module.exports = { seedDatabase };
