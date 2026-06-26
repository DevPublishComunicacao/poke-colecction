const path = require('path');
const fs = require('fs');
const https = require('https');

const { initDatabase, T } = require('./db');

const CARD_IDS = Array.from({ length: 124 }, (_, i) => (i + 1).toString().padStart(3, '0'));

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

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => {
      file.close();
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    });
  });
}

async function fetchSingleCard(lang, lid, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(`https://api.tcgdex.net/v2/${lang}/cards/me03-${lid}`);
      if (!resp.ok) {
        if (attempt < retries) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
        return null;
      }
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
        id: 'me03-' + lid,
        name: c.name || '',
        number: lid,
        total: '88',
        image: 'assets/me03' + (lang === 'pt' ? '-pt' : '') + '-' + lid + '.webp',
        type: c.types && c.types.length > 0 ? c.types[0] : '—',
        hp: c.hp != null ? String(c.hp) : '-',
        rarity: c.rarity || 'Comum',
        stage: c.stage || '—',
        weakness: c.weaknesses && c.weaknesses[0] ? formatWeakness(c.weaknesses[0]) : 'Nenhuma',
        resistance: c.resistances && c.resistances[0] ? formatResistance(c.resistances[0]) : 'Nenhuma',
        retreat: c.retreat != null ? formatRetreat(c.retreat) : '0',
        attacks
      };
    } catch (e) {
      if (attempt < retries) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
      return null;
    }
  }
}

async function downloadAllImages(lang, cards) {
  const assetsDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  let ok = 0, fail = 0;
  for (const c of cards) {
    const lid = c.number;
    const filename = 'me03' + (lang === 'pt' ? '-pt' : '') + '-' + lid + '.webp';
    const dest = path.join(assetsDir, filename);
    if (fs.existsSync(dest)) { ok++; continue; }
    const url = `https://assets.tcgdex.net/${lang}/me/me03/${lid}/low.webp`;
    try {
      await downloadImage(url, dest);
      ok++;
    } catch (e) {
      fail++;
    }
  }
  return { ok, fail };
}

async function seedPerfectOrder(db) {
  const colecao = await db.get(`SELECT id FROM ${T('colecoes')} WHERE name = 'Megaevoluções'`);
  if (!colecao) {
    console.error('Coleção "Megaevoluções" não encontrada. Execute o seed principal primeiro.');
    return;
  }

  const existing = await db.get(`SELECT id FROM ${T('expansoes')} WHERE name = 'Equilíbrio Perfeito'`);
  if (existing) {
    console.log('Expansão "Equilíbrio Perfeito" já existe. Pulando seed.');
    console.log('ID da expansão:', existing.id);
    return existing.id;
  }

  console.log('Buscando dados das cartas da TCGdex...');
  const batchSize = 30;
  let enCards = [], ptCards = [];

  for (let i = 0; i < CARD_IDS.length; i += batchSize) {
    const batch = CARD_IDS.slice(i, i + batchSize);
    const en = await Promise.all(batch.map(lid => fetchSingleCard('en', lid).catch(() => null)));
    const pt = await Promise.all(batch.map(lid => fetchSingleCard('pt', lid).catch(() => null)));
    enCards.push(...en.filter(Boolean));
    ptCards.push(...pt.filter(Boolean));
  }

  console.log(`EN: ${enCards.length} cartas, PT: ${ptCards.length} cartas`);

  if (enCards.length === 0) {
    console.error('Nenhuma carta obtida. Abortando.');
    return;
  }

  console.log('Baixando imagens...');
  const imgEn = await downloadAllImages('en', enCards);
  const imgPt = await downloadAllImages('pt', ptCards);
  console.log(`Imagens: EN ${imgEn.ok} ok ${imgEn.fail} fail, PT ${imgPt.ok} ok ${imgPt.fail} fail`);

  const PAIS_EUA = 1;
  const PAIS_BRASIL = 2;

  const txFn = db.transaction(async (tx) => {
    await tx.run(`INSERT INTO ${T('expansoes')} (name, colecao_id, year, description) VALUES ($1, $2, $3, $4)`,
      ['Equilíbrio Perfeito', colecao.id, 2026, 'Equilíbrio Perfeito traz harmonia entre ataque e defesa com centenas de cartas estratégicas para colecionadores.']);
    const exp = await tx.get(`SELECT id FROM ${T('expansoes')} WHERE name = 'Equilíbrio Perfeito'`);
    const expId = exp.id;

    for (let idx = 0; idx < enCards.length; idx++) {
      const c = enCards[idx];
      await tx.run(`INSERT INTO ${T('cards')} (id, expansao_id, pais_id, name, number, total, image, type, hp, rarity, stage, weakness, resistance, retreat, attacks, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [c.id, expId, PAIS_EUA, c.name, c.number, c.total, c.image, c.type, c.hp, c.rarity, c.stage, c.weakness, c.resistance, c.retreat, JSON.stringify(c.attacks || []), idx]);
    }
    for (let idx = 0; idx < ptCards.length; idx++) {
      const c = ptCards[idx];
      await tx.run(`INSERT INTO ${T('cards')} (id, expansao_id, pais_id, name, number, total, image, type, hp, rarity, stage, weakness, resistance, retreat, attacks, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [c.id, expId, PAIS_BRASIL, c.name, c.number, c.total, c.image, c.type, c.hp, c.rarity, c.stage, c.weakness, c.resistance, c.retreat, JSON.stringify(c.attacks || []), idx]);
    }
    console.log(`Seed concluído: expansão id=${expId}, ${enCards.length} EN + ${ptCards.length} PT cartas`);
    return expId;
  });

  const expId = await txFn();
  return expId;
}

async function main() {
  const db = await initDatabase();
  try {
    const expId = await seedPerfectOrder(db);
    if (expId) console.log('Expansão criada com ID:', expId);
    else console.log('Nada foi criado.');
  } catch (e) {
    console.error('Erro:', e.message);
  } finally {
    await db.close();
  }
}

if (require.main === module) { main(); }

module.exports = { seedPerfectOrder };