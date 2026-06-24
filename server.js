const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const CACHE_FILE = path.join(__dirname, 'seed-cache.json');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'pokecollection.db');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json());
app.use(express.static(path.join(__dirname)));

function initDatabase() {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    db.exec(`
        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            year INTEGER NOT NULL,
            country TEXT NOT NULL,
            description TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cards (
            id TEXT NOT NULL,
            collection_id TEXT NOT NULL,
            name TEXT NOT NULL,
            number TEXT NOT NULL,
            total TEXT NOT NULL,
            image TEXT NOT NULL,
            type TEXT NOT NULL,
            hp TEXT NOT NULL,
            rarity TEXT NOT NULL,
            stage TEXT NOT NULL,
            weakness TEXT NOT NULL,
            resistance TEXT NOT NULL,
            retreat TEXT NOT NULL,
            attacks TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (collection_id, id),
            FOREIGN KEY (collection_id) REFERENCES collections(id)
        );

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_stock (
            user_id TEXT NOT NULL,
            collection_id TEXT NOT NULL,
            card_id TEXT NOT NULL,
            finish_none INTEGER NOT NULL DEFAULT 0,
            finish_holo INTEGER NOT NULL DEFAULT 0,
            finish_reverse INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, collection_id, card_id)
        );

        CREATE TABLE IF NOT EXISTS user_acquired (
            user_id TEXT NOT NULL,
            collection_id TEXT NOT NULL,
            card_id TEXT NOT NULL,
            PRIMARY KEY (user_id, collection_id, card_id)
        );
    `);

    return db;
}

function generateUserId() { return crypto.randomUUID(); }

function authenticateToken(req, res, next) {
    const auth = req.headers['authorization'];
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

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
        total: '122',
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
    const colCount = db.prepare('SELECT COUNT(*) as cnt FROM collections').get();
    if (colCount.cnt > 0) return;

    const insertCol = db.prepare('INSERT INTO collections (id, name, year, country, description) VALUES (?, ?, ?, ?, ?)');
    const insertCard = db.prepare('INSERT INTO cards (id, collection_id, name, number, total, image, type, hp, rarity, stage, weakness, resistance, retreat, attacks, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

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

    const tx = db.transaction(() => {
        for (const col of allCollections) {
            insertCol.run(col.id, col.name, col.year, col.country, col.description);
            col.cards.forEach((card, idx) => {
                insertCard.run(
                    card.id, col.id, card.name, card.number, card.total,
                    card.image, card.type, card.hp, card.rarity, card.stage,
                    card.weakness, card.resistance, card.retreat,
                    JSON.stringify(card.attacks || []), idx
                );
            });
        }
    });

    tx();
    const totalCards = allCollections.reduce((s, c) => s + c.cards.length, 0);
    console.log('Database seeded: ' + allCollections.length + ' collections, ' + totalCards + ' cards');
}

const db = initDatabase();
(async () => {
    await seedDatabase(db);
    app.listen(PORT, '0.0.0.0', () => {
        console.log('PokéCollection server running on http://localhost:' + PORT);
    });
})();

app.get('/api/collections', (req, res) => {
    const rows = db.prepare('SELECT id, name, year, country, description FROM collections ORDER BY id').all();
    const counts = db.prepare('SELECT collection_id, COUNT(*) as cnt FROM cards GROUP BY collection_id').all();
    const countMap = {};
    for (const c of counts) countMap[c.collection_id] = c.cnt;
    res.json(rows.map(r => ({ ...r, cards: countMap[r.id] || 0 })));
});

app.get('/api/collections/:id', (req, res) => {
    const col = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!col) return res.status(404).json({ error: 'Collection not found' });
    const cards = db.prepare('SELECT * FROM cards WHERE collection_id = ? ORDER BY sort_order').all(req.params.id);
    res.json({ ...col, cards: cards.map(c => ({ ...c, attacks: JSON.parse(c.attacks) })) });
});

// --- Auth routes ---
app.post('/api/auth/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 3) return res.status(400).json({ error: 'Username must have at least 3 characters' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must have at least 4 characters' });
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });
    const id = generateUserId();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, username, password) VALUES (?, ?, ?)').run(id, username, hash);
    const token = jwt.sign({ userId: id, username }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id, username } });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid username or password' });
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, username: user.username } });
});

// --- User data routes (require auth) ---
app.get('/api/user/stock/:collectionId', authenticateToken, (req, res) => {
    const rows = db.prepare('SELECT card_id, finish_none, finish_holo, finish_reverse FROM user_stock WHERE user_id = ? AND collection_id = ?').all(req.user.userId, req.params.collectionId);
    const stock = {};
    for (const r of rows) {
        stock[r.card_id] = { none: r.finish_none, holo: r.finish_holo, reverse: r.finish_reverse };
    }
    res.json(stock);
});

app.put('/api/user/stock/:collectionId', authenticateToken, (req, res) => {
    const { collectionId } = req.params;
    const stock = req.body;
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM user_stock WHERE user_id = ? AND collection_id = ?').run(req.user.userId, collectionId);
        const insert = db.prepare('INSERT INTO user_stock (user_id, collection_id, card_id, finish_none, finish_holo, finish_reverse) VALUES (?, ?, ?, ?, ?, ?)');
        for (const [cardId, finishes] of Object.entries(stock)) {
            insert.run(req.user.userId, collectionId, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0);
        }
    });
    tx();
    res.json({ ok: true });
});

app.get('/api/user/acquired/:collectionId', authenticateToken, (req, res) => {
    const rows = db.prepare('SELECT card_id FROM user_acquired WHERE user_id = ? AND collection_id = ? ORDER BY card_id').all(req.user.userId, req.params.collectionId);
    res.json({ ids: rows.map(r => r.card_id) });
});

app.put('/api/user/acquired/:collectionId', authenticateToken, (req, res) => {
    const { collectionId } = req.params;
    const { ids } = req.body;
    const userId = req.user.userId;
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM user_acquired WHERE user_id = ? AND collection_id = ?').run(userId, collectionId);
        if (ids && ids.length > 0) {
            const insert = db.prepare('INSERT INTO user_acquired (user_id, collection_id, card_id) VALUES (?, ?, ?)');
            for (const cardId of ids) {
                insert.run(userId, collectionId, cardId);
            }
        }
    });
    tx();
    res.json({ ok: true });
});

app.get('/api/user/all/:collectionId', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const stockRows = db.prepare('SELECT card_id, finish_none, finish_holo, finish_reverse FROM user_stock WHERE user_id = ? AND collection_id = ?').all(userId, req.params.collectionId);
    const stock = {};
    for (const r of stockRows) {
        stock[r.card_id] = { none: r.finish_none, holo: r.finish_holo, reverse: r.finish_reverse };
    }
    const acqRows = db.prepare('SELECT card_id FROM user_acquired WHERE user_id = ? AND collection_id = ? ORDER BY card_id').all(userId, req.params.collectionId);
    res.json({ stock, acquired: acqRows.map(r => r.card_id) });
});

app.put('/api/user/all/:collectionId', authenticateToken, (req, res) => {
    const { collectionId } = req.params;
    const { stock, acquired } = req.body;
    const userId = req.user.userId;
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM user_stock WHERE user_id = ? AND collection_id = ?').run(userId, collectionId);
        db.prepare('DELETE FROM user_acquired WHERE user_id = ? AND collection_id = ?').run(userId, collectionId);
        if (stock) {
            const insert = db.prepare('INSERT INTO user_stock (user_id, collection_id, card_id, finish_none, finish_holo, finish_reverse) VALUES (?, ?, ?, ?, ?, ?)');
            for (const [cardId, finishes] of Object.entries(stock)) {
                insert.run(userId, collectionId, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0);
            }
        }
        if (acquired && acquired.length > 0) {
            const insert = db.prepare('INSERT INTO user_acquired (user_id, collection_id, card_id) VALUES (?, ?, ?)');
            for (const cardId of acquired) {
                insert.run(userId, collectionId, cardId);
            }
        }
    });
    tx();
    res.json({ ok: true });
});

app.post('/api/migrate', authenticateToken, (req, res) => {
    const { collectionId, stock, acquired } = req.body;
    const userId = req.user.userId;
    if (!collectionId) return res.status(400).json({ error: 'collectionId required' });
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM user_stock WHERE user_id = ? AND collection_id = ?').run(userId, collectionId);
        db.prepare('DELETE FROM user_acquired WHERE user_id = ? AND collection_id = ?').run(userId, collectionId);
        if (stock) {
            const insert = db.prepare('INSERT INTO user_stock (user_id, collection_id, card_id, finish_none, finish_holo, finish_reverse) VALUES (?, ?, ?, ?, ?, ?)');
            for (const [cardId, finishes] of Object.entries(stock)) {
                insert.run(userId, collectionId, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0);
            }
        }
        if (acquired && acquired.length > 0) {
            const insert = db.prepare('INSERT INTO user_acquired (user_id, collection_id, card_id) VALUES (?, ?, ?)');
            for (const cardId of acquired) {
                insert.run(userId, collectionId, cardId);
            }
        }
    });
    tx();
    res.json({ ok: true, migrated: true });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', db: !!db.open });
});

app.get('/api/user/export/:collectionId', authenticateToken, (req, res) => {
    const { collectionId } = req.params;
    const userId = req.user.userId;
    const stockRows = db.prepare('SELECT card_id, finish_none, finish_holo, finish_reverse FROM user_stock WHERE user_id = ? AND collection_id = ?').all(userId, collectionId);
    const stock = {};
    for (const r of stockRows) stock[r.card_id] = { none: r.finish_none, holo: r.finish_holo, reverse: r.finish_reverse };
    const acqRows = db.prepare('SELECT card_id FROM user_acquired WHERE user_id = ? AND collection_id = ? ORDER BY card_id').all(userId, collectionId);
    res.json({ collectionId, stock, acquired: acqRows.map(r => r.card_id), exportedAt: new Date().toISOString() });
});

app.post('/api/user/import/:collectionId', authenticateToken, (req, res) => {
    const { collectionId } = req.params;
    const { stock, acquired } = req.body;
    const userId = req.user.userId;
    if (!stock && !acquired) return res.status(400).json({ error: 'Forneça stock e/ou acquired no body' });
    const tx = db.transaction(() => {
        if (stock) {
            db.prepare('DELETE FROM user_stock WHERE user_id = ? AND collection_id = ?').run(userId, collectionId);
            const insert = db.prepare('INSERT INTO user_stock (user_id, collection_id, card_id, finish_none, finish_holo, finish_reverse) VALUES (?, ?, ?, ?, ?, ?)');
            for (const [cardId, finishes] of Object.entries(stock)) {
                insert.run(userId, collectionId, cardId, finishes.none || 0, finishes.holo || 0, finishes.reverse || 0);
            }
        }
        if (acquired && acquired.length > 0) {
            db.prepare('DELETE FROM user_acquired WHERE user_id = ? AND collection_id = ?').run(userId, collectionId);
            const insert = db.prepare('INSERT INTO user_acquired (user_id, collection_id, card_id) VALUES (?, ?, ?)');
            for (const cardId of acquired) insert.run(userId, collectionId, cardId);
        }
    });
    tx();
    res.json({ ok: true, imported: true });
});

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(__dirname, 'index.html'));
});
