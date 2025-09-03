const apiKeyInput = document.getElementById('apiKey');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const windowDaysInput = document.getElementById('windowDays');
const startDiscountPctInput = document.getElementById('startDiscountPct');
const endDiscountPctInput = document.getElementById('endDiscountPct');
const minPriceInput = document.getElementById('minPrice');
const dryRunInput = document.getElementById('dryRun');
const loadPropsBtn = document.getElementById('loadProps');
const runBtn = document.getElementById('runBtn');
const propsDiv = document.getElementById('props');
const logPre = document.getElementById('log');
const rulesFileInput = document.getElementById('rulesFile');

// Rules UI elements
const rulesFile2 = document.getElementById('rulesFile2');
const propSelectRules = document.getElementById('propSelectRules');
const baseRateInput = document.getElementById('baseRate');
const minRateInput = document.getElementById('minRate');
const weekendRateInput = document.getElementById('weekendRate');
const ppagInput = document.getElementById('ppag');
const addlFromInput = document.getElementById('addlFrom');
const loadRulesBtn = document.getElementById('loadRules');
const saveRatesBtn = document.getElementById('saveRates');
const seasonsDiv = document.getElementById('seasons');
const addSeasonBtn = document.getElementById('addSeason');
const saveSeasonsBtn = document.getElementById('saveSeasons');
const toastContainer = document.getElementById('toast-container');

// Default date range: today -> 18 months ahead (server enforces; UI displays)
function fmtDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
const now = new Date();
const startLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const endExclusive = new Date(startLocal.getFullYear(), startLocal.getMonth()+18, startLocal.getDate());
const endLocal = new Date(endExclusive.getFullYear(), endExclusive.getMonth(), endExclusive.getDate()-1);
startDateInput.value = fmtDate(startLocal);
endDateInput.value = fmtDate(endLocal);

function log(msg) {
  logPre.textContent += `\n${msg}`;
  logPre.scrollTop = logPre.scrollHeight;
}

function showToast(message, type = 'info', timeout = 2600) {
  if (!toastContainer) { console[type === 'error' ? 'error' : 'log'](message); return; }
  const div = document.createElement('div');
  div.className = `toast toast-${type}`;
  div.textContent = message;
  toastContainer.appendChild(div);
  const remove = () => { if (div.parentNode) div.parentNode.removeChild(div); };
  setTimeout(remove, timeout);
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (apiKeyInput.value) h['x-apikey'] = apiKeyInput.value;
  return h;
}

// Properties cache for rules select and run selection
let allPropsCache = [];
let rulesState = { baseRates: {}, seasons: [] };
const appReady = { props: false, rules: false };

function renderOrchestrator() {
  // Only proceed when both phases are ready
  if (!appReady.props || !appReady.rules) return;
  // Ensure a property is selected
  if (propSelectRules && !propSelectRules.value && propSelectRules.options.length) {
    propSelectRules.selectedIndex = 0;
  }
  if (propSelectCal && !propSelectCal.value && propSelectCal.options.length) {
    propSelectCal.selectedIndex = 0;
  }
  // Hydrate property fields and LOS
  try { updateBaseMinForSelectedProp(); } catch {}
  try { renderLos(); } catch {}
  // Calendar and legend
  try { renderCalendar(); } catch {}
  try { renderSeasonLegend(); } catch {}
}

loadPropsBtn.addEventListener('click', () => { propsDiv.innerHTML = 'Loading…'; loadPropertiesAndRender(); });

async function loadPropertiesAndRender() {
  try {
    const qs = apiKeyInput.value ? `?apiKey=${encodeURIComponent(apiKeyInput.value)}` : '';
    const r = await fetch(`/api/properties${qs}`, { headers: headers() });
    const props = await r.json();
    allPropsCache = props;
    renderProperties(props);
    syncRulesPropSelect();
    syncCalProps();
    appReady.props = true;
    renderOrchestrator();
  } catch (e) {
    propsDiv.innerHTML = `<div class="error">Failed to load: ${e.message}</div>`;
  }
}

function renderProperties(props) {
  if (!Array.isArray(props) || !props.length) {
    propsDiv.innerHTML = '<em>No properties found</em>';
    return;
  }
  const container = document.createElement('div');
  container.className = 'prop-list';
  for (const p of props) {
    const row = document.createElement('label');
    row.className = 'prop-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = String(p.id);
    row.appendChild(cb);
    const name = document.createElement('span');
    name.textContent = `${p.name ?? 'Unnamed'} (ID ${p.id})`;
    row.appendChild(name);
    container.appendChild(row);
  }
  propsDiv.innerHTML = '';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const selectAll = document.createElement('button');
  selectAll.textContent = 'Select All';
  selectAll.onclick = () => container.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = true);
  const deselectAll = document.createElement('button');
  deselectAll.textContent = 'Deselect All';
  deselectAll.onclick = () => container.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = false);
  actions.appendChild(selectAll);
  actions.appendChild(deselectAll);
  propsDiv.appendChild(actions);
  propsDiv.appendChild(container);
}

function syncRulesPropSelect() {
  propSelectRules.innerHTML = '';
  for (const p of allPropsCache) {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = `${p.name ?? 'Unnamed'} (ID ${p.id})`;
    propSelectRules.appendChild(opt);
  }
  if (!propSelectRules.value && propSelectRules.options.length) {
    propSelectRules.selectedIndex = 0;
  }
  updateBaseMinForSelectedProp();
}

document.addEventListener('DOMContentLoaded', () => {
  rulesFile2.value = rulesFileInput.value;
  const tabs = document.querySelectorAll('.tab');
  const pages = document.querySelectorAll('.page');
  function show(page) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.page === page));
    pages.forEach(p => p.classList.toggle('active', p.dataset.page === page));
  }
  tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.page)));
  show('properties');
  // Automatically load properties on start
  propsDiv.innerHTML = 'Loading…';
  loadPropertiesAndRender()
    .then(() => loadRules().catch(() => {}))
    .catch(() => {});
});

runBtn.addEventListener('click', async () => {
  const selected = Array.from(propsDiv.querySelectorAll('.prop-list input[type=checkbox]'))
    .filter(c => c.checked).map(c => c.value);
  // Basic client-side validation
  if (!startDateInput.value || !endDateInput.value) { log('Error: Start/End date required'); return; }
  const sDate = new Date(startDateInput.value + 'T00:00:00');
  const eDate = new Date(endDateInput.value + 'T00:00:00');
  if (isNaN(sDate) || isNaN(eDate)) { log('Error: Invalid date(s)'); return; }
  if (eDate < sDate) { log('Error: End date must be on/after start date'); return; }
  const monthsDiff = (eDate.getFullYear() - sDate.getFullYear()) * 12 + (eDate.getMonth() - sDate.getMonth());
  if (monthsDiff > 17) { log('Error: Date range exceeds 18 months'); return; }
  const body = {
    startDate: startDateInput.value,
    endDate: endDateInput.value,
    windowDays: Number(windowDaysInput.value),
    startDiscountPct: Number(startDiscountPctInput.value),
    endDiscountPct: Number(endDiscountPctInput.value),
    minPrice: Number(minPriceInput.value),
    rulesFile: rulesFileInput.value,
    dryRun: !!dryRunInput.checked,
    selectedPropertyIds: selected,
  };
  log('Starting update…');
  try {
    const r = await fetch('/api/run-update', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    for (const line of data.logs || []) log(line);
    log(`Summary: success=${data.success} failed=${data.failed} skipped=${data.skipped} dry_run=${data.dry_run}`);
  } catch (e) {
    log(`Error: ${e.message}`);
  }
});

// Seasons / Rules
propSelectRules.addEventListener('change', updateBaseMinForSelectedProp);
// Ensure save button state resets on property change
propSelectRules.addEventListener('change', () => {
  if (saveRatesBtn) { saveRatesBtn.disabled = false; saveRatesBtn.textContent = 'Save'; }
});
loadRulesBtn.addEventListener('click', async () => {
  try { await loadRules(); showToast('Rules loaded', 'success'); }
  catch (e) { showToast(`Failed to load rules: ${e.message}`, 'error', 4000); }
});
saveRatesBtn.addEventListener('click', async (e) => {
  const btn = e.currentTarget; const prev = btn.textContent; btn.textContent = 'Saving…'; btn.disabled = true;
  const pid = propSelectRules.value;
  if (!pid) return;
  const existing = rulesState.baseRates[pid] || {};
  rulesState.baseRates[pid] = {
    ...existing,
    base: Number(baseRateInput.value || 0),
    min: Number(minRateInput.value || 0),
    weekend_pct: Number(weekendRateInput?.value || 0),
    price_per_additional_guest: Number(typeof ppagInput !== 'undefined' && ppagInput ? (ppagInput.value || 0) : 0),
    additional_guests_starts_from: Number(typeof addlFromInput !== 'undefined' && addlFromInput ? (addlFromInput.value || 0) : 0),
    los: Array.isArray(existing.los) ? existing.los : [],
  };
  try { await saveRules(); showToast('Settings saved', 'success'); }
  catch (err) { showToast(err?.message || 'Failed to save base/min', 'error', 5000); }
  finally {
    btn.textContent = prev; btn.disabled = false;
    // Rehydrate from disk to confirm and reflect persisted values
    loadRules().catch(() => {});
  }
});
addSeasonBtn.addEventListener('click', () => {
  rulesState.seasons.push({ name: '', start: '', end: '', percent: 0 });
  renderSeasons();
});
saveSeasonsBtn.addEventListener('click', async (e) => {
  const btn = e.currentTarget; const prev = btn.textContent; btn.textContent = 'Saving…'; btn.disabled = true;
  try { await saveRules(); showToast('Seasons saved', 'success'); }
  catch (err) { showToast(err?.message || 'Failed to save seasons', 'error', 5000); }
  finally { btn.textContent = prev; btn.disabled = false; }
});

async function loadRules() {
  const file = rulesFile2.value || 'price_rules.json';
  const qs = new URLSearchParams({ rulesFile: file }).toString();
  const r = await fetch(`/api/rules?${qs}`);
  const data = await r.json();
  rulesState = data || { baseRates: {}, seasons: [], overrides: {}, settings: {} };
  if (!rulesState.overrides) rulesState.overrides = {};
  if (!rulesState.settings) rulesState.settings = {};
  if (overrideColorInput) overrideColorInput.value = rulesState.settings.override_color || '#ffd1dc';
  renderSeasons();
  appReady.rules = true;
  renderOrchestrator();
}

function renderSeasons() {
  const tbl = document.createElement('table');
  tbl.className = 'seasons-table';
  tbl.innerHTML = `<thead><tr><th>Name</th><th>Start</th><th>End</th><th>Percent</th><th>Color</th><th></th></tr></thead>`;
  const tbody = document.createElement('tbody');
  rulesState.seasons.forEach((s, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" value="${s.name ?? ''}" data-i="${idx}" data-k="name"></td>
      <td><input type="date" value="${s.start ?? ''}" data-i="${idx}" data-k="start"></td>
      <td><input type="date" value="${s.end ?? ''}" data-i="${idx}" data-k="end"></td>
      <td><input type="number" step="0.1" value="${s.percent ?? 0}" data-i="${idx}" data-k="percent"></td>
      <td><input type="color" value="${s.color ?? '#ffffff'}" data-i="${idx}" data-k="color"></td>
      <td><button data-del="${idx}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  seasonsDiv.innerHTML = '';
  seasonsDiv.appendChild(tbl);

  seasonsDiv.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.k;
      rulesState.seasons[i][k] = inp.type === 'number' ? Number(inp.value) : inp.value;
    });
  });
  seasonsDiv.querySelectorAll('button[data-del]').forEach(btn => {
    btn.onclick = () => { const i = Number(btn.dataset.del); rulesState.seasons.splice(i, 1); renderSeasons(); };
  });
}

function updateBaseMinForSelectedProp() {
  const pid = propSelectRules.value;
  const rec = rulesState.baseRates[pid] || {};
  baseRateInput.value = rec.base ?? rec.baseRate ?? '';
  minRateInput.value = rec.min ?? rec.minRate ?? '';
  if (weekendRateInput) weekendRateInput.value = rec.weekend_pct ?? rec.weekendPct ?? rec.weekend ?? 0;
  if (ppagInput) ppagInput.value = rec.price_per_additional_guest ?? rec.additional_guest_price ?? 0;
  if (addlFromInput) addlFromInput.value = rec.additional_guests_starts_from ?? rec.addl_from ?? 0;
  renderLos();
}

async function saveRules() {
  const file = rulesFile2.value || 'price_rules.json';
  if (!rulesState.settings) rulesState.settings = {};
  rulesState.settings.override_color = overrideColorInput?.value || rulesState.settings.override_color || '#ffd1dc';
  const body = { rulesFile: file, baseRates: rulesState.baseRates, seasons: rulesState.seasons, overrides: rulesState.overrides || {}, settings: rulesState.settings };
  const r = await fetch('/api/rules', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  if (!r.ok) {
    let msg = 'Failed to save rules';
    try { const data = await r.json(); if (data?.error) msg = data.error; } catch {}
    throw new Error(msg);
  }
}

// keep rules file inputs in sync
rulesFileInput.addEventListener('input', () => { rulesFile2.value = rulesFileInput.value; });
rulesFile2.addEventListener('input', () => { rulesFileInput.value = rulesFile2.value; });
// Auto-reload rules when rules file changes
rulesFileInput.addEventListener('change', () => { loadRules().catch(() => {}); });
rulesFile2.addEventListener('change', () => { loadRules().catch(() => {}); });

// ---------- LOS rules (per property) ----------
const losDiv = document.getElementById('los');
const addLosBtn = document.getElementById('addLos');
const saveLosBtn = document.getElementById('saveLos');

function getLosFor(pid) {
  const rec = rulesState.baseRates[pid] || (rulesState.baseRates[pid] = { base: 0, min: 0, los: [] });
  if (!Array.isArray(rec.los)) rec.los = [];
  return rec.los;
}

function renderLos() {
  const pid = propSelectRules.value;
  const los = getLosFor(pid).slice().sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0));
  const tbl = document.createElement('table');
  tbl.className = 'seasons-table';
  tbl.innerHTML = `<thead><tr><th>Name</th><th>Min Days</th><th>Max Days</th><th>Discount %</th><th>Color</th><th></th></tr></thead>`;
  const tbody = document.createElement('tbody');
  los.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" value="${r.name ?? ''}" data-i="${idx}" data-k="name"></td>
      <td><input type="number" step="1" value="${r.min_days ?? ''}" data-i="${idx}" data-k="min_days"></td>
      <td><input type="number" step="1" value="${r.max_days ?? ''}" data-i="${idx}" data-k="max_days"></td>
      <td><input type="number" step="0.1" value="${r.percent ?? 0}" data-i="${idx}" data-k="percent"></td>
      <td><input type="color" value="${r.color ?? '#888888'}" data-i="${idx}" data-k="color" title="LOS color"></td>
      <td><button data-del="${idx}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  losDiv.innerHTML = '';
  losDiv.appendChild(tbl);
  losDiv.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = Number(inp.dataset.i); const k = inp.dataset.k;
      const list = getLosFor(propSelectRules.value);
      if (!list[i]) list[i] = {};
      list[i][k] = inp.type === 'number' ? Number(inp.value) : inp.value;
    });
  });
  losDiv.querySelectorAll('button[data-del]').forEach(btn => {
    btn.onclick = () => { const i = Number(btn.dataset.del); const list = getLosFor(propSelectRules.value); list.splice(i, 1); renderLos(); };
  });
}

addLosBtn.addEventListener('click', () => {
  const list = getLosFor(propSelectRules.value);
  // Sort existing by min_days
  list.sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0));
  if (list.length === 0) {
    // Sensible default first tier
    list.push({ name: 'Default 2-6 nights', min_days: 2, max_days: 6, percent: 0 });
  } else {
    const last = list[list.length - 1];
    // Determine next tier start just after the last tier's end (or min if open-ended)
    const prevEnd = last.max_days != null ? Number(last.max_days) : Number(last.min_days ?? 1);
    const newMin = (isFinite(prevEnd) ? prevEnd : 1) + 1;
    // If the last tier was open-ended, cap it right before the new tier to avoid overlap
    if (last.max_days == null) last.max_days = newMin - 1;
    const newMax = newMin + 6; // 1-week span by default
    list.push({ name: '', min_days: newMin, max_days: newMax, percent: 0 });
  }
  renderLos();
});

saveLosBtn.addEventListener('click', async (e) => {
  const btn = e.currentTarget; const prev = btn.textContent; btn.textContent = 'Saving…'; btn.disabled = true;
  try { await saveRules(); showToast('LOS saved', 'success'); }
  catch (err) { showToast(err?.message || 'Failed to save LOS', 'error', 5000); }
  finally { btn.textContent = prev; btn.disabled = false; }
});

// ---------- Calendar Preview (rules) ----------
const propSelectCal = document.getElementById('propSelectCal');
const monthInput = document.getElementById('monthInput');
const calDiv = document.getElementById('calendar');
const seasonLegendDiv = document.getElementById('seasonLegend');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');
const overrideColorInput = document.getElementById('overrideColor');
const overrideModal = document.getElementById('overrideModal');
const ovrDateDisplay = document.getElementById('ovrDateDisplay');
const ovrPropName = document.getElementById('ovrPropName');
const ovrPrice = document.getElementById('ovrPrice');
const ovrMin = document.getElementById('ovrMin');
const ovrMax = document.getElementById('ovrMax');
const ovrSave = document.getElementById('ovrSave');
const ovrDelete = document.getElementById('ovrDelete');
const ovrCancel = document.getElementById('ovrCancel');

function syncCalProps() {
  propSelectCal.innerHTML = '';
  for (const p of allPropsCache) {
    const opt = document.createElement('option');
    opt.value = String(p.id);
    opt.textContent = `${p.name ?? 'Unnamed'} (ID ${p.id})`;
    propSelectCal.appendChild(opt);
  }
  const m = String(new Date().getMonth() + 1).padStart(2, '0');
  const yy = new Date().getFullYear();
  monthInput.value = `${yy}-${m}`;
  renderCalendar();
  renderSeasonLegend();
}

function getSeasonPctForDate(ds) {
  const d = new Date(ds + 'T00:00:00');
  let pct = 0;
  for (const s of rulesState.seasons || []) {
    if (!s.start || !s.end) continue;
    const sd = new Date(s.start + 'T00:00:00');
    const ed = new Date(s.end + 'T00:00:00');
    if (d >= sd && d <= ed) pct += Number(s.percent || 0);
  }
  return pct;
}

function getSeasonForDate(ds) {
  const d = new Date(ds + 'T00:00:00');
  let match = null;
  for (const s of rulesState.seasons || []) {
    if (!s.start || !s.end) continue;
    const sd = new Date(s.start + 'T00:00:00');
    const ed = new Date(s.end + 'T00:00:00');
    if (d >= sd && d <= ed) { match = s; break; }
  }
  return match;
}

function computeOneNightPrice(ds, pid) {
  const rec = rulesState.baseRates[pid] || {};
  const base = Number(rec.base || 0);
  if (!base) return '';
  const minRate = Number(rec.min || 0);
  // Override check
  const olist = rulesState.overrides?.[pid] || [];
  const ovr = Array.isArray(olist) ? olist.find(o => o.date === ds) : null;
  if (ovr && ovr.price > 0) {
    return Math.floor(Number(ovr.price));
  }
  const seasonPct = getSeasonPctForDate(ds);
  const baseAdj = Math.floor(base * (1 + seasonPct / 100));
  // find LOS that covers 1 night
  const los = Array.isArray(rec.los) ? rec.los : [];
  const cover = los.find(r => (r.min_days ?? 1) <= 1 && (r.max_days == null || r.max_days >= 1));
  let price = baseAdj;
  if (cover) price = Math.floor(baseAdj * (1 - Math.abs(cover.percent || 0) / 100));
  // Weekend uplift for Fri/Sat
  const d = new Date(ds + 'T00:00:00');
  const day = d.getDay();
  const isWeekend = day === 5 || day === 6;
  const weekendPct = Number(rec.weekend_pct || rec.weekendPct || rec.weekend || 0);
  if (isWeekend && weekendPct) price = Math.floor(price * (1 + Math.abs(weekendPct) / 100));
  const globalMin = Number(minPriceInput.value || 0);
  price = Math.max(price, minRate || 0, globalMin || 0);
  return price;
}

function seasonColor(pct) {
  // map -20..+40% to color shades; low=light, high=deeper
  const clamped = Math.max(-20, Math.min(40, pct));
  const scale = (clamped + 20) / 60; // 0..1
  const light = 95 - Math.round(scale * 35); // 95..60
  return `hsl(200, 90%, ${light}%)`;
}

function renderCalendar() {
  if (!appReady.props || !appReady.rules) return;
  // trigger subtle animation
  calDiv.classList.add('cal-animate');
  setTimeout(() => calDiv.classList.remove('cal-animate'), 220);
  const ym = monthInput.value;
  if (!ym) return;
  const pid = propSelectCal.value;
  const [yy, mm] = ym.split('-').map(Number);
  const first = new Date(yy, mm - 1, 1);
  const startWeekday = (first.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(yy, mm - 1, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const header = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const frag = document.createDocumentFragment();
  const head = document.createElement('div'); head.className = 'cal-header';
  for (const h of header) { const div = document.createElement('div'); div.textContent = h; head.appendChild(div); }
  frag.appendChild(head);

  for (let i = 0; i < cells.length; i += 7) {
    const row = document.createElement('div'); row.className = 'cal-row';
    for (let j = 0; j < 7; j++) {
      const cellDate = cells[i + j];
      const cell = document.createElement('div'); cell.className = 'cal-cell' + (!cellDate ? ' muted' : '');
      if (cellDate) {
        const ds = `${cellDate.getFullYear()}-${String(cellDate.getMonth()+1).padStart(2,'0')}-${String(cellDate.getDate()).padStart(2,'0')}`;
        const dateEl = document.createElement('div'); dateEl.className = 'cal-date'; dateEl.textContent = cellDate.getDate();
        // Flags
        const olist = rulesState.overrides?.[pid] || [];
        const hasOverride = Array.isArray(olist) ? olist.some(o => o.date === ds) : false;
        const day = cellDate.getDay();
        const isWeekend = day === 5 || day === 6;
        const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        if (isWeekend) cell.classList.add('weekend');
        if (ds === todayStr) cell.classList.add('today');
        if (hasOverride) cell.classList.add('override');
        // Background: override color > season color > derived shade
        if (hasOverride) {
          cell.style.background = rulesState.settings?.override_color || '#ffd1dc';
        } else {
          // No season background fill — use a thin indicator bar instead
          const season = getSeasonForDate(ds);
          const bar = document.createElement('div');
          bar.className = 'cal-season';
          const col = season?.color || seasonColor(getSeasonPctForDate(ds));
          bar.style.background = col;
          cell.appendChild(bar);
        }
        const priceEl = document.createElement('div'); priceEl.className = 'cal-price';
        const p = computeOneNightPrice(ds, pid);
        priceEl.innerHTML = p !== '' ? `<span class="pill">£${p}</span>` : '<span class="pill">—</span>';
        // LOS indicator: colored dot if a second LOS tier exists
        const rec = rulesState.baseRates[pid] || {};
        const los = Array.isArray(rec.los) ? rec.los.slice().sort((a,b)=>(a.min_days??0)-(b.min_days??0)) : [];
        if (los.length > 1) {
          const second = los[1];
          const dot = document.createElement('div');
          dot.className = 'cal-dot';
          dot.style.background = second?.color || '#888888';
          dot.title = second?.name ? `Additional LOS: ${second.name}` : 'Additional LOS present';
          cell.appendChild(dot);
        }
        cell.appendChild(dateEl); cell.appendChild(priceEl);
        // Click to open override editor for this date
        cell.addEventListener('click', () => openOverrideModal(ds));
      }
      row.appendChild(cell);
    }
    frag.appendChild(row);
  }
  calDiv.innerHTML = '';
  calDiv.appendChild(frag);
}

propSelectCal?.addEventListener('change', renderCalendar);
monthInput?.addEventListener('change', renderCalendar);

function changeMonth(delta) {
  if (!monthInput.value) return;
  const [yy, mm] = monthInput.value.split('-').map(Number);
  const d = new Date(yy, (mm - 1) + delta, 1);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  monthInput.value = `${d.getFullYear()}-${m}`;
  renderCalendar();
  renderSeasonLegend();
}
prevMonthBtn?.addEventListener('click', () => changeMonth(-1));
nextMonthBtn?.addEventListener('click', () => changeMonth(1));

function renderSeasonLegend() {
  if (!seasonLegendDiv) return;
  const allSeasons = Array.isArray(rulesState.seasons) ? rulesState.seasons : [];
  let list = allSeasons;
  // Filter to seasons that intersect the displayed month
  if (monthInput?.value) {
    const [yy, mm] = monthInput.value.split('-').map(Number);
    const monthStart = new Date(yy, mm - 1, 1);
    const monthEnd = new Date(yy, mm, 0); // last day of month
    list = allSeasons.filter((s) => {
      if (!s.start || !s.end) return false;
      const sd = new Date(s.start + 'T00:00:00');
      const ed = new Date(s.end + 'T00:00:00');
      return sd <= monthEnd && ed >= monthStart; // overlaps month
    });
  }
  const frag = document.createDocumentFragment();
  for (const s of list) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const sw = document.createElement('i');
    sw.className = 'swatch';
    sw.style.background = s.color || seasonColor(Number(s.percent || 0));
    sw.style.borderColor = '#888';
    const txt = document.createElement('span');
    txt.textContent = s.name || '(unnamed)';
    item.appendChild(sw); item.appendChild(txt);
    frag.appendChild(item);
  }
  seasonLegendDiv.innerHTML = '';
  seasonLegendDiv.appendChild(frag);
}

function openOverrideModal(ds) {
  const pid = propSelectCal.value;
  const prop = (allPropsCache || []).find(p => String(p.id) === String(pid));
  if (!rulesState.overrides) rulesState.overrides = {};
  const list = rulesState.overrides[pid] || (rulesState.overrides[pid] = []);
  const existing = list.find(o => o.date === ds) || null;
  ovrDateDisplay.textContent = ds;
  ovrPropName.textContent = prop?.name ? `(${prop.name})` : `Property ${pid}`;
  ovrPrice.value = existing?.price ?? '';
  ovrMin.value = existing?.min_stay ?? '';
  ovrMax.value = existing?.max_stay ?? '';
  overrideModal.classList.add('show');
  overrideModal.setAttribute('aria-hidden', 'false');

  ovrSave.onclick = async () => {
    const price = Number(ovrPrice.value || 0);
    const min_stay = ovrMin.value ? Number(ovrMin.value) : null;
    const max_stay = ovrMax.value ? Number(ovrMax.value) : null;
    const idx = list.findIndex(o => o.date === ds);
    if (price > 0) {
      const rec = { date: ds, price, min_stay, max_stay };
      if (idx >= 0) list[idx] = rec; else list.push(rec);
      await saveRules().catch(e => showToast(e.message, 'error'));
      showToast('Override saved', 'success');
    } else {
      if (idx >= 0) list.splice(idx, 1);
      await saveRules().catch(e => showToast(e.message, 'error'));
      showToast('Override removed', 'success');
    }
    closeOverrideModal();
    renderCalendar();
  };
  ovrDelete.onclick = async () => {
    const idx = list.findIndex(o => o.date === ds);
    if (idx >= 0) list.splice(idx, 1);
    await saveRules().catch(e => showToast(e.message, 'error'));
    showToast('Override removed', 'success');
    closeOverrideModal();
    renderCalendar();
  };
  ovrCancel.onclick = () => closeOverrideModal();
  const onBackdrop = (e) => { if (e.target === overrideModal) { closeOverrideModal(); overrideModal.removeEventListener('click', onBackdrop); } };
  overrideModal.addEventListener('click', onBackdrop);
}

function closeOverrideModal() {
  overrideModal.classList.remove('show');
  overrideModal.setAttribute('aria-hidden', 'true');
}

// Keep rules file inputs in sync (3 fields)
const rulesFile3 = document.getElementById('rulesFile3');
rulesFileInput.addEventListener('input', () => { rulesFile2.value = rulesFileInput.value; rulesFile3.value = rulesFileInput.value; });
rulesFile2.addEventListener('input', () => { rulesFileInput.value = rulesFile2.value; rulesFile3.value = rulesFile2.value; });
rulesFile3.addEventListener('input', () => { rulesFileInput.value = rulesFile3.value; rulesFile2.value = rulesFile3.value; });
rulesFile3.addEventListener('change', () => { loadRules().catch(() => {}); });

// After loading properties or rules, sync calendar property select
const origLoadProps = loadPropertiesAndRender;
loadPropertiesAndRender = async function() { await origLoadProps(); syncCalProps(); };
const origLoadRules = loadRules;
loadRules = async function() { await origLoadRules(); renderSeasons(); updateBaseMinForSelectedProp(); renderLos(); renderCalendar(); renderSeasonLegend(); };
