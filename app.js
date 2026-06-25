// PokéCollection - Application Data and Logic

let collectionsData = [];

// Auth state
let _authToken = null;
let _authUser = null;

function getToken() {
    if (!_authToken) _authToken = localStorage.getItem('auth_token');
    return _authToken;
}

function setToken(token, user) {
    _authToken = token;
    _authUser = user;
    if (token) localStorage.setItem('auth_token', token);
    else localStorage.removeItem('auth_token');
}

function clearAuth() {
    _authToken = null;
    _authUser = null;
    localStorage.removeItem('auth_token');
}

function authHeaders() {
    const t = getToken();
    return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function isLoggedIn() { return !!getToken(); }

function updateUserUI() {
    const span = document.getElementById('userName');
    if (!span) return;
    span.textContent = _authUser ? _authUser.username : 'Entrar';
}

// In-memory cache for stock & acquired (synced with server)
let _stockCache = null;
let _acquiredCache = null;
let _dataInitialized = false;

async function fetchAndCacheUserData(collectionId) {
    if (!isLoggedIn()) {
        _stockCache = {};
        _acquiredCache = [];
        _dataInitialized = true;
        return;
    }
    try {
        const resp = await fetch('/api/user/all/' + collectionId, { headers: authHeaders() });
        if (!resp.ok) return;
        const data = await resp.json();
        _stockCache = data.stock || {};
        _acquiredCache = data.acquired || [];
        _dataInitialized = true;
    } catch (e) {
        _stockCache = {};
        _acquiredCache = [];
        _dataInitialized = true;
    }
}

async function syncUserData() {
    if (!isLoggedIn() || !currentCollection) return;
    try {
        await fetch('/api/user/all/' + currentCollection.id, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ stock: _stockCache || {}, acquired: _acquiredCache || [] })
        });
    } catch (e) {}
}

function getAcquiredCards() {
    if (_acquiredCache) return [...new Set(_acquiredCache)];
    return [];
}

function setAcquiredCards(ids) {
    _acquiredCache = [...new Set(ids)];
}

function getCardStock() {
    return _stockCache || {};
}

function setCardStock(stock) {
    _stockCache = stock;
}

function toggleAcquire(cardId) {
    const acquired = getAcquiredCards();
    const idx = acquired.indexOf(cardId);
    if (idx >= 0) {
        acquired.splice(idx, 1);
        const stock = getCardStock();
        delete stock[cardId];
        setCardStock(stock);
    } else {
        acquired.push(cardId);
        const stock = getCardStock();
        if (!stock[cardId] || (!stock[cardId].none && !stock[cardId].holo && !stock[cardId].reverse)) {
            if (!stock[cardId]) stock[cardId] = { none: 0, holo: 0, reverse: 0 };
            stock[cardId].none = (stock[cardId].none || 0) + 1;
            setCardStock(stock);
        }
    }
    setAcquiredCards(acquired);
    syncUserData();
    renderCards();
}

// Keep localStorage for "selectedCollection" preference only
function getSelectedCollectionId() {
    try { return localStorage.getItem('selectedCollection'); } catch (e) { return null; }
}
function setSelectedCollectionId(id) {
    try { localStorage.setItem('selectedCollection', id); } catch (e) {}
}

// State variables (will be set after async init)
let currentCollection = null;
let searchFilter = "";

async function initApp() {
    try {
        const resp = await fetch('/api/collections');
        collectionsData = await resp.json();
    } catch (e) {
        collectionsData = [];
    }
    if (collectionsData.length === 0) return;

    const savedId = getSelectedCollectionId();
    let found = savedId ? collectionsData.find(c => c.id === savedId) : null;
    currentCollection = found || collectionsData[0];

    try {
        const colResp = await fetch('/api/collections/' + currentCollection.id);
        const colData = await colResp.json();
        currentCollection = { ...colData, cards: colData.cards || [] };
    } catch (e) {
        currentCollection = { ...currentCollection, cards: [] };
    }

    await fetchAndCacheUserData(currentCollection.id);

    initCollectionSelect();
    updateCollectionInfo();
    renderCards();

    const loader = document.getElementById('loadingOverlay');
    if (loader) loader.style.display = 'none';
}

document.addEventListener("DOMContentLoaded", () => {
    migrateAcquiredToQuantity();
    initAuth();
    initApp();
});

// --- Auth Logic ---
let _authMode = 'login';

function initAuth() {
    const stored = localStorage.getItem('auth_token');
    if (stored) {
        _authToken = stored;
        try {
            const payload = JSON.parse(atob(stored.split('.')[1]));
            _authUser = { id: payload.userId, username: payload.username };
        } catch (e) { clearAuth(); }
    }
    updateUserUI();

    document.getElementById('userBtn').addEventListener('click', () => {
        if (isLoggedIn()) {
            clearAuth();
            _stockCache = {};
            _acquiredCache = [];
            updateUserUI();
            if (currentCollection) renderCards();
            return;
        }
        openAuthModal();
    });

    document.getElementById('authModalClose').addEventListener('click', closeAuthModal);
    document.getElementById('authModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeAuthModal();
    });

    document.getElementById('authToggleBtn').addEventListener('click', () => {
        _authMode = _authMode === 'login' ? 'register' : 'login';
        document.getElementById('authTitle').textContent = _authMode === 'login' ? 'Entrar' : 'Registrar';
        document.getElementById('authSubmit').textContent = _authMode === 'login' ? 'Entrar' : 'Registrar';
        document.getElementById('authToggleText').textContent = _authMode === 'login' ? 'Não tem conta?' : 'Já tem conta?';
        document.getElementById('authToggleBtn').textContent = _authMode === 'login' ? 'Registrar' : 'Entrar';
        document.getElementById('authError').textContent = '';
    });

    document.getElementById('authForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('authUsername').value.trim();
        const password = document.getElementById('authPassword').value;
        const errorEl = document.getElementById('authError');
        errorEl.textContent = '';
        const endpoint = _authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
        try {
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await resp.json();
            if (!resp.ok) {
                errorEl.textContent = data.error || 'Erro desconhecido';
                return;
            }
            setToken(data.token, data.user);
            updateUserUI();
            closeAuthModal();
            document.getElementById('authUsername').value = '';
            document.getElementById('authPassword').value = '';
            // Reload user data for current collection
            if (currentCollection) {
                await fetchAndCacheUserData(currentCollection.id);
                renderCards();
            }
        } catch (e) {
            errorEl.textContent = 'Erro de conexão';
        }
    });
}

function openAuthModal() {
    document.getElementById('authModal').classList.add('active');
    document.getElementById('authModal').setAttribute('aria-hidden', 'false');
    document.getElementById('authError').textContent = '';
}

function closeAuthModal() {
    document.getElementById('authModal').classList.remove('active');
    document.getElementById('authModal').setAttribute('aria-hidden', 'true');
}

const FINISH_LABELS = { none: 'Comum', holo: 'Foil', reverse: 'Reverse' };

const PULL_RATES = {
    "Comum": "Várias por pacote",
    "Incomum": "~2 por pacote",
    "Raro": "1 por pacote",
    "Rara": "1 por pacote",
    "Raro Holo": "~1 em 3 pacotes",
    "Raro Duplo": "~1 em 5 pacotes",
    "Rara Dupla": "~1 em 5 pacotes",
    "Raro Ilustração": "~1 em 9 pacotes",
    "Ilustração Rara": "~1 em 9 pacotes",
    "Raro Ultra": "~1 em 12 pacotes",
    "Ultra Rara": "~1 em 12 pacotes",
    "Raro Ilustração Especial": "~1 em 83 pacotes",
    "Ilustração Rara Especial": "~1 em 83 pacotes",
    "Megaevolução Raro Hyper": "~1 em 956 pacotes",
    "Mega Hiper Raro": "~1 em 956 pacotes"
};

function adjustStock(cardId, finish, delta) {
    const stock = getCardStock();
    if (!stock[cardId]) stock[cardId] = { none: 0, holo: 0, reverse: 0 };
    const current = stock[cardId][finish] || 0;
    const next = Math.max(0, current + delta);
    stock[cardId][finish] = next;
    const hasAny = stock[cardId].none || stock[cardId].holo || stock[cardId].reverse;
    if (!hasAny) {
        delete stock[cardId];
    }
    setCardStock(stock);
    // Sync acquired state
    const acquired = getAcquiredCards();
    const idx = acquired.indexOf(cardId);
    if (hasAny && idx === -1) {
        acquired.push(cardId);
        setAcquiredCards(acquired);
    } else if (!hasAny && idx >= 0) {
        acquired.splice(idx, 1);
        setAcquiredCards(acquired);
    }
    syncUserData();
    renderCards();
}

function markAllAcquired() {
    const acquired = getAcquiredCards();
    const allIds = currentCollection.cards.map(c => c.id);
    let changed = false;
    for (const id of allIds) {
        if (!acquired.includes(id)) {
            acquired.push(id);
            changed = true;
        }
    }
    if (changed) {
        setAcquiredCards(acquired);
        syncUserData();
        renderCards();
    }
}

function markAllUnacquired() {
    const acquired = getAcquiredCards();
    if (acquired.length > 0) {
        setAcquiredCards([]);
        setCardStock({});
        syncUserData();
        renderCards();
    }
}

// DOM Elements
const collectionDropdown = document.getElementById("collectionDropdown");
const dropdownTrigger = document.getElementById("dropdownTrigger");
const dropdownSelectedValue = document.getElementById("dropdownSelectedValue");
const dropdownMenu = document.getElementById("dropdownMenu");
const colYear = document.getElementById("colYear");
const colCountry = document.getElementById("colCountry");
const colName = document.getElementById("colName");
const colDesc = document.getElementById("colDesc");
const statTotal = document.getElementById("statTotal");
const cardsGrid = document.getElementById("cardsGrid");
const resultsCount = document.getElementById("resultsCount");

// Modal Elements
const cardModal = document.getElementById("cardModal");
const modalClose = document.getElementById("modalClose");
const modalCard3D = document.getElementById("modalCard3D");
const modalCardImg = document.getElementById("modalCardImg");
const modalHoloShine = document.getElementById("modalHoloShine");
const modalCardNumber = document.getElementById("modalCardNumber");
const modalCardName = document.getElementById("modalCardName");
const modalCardType = document.getElementById("modalCardType");
const modalCardHp = document.getElementById("modalCardHp");
const modalCardRarity = document.getElementById("modalCardRarity");
const modalCardStage = document.getElementById("modalCardStage");
const modalCardAttacks = document.getElementById("modalCardAttacks");
const modalCardWeakness = document.getElementById("modalCardWeakness");
const modalCardResistance = document.getElementById("modalCardResistance");
const modalCardRetreat = document.getElementById("modalCardRetreat");
const modalCardSpecs = document.getElementById("modalCardSpecs");
const modalAttacksSection = document.getElementById("modalAttacksSection");
const modalCardFooterSpecs = document.getElementById("modalCardFooterSpecs");
const modalCardStock = document.getElementById("modalCardStock");
const modalStockItems = document.getElementById("modalStockItems");
const modalAcquireBtn = document.getElementById("modalAcquireBtn");
const modalPullRate = document.getElementById("modalPullRate");
const modalPriceLinks = document.getElementById("modalPriceLinks");

// Populate Collection Select dropdown
function initCollectionSelect() {
    dropdownMenu.innerHTML = collectionsData.map(col => 
        `<li class="dropdown-item ${col.id === currentCollection.id ? 'selected' : ''}" data-value="${col.id}" role="option">${col.name}</li>`
    ).join("");
    
    dropdownSelectedValue.textContent = currentCollection.name;

    dropdownTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = collectionDropdown.classList.toggle("active");
        dropdownTrigger.setAttribute("aria-expanded", isOpen);
    });

    document.addEventListener("click", () => {
        collectionDropdown.classList.remove("active");
        dropdownTrigger.setAttribute("aria-expanded", "false");
    });

    dropdownMenu.addEventListener("click", async (e) => {
        const item = e.target.closest(".dropdown-item");
        if (!item) return;

        const selectedId = item.dataset.value;
        const colMeta = collectionsData.find(c => c.id === selectedId);
        if (!colMeta) return;
        
        dropdownMenu.querySelectorAll(".dropdown-item").forEach(el => el.classList.remove("selected"));
        item.classList.add("selected");
        dropdownSelectedValue.textContent = colMeta.name;
        collectionDropdown.classList.remove("active");
        dropdownTrigger.setAttribute("aria-expanded", "false");
        
        setSelectedCollectionId(colMeta.id);
        
        // Fetch cards + user data for the new collection
        try {
            const colResp = await fetch('/api/collections/' + colMeta.id);
            const colData = await colResp.json();
            currentCollection = colData;
        } catch (e) {
            currentCollection = { ...colMeta, cards: [] };
        }
        await fetchAndCacheUserData(colMeta.id);
        
        updateCollectionInfo();
        renderCards();
    });
}

// Update Header stats & details
function updateCollectionInfo() {
    colYear.textContent = currentCollection.year;
    colCountry.textContent = currentCollection.country;
    colName.textContent = currentCollection.name;
    colDesc.textContent = currentCollection.description;
    statTotal.textContent = currentCollection.cards.length;
}

// Filter and Render Cards to grid
function renderCards() {
    const query = searchFilter.toLowerCase().trim();
    const cardStock = getCardStock();
    const filtered = currentCollection.cards.filter(card => 
        card.name.toLowerCase().includes(query) || 
        card.type.toLowerCase().includes(query) ||
        card.rarity.toLowerCase().includes(query) ||
        card.number.toLowerCase().includes(query)
    );

    resultsCount.textContent = `Exibindo ${filtered.length} de ${currentCollection.cards.length} cartas`;

    const acquiredCards = getAcquiredCards();
    const acquiredCount = acquiredCards.length;

    // Update stats
    const statTotal = document.getElementById("statTotal");
    if (statTotal) {
        const totalCards = currentCollection.cards.length;
        statTotal.textContent = acquiredCount > 0 ? `${totalCards} (${acquiredCount} adquiridas)` : String(totalCards);
    }

    const loggedIn = isLoggedIn();
    // Bulk action bar — create once, update labels only
    if (!document.querySelector(".bulk-bar")) {
        const gridHeader = document.querySelector(".grid-header");
        if (gridHeader) {
            gridHeader.insertAdjacentHTML("afterend", `
                <div class="bulk-bar">
                    <span class="bulk-count" id="bulkCount">${acquiredCount}/${currentCollection.cards.length}</span>
                    <div class="bulk-search">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        <input type="text" id="cardSearch" placeholder="Buscar..." aria-label="Buscar carta" autocomplete="off">
                        <div class="search-autocomplete" id="searchAutocomplete"></div>
                    </div>
                    ${loggedIn ? `<button class="bulk-btn" id="markAllBtn">${acquiredCount === currentCollection.cards.length ? '' : 'Marcar'} todas</button>
                    <button class="bulk-btn" id="unmarkAllBtn">${acquiredCount > 0 ? 'Desmarcar' : ''} todas</button>` : ''}
                </div>
            `);
            attachSearchListeners();
            if (loggedIn) {
                document.getElementById("markAllBtn").addEventListener("click", markAllAcquired);
                document.getElementById("unmarkAllBtn").addEventListener("click", markAllUnacquired);
            }
            // Card index bar
            const bulkBar = document.querySelector(".bulk-bar");
            if (bulkBar) {
                bulkBar.insertAdjacentHTML("afterend", `<div class="card-index-bar" id="cardIndexBar"></div>`);
            }
        }
    } else {
        const countEl = document.getElementById("bulkCount");
        if (countEl) countEl.textContent = `${acquiredCount}/${currentCollection.cards.length}`;
        const markBtn = document.getElementById("markAllBtn");
        if (markBtn) markBtn.textContent = acquiredCount === currentCollection.cards.length ? '' : 'Marcar todas';
        const unmarkBtn = document.getElementById("unmarkAllBtn");
        if (unmarkBtn) unmarkBtn.textContent = acquiredCount > 0 ? 'Desmarcar todas' : '';
    }

    // Card index bar — update number pills
    const indexBar = document.getElementById("cardIndexBar");
    if (indexBar) {
        const selNum = searchFilter.trim();
        const numbers = currentCollection.cards.map(c => c.number);
        indexBar.innerHTML = `<button class="index-pill${!selNum ? ' active' : ''}" data-num="">Todas</button>` +
            numbers.map(n => `<button class="index-pill${selNum === n ? ' active' : ''}" data-num="${n}">${n}</button>`).join('');
    }

    if (filtered.length === 0) {
        cardsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fa-regular fa-folder-open"></i>
                <p>Nenhuma carta encontrada para "${searchFilter}"</p>
            </div>
        `;
        return;
    }

    cardsGrid.innerHTML = filtered.map(card => {
        const stock = cardStock[card.id] || { none: 0, holo: 0, reverse: 0 };
        const totalQty = stock.none + stock.holo + stock.reverse;
        const acquired = acquiredCards.includes(card.id);
        const dominant = stock.reverse > 0 ? 'reverse' : stock.holo > 0 ? 'holo' : 'none';
        const classes = ['poke-card'];
        if (acquired) classes.push('acquired');
        if (dominant !== 'none') classes.push('foil-' + dominant);
        return `
        <article class="${classes.join(' ')}" data-card-id="${card.id}" tabindex="0">
            <div class="card-img-wrapper">
                <img src="${card.image}" alt="Carta de ${card.name}" loading="lazy">
                ${loggedIn ? `<button class="acquire-btn" data-acquire-id="${card.id}" aria-label="${acquired ? 'Remover' : 'Marcar'} como adquirida" title="${acquired ? 'Remover' : 'Marcar'} adquirida">
                    <i class="fa-solid fa-check"></i>
                </button>` : ''}
                <span class="foil-badge foil-${dominant}">${FINISH_LABELS[dominant]}</span>
            </div>
            <div class="card-info">
                <div class="card-info-header">
                    <h4 class="card-title">${card.name}</h4>
                    <span class="card-number">${card.number}/${card.total}</span>
                </div>
                <div class="card-characteristics">
                    ${card.type !== "Treinadora" ? `<span class="char-badge type-${card.type.toLowerCase()}">${card.type}</span>` : ''}
                    <span class="char-badge rarity">${card.rarity}</span>
                </div>
                ${loggedIn ? `<div class="card-qty">
                    ${['none','holo','reverse'].map(f => `
                        <div class="qty-group">
                            <span class="qty-label">${FINISH_LABELS[f]}</span>
                            <div class="qty-row">
                                <button class="qty-btn" data-stock="${card.id}:${f}:-1">−</button>
                                <span class="qty-value">${stock[f]}</span>
                                <button class="qty-btn" data-stock="${card.id}:${f}:1">+</button>
                            </div>
                        </div>
                    `).join('')}
                </div>` : ''}
            </div>
        </article>`;
    }).join("");

    // Reattach listeners to new DOM nodes
    document.querySelectorAll(".poke-card").forEach(el => {
        el.addEventListener("click", (e) => {
            if (e.target.closest(".acquire-btn") || e.target.closest(".foil-badge") || e.target.closest(".qty-btn")) return;
            openCardDetails(el.dataset.cardId);
        });
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openCardDetails(el.dataset.cardId);
            }
        });
    });

    document.querySelectorAll(".acquire-btn").forEach(el => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleAcquire(el.dataset.acquireId);
        });
    });

    document.querySelectorAll("[data-stock]").forEach(el => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const parts = el.dataset.stock.split(':');
            adjustStock(parts[0], parts[1], parseInt(parts[2]));
        });
    });
}

// Index pill click handler (delegated)
document.addEventListener("click", (e) => {
    const pill = e.target.closest(".index-pill");
    if (!pill) return;
    const num = pill.dataset.num;
    searchFilter = num;
    const input = getSearchEl();
    if (input) input.value = num;
    renderCards();
});

// Modal and 3D Interaction details
function openCardDetails(cardId) {
    const card = currentCollection.cards.find(c => c.id === cardId);
    if (!card) return;

    modalCardNumber.textContent = `${card.number}/${card.total}`;
    modalCardName.textContent = card.name;
    modalCardImg.src = card.image;
    modalCardImg.alt = `Carta de ${card.name}`;
    modalCardImg.dataset.cardId = card.id;
    
    // Type and hp
    const isTrainer = card.hp === "-";
    modalCardType.className = `card-type-badge ${isTrainer ? 'Colorless' : card.type}`;
    modalCardType.textContent = isTrainer ? card.rarity : card.type;
    modalCardType.style.display = isTrainer ? 'none' : '';
    modalCardHp.textContent = isTrainer ? '—' : card.hp;
    modalCardRarity.textContent = card.rarity;
    modalCardStage.textContent = isTrainer ? '—' : card.stage;

    // Pull rate & price links
    const pullRate = PULL_RATES[card.rarity] || '—';
    modalPullRate.textContent = pullRate;
    const cardQuery = encodeURIComponent(`${card.name} Pokémon TCG ${card.number}/${card.total}`);
    modalPriceLinks.innerHTML = `
        <a href="https://www.ebay.com/sch/i.html?_nkw=${cardQuery}" target="_blank" rel="noopener noreferrer" class="price-link ebay">eBay</a>
        <a href="https://www.tcgplayer.com/search/pokemon/product?q=${cardQuery}" target="_blank" rel="noopener noreferrer" class="price-link tcgplayer">TCGplayer</a>
    `;

    // Attacks list
    modalCardAttacks.innerHTML = card.attacks.map(att => `
        <div class="attack-item">
            <div class="attack-header">
                <span class="attack-name">${att.name}</span>
                <span class="attack-damage">${att.damage ? att.damage : ""}</span>
            </div>
            <p class="attack-desc">${att.desc}</p>
        </div>
    `).join("");

    // Footer specs
    modalCardWeakness.textContent = isTrainer ? '—' : card.weakness;
    modalCardResistance.textContent = isTrainer ? '—' : card.resistance;
    modalCardRetreat.textContent = isTrainer ? '—' : card.retreat;
    modalCardSpecs.style.display = isTrainer ? 'none' : '';
    modalCardFooterSpecs.style.display = isTrainer ? 'none' : '';
    modalAttacksSection.querySelector('h3').textContent = isTrainer ? 'Efeito' : 'Ataques / Habilidades';

    const loggedIn = isLoggedIn();
    // Stock info — inline editor
    if (loggedIn) {
        const stock = getCardStock();
        const s = stock[card.id] || { none: 0, holo: 0, reverse: 0 };
        modalStockItems.innerHTML = ['none','holo','reverse'].map(f => `
            <div class="modal-qty-group">
                <span class="modal-qty-label ${f === 'holo' ? 'modal-qty-holo' : f === 'reverse' ? 'modal-qty-reverse' : ''}">${FINISH_LABELS[f]}</span>
                <div class="modal-qty-row">
                    <button class="modal-qty-btn" data-mstock="${card.id}:${f}:-1">−</button>
                    <span class="modal-qty-value">${s[f]}</span>
                    <button class="modal-qty-btn" data-mstock="${card.id}:${f}:1">+</button>
                </div>
            </div>
        `).join('');
        modalCardStock.style.display = (s.none || s.holo || s.reverse) ? '' : 'none';
    } else {
        modalCardStock.style.display = 'none';
    }

    // Acquire button state in modal
    modalAcquireBtn.style.display = loggedIn ? '' : 'none';
    const isAcquired = getAcquiredCards().includes(card.id);
    modalAcquireBtn.classList.toggle("acquired", isAcquired);
    modalAcquireBtn.setAttribute("aria-label", isAcquired ? 'Remover' : 'Marcar como adquirida');
    modalAcquireBtn.title = isAcquired ? 'Remover adquirida' : 'Marcar adquirida';

    // Show modal
    cardModal.classList.add("active");
    cardModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden"; // disable scroll behind

    // Reset 3D Rotation
    modalCard3D.style.transform = `rotateX(0deg) rotateY(0deg)`;
}

function closeModal() {
    cardModal.classList.remove("active");
    cardModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "auto";
}

// Modal Close events
modalClose.addEventListener("click", closeModal);

// Use mousedown on cardModal for acquire (more reliable inside 3D context)
cardModal.addEventListener("mousedown", (e) => {
    const btn = e.target.closest("#modalAcquireBtn");
    if (!btn) return;
    const cardId = document.getElementById("modalCardImg").dataset.cardId;
    if (!cardId) return;
    e.stopPropagation();
    // Toggle acquired state directly without waiting for renderCards
    const acquired = getAcquiredCards();
    const idx = acquired.indexOf(cardId);
    const wasAcquired = idx >= 0;
    if (wasAcquired) {
        acquired.splice(idx, 1);
        const stock = getCardStock();
        delete stock[cardId];
        setCardStock(stock);
        // Also update the qty display in modal
        modalStockItems.innerHTML = ['none','holo','reverse'].map(f => `
            <div class="modal-qty-group">
                <span class="modal-qty-label ${f === 'holo' ? 'modal-qty-holo' : f === 'reverse' ? 'modal-qty-reverse' : ''}">${FINISH_LABELS[f]}</span>
                <div class="modal-qty-row">
                    <button class="modal-qty-btn" data-mstock="${cardId}:${f}:-1">−</button>
                    <span class="modal-qty-value">0</span>
                    <button class="modal-qty-btn" data-mstock="${cardId}:${f}:1">+</button>
                </div>
            </div>
        `).join('');
        modalCardStock.style.display = 'none';
    } else {
        acquired.push(cardId);
        const stock = getCardStock();
        if (!stock[cardId] || (!stock[cardId].none && !stock[cardId].holo && !stock[cardId].reverse)) {
            if (!stock[cardId]) stock[cardId] = { none: 0, holo: 0, reverse: 0 };
            stock[cardId].none = (stock[cardId].none || 0) + 1;
            setCardStock(stock);
        }
        // Show stock editor with current values
        const s = stock[cardId] || { none: 0, holo: 0, reverse: 0 };
        modalStockItems.innerHTML = ['none','holo','reverse'].map(f => `
            <div class="modal-qty-group">
                <span class="modal-qty-label ${f === 'holo' ? 'modal-qty-holo' : f === 'reverse' ? 'modal-qty-reverse' : ''}">${FINISH_LABELS[f]}</span>
                <div class="modal-qty-row">
                    <button class="modal-qty-btn" data-mstock="${cardId}:${f}:-1">−</button>
                    <span class="modal-qty-value">${s[f]}</span>
                    <button class="modal-qty-btn" data-mstock="${cardId}:${f}:1">+</button>
                </div>
            </div>
        `).join('');
        modalCardStock.style.display = '';
    }
    setAcquiredCards(acquired);
    syncUserData();
    const nowAcquired = !wasAcquired;
    btn.classList.toggle("acquired", nowAcquired);
    btn.setAttribute("aria-label", nowAcquired ? 'Remover' : 'Marcar como adquirida');
    btn.title = nowAcquired ? 'Remover adquirida' : 'Marcar adquirida';
    // Update the card in the grid without full re-render
    const gridCard = document.querySelector(`.poke-card[data-card-id="${cardId}"]`);
    if (gridCard) {
        gridCard.classList.toggle("acquired", nowAcquired);
        const gridBtn = gridCard.querySelector(".acquire-btn");
        if (gridBtn) {
            gridBtn.classList.toggle("acquired", nowAcquired);
            gridBtn.setAttribute("aria-label", nowAcquired ? 'Remover' : 'Marcar como adquirida');
            gridBtn.title = nowAcquired ? 'Remover adquirida' : 'Marcar adquirida';
        }
        // Update grid qty values when unacquired (zeroed out)
        if (!nowAcquired) {
            gridCard.querySelectorAll(".qty-value").forEach(el => el.textContent = "0");
            const badge = gridCard.querySelector(".foil-badge");
            if (badge) {
                badge.textContent = 'Comum';
                badge.className = badge.className.replace(/foil-\w+/, 'foil-none');
            }
        }
    }
    // Update bulk bar count
    const countEl = document.getElementById("bulkCount");
    if (countEl) {
        const total = currentCollection.cards.length;
        const ac = getAcquiredCards();
        countEl.textContent = `${ac.length}/${total}`;
    }
    const markBtn = document.getElementById("markAllBtn");
    if (markBtn) {
        const ac = getAcquiredCards();
        markBtn.textContent = ac.length === currentCollection.cards.length ? '' : 'Marcar todas';
    }
    const unmarkBtn = document.getElementById("unmarkAllBtn");
    if (unmarkBtn) {
        const ac = getAcquiredCards();
        unmarkBtn.textContent = ac.length > 0 ? 'Desmarcar todas' : '';
    }
});

cardModal.addEventListener("click", (e) => {
    if (e.target === cardModal) closeModal();
});

// Modal stock adjustment via delegation
document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mstock]");
    if (!btn) return;
    e.stopPropagation();
    const parts = btn.dataset.mstock.split(':');
    adjustStock(parts[0], parts[1], parseInt(parts[2]));
    // Re-populate stock inline without closing modal
    const card = currentCollection.cards.find(c => c.id === parts[0]);
    if (card) {
        const stock = getCardStock();
        const s = stock[parts[0]] || { none: 0, holo: 0, reverse: 0 };
        const hasAny = s.none || s.holo || s.reverse;
        modalStockItems.innerHTML = ['none','holo','reverse'].map(f => `
            <div class="modal-qty-group">
                <span class="modal-qty-label ${f === 'holo' ? 'modal-qty-holo' : f === 'reverse' ? 'modal-qty-reverse' : ''}">${FINISH_LABELS[f]}</span>
                <div class="modal-qty-row">
                    <button class="modal-qty-btn" data-mstock="${parts[0]}:${f}:-1">−</button>
                    <span class="modal-qty-value">${s[f]}</span>
                    <button class="modal-qty-btn" data-mstock="${parts[0]}:${f}:1">+</button>
                </div>
            </div>
        `).join('');
        modalCardStock.style.display = hasAny ? '' : 'none';
        // Sync modal acquire button
        const acquireBtn = document.getElementById("modalAcquireBtn");
        if (acquireBtn) {
            acquireBtn.classList.toggle("acquired", hasAny);
            acquireBtn.setAttribute("aria-label", hasAny ? 'Remover' : 'Marcar como adquirida');
            acquireBtn.title = hasAny ? 'Remover adquirida' : 'Marcar adquirida';
        }
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && cardModal.classList.contains("active")) {
        closeModal();
    }
});

// Interactive search box with autocomplete (inside bulk bar)
let acHighlightIdx = -1;

function getSearchEl() { return document.getElementById("cardSearch"); }
function getAutocompleteEl() { return document.getElementById("searchAutocomplete"); }

function closeAutocomplete() {
    const el = getAutocompleteEl();
    if (!el) return;
    el.classList.remove("active");
    el.innerHTML = "";
    acHighlightIdx = -1;
}

function renderAutocomplete(query) {
    const trimmed = query.toLowerCase().trim();
    if (!trimmed) { closeAutocomplete(); return; }

    const results = currentCollection.cards.filter(c =>
        c.name.toLowerCase().includes(trimmed) ||
        c.type.toLowerCase().includes(trimmed) ||
        c.rarity.toLowerCase().includes(trimmed) ||
        c.number.toLowerCase().includes(trimmed)
    ).slice(0, 10);

    const el = getAutocompleteEl();
    if (!el) return;
    if (!results.length) { closeAutocomplete(); return; }

    el.innerHTML = results.map((card, i) => `
        <div class="ac-item" data-ac-id="${card.id}" data-index="${i}">
            <img src="${card.image}" alt="${card.name}" loading="lazy">
            <div class="ac-info">
                <span class="ac-name">${card.name}</span>
                <span class="ac-meta">
                    <span class="ac-number">${card.number}/${card.total}</span>
                    <span>${card.rarity}</span>
                </span>
            </div>
        </div>
    `).join("");
    el.classList.add("active");
    acHighlightIdx = -1;
}

function attachSearchListeners() {
    const input = getSearchEl();
    const autoEl = getAutocompleteEl();
    if (!input || !autoEl) return;
    if (input._acAttached) return;
    input._acAttached = true;

    input.addEventListener("input", (e) => {
        searchFilter = e.target.value;
        renderCards();
        renderAutocomplete(e.target.value);
    });

    input.addEventListener("keydown", (e) => {
        const items = (getAutocompleteEl() || { querySelectorAll: () => [] }).querySelectorAll(".ac-item");
        if (!items.length) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            acHighlightIdx = Math.min(acHighlightIdx + 1, items.length - 1);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            acHighlightIdx = Math.max(acHighlightIdx - 1, -1);
        } else if (e.key === "Enter") {
            e.preventDefault();
            const highlighted = (getAutocompleteEl() || { querySelector: () => null }).querySelector(".highlighted");
            const target = highlighted || (items.length === 1 ? items[0] : null);
            if (target) {
                openCardDetails(target.dataset.acId);
                closeAutocomplete();
                getSearchEl().value = "";
                searchFilter = "";
                renderCards();
            }
            return;
        } else if (e.key === "Escape") {
            closeAutocomplete();
            return;
        } else {
            return;
        }

        items.forEach((el, i) => {
            el.classList.toggle("highlighted", i === acHighlightIdx);
        });
        const hl = items[acHighlightIdx];
        if (hl) hl.scrollIntoView({ block: "nearest" });
    });
}

// Delegated click for autocomplete items (survives DOM replacement)
document.addEventListener("click", (e) => {
    const item = e.target.closest(".ac-item");
    if (item) {
        e.preventDefault();
        openCardDetails(item.dataset.acId);
        closeAutocomplete();
        const input = getSearchEl();
        if (input) { input.value = ""; }
        searchFilter = "";
        renderCards();
        return;
    }
    if (!e.target.closest(".bulk-search")) {
        closeAutocomplete();
    }
});

// 3D Card Hover Effect in Modal
modalCard3D.addEventListener("mousemove", (e) => {
    const rect = modalCard3D.getBoundingClientRect();
    const x = e.clientX - rect.left; // x position inside element
    const y = e.clientY - rect.top;  // y position inside element
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    // Tilt calculations (-15 to 15 degrees)
    const rotateY = ((x - centerX) / centerX) * 15;
    const rotateX = -((y - centerY) / centerY) * 15;
    
    modalCard3D.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.03)`;
    
    // Holographic position calculations (0% to 100%)
    const shineX = (x / rect.width) * 100;
    const shineY = (y / rect.height) * 100;
    
    modalHoloShine.style.backgroundPosition = `${shineX}% ${shineY}%`;
    modalHoloShine.style.opacity = 0.5;
});

modalCard3D.addEventListener("mouseleave", () => {
    modalCard3D.style.transform = `rotateX(0deg) rotateY(0deg) scale(1)`;
    modalHoloShine.style.opacity = 0;
});

// Initialization
function migrateAcquiredToQuantity() {
    if (localStorage.getItem('qty_migrated_v1')) return;
    (collectionsData || []).forEach(col => {
        if (!col.id) return;
        try {
            const stockKey = 'stock_' + col.id;
            if (localStorage.getItem(stockKey)) return;
            const oldQtys = JSON.parse(localStorage.getItem('qty_' + col.id) || '{}');
            const oldFinishes = JSON.parse(localStorage.getItem('finish_' + col.id) || '{}');
            const stock = {};
            Object.keys(oldQtys).forEach(id => {
                const qty = oldQtys[id];
                if (qty > 0) {
                    const finish = oldFinishes[id] || 'none';
                    stock[id] = { none: 0, holo: 0, reverse: 0 };
                    stock[id][finish] = qty;
                }
            });
            if (Object.keys(stock).length) {
                localStorage.setItem(stockKey, JSON.stringify(stock));
            }
        } catch (e) {}
    });
    localStorage.setItem('qty_migrated_v1', '1');
}


