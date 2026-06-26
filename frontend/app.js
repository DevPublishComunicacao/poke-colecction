let colecoes = [];
let expansoes = [];
let paises = [];
let currentCards = [];

let selectedColecao = null;
let selectedExpansao = null;
let selectedPais = null;

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
  localStorage.removeItem('remembered_password');
  updateUserUI();
}

function authHeaders() {
  const t = getToken();
  return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function isLoggedIn() { return !!getToken(); }

function updateUserUI() {
  const span = document.getElementById('userName');
  if (!span) return;
  const isLogged = !!_authUser;
  span.textContent = isLogged ? (_authUser.name || _authUser.username) : 'Entrar';
  const gearBtn = document.getElementById('userGearBtn');
  if (gearBtn) {
    gearBtn.style.display = isLogged && _authUser.username === 'dev.publishcomunicacao@gmail.com' ? '' : 'none';
  }
}

let _stockCache = null;
let _acquiredCache = null;
let _dataInitialized = false;

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

async function fetchAndCacheUserData() {
  if (!isLoggedIn() || !selectedExpansao || !selectedPais) {
    _stockCache = {};
    _acquiredCache = [];
    _dataInitialized = true;
    return;
  }
  try {
    const eid = selectedExpansao.id;
    const pid = selectedPais.id;
    const resp = await fetch('/api/user/all?expansao_id=' + eid + '&pais_id=' + pid, { headers: authHeaders() });
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
  if (!isLoggedIn() || !selectedExpansao || !selectedPais) return;
  try {
    const eid = selectedExpansao.id;
    const pid = selectedPais.id;
    const resp = await fetch('/api/user/all?expansao_id=' + eid + '&pais_id=' + pid, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ stock: _stockCache || {}, acquired: _acquiredCache || [] })
    });
    if (resp.status === 401) {
      clearAuth();
      updateUserUI();
      if (currentCards) renderCards();
    }
  } catch (e) {}
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

// --- Preferences ---
async function savePrefsServer() {
  if (!isLoggedIn() || !selectedColecao || !selectedExpansao || !selectedPais) return;
  try {
    await fetch('/api/user/preferences', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        colecao_id: selectedColecao.id,
        expansao_id: selectedExpansao.id,
        pais_id: selectedPais.id
      })
    });
  } catch (e) {}
}

async function saveAllPrefs() {
  await savePrefsServer();
}

async function applyServerPrefs() {
  if (!isLoggedIn()) return;
  try {
    const resp = await fetch('/api/user/preferences', { headers: authHeaders() });
    if (!resp.ok) return;
    const p = await resp.json();
    if (!p) return;

    const c = colecoes.find(x => x.id === p.colecao_id);
    if (!c) return;

    // Auto-select colecao
    selectedColecao = c;
    document.getElementById('colecaoSelectedValue').textContent = c.name;
    document.getElementById('colecaoSelectedValue').dataset.val = c.id;
    const coMenu = document.getElementById('colecaoMenu');
    if (coMenu) {
      coMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('selected', el.dataset.value === String(c.id)));
    }

    await loadExpansoes();
    const e = expansoes.find(x => x.id === p.expansao_id);
    if (!e) { updateHeaderInfo(); renderCards(); return; }

    // Auto-select expansao
    selectedExpansao = e;
    document.getElementById('expansaoSelectedValue').textContent = e.name;
    document.getElementById('expansaoSelectedValue').dataset.val = e.id;
    const exMenu = document.getElementById('expansaoMenu');
    if (exMenu) {
      exMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('selected', el.dataset.value === String(e.id)));
    }

    await loadPaises();
    const pa = paises.find(x => x.id === p.pais_id);
    if (!pa) { updateHeaderInfo(); renderCards(); return; }

    // Auto-select pais
    selectedPais = pa;
    document.getElementById('paisSelectedValue').textContent = pa.name;
    document.getElementById('paisSelectedValue').dataset.val = pa.id;
    const paMenu = document.getElementById('paisMenu');
    if (paMenu) {
      paMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('selected', el.dataset.value === String(pa.id)));
    }

    await loadCards();
  } catch (e) {}
}

async function restorePrefs() {
  // Try server first if logged in, then localStorage
  if (isLoggedIn()) {
    try {
      const resp = await fetch('/api/user/preferences', { headers: authHeaders() });
      if (resp.ok) {
        const p = await resp.json();
        if (p) {
          const c = colecoes.find(x => x.id === p.colecao_id);
          if (c) selectedColecao = c;
          // expansao_id and pais_id will be resolved after load
          return { serverPrefs: p, found: !!c };
        }
      }
    } catch (e) {}
  }
  return { found: false };
}

// --- Dropdown helpers ---
function createDropdown(triggerId, menuId, selectedId, items, valueKey, labelKey, onSelect) {
  const trigger = document.getElementById(triggerId);
  const menu = document.getElementById(menuId);
  const selectedEl = document.getElementById(selectedId);
  if (!trigger || !menu || !selectedEl) return;

  function render() {
    menu.innerHTML = items.map(item => {
      const val = valueKey ? item[valueKey] : item.id;
      const lbl = labelKey ? item[labelKey] : (item.name || item);
      return `<li class="dropdown-item${val === selectedEl.dataset.val ? ' selected' : ''}" data-value="${val}" role="option">${lbl}</li>`;
    }).join('');
  }

  function open() {
    const dd = trigger.closest('.custom-dropdown');
    if (dd) dd.classList.add('active');
    trigger.setAttribute('aria-expanded', 'true');
  }

  function close() {
    const dd = trigger.closest('.custom-dropdown');
    if (dd) dd.classList.remove('active');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = trigger.closest('.custom-dropdown');
    const isOpen = dd && dd.classList.contains('active');
    if (isOpen) close(); else open();
  });

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.dropdown-item');
    if (!item) return;
    const val = item.dataset.value;
    close();
    if (val === selectedEl.dataset.val) return;
    selectedEl.dataset.val = val;
    const found = items.find(i => (valueKey ? i[valueKey] : i.id) == val);
    if (found) {
      selectedEl.textContent = labelKey ? found[labelKey] : (found.name || found);
      onSelect(found, val);
    }
  });

  return { render, close, setItems: (newItems) => { items = newItems; } };
}

// --- Cascade logic ---
async function resetAllDropdowns() {
  selectedColecao = null;
  selectedExpansao = null;
  selectedPais = null;
  expansoes = [];
  paises = [];
  currentCards = [];
  document.getElementById('colecaoSelectedValue').textContent = 'Selecione...';
  document.getElementById('colecaoSelectedValue').dataset.val = '';
  document.getElementById('expansaoSelectedValue').textContent = 'Selecione...';
  document.getElementById('expansaoSelectedValue').dataset.val = '';
  document.getElementById('paisSelectedValue').textContent = 'Selecione...';
  document.getElementById('paisSelectedValue').dataset.val = '';
  const coMenu = document.getElementById('colecaoMenu');
  if (coMenu) {
    coMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('selected', !el.dataset.value));
  }
  document.getElementById('expansaoMenu').innerHTML = '<li class="dropdown-item selected" data-value="" role="option">Selecione...</li>';
  document.getElementById('paisMenu').innerHTML = '<li class="dropdown-item selected" data-value="" role="option">Selecione...</li>';
  document.getElementById('colColecao').textContent = '';
  document.getElementById('colExpansao').textContent = '';
  document.getElementById('colPaisAno').textContent = '';
  document.getElementById('colDesc').textContent = '';
  document.getElementById('statTotal').textContent = '0';
  const grid = document.getElementById('cardsGrid');
  if (grid) grid.innerHTML = '<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>Selecione uma coleção, expansão e país para ver as cartas</p></div>';
  const resultsEl = document.getElementById('resultsCount');
  if (resultsEl) resultsEl.textContent = '';
  const bulkBar = document.querySelector('.bulk-bar');
  if (bulkBar) bulkBar.remove();
  const indexBar = document.getElementById('cardIndexBar');
  if (indexBar) indexBar.remove();
}

async function onColecaoClear() {
  selectedColecao = null;
  selectedExpansao = null;
  selectedPais = null;
  expansoes = [];
  paises = [];
  currentCards = [];
  document.getElementById('colecaoSelectedValue').textContent = 'Selecione...';
  document.getElementById('colecaoSelectedValue').dataset.val = '';
  document.getElementById('expansaoSelectedValue').textContent = 'Selecione...';
  document.getElementById('expansaoSelectedValue').dataset.val = '';
  document.getElementById('paisSelectedValue').textContent = 'Selecione...';
  document.getElementById('paisSelectedValue').dataset.val = '';
  const coMenu = document.getElementById('colecaoMenu');
  if (coMenu) {
    coMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('selected', !el.dataset.value));
  }
  document.getElementById('expansaoMenu').innerHTML = '<li class="dropdown-item selected" data-value="" role="option">Selecione...</li>';
  document.getElementById('paisMenu').innerHTML = '<li class="dropdown-item selected" data-value="" role="option">Selecione...</li>';
  updateHeaderInfo();
  renderCards();
  await saveAllPrefs();
}

async function onExpansaoClear() {
  selectedExpansao = null;
  selectedPais = null;
  paises = [];
  currentCards = [];
  document.getElementById('expansaoSelectedValue').textContent = 'Selecione...';
  document.getElementById('expansaoSelectedValue').dataset.val = '';
  document.getElementById('paisSelectedValue').textContent = 'Selecione...';
  document.getElementById('paisSelectedValue').dataset.val = '';
  const exMenu = document.getElementById('expansaoMenu');
  if (exMenu) {
    exMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('selected', !el.dataset.value));
  }
  document.getElementById('paisMenu').innerHTML = '<li class="dropdown-item selected" data-value="" role="option">Selecione...</li>';
  updateHeaderInfo();
  renderCards();
  await saveAllPrefs();
}

async function onPaisClear() {
  selectedPais = null;
  currentCards = [];
  document.getElementById('paisSelectedValue').textContent = 'Selecione...';
  document.getElementById('paisSelectedValue').dataset.val = '';
  updateHeaderInfo();
  renderCards();
  await saveAllPrefs();
}

async function onColecaoSelect(colecao) {
  selectedColecao = colecao;
  selectedExpansao = null;
  selectedPais = null;
  expansoes = [];
  paises = [];
  currentCards = [];
  document.getElementById('expansaoSelectedValue').textContent = 'Selecione...';
  document.getElementById('expansaoSelectedValue').dataset.val = '';
  document.getElementById('paisSelectedValue').textContent = 'Selecione...';
  document.getElementById('paisSelectedValue').dataset.val = '';
  document.getElementById('colecaoSelectedValue').dataset.val = colecao.id;
  const coMenu = document.getElementById('colecaoMenu');
  if (coMenu) {
    coMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('selected', el.dataset.value === String(colecao.id)));
  }

  await loadExpansoes();
  updateHeaderInfo();
  renderCards();
  await saveAllPrefs();
}

async function onExpansaoSelect(expansao) {
  selectedExpansao = expansao;
  selectedPais = null;
  paises = [];
  currentCards = [];
  document.getElementById('expansaoSelectedValue').textContent = expansao.name;
  document.getElementById('expansaoSelectedValue').dataset.val = expansao.id;
  const exMenu = document.getElementById('expansaoMenu');
  if (exMenu) {
    exMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('selected', el.dataset.value === String(expansao.id)));
  }
  document.getElementById('paisSelectedValue').textContent = 'Selecione...';
  document.getElementById('paisSelectedValue').dataset.val = '';

  await loadPaises();
  updateHeaderInfo();
  renderCards();
  await saveAllPrefs();
}

async function onPaisSelect(pais) {
  selectedPais = pais;
  document.getElementById('paisSelectedValue').textContent = pais.name;
  document.getElementById('paisSelectedValue').dataset.val = pais.id;
  const paMenu = document.getElementById('paisMenu');
  if (paMenu) {
    paMenu.querySelectorAll('.dropdown-item').forEach(el => el.classList.toggle('selected', el.dataset.value === String(pais.id)));
  }
  await loadCards();
}

// --- Data loading ---
async function loadExpansoes() {
  if (!selectedColecao) return;
  const resp = await fetch('/api/expansoes?colecao_id=' + selectedColecao.id);
  if (resp.ok) expansoes = await resp.json();
  else expansoes = [];
  const eMenu = document.getElementById('expansaoMenu');
  if (eMenu) {
    eMenu.innerHTML = `<li class="dropdown-item${!selectedExpansao ? ' selected' : ''}" data-value="" role="option">Selecione...</li>` +
      expansoes.map(e =>
        `<li class="dropdown-item${selectedExpansao && e.id === selectedExpansao.id ? ' selected' : ''}" data-value="${e.id}" role="option">${e.name}</li>`
      ).join('');
  }
}

async function loadPaises() {
  if (!selectedExpansao) return;
  const resp = await fetch('/api/paises?expansao_id=' + selectedExpansao.id);
  if (resp.ok) paises = await resp.json();
  else paises = [];
  const pMenu = document.getElementById('paisMenu');
  if (pMenu) {
    pMenu.innerHTML = `<li class="dropdown-item${!selectedPais ? ' selected' : ''}" data-value="" role="option">Selecione...</li>` +
      paises.map(p =>
        `<li class="dropdown-item${selectedPais && p.id === selectedPais.id ? ' selected' : ''}" data-value="${p.id}" role="option">${p.name}</li>`
      ).join('');
  }
}

async function loadCards() {
  if (!selectedExpansao || !selectedPais) { currentCards = []; renderCards(); return; }
  const resp = await fetch('/api/cards?expansao_id=' + selectedExpansao.id + '&pais_id=' + selectedPais.id);
  if (resp.ok) currentCards = await resp.json();
  else currentCards = [];
  await fetchAndCacheUserData();
  updateHeaderInfo();
  renderCards();
  await saveAllPrefs();
}

// --- Header ---
function updateHeaderInfo() {
  const colecaoEl = document.getElementById('colColecao');
  const expansaoEl = document.getElementById('colExpansao');
  const paisAnoEl = document.getElementById('colPaisAno');
  const descEl = document.getElementById('colDesc');
  const totalEl = document.getElementById('statTotal');
  if (!colecaoEl) return;

  if (selectedColecao && selectedExpansao) {
    colecaoEl.textContent = selectedColecao.name;
    expansaoEl.textContent = selectedExpansao.name;
    paisAnoEl.textContent = '(' + (selectedPais ? selectedPais.name + ' — ' : '') + (selectedExpansao.year || '') + ')';
    descEl.textContent = selectedExpansao.description || '';
    totalEl.textContent = currentCards.length;
  } else if (selectedColecao) {
    colecaoEl.textContent = selectedColecao.name;
    expansaoEl.textContent = '';
    paisAnoEl.textContent = '';
    descEl.textContent = '';
    totalEl.textContent = '0';
  } else {
    colecaoEl.textContent = '';
    expansaoEl.textContent = '';
    paisAnoEl.textContent = '';
    descEl.textContent = '';
    totalEl.textContent = '0';
  }
}

// --- State ---
let searchFilter = '';
let filterStatus = '';

// --- Init ---
async function initApp() {
  // Fetch colecoes
  try {
    const resp = await fetch('/api/colecoes');
    colecoes = await resp.json();
  } catch (e) { colecoes = []; }

  if (colecoes.length === 0) {
    const loader = document.getElementById('loadingOverlay');
    if (loader) loader.style.display = 'none';
    return;
  }

  initColecaoDropdown();

  const colVal = document.getElementById('colecaoSelectedValue');
  const expVal = document.getElementById('expansaoSelectedValue');
  const paisVal = document.getElementById('paisSelectedValue');

  // Restore preferences
  const prefResult = await restorePrefs();

  if (selectedColecao) {
    // Prefs found — auto-select everything
    colVal.textContent = selectedColecao.name;
    colVal.dataset.val = selectedColecao.id;
    highlightDropdownItem('colecaoMenu', selectedColecao.id);
    await loadExpansoes();

    let savedExpId = null;
    if (prefResult.serverPrefs) savedExpId = prefResult.serverPrefs.expansao_id;
    else if (prefResult.localPrefs) savedExpId = prefResult.localPrefs.expansao_id;

    if (savedExpId) {
      const found = expansoes.find(e => e.id == savedExpId);
      if (found) selectedExpansao = found;
    }

    if (selectedExpansao) {
      expVal.textContent = selectedExpansao.name;
      expVal.dataset.val = selectedExpansao.id;
      highlightDropdownItem('expansaoMenu', selectedExpansao.id);
      await loadPaises();

      let savedPaisId = null;
      if (prefResult.serverPrefs) savedPaisId = prefResult.serverPrefs.pais_id;
      else if (prefResult.localPrefs) savedPaisId = prefResult.localPrefs.pais_id;

      if (savedPaisId) {
        const found = paises.find(p => p.id == savedPaisId);
        if (found) selectedPais = found;
      }

      if (selectedPais) {
        paisVal.textContent = selectedPais.name;
        paisVal.dataset.val = selectedPais.id;
        highlightDropdownItem('paisMenu', selectedPais.id);
      }
    }

    await loadCards();
    updateHeaderInfo();
  } else {
    // No prefs — show placeholders
    colVal.textContent = 'Selecione...';
    colVal.dataset.val = '';
    expVal.textContent = 'Selecione...';
    expVal.dataset.val = '';
    paisVal.textContent = 'Selecione...';
    paisVal.dataset.val = '';
    updateHeaderInfo();
  }

  const loader = document.getElementById('loadingOverlay');
  if (loader) loader.style.display = 'none';
}

function highlightDropdownItem(menuId, value) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  menu.querySelectorAll('.dropdown-item').forEach(el => {
    el.classList.toggle('selected', String(el.dataset.value) === String(value));
  });
}

function initColecaoDropdown() {
  const trigger = document.getElementById('colecaoTrigger');
  const menu = document.getElementById('colecaoMenu');
  const selectedEl = document.getElementById('colecaoSelectedValue');

  menu.innerHTML = `<li class="dropdown-item${!selectedColecao ? ' selected' : ''}" data-value="" role="option">Selecione...</li>` +
    colecoes.map(c =>
      `<li class="dropdown-item${c.id === selectedColecao?.id ? ' selected' : ''}" data-value="${c.id}" role="option">${c.name}</li>`
    ).join('');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = trigger.closest('.custom-dropdown');
    const isOpen = dd.classList.contains('active');
    dd.classList.toggle('active');
    trigger.setAttribute('aria-expanded', !isOpen);
    // Close siblings
    document.querySelectorAll('.custom-dropdown').forEach(d => {
      if (d !== dd) d.classList.remove('active');
    });
  });

  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.dropdown-item');
    if (!item) return;
    const val = item.dataset.value;
    trigger.closest('.custom-dropdown').classList.remove('active');
    trigger.setAttribute('aria-expanded', 'false');
    if (!val) {
      await onColecaoClear();
      return;
    }
    const colecao = colecoes.find(c => String(c.id) === val);
    if (!colecao) return;
    if (colecao.id === selectedColecao?.id) return;
    selectedEl.textContent = colecao.name;
    selectedEl.dataset.val = colecao.id;
    await onColecaoSelect(colecao);
  });

  // Close dropdowns only when clicking outside any dropdown
  document.addEventListener('click', (e) => {
    if (e.target.closest('.custom-dropdown')) return;
    document.querySelectorAll('.custom-dropdown').forEach(d => {
      d.classList.remove('active');
      const t = d.querySelector('.dropdown-trigger');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
  });
}

// Attach expansao/pais dropdown listeners
document.addEventListener('click', async (e) => {
  // Expansão dropdown items
  const expItem = e.target.closest('#expansaoMenu .dropdown-item');
  if (expItem) {
    e.stopPropagation();
    const val = expItem.dataset.value;
    document.getElementById('expansaoDropdown').classList.remove('active');
    document.getElementById('expansaoTrigger').setAttribute('aria-expanded', 'false');
    if (!val) {
      await onExpansaoClear();
      return;
    }
    const exp = expansoes.find(x => String(x.id) === val);
    if (!exp || exp.id === selectedExpansao?.id) return;
    document.getElementById('expansaoSelectedValue').textContent = exp.name;
    document.getElementById('expansaoSelectedValue').dataset.val = exp.id;
    highlightDropdownItem('expansaoMenu', exp.id);
    await onExpansaoSelect(exp);
    return;
  }
  // País dropdown items
  const paisItem = e.target.closest('#paisMenu .dropdown-item');
  if (paisItem) {
    e.stopPropagation();
    const val = paisItem.dataset.value;
    document.getElementById('paisDropdown').classList.remove('active');
    document.getElementById('paisTrigger').setAttribute('aria-expanded', 'false');
    if (!val) {
      await onPaisClear();
      return;
    }
    const pais = paises.find(x => String(x.id) === val);
    if (!pais || pais.id === selectedPais?.id) return;
    document.getElementById('paisSelectedValue').textContent = pais.name;
    document.getElementById('paisSelectedValue').dataset.val = pais.id;
    highlightDropdownItem('paisMenu', pais.id);
    await onPaisSelect(pais);
    return;
  }
  // Open expansao dropdown
  const expTrig = e.target.closest('#expansaoTrigger');
  if (expTrig) {
    e.stopPropagation();
    const dd = document.getElementById('expansaoDropdown');
    dd.classList.toggle('active');
    expTrig.setAttribute('aria-expanded', dd.classList.contains('active'));
    document.querySelectorAll('.custom-dropdown').forEach(d => {
      if (d !== dd) d.classList.remove('active');
    });
    return;
  }
  // Open pais dropdown
  const paisTrig = e.target.closest('#paisTrigger');
  if (paisTrig) {
    e.stopPropagation();
    const dd = document.getElementById('paisDropdown');
    dd.classList.toggle('active');
    paisTrig.setAttribute('aria-expanded', dd.classList.contains('active'));
    document.querySelectorAll('.custom-dropdown').forEach(d => {
      if (d !== dd) d.classList.remove('active');
    });
    return;
  }
});

// --- Auth ---
let _authMode = 'login';

function initAuth() {
  const stored = localStorage.getItem('auth_token');
  if (stored) {
    _authToken = stored;
    try {
      const payload = JSON.parse(atob(stored.split('.')[1]));
      _authUser = { id: payload.userId, username: payload.username, name: payload.name || '' };
    } catch (e) { clearAuth(); }
  }
  updateUserUI();

  document.getElementById('userBtn').addEventListener('click', () => {
    if (isLoggedIn()) {
      clearAuth();
      _stockCache = {};
      _acquiredCache = [];
      resetAllDropdowns();
      return;
    }
    openAuthModal();
  });

  document.getElementById('userGearBtn').addEventListener('click', () => {
    // placeholder — futura tela de admin/config
    alert('Configurações (em breve)');
  });

  document.getElementById('authModalClose').addEventListener('click', closeAuthModal);
  document.getElementById('authModal').addEventListener('mousedown', (e) => {
    if (e.target === e.currentTarget) closeAuthModal();
  });

  document.getElementById('authToggleBtn').addEventListener('click', () => {
    _authMode = _authMode === 'login' ? 'register' : 'login';
    document.getElementById('authTitle').textContent = _authMode === 'login' ? 'Entrar' : 'Registrar';
    document.getElementById('authSubmit').textContent = _authMode === 'login' ? 'Entrar' : 'Registrar';
    document.getElementById('authToggleText').textContent = _authMode === 'login' ? 'Não tem conta?' : 'Já tem conta?';
    document.getElementById('authToggleBtn').textContent = _authMode === 'login' ? 'Registrar' : 'Entrar';
    document.getElementById('authNameField').style.display = _authMode === 'register' ? '' : 'none';
    document.getElementById('authError').textContent = '';
    document.getElementById('authUsername').focus();
  });

  document.getElementById('passwordToggle').addEventListener('click', () => {
    const input = document.getElementById('authPassword');
    const icon = document.querySelector('#passwordToggle i');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    icon.className = isPassword ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    document.getElementById('passwordToggle').setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
  });

  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    const errorEl = document.getElementById('authError');
    errorEl.textContent = '';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(username)) {
      errorEl.textContent = 'Informe um e-mail válido';
      return;
    }

    let displayName = '';
    if (_authMode === 'register') {
      displayName = document.getElementById('authName').value.trim();
      if (displayName.length < 3) {
        errorEl.textContent = 'Nome deve ter pelo menos 3 caracteres';
        return;
      }
    }

    const endpoint = _authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, name: displayName })
      });
      const data = await resp.json();
      if (!resp.ok) {
        errorEl.textContent = data.error || 'Erro desconhecido';
        return;
      }
      setToken(data.token, data.user);
      updateUserUI();
      closeAuthModal();
      if (document.getElementById('rememberMe').checked) {
        localStorage.setItem('remembered_email', username);
        localStorage.setItem('remembered_password', password);
      } else {
        localStorage.removeItem('remembered_email');
        localStorage.removeItem('remembered_password');
      }
      document.getElementById('authUsername').value = '';
      document.getElementById('authPassword').value = '';
      document.getElementById('authName').value = '';

      // Load user prefs from server after login
      await applyServerPrefs();
    } catch (e) {
      errorEl.textContent = 'Erro de conexão';
    }
  });
}

function openAuthModal() {
  document.getElementById('authModal').classList.add('active');
  document.getElementById('authModal').setAttribute('aria-hidden', 'false');
  document.getElementById('authError').textContent = '';
  const savedEmail = localStorage.getItem('remembered_email');
  const savedPass = localStorage.getItem('remembered_password');
  if (savedEmail) {
    document.getElementById('authUsername').value = savedEmail;
    if (savedPass) document.getElementById('authPassword').value = savedPass;
    document.getElementById('rememberMe').checked = true;
    document.getElementById('authPassword').focus();
  } else {
    document.getElementById('authUsername').focus();
  }
}

function closeAuthModal() {
  document.getElementById('authModal').classList.remove('active');
  document.getElementById('authModal').setAttribute('aria-hidden', 'true');
}

// --- Rendering ---
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

function renderCards() {
  if (!currentCards || currentCards.length === 0) {
    const grid = document.getElementById('cardsGrid');
    if (grid) grid.innerHTML = '<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>Selecione uma coleção, expansão e país para ver as cartas</p></div>';
    return;
  }

  const query = searchFilter.toLowerCase().trim();
  const cardStock = getCardStock();
  const allCards = currentCards.filter(card =>
    card.name.toLowerCase().includes(query) ||
    card.type.toLowerCase().includes(query) ||
    card.rarity.toLowerCase().includes(query) ||
    card.number.toLowerCase().includes(query)
  );
  const filtered = filterStatus === "acquired" ? allCards.filter(c => getAcquiredCards().includes(c.id)) :
                   filterStatus === "missing"  ? allCards.filter(c => !getAcquiredCards().includes(c.id)) :
                   allCards;

  const resultsEl = document.getElementById('resultsCount');
  if (resultsEl) resultsEl.textContent = `Exibindo ${filtered.length} de ${currentCards.length} cartas`;

  const acquiredCards = getAcquiredCards();
  const acquiredCount = acquiredCards.length;
  const statTotal = document.getElementById('statTotal');
  if (statTotal) {
    statTotal.textContent = acquiredCount > 0 ? `${currentCards.length} (${acquiredCount} adquiridas)` : String(currentCards.length);
  }

  const loggedIn = isLoggedIn();
  if (!document.querySelector(".bulk-bar")) {
    const gridHeader = document.querySelector(".grid-header");
    if (gridHeader) {
      gridHeader.insertAdjacentHTML("afterend", `
        <div class="bulk-bar">
          <span class="bulk-count" id="bulkCount">${acquiredCount}/${currentCards.length}</span>
          <div class="bulk-search">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="cardSearch" placeholder="Buscar..." aria-label="Buscar carta" autocomplete="off">
            <div class="search-autocomplete" id="searchAutocomplete"></div>
          </div>
          <div class="filter-status-group">
            <button class="filter-status-btn${!filterStatus ? ' active' : ''}" data-filter="all">Todas</button>
            <button class="filter-status-btn${filterStatus === 'acquired' ? ' active' : ''}" data-filter="acquired">Adquiridas</button>
            <button class="filter-status-btn${filterStatus === 'missing' ? ' active' : ''}" data-filter="missing">Faltantes</button>
          </div>
        </div>
      `);
      attachSearchListeners();
      document.querySelectorAll(".filter-status-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const f = btn.dataset.filter;
          if (f === "all") {
            filterStatus = "";
            searchFilter = "";
            const inp = getSearchEl(); if (inp) inp.value = "";
          } else {
            filterStatus = filterStatus === f ? "" : f;
            if (filterStatus) { searchFilter = ""; const inp = getSearchEl(); if (inp) inp.value = ""; }
          }
          renderCards();
        });
      });
      const bulkBar = document.querySelector(".bulk-bar");
      if (bulkBar) {
        bulkBar.insertAdjacentHTML("afterend", `<div class="card-index-bar" id="cardIndexBar"></div>`);
      }
    }
  } else {
    const countEl = document.getElementById("bulkCount");
    if (countEl) countEl.textContent = `${acquiredCount}/${currentCards.length}`;
    document.querySelectorAll(".filter-status-btn").forEach(btn => {
      const isActive = btn.dataset.filter === "all" ? !filterStatus : btn.dataset.filter === filterStatus;
      btn.classList.toggle("active", isActive);
    });
  }

  const indexBar = document.getElementById("cardIndexBar");
  if (indexBar) {
    const selNum = searchFilter.trim();
    const acqSet = new Set(getAcquiredCards());
    indexBar.innerHTML = `<button class="index-pill${!selNum ? ' active' : ''}" data-num="">Todas</button>` +
      currentCards.map(c => {
        const isAcq = acqSet.has(c.id);
        return `<button class="index-pill${selNum === c.number ? ' active' : ''}${isAcq ? ' acquired' : ''}" data-num="${c.number}">${c.number}</button>`;
      }).join('');
  }

  if (filtered.length === 0) {
    document.getElementById('cardsGrid').innerHTML = `
      <div class="empty-state">
        <i class="fa-regular fa-folder-open"></i>
        <p>Nenhuma carta encontrada para "${searchFilter}"</p>
      </div>
    `;
    return;
  }

  document.getElementById('cardsGrid').innerHTML = filtered.map(card => {
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

document.addEventListener("click", (e) => {
  const pill = e.target.closest(".index-pill");
  if (!pill) return;
  const num = pill.dataset.num;
  searchFilter = num;
  const input = getSearchEl();
  if (input) input.value = num;
  if (!num) filterStatus = "";
  renderCards();
});

// --- Modal ---
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

function openCardDetails(cardId) {
  const card = currentCards.find(c => c.id === cardId);
  if (!card) return;

  modalCardNumber.textContent = `${card.number}/${card.total}`;
  modalCardName.textContent = card.name;
  modalCardImg.src = card.image;
  modalCardImg.alt = `Carta de ${card.name}`;
  modalCardImg.dataset.cardId = card.id;

  const isTrainer = card.hp === "-";
  modalCardType.className = `card-type-badge ${isTrainer ? 'Colorless' : card.type}`;
  modalCardType.textContent = isTrainer ? card.rarity : card.type;
  modalCardType.style.display = isTrainer ? 'none' : '';
  modalCardHp.textContent = isTrainer ? '—' : card.hp;
  modalCardRarity.textContent = card.rarity;
  modalCardStage.textContent = isTrainer ? '—' : card.stage;

  const pullRate = PULL_RATES[card.rarity] || '—';
  modalPullRate.textContent = pullRate;
  const cardQuery = encodeURIComponent(`${card.name} Pokémon TCG ${card.number}/${card.total}`);
  modalPriceLinks.innerHTML = `
    <a href="https://www.ebay.com/sch/i.html?_nkw=${cardQuery}" target="_blank" rel="noopener noreferrer" class="price-link ebay">eBay</a>
    <a href="https://www.tcgplayer.com/search/pokemon/product?q=${cardQuery}" target="_blank" rel="noopener noreferrer" class="price-link tcgplayer">TCGplayer</a>
  `;

  modalCardAttacks.innerHTML = card.attacks.map(att => `
    <div class="attack-item">
      <div class="attack-header">
        <span class="attack-name">${att.name}</span>
        <span class="attack-damage">${att.damage ? att.damage : ""}</span>
      </div>
      <p class="attack-desc">${att.desc}</p>
    </div>
  `).join("");

  modalCardWeakness.textContent = isTrainer ? '—' : card.weakness;
  modalCardResistance.textContent = isTrainer ? '—' : card.resistance;
  modalCardRetreat.textContent = isTrainer ? '—' : card.retreat;
  modalCardSpecs.style.display = isTrainer ? 'none' : '';
  modalCardFooterSpecs.style.display = isTrainer ? 'none' : '';
  modalAttacksSection.querySelector('h3').textContent = isTrainer ? 'Efeito' : 'Ataques / Habilidades';

  const loggedIn = isLoggedIn();
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

  modalAcquireBtn.style.display = loggedIn ? '' : 'none';
  const isAcquired = getAcquiredCards().includes(card.id);
  modalAcquireBtn.classList.toggle("acquired", isAcquired);
  modalAcquireBtn.setAttribute("aria-label", isAcquired ? 'Remover' : 'Marcar como adquirida');
  modalAcquireBtn.title = isAcquired ? 'Remover adquirida' : 'Marcar adquirida';

  cardModal.classList.add("active");
  cardModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  modalCard3D.style.transform = `rotateX(0deg) rotateY(0deg)`;
}

function closeModal() {
  cardModal.classList.remove("active");
  cardModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "auto";
}

modalClose.addEventListener("click", closeModal);
cardModal.addEventListener("mousedown", (e) => {
  const btn = e.target.closest("#modalAcquireBtn");
  if (!btn) return;
  const cardId = document.getElementById("modalCardImg").dataset.cardId;
  if (!cardId) return;
  e.stopPropagation();
  const acquired = getAcquiredCards();
  const idx = acquired.indexOf(cardId);
  const wasAcquired = idx >= 0;
  if (wasAcquired) {
    acquired.splice(idx, 1);
    const stock = getCardStock();
    delete stock[cardId];
    setCardStock(stock);
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
  const gridCard = document.querySelector(`.poke-card[data-card-id="${cardId}"]`);
  if (gridCard) {
    gridCard.classList.toggle("acquired", nowAcquired);
    const gridBtn = gridCard.querySelector(".acquire-btn");
    if (gridBtn) {
      gridBtn.classList.toggle("acquired", nowAcquired);
      gridBtn.setAttribute("aria-label", nowAcquired ? 'Remover' : 'Marcar como adquirida');
      gridBtn.title = nowAcquired ? 'Remover adquirida' : 'Marcar adquirida';
    }
    if (!nowAcquired) {
      gridCard.querySelectorAll(".qty-value").forEach(el => el.textContent = "0");
      const badge = gridCard.querySelector(".foil-badge");
      if (badge) {
        badge.textContent = 'Comum';
        badge.className = badge.className.replace(/foil-\w+/, 'foil-none');
      }
    }
  }
  const countEl = document.getElementById("bulkCount");
  if (countEl) {
    countEl.textContent = `${getAcquiredCards().length}/${currentCards.length}`;
  }
});

cardModal.addEventListener("click", (e) => {
  if (e.target === cardModal) closeModal();
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-mstock]");
  if (!btn) return;
  e.stopPropagation();
  const parts = btn.dataset.mstock.split(':');
  adjustStock(parts[0], parts[1], parseInt(parts[2]));
  const card = currentCards.find(c => c.id === parts[0]);
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

// --- Search ---
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
  const results = currentCards.filter(c =>
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

// --- 3D hover ---
modalCard3D.addEventListener("mousemove", (e) => {
  const rect = modalCard3D.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const rotateY = ((x - centerX) / centerX) * 15;
  const rotateX = -((y - centerY) / centerY) * 15;
  modalCard3D.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.03)`;
  const shineX = (x / rect.width) * 100;
  const shineY = (y / rect.height) * 100;
  modalHoloShine.style.backgroundPosition = `${shineX}% ${shineY}%`;
  modalHoloShine.style.opacity = 0.5;
});

modalCard3D.addEventListener("mouseleave", () => {
  modalCard3D.style.transform = `rotateX(0deg) rotateY(0deg) scale(1)`;
  modalHoloShine.style.opacity = 0;
});

// --- Entry point ---
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  initApp();
});
