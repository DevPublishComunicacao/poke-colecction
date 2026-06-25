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

const SAMPLE_COLLECTIONS = [
  {
    id: 'base-set',
    name: 'Base Set (1ª Edição)',
    year: 1999,
    country: 'Estados Unidos',
    description: 'A lendária coleção original que iniciou a febre de Pokémon TCG no ocidente.',
    cards: [
      { id: 'charizard-base', name: 'Charizard', number: '4', total: '102', image: 'assets/charizard.png', type: 'Fogo', hp: '120', rarity: 'Raro Holo', stage: 'Estágio 2', attacks: [{ name: 'Chama Giratória', damage: '100', desc: 'Descarte 2 Energias ligadas a Charizard.' }], weakness: 'Água ×2', resistance: 'Nenhuma', retreat: '★★' },
      { id: 'pikachu-base', name: 'Pikachu', number: '58', total: '102', image: 'assets/pikachu.png', type: 'Relâmpago', hp: '60', rarity: 'Comum', stage: 'Básico', attacks: [{ name: 'Faísca', damage: '30', desc: 'Jogue uma moeda.' }], weakness: 'Lutador ×2', resistance: 'Nenhuma', retreat: '★' }
    ]
  },
  {
    id: 'neo-genesis',
    name: 'Neo Genesis (Edição Japonesa)',
    year: 2000,
    country: 'Japão',
    description: 'A lendária coleção que apresentou os Pokémon de Johto ao TCG.',
    cards: [
      { id: 'lugia-neo', name: 'Lugia', number: '9', total: '111', image: 'assets/lugia.png', type: 'Incolor', hp: '90', rarity: 'Raro Holo', stage: 'Básico', attacks: [{ name: 'Vento Psíquico', damage: '40', desc: 'O Pokémon Ativo do oponente agora está Confuso.' }], weakness: 'Elétrico ×2', resistance: 'Lutador -30', retreat: '★★' },
      { id: 'gengar-neo', name: 'Gengar', number: '10', total: '111', image: 'assets/gengar.png', type: 'Psíquico', hp: '80', rarity: 'Raro Holo', stage: 'Estágio 2', attacks: [{ name: 'Mão Fantasma', damage: '50', desc: 'Pokémon Defensor agora está Adormecido.' }], weakness: 'Sombrio ×2', resistance: 'Lutador -30', retreat: '★' }
    ]
  }
];

async function seedDatabase(db) {
  const col = await db.get(`SELECT COUNT(*) as cnt FROM ${T('collections')}`);
  if (col.cnt > 0) {
    if (!loadCardCache()) {
      const enCards = await db.all(`SELECT * FROM ${T('cards')} WHERE collection_id = $1 ORDER BY sort_order`, ['chaos-rising']);
      const ptCards = await db.all(`SELECT * FROM ${T('cards')} WHERE collection_id = $1 ORDER BY sort_order`, ['chaos-rising-ptbr']);
      if (enCards.length && ptCards.length) {
        const mapCard = c => ({ ...c, attacks: JSON.parse(c.attacks) });
        saveCardCache(enCards.map(mapCard), ptCards.map(mapCard));
        console.log('Cache generated from existing database');
      }
    }
    return;
  }

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

  const allCollections = [
    ...SAMPLE_COLLECTIONS,
    {
      id: 'chaos-rising',
      name: 'Megaevoluções - Caos Ascendente',
      year: 2026,
      country: 'Estados Unidos',
      description: 'Caos Ascendente apresenta novas Megaevoluções com ilustrações impressionantes de Kalos.',
      cards: enCards
    },
    {
      id: 'chaos-rising-ptbr',
      name: 'Mega Evolução - Caos Ascendente (pt-BR)',
      year: 2026,
      country: 'Brasil',
      description: 'Versão em português brasileiro de Caos Ascendente.',
      cards: ptCards
    }
  ];

  const txFn = db.transaction(async (tx) => {
    for (const col of allCollections) {
      await tx.run(`INSERT INTO ${T('collections')} (id, name, year, country, description) VALUES ($1, $2, $3, $4, $5)`, [col.id, col.name, col.year, col.country, col.description]);
      for (let idx = 0; idx < col.cards.length; idx++) {
        const card = col.cards[idx];
        await tx.run(`INSERT INTO ${T('cards')} (id, collection_id, name, number, total, image, type, hp, rarity, stage, weakness, resistance, retreat, attacks, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [card.id, col.id, card.name, card.number, card.total, card.image, card.type, card.hp, card.rarity, card.stage, card.weakness, card.resistance, card.retreat, JSON.stringify(card.attacks || []), idx]);
      }
    }
  });
  await txFn();

  const totalCards = allCollections.reduce((s, c) => s + c.cards.length, 0);
  console.log('Database seeded: ' + allCollections.length + ' collections, ' + totalCards + ' cards');
}

module.exports = { seedDatabase };
