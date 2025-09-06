const apiKeyInput = document.getElementById('apiKey');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const windowDaysInput = document.getElementById('windowDays');
const startDiscountPctInput = document.getElementById('startDiscountPct');
const endDiscountPctInput = document.getElementById('endDiscountPct');
const minPriceInput = document.getElementById('minPrice');
const saveDiscountsBtn = document.getElementById('saveDiscounts');
const loadPropsBtn = document.getElementById('loadProps');
const saveSettingsBtn = document.getElementById('saveSettings');
const runBtn = document.getElementById('runBtn');
const dryRunBtn = document.getElementById('dryRunBtn');
const importBookingsBtn = document.getElementById('importBookings');
const importAllBookingsBtn = document.getElementById('importAllBookings');
const syncUpdatesBtn = document.getElementById('syncUpdates');
const showJitterBtn = document.getElementById('showJitter');
const lastSyncAtInput = document.getElementById('lastSyncAt');
const propsDiv = document.getElementById('props');
const logPre = document.getElementById('log');
const rulesFileInput = document.getElementById('rulesFile');

// Rules UI elements
// single source of truth for rules file in Settings tab
const propSelectRules = document.getElementById('propSelectRules');
const baseRateInput = document.getElementById('baseRate');
const minRateInput = document.getElementById('minRate');
const minProfitPctInput = document.getElementById('minProfitPct');
const weekendRateInput = document.getElementById('weekendRate');
const maxDiscountPctInput = document.getElementById('maxDiscountPct');
const ppagInput = document.getElementById('ppag');
const addlFromInput = document.getElementById('addlFrom');
const cleaningFeeInput = document.getElementById('cleaningFee');
const serviceFeeInput = document.getElementById('serviceFee');
const loadRulesBtn = document.getElementById('loadRules');
const saveRatesBtn = document.getElementById('saveRates');
const seasonsDiv = document.getElementById('seasons');
const addSeasonBtn = document.getElementById('addSeason');
const saveSeasonsBtn = document.getElementById('saveSeasons');
const toastContainer = document.getElementById('toast-container');
// Jitter settings UI
const jitterEnabledInput = document.getElementById('jitterEnabled');
const jitterIntervalInput = document.getElementById('jitterInterval');
const jitterLookaheadInput = document.getElementById('jitterLookahead');
const jitterBlockNearInput = document.getElementById('jitterBlockNear');
const jitterDatesPerRunInput = document.getElementById('jitterDatesPerRun');
const jitterMarkdownMinInput = document.getElementById('jitterMarkdownMin');
const jitterMarkdownMaxInput = document.getElementById('jitterMarkdownMax');
const jitterMarkupMinInput = document.getElementById('jitterMarkupMin');
const jitterMarkupMaxInput = document.getElementById('jitterMarkupMax');
const jitterSeedInput = document.getElementById('jitterSeed');
// Channel fees / uplifts UI
const airbnbUpliftInput = document.getElementById('airbnbUpliftPct');
const airbnbAddonInput = document.getElementById('airbnbAddon');
const bookingUpliftInput = document.getElementById('bookingUpliftPct');
const bookingAddonInput = document.getElementById('bookingAddon');
const ohAddonInput = document.getElementById('ohAddon');
// Fee fold-in UI
const foldFeesEnabledInput = document.getElementById('foldFeesEnabled');
const foldIncludeCleaningInput = document.getElementById('foldIncludeCleaning');
const foldIncludeServiceInput = document.getElementById('foldIncludeService');
// Lead-in price UI (yesterday)
const leadInEnabledInput = document.getElementById('leadInEnabled');
const leadInPriceInput = document.getElementById('leadInPrice');

// Default date range: today -> 18 months ahead (server enforces; UI displays if inputs exist)
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const now = new Date();
const startLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const endExclusive = new Date(
  startLocal.getFullYear(),
  startLocal.getMonth() + 18,
  startLocal.getDate()
);
const endLocal = new Date(
  endExclusive.getFullYear(),
  endExclusive.getMonth(),
  endExclusive.getDate() - 1
);
if (startDateInput) startDateInput.value = fmtDate(startLocal);
if (endDateInput) endDateInput.value = fmtDate(endLocal);

function log(msg) {
  logPre.textContent += `\n${msg}`;
  logPre.scrollTop = logPre.scrollHeight;
}

function showToast(message, type = 'info', timeout = 2600) {
  if (!toastContainer) {
    console[type === 'error' ? 'error' : 'log'](message);
    return;
  }
  const div = document.createElement('div');
  div.className = `toast toast-${type}`;
  div.textContent = message;
  toastContainer.appendChild(div);
  const remove = () => {
    if (div.parentNode) div.parentNode.removeChild(div);
  };
  setTimeout(remove, timeout);
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (apiKeyInput.value) h['x-apikey'] = apiKeyInput.value;
  return h;
}

// Properties cache for rules select and run selection
let allPropsCache = [];
let rulesState = { baseRates: {}, seasons: [], overrides: {}, blocked: {}, settings: {} };
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
  try {
    updateBaseMinForSelectedProp();
  } catch {}
  try {
    renderGlobalLos();
  } catch {}
  // Calendar and legend
  try {
    renderCalendar();
  } catch {}
  try {
    renderSeasonLegend();
  } catch {}
  try {
    ensureBookingsLoaded();
  } catch {}
  try {
    loadSyncState();
  } catch {}
}

loadPropsBtn.addEventListener('click', () => {
  propsDiv.innerHTML = 'Loading…';
  loadPropertiesAndRender();
});

// Save Settings button: persist override color, jitter and channel fee/uplift settings
saveSettingsBtn?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const prev = btn.textContent;
  btn.textContent = 'Saving…';
  btn.disabled = true;
  try {
    await saveRules();
    showToast('Settings saved', 'success');
    // Re-load to reflect normalized values
    await loadRules().catch(() => {});
  } catch (err) {
    showToast(err?.message || 'Failed to save settings', 'error', 5000);
  } finally {
    btn.textContent = prev;
    btn.disabled = false;
  }
});

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
    // Ensure rules are loaded/refreshed automatically when properties are loaded
    try {
      await loadRules();
    } catch {}
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
    const abbr = abbreviatePropertyName(p?.name ?? 'Unnamed');
    name.textContent = abbr;
    row.appendChild(name);
    // Reflect selection state visually
    cb.addEventListener('change', () => {
      row.classList.toggle('selected', cb.checked);
    });
    container.appendChild(row);
  }
  propsDiv.innerHTML = '';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const selectAll = document.createElement('button');
  selectAll.textContent = 'Select All';
  selectAll.onclick = () =>
    container.querySelectorAll('input[type=checkbox]').forEach((c) => {
      c.checked = true;
      c.dispatchEvent(new Event('change'));
    });
  const deselectAll = document.createElement('button');
  deselectAll.textContent = 'Deselect All';
  deselectAll.onclick = () =>
    container.querySelectorAll('input[type=checkbox]').forEach((c) => {
      c.checked = false;
      c.dispatchEvent(new Event('change'));
    });
  actions.appendChild(selectAll);
  actions.appendChild(deselectAll);
  propsDiv.appendChild(actions);
  propsDiv.appendChild(container);
}

// Abbreviate long property names for nicer cards
function abbreviatePropertyName(s) {
  try {
    let t = String(s || '').trim();
    if (!t) return 'Unnamed';
    // Remove any description after a hyphen/dash ("Beach House 1 - something" -> "Beach House 1")
    t = t.split(/\s[-–—]\s+/)[0].trim();
    // Remove trailing property IDs if present in the name already
    t = t.replace(/\(ID\s*\d+\)$/i, '').trim();
    // Common substitutions
    t = t.replace(/Apartment/gi, 'Apt');
    t = t.replace(/Bedroom/gi, 'BR');
    t = t.replace(/Bed(\s|$)/gi, 'Bd$1');
    t = t.replace(/House/gi, 'Hse');
    t = t.replace(/with/gi, 'w/');
    t = t.replace(/Overlooking/gi, 'O/');
    t = t.replace(/Studio/gi, 'Std');
    // Collapse repeated spaces
    t = t.replace(/\s{2,}/g, ' ').trim();
    // Truncate if still long
    const max = 42;
    if (t.length > max) t = t.slice(0, max - 1) + '…';
    return t;
  } catch {
    return s;
  }
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
  // default show Calendar
  const tabs = document.querySelectorAll('.tab');
  const pages = document.querySelectorAll('.page');
  function show(page) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.page === page));
    pages.forEach((p) => p.classList.toggle('active', p.dataset.page === page));
  }
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.page)));
  show('calendar');
  // Automatically load properties on start
  propsDiv.innerHTML = 'Loading…';
  loadPropertiesAndRender()
    .then(() => loadRules().catch(() => {}))
    .catch(() => {});
});

async function triggerRunUpdate(dryRun) {
  const selected = Array.from(propsDiv.querySelectorAll('.prop-list input[type=checkbox]'))
    .filter((c) => c.checked)
    .map((c) => c.value);
  const body = {
    // start/end computed server-side; omit here
    windowDays: Number(windowDaysInput.value),
    startDiscountPct: Number(startDiscountPctInput.value),
    endDiscountPct: Number(endDiscountPctInput.value),
    minPrice: Number(minPriceInput.value),
    rulesFile: rulesFileInput.value,
    dryRun: !!dryRun,
    selectedPropertyIds: selected,
    // pass fee fold-in flags so run respects current UI state even if not saved
    fold_fees_into_nightly: !!(foldFeesEnabledInput && foldFeesEnabledInput.checked),
    fold_include_cleaning:
      foldIncludeCleaningInput != null ? !!foldIncludeCleaningInput.checked : undefined,
    fold_include_service:
      foldIncludeServiceInput != null ? !!foldIncludeServiceInput.checked : undefined,
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
    log(
      `Summary: success=${data.success} failed=${data.failed} skipped=${data.skipped} dry_run=${data.dry_run}`
    );
  } catch (e) {
    log(`Error: ${e.message}`);
  }
}

runBtn.addEventListener('click', async () => {
  await triggerRunUpdate(false);
});

dryRunBtn.addEventListener('click', async () => {
  await triggerRunUpdate(true);
});

// Import upcoming bookings, persist to upcoming_bookings.json and merge to store
importBookingsBtn.addEventListener('click', async () => {
  log('Importing upcoming bookings…');
  try {
    const qs = new URLSearchParams({ size: String(100) }).toString();
    const r = await fetch(`/api/bookings/upcoming?${qs}`, { headers: headers() });
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await r.json() : { errorText: await r.text() };
    if (!r.ok || !ct.includes('application/json')) {
      const msg = data?.error || data?.errorText?.slice(0, 140) || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    log(
      `Imported ${data.itemsSaved} bookings (count=${data.count}, pages=${data.pages}) → ${data.saved}; merged ${data.mergedToStore}, removed ${data.removedFromStore ?? 0} (store ${data.storeCount})`
    );
    showToast('Upcoming bookings imported', 'success');
    await loadLocalBookings().catch(() => {});
    renderCalendar();
  } catch (e) {
    log(`Error importing bookings: ${e.message}`);
    showToast(`Failed to import: ${e.message}`, 'error', 5000);
  }
});

// Import ALL bookings (historic + current + future) and merge to store
importAllBookingsBtn.addEventListener('click', async () => {
  log('Importing ALL bookings…');
  try {
    const qs = new URLSearchParams({ size: String(100) }).toString();
    const r = await fetch(`/api/bookings/all?${qs}`, { headers: headers() });
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await r.json() : { errorText: await r.text() };
    if (!r.ok || !ct.includes('application/json')) {
      const msg = data?.error || data?.errorText?.slice(0, 140) || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    log(
      `Imported ${data.itemsSaved} bookings (count=${data.count}, pages=${data.pages}) → ${data.saved}; merged ${data.mergedToStore}, removed ${data.removedFromStore ?? 0} (store ${data.storeCount})`
    );
    showToast('All bookings imported', 'success');
    await loadLocalBookings().catch(() => {});
    renderCalendar();
  } catch (e) {
    log(`Error importing ALL bookings: ${e.message}`);
    showToast(`Failed to import ALL: ${e.message}`, 'error', 5000);
  }
});

// Sync updates since last run (server tracks lastSyncAt)
syncUpdatesBtn.addEventListener('click', async () => {
  log('Syncing booking updates since last run…');
  try {
    const r = await fetch('/api/bookings/sync-updates', { headers: headers() });
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await r.json() : { errorText: await r.text() };
    if (!r.ok || !ct.includes('application/json')) {
      const msg = data?.error || data?.errorText?.slice(0, 140) || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    log(
      `Synced updates since '${data.sinceUsed}', fetched=${data.fetched}, merged=${data.mergedToStore}, removed=${data.removedFromStore ?? 0} (store=${data.storeCount}), nextSince='${data.nextSince}'`
    );
    showToast('Updates synced', 'success');
    if (lastSyncAtInput) lastSyncAtInput.value = data?.nextSince || '';
    await loadLocalBookings().catch(() => {});
    renderCalendar();
  } catch (e) {
    log(`Error syncing updates: ${e.message}`);
    showToast(`Failed to sync: ${e.message}`, 'error', 5000);
  }
});

// Show latest jitter status in the Run log
showJitterBtn?.addEventListener('click', async () => {
  log('Fetching latest jitter status…');
  try {
    const r = await fetch('/api/jitter/last-log');
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await r.json() : { errorText: await r.text() };
    if (!r.ok || !ct.includes('application/json')) {
      const msg = data?.error || data?.errorText?.slice(0, 140) || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    const ts = data.ts || '(unknown time)';
    log(`Jitter: ts=${ts} success=${data.success} failed=${data.failed} skipped=${data.skipped}`);
    if (Array.isArray(data.jitter)) {
      for (const item of data.jitter) {
        const n = item.property_name || `ID ${item.property_id}`;
        const dates = Array.isArray(item.dates) ? item.dates : [];
        if (!dates.length) continue;
        const parts = dates.map((d) => `${d.date} ${d.pct > 0 ? '+' : ''}${d.pct}%`);
        log(`Jitter ${n}: ${parts.join(', ')}`);
      }
    }
    if (Array.isArray(data.failures) && data.failures.length) {
      log(`Failures (${data.failures.length}):`);
      for (const f of data.failures) {
        const n = `${f.property_name || f.property_id}/${f.room_name || f.room_id}`;
        const status = f.error_status != null ? `HTTP ${f.error_status}` : 'error';
        const msg = f.error_message || '';
        const path = f.payload_path ? ` (payload: ${f.payload_path})` : '';
        log(`FAILED ${n}: ${status} ${msg}${path}`);
      }
    }
    if ((!data.jitter || !data.jitter.length) && (!data.failures || !data.failures.length)) {
      log('No jitter changes or failures recorded in the last run.');
    }
  } catch (e) {
    log(`Error: ${e.message}`);
  }
});

// Seasons / Rules
propSelectRules.addEventListener('change', updateBaseMinForSelectedProp);
// Ensure save button state resets on property change
propSelectRules.addEventListener('change', () => {
  if (saveRatesBtn) {
    saveRatesBtn.disabled = false;
    saveRatesBtn.textContent = 'Save';
  }
});
if (loadRulesBtn) {
  loadRulesBtn.addEventListener('click', async () => {
    try {
      await loadRules();
      showToast('Rules loaded', 'success');
    } catch (e) {
      showToast(`Failed to load rules: ${e.message}`, 'error', 4000);
    }
  });
}
saveRatesBtn.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const prev = btn.textContent;
  btn.textContent = 'Saving…';
  btn.disabled = true;
  const pid = propSelectRules.value;
  if (!pid) return;
  const existing = rulesState.baseRates[pid] || {};
  rulesState.baseRates[pid] = {
    ...existing,
    base: Number(baseRateInput.value || 0),
    min: Number(minRateInput.value || 0),
    min_profit_pct: Number(
      typeof minProfitPctInput !== 'undefined' && minProfitPctInput
        ? minProfitPctInput.value || 0
        : 0
    ),
    weekend_pct: Number(weekendRateInput?.value || 0),
    max_discount_pct: Number(maxDiscountPctInput?.value || 0),
    price_per_additional_guest: Number(
      typeof ppagInput !== 'undefined' && ppagInput ? ppagInput.value || 0 : 0
    ),
    additional_guests_starts_from: Number(
      typeof addlFromInput !== 'undefined' && addlFromInput ? addlFromInput.value || 0 : 0
    ),
    cleaning_fee: Number(
      typeof cleaningFeeInput !== 'undefined' && cleaningFeeInput ? cleaningFeeInput.value || 0 : 0
    ),
    service_fee: Number(
      typeof serviceFeeInput !== 'undefined' && serviceFeeInput ? serviceFeeInput.value || 0 : 0
    ),
    los: Array.isArray(existing.los) ? existing.los : [],
  };
  try {
    await saveRules();
    showToast('Settings saved', 'success');
  } catch (err) {
    showToast(err?.message || 'Failed to save base/min', 'error', 5000);
  } finally {
    btn.textContent = prev;
    btn.disabled = false;
    // Rehydrate from disk to confirm and reflect persisted values
    loadRules().catch(() => {});
  }
});
// Save Discounts button: persist discount window + min price into rules.settings
saveDiscountsBtn?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const prev = btn.textContent;
  btn.textContent = 'Saving…';
  btn.disabled = true;
  try {
    if (!rulesState.settings) rulesState.settings = {};
    rulesState.settings.window_days = Math.max(0, Number(windowDaysInput.value || 0));
    rulesState.settings.start_discount_pct = Math.max(
      0,
      Math.min(100, Number(startDiscountPctInput.value || 0))
    );
    rulesState.settings.end_discount_pct = Math.max(
      0,
      Math.min(100, Number(endDiscountPctInput.value || 0))
    );
    rulesState.settings.min_price = Math.max(0, Number(minPriceInput.value || 0));
    await saveRules();
    // Re-load to reflect normalized values and confirm persistence
    await loadRules().catch(() => {});
    showToast('Discounts saved', 'success');
  } catch (err) {
    showToast(err?.message || 'Failed to save discounts', 'error', 5000);
  } finally {
    btn.textContent = prev;
    btn.disabled = false;
  }
});
addSeasonBtn.addEventListener('click', () => {
  rulesState.seasons.push({ name: '', start: '', end: '', percent: 0 });
  renderSeasons();
});
saveSeasonsBtn.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const prev = btn.textContent;
  btn.textContent = 'Saving…';
  btn.disabled = true;
  try {
    await saveRules();
    showToast('Seasons saved', 'success');
  } catch (err) {
    showToast(err?.message || 'Failed to save seasons', 'error', 5000);
  } finally {
    btn.textContent = prev;
    btn.disabled = false;
  }
});

async function loadRules() {
  const file = rulesFileInput.value || 'price_rules.json';
  const qs = new URLSearchParams({ rulesFile: file }).toString();
  const r = await fetch(`/api/rules?${qs}`);
  const data = await r.json();
  rulesState = data || { baseRates: {}, seasons: [], overrides: {}, blocked: {}, settings: {} };
  if (!rulesState.overrides) rulesState.overrides = {};
  if (!rulesState.blocked) rulesState.blocked = {};
  if (!rulesState.settings) rulesState.settings = {};
  if (overrideColorInput)
    overrideColorInput.value = rulesState.settings.override_color || '#ffd1dc';
  // Discounts settings → UI (persisted in rules.settings if saved)
  if (windowDaysInput && rulesState.settings.window_days != null)
    windowDaysInput.value = rulesState.settings.window_days;
  else if (windowDaysInput && rulesState.settings.windowDays != null)
    windowDaysInput.value = rulesState.settings.windowDays;
  if (startDiscountPctInput && rulesState.settings.start_discount_pct != null)
    startDiscountPctInput.value = rulesState.settings.start_discount_pct;
  else if (startDiscountPctInput && rulesState.settings.startDiscountPct != null)
    startDiscountPctInput.value = rulesState.settings.startDiscountPct;
  if (endDiscountPctInput && rulesState.settings.end_discount_pct != null)
    endDiscountPctInput.value = rulesState.settings.end_discount_pct;
  else if (endDiscountPctInput && rulesState.settings.endDiscountPct != null)
    endDiscountPctInput.value = rulesState.settings.endDiscountPct;
  if (minPriceInput && rulesState.settings.min_price != null)
    minPriceInput.value = rulesState.settings.min_price;
  else if (minPriceInput && rulesState.settings.minPrice != null)
    minPriceInput.value = rulesState.settings.minPrice;
  // Jitter settings → UI
  if (jitterEnabledInput) jitterEnabledInput.checked = !!rulesState.settings.auto_jitter_enabled;
  if (jitterIntervalInput)
    jitterIntervalInput.value = rulesState.settings.jitter_interval_minutes ?? 60;
  if (jitterLookaheadInput)
    jitterLookaheadInput.value = rulesState.settings.jitter_lookahead_days ?? 30;
  if (jitterBlockNearInput)
    jitterBlockNearInput.value = rulesState.settings.jitter_block_near_days ?? 2;
  if (jitterDatesPerRunInput)
    jitterDatesPerRunInput.value = rulesState.settings.jitter_dates_per_run ?? 2;
  if (jitterMarkdownMinInput)
    jitterMarkdownMinInput.value = rulesState.settings.jitter_markdown_min ?? 5;
  if (jitterMarkdownMaxInput)
    jitterMarkdownMaxInput.value = rulesState.settings.jitter_markdown_max ?? 8;
  if (jitterMarkupMinInput) jitterMarkupMinInput.value = rulesState.settings.jitter_markup_min ?? 0;
  if (jitterMarkupMaxInput) jitterMarkupMaxInput.value = rulesState.settings.jitter_markup_max ?? 2;
  if (jitterSeedInput) jitterSeedInput.value = rulesState.settings.jitter_seed_salt ?? '';
  // Channel fees/uplifts → UI
  if (airbnbUpliftInput) airbnbUpliftInput.value = rulesState.settings.airbnb_uplift_pct ?? 0;
  if (airbnbAddonInput) airbnbAddonInput.value = rulesState.settings.airbnb_addon_fee ?? 0;
  if (bookingUpliftInput) bookingUpliftInput.value = rulesState.settings.booking_uplift_pct ?? 0;
  if (bookingAddonInput) bookingAddonInput.value = rulesState.settings.booking_addon_fee ?? 0;
  if (ohAddonInput) ohAddonInput.value = rulesState.settings.oh_addon_fee ?? 0;
  // Fee fold-in → UI
  if (foldFeesEnabledInput)
    foldFeesEnabledInput.checked = !!rulesState.settings.fold_fees_into_nightly;
  if (foldIncludeCleaningInput)
    foldIncludeCleaningInput.checked =
      rulesState.settings.fold_include_cleaning != null
        ? !!rulesState.settings.fold_include_cleaning
        : true;
  if (foldIncludeServiceInput)
    foldIncludeServiceInput.checked =
      rulesState.settings.fold_include_service != null
        ? !!rulesState.settings.fold_include_service
        : true;
  // Lead-in price → UI
  if (leadInEnabledInput)
    leadInEnabledInput.checked = !!rulesState.settings.historic_lead_in_enabled;
  if (leadInPriceInput) leadInPriceInput.value = rulesState.settings.historic_lead_in_price ?? 0;
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

  seasonsDiv.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('change', () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.k;
      rulesState.seasons[i][k] = inp.type === 'number' ? Number(inp.value) : inp.value;
    });
  });
  seasonsDiv.querySelectorAll('button[data-del]').forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.del);
      rulesState.seasons.splice(i, 1);
      renderSeasons();
    };
  });
}

function updateBaseMinForSelectedProp() {
  const pid = propSelectRules.value;
  const rec = rulesState.baseRates[pid] || {};
  baseRateInput.value = rec.base ?? rec.baseRate ?? '';
  minRateInput.value = rec.min ?? rec.minRate ?? '';
  if (minProfitPctInput) minProfitPctInput.value = rec.min_profit_pct ?? rec.minProfitPct ?? 0;
  if (weekendRateInput)
    weekendRateInput.value = rec.weekend_pct ?? rec.weekendPct ?? rec.weekend ?? 0;
  if (maxDiscountPctInput)
    maxDiscountPctInput.value = rec.max_discount_pct ?? rec.maxDiscountPct ?? '';
  if (ppagInput)
    ppagInput.value = rec.price_per_additional_guest ?? rec.additional_guest_price ?? 0;
  if (typeof cleaningFeeInput !== 'undefined' && cleaningFeeInput)
    cleaningFeeInput.value = rec.cleaning_fee ?? rec.cleaningFee ?? 0;
  if (typeof serviceFeeInput !== 'undefined' && serviceFeeInput)
    serviceFeeInput.value = rec.service_fee ?? rec.serviceFee ?? 0;
  if (addlFromInput) addlFromInput.value = rec.additional_guests_starts_from ?? rec.addl_from ?? 0;
  renderGlobalLos();
}

async function saveRules() {
  const file = rulesFileInput.value || 'price_rules.json';
  if (!rulesState.settings) rulesState.settings = {};
  rulesState.settings.override_color =
    overrideColorInput?.value || rulesState.settings.override_color || '#ffd1dc';
  // Gather jitter settings from UI
  if (jitterEnabledInput) rulesState.settings.auto_jitter_enabled = !!jitterEnabledInput.checked;
  if (jitterIntervalInput)
    rulesState.settings.jitter_interval_minutes = Math.max(
      5,
      Number(jitterIntervalInput.value || 60)
    );
  if (jitterLookaheadInput)
    rulesState.settings.jitter_lookahead_days = Math.max(
      1,
      Number(jitterLookaheadInput.value || 30)
    );
  if (jitterBlockNearInput)
    rulesState.settings.jitter_block_near_days = Math.max(
      0,
      Number(jitterBlockNearInput.value || 2)
    );
  if (jitterDatesPerRunInput)
    rulesState.settings.jitter_dates_per_run = Math.max(
      1,
      Number(jitterDatesPerRunInput.value || 2)
    );
  if (jitterMarkdownMinInput)
    rulesState.settings.jitter_markdown_min = Number(jitterMarkdownMinInput.value || 5);
  if (jitterMarkdownMaxInput)
    rulesState.settings.jitter_markdown_max = Number(jitterMarkdownMaxInput.value || 8);
  if (jitterMarkupMinInput)
    rulesState.settings.jitter_markup_min = Number(jitterMarkupMinInput.value || 0);
  if (jitterMarkupMaxInput)
    rulesState.settings.jitter_markup_max = Number(jitterMarkupMaxInput.value || 2);
  if (jitterSeedInput) rulesState.settings.jitter_seed_salt = jitterSeedInput.value || '';
  // Gather channel fees/uplifts
  if (airbnbUpliftInput)
    rulesState.settings.airbnb_uplift_pct = Number(airbnbUpliftInput.value || 0);
  if (airbnbAddonInput)
    rulesState.settings.airbnb_addon_fee = Math.max(0, Number(airbnbAddonInput.value || 0));
  if (bookingUpliftInput)
    rulesState.settings.booking_uplift_pct = Number(bookingUpliftInput.value || 0);
  if (bookingAddonInput)
    rulesState.settings.booking_addon_fee = Math.max(0, Number(bookingAddonInput.value || 0));
  if (ohAddonInput) rulesState.settings.oh_addon_fee = Math.max(0, Number(ohAddonInput.value || 0));
  // Fee fold-in
  if (foldFeesEnabledInput)
    rulesState.settings.fold_fees_into_nightly = !!foldFeesEnabledInput.checked;
  if (foldIncludeCleaningInput)
    rulesState.settings.fold_include_cleaning = !!foldIncludeCleaningInput.checked;
  if (foldIncludeServiceInput)
    rulesState.settings.fold_include_service = !!foldIncludeServiceInput.checked;
  // Lead-in price
  if (leadInEnabledInput)
    rulesState.settings.historic_lead_in_enabled = !!leadInEnabledInput.checked;
  if (leadInPriceInput)
    rulesState.settings.historic_lead_in_price = Math.max(0, Number(leadInPriceInput.value || 0));
  // Persist Discounts (if present) when saving settings from the Settings tab
  if (windowDaysInput)
    rulesState.settings.window_days = Math.max(0, Number(windowDaysInput.value || 0));
  if (startDiscountPctInput)
    rulesState.settings.start_discount_pct = Math.max(
      0,
      Math.min(100, Number(startDiscountPctInput.value || 0))
    );
  if (endDiscountPctInput)
    rulesState.settings.end_discount_pct = Math.max(
      0,
      Math.min(100, Number(endDiscountPctInput.value || 0))
    );
  if (minPriceInput) rulesState.settings.min_price = Math.max(0, Number(minPriceInput.value || 0));
  const body = {
    rulesFile: file,
    baseRates: rulesState.baseRates,
    seasons: rulesState.seasons,
    overrides: rulesState.overrides || {},
    blocked: rulesState.blocked || {},
    settings: rulesState.settings,
    global_los: Array.isArray(rulesState.global_los) ? rulesState.global_los : [],
  };
  const r = await fetch('/api/rules', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = 'Failed to save rules';
    try {
      const data = await r.json();
      if (data?.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
}

// Auto-reload rules when rules file changes
rulesFileInput.addEventListener('change', () => {
  loadRules().catch(() => {});
});

// Auto-load rules at startup so Properties/Seasons are ready without manual clicks
loadRules().catch(() => {});

// ---------- LOS rules (per property) ----------
const losGlobalDiv = document.getElementById('losGlobal');
const addLosGlobalBtn = document.getElementById('addLosGlobal');
const saveLosGlobalBtn = document.getElementById('saveLosGlobal');

function getGlobalLos() {
  if (!Array.isArray(rulesState.global_los)) rulesState.global_los = [];
  return rulesState.global_los;
}

function renderGlobalLos() {
  const los = getGlobalLos()
    .slice()
    .sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0));
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
  losGlobalDiv.innerHTML = '';
  losGlobalDiv.appendChild(tbl);
  losGlobalDiv.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('change', () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.k;
      const list = getGlobalLos();
      if (!list[i]) list[i] = {};
      list[i][k] = inp.type === 'number' ? Number(inp.value) : inp.value;
    });
  });
  losGlobalDiv.querySelectorAll('button[data-del]').forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.del);
      const list = getGlobalLos();
      list.splice(i, 1);
      renderGlobalLos();
    };
  });
}

addLosGlobalBtn.addEventListener('click', () => {
  const list = getGlobalLos();
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
  renderGlobalLos();
});

saveLosGlobalBtn.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const prev = btn.textContent;
  btn.textContent = 'Saving…';
  btn.disabled = true;
  try {
    await saveRules();
    showToast('LOS saved', 'success');
  } catch (err) {
    showToast(err?.message || 'Failed to save LOS', 'error', 5000);
  } finally {
    btn.textContent = prev;
    btn.disabled = false;
  }
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
const ovrLosHint = document.getElementById('ovrLosHint');
const ovrBlock = document.getElementById('ovrBlock');
const ovrUnblock = document.getElementById('ovrUnblock');

// --- Bookings cache (for calendar display) ---
let bookingsCache = null; // { items: [...], count, ... }
let bookingsLoadStarted = false;
async function loadLocalBookings() {
  try {
    const r = await fetch('/api/bookings/store');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    bookingsCache = await r.json();
  } catch {
    bookingsCache = null;
  }
}

async function loadSyncState() {
  try {
    const r = await fetch('/api/bookings/sync-state');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (lastSyncAtInput) lastSyncAtInput.value = data?.lastSyncAt || '';
  } catch {
    if (lastSyncAtInput) lastSyncAtInput.value = '';
  }
}
function ensureBookingsLoaded() {
  if (bookingsLoadStarted) return;
  bookingsLoadStarted = true;
  loadLocalBookings()
    .then(() => {
      try {
        renderCalendar();
      } catch {}
    })
    .catch(() => {});
}
function getBookingPropId(b) {
  return (
    b?.property_id ??
    b?.propertyId ??
    b?.houseId ??
    b?.accommodationId ??
    b?.property?.id ??
    b?.house?.id ??
    null
  );
}
function getBookingChannel(b) {
  const raw = (b?.channelName ?? b?.channel ?? b?.source ?? b?.origin ?? '')
    .toString()
    .toLowerCase();
  if (!raw) return 'other';
  if (raw.includes('airbnb')) return 'airbnb';
  if (raw.includes('booking')) return 'booking';
  return 'other';
}
function getBookingDates(b) {
  const inRaw =
    b?.arrivalDate ?? b?.checkIn ?? b?.checkInDate ?? b?.startDate ?? b?.arrival ?? null;
  const outRaw =
    b?.departureDate ?? b?.checkOut ?? b?.checkOutDate ?? b?.endDate ?? b?.departure ?? null;
  const fmt = (s) => (typeof s === 'string' && s.length >= 10 ? s.slice(0, 10) : null);
  return [fmt(inRaw), fmt(outRaw)];
}
function dateInRange(ds, start, endExclusive) {
  return !!(ds && start && endExclusive && ds >= start && ds < endExclusive);
}

// --- Range selection state for calendar ---
const calSelection = { active: false, start: null, end: null };
let calMouseUpHandler = null;
function clearCalSelection() {
  calSelection.active = false;
  calSelection.start = null;
  calSelection.end = null;
  calDiv.querySelectorAll('.cal-cell.selected').forEach((el) => el.classList.remove('selected'));
}
function datesInRange(startDs, endDs) {
  const a = startDs < endDs ? startDs : endDs;
  const b = startDs < endDs ? endDs : startDs;
  const out = [];
  const sd = new Date(a + 'T00:00:00');
  const ed = new Date(b + 'T00:00:00');
  for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  }
  return out;
}
function highlightRange(startDs, endDs) {
  const a = startDs < endDs ? startDs : endDs;
  const b = startDs < endDs ? endDs : startDs;
  calDiv.querySelectorAll('.cal-cell[data-date]').forEach((el) => {
    const ds = el.getAttribute('data-date');
    const sel = ds >= a && ds <= b;
    el.classList.toggle('selected', sel);
  });
}

// Convert a hex color (e.g. #rrggbb or #rgb or #rrggbbaa) to rgba(r,g,b,a)
// If parsing fails, returns the original string.
function hexToRgba(hex, alpha = 0.22) {
  try {
    if (typeof hex !== 'string') return hex;
    const h = hex.trim();
    if (!h.startsWith('#')) return hex;
    let r,
      g,
      b,
      a = 1;
    if (h.length === 4) {
      // #rgb
      r = parseInt(h[1] + h[1], 16);
      g = parseInt(h[2] + h[2], 16);
      b = parseInt(h[3] + h[3], 16);
    } else if (h.length === 7) {
      // #rrggbb
      r = parseInt(h.slice(1, 3), 16);
      g = parseInt(h.slice(3, 5), 16);
      b = parseInt(h.slice(5, 7), 16);
    } else if (h.length === 9) {
      // #rrggbbaa
      r = parseInt(h.slice(1, 3), 16);
      g = parseInt(h.slice(3, 5), 16);
      b = parseInt(h.slice(5, 7), 16);
      a = parseInt(h.slice(7, 9), 16) / 255;
    } else {
      return hex;
    }
    // If input already had alpha (#rrggbbaa), respect it; otherwise apply provided alpha
    const hasExplicitAlpha = h.length === 9;
    const outA = hasExplicitAlpha ? a : Math.max(0, Math.min(1, alpha));
    return `rgba(${r}, ${g}, ${b}, ${outA})`;
  } catch {
    return hex;
  }
}

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
    if (d >= sd && d <= ed) {
      match = s;
      break;
    }
  }
  return match;
}

// Mirror server-side discount curve for preview
function computeDiscountPctLocal({
  date,
  windowDays = 30,
  startDiscountPct = 30,
  endDiscountPct = 1,
}) {
  try {
    const d = new Date(date + 'T00:00:00');
    const t0 = new Date(new Date().toDateString()); // local midnight today
    const daysUntil = Math.floor((d - t0) / 86400000);
    if (daysUntil < 0) return 0;
    const effectiveWindow = Math.max(1, Number(windowDays || 30));
    if (daysUntil >= effectiveWindow) return 0;
    const startDec = Math.max(0, Math.min(100, Number(startDiscountPct || 0))) / 100.0;
    const endDec = Math.max(0, Math.min(100, Number(endDiscountPct || 0))) / 100.0;
    const progress = effectiveWindow > 1 ? daysUntil / (effectiveWindow - 1.0) : 0.0;
    return startDec + (endDec - startDec) * progress; // returns 0..1
  } catch {
    return 0;
  }
}

function computeOneNightPrice(ds, pid) {
  const rec = rulesState.baseRates[pid] || {};
  const base = Number(rec.base || 0);
  if (!base) return '';
  const minRate = Number(rec.min || 0);
  // Override check
  const olist = rulesState.overrides?.[pid] || [];
  const ovr = Array.isArray(olist) ? olist.find((o) => o.date === ds) : null;
  if (ovr && ovr.price > 0) {
    return Math.floor(Number(ovr.price));
  }
  const seasonPct = getSeasonPctForDate(ds);
  // Apply discount window and cap per property
  const discPctRaw = computeDiscountPctLocal({
    date: ds,
    windowDays: Number(windowDaysInput?.value || 30),
    startDiscountPct: Number(startDiscountPctInput?.value || 30),
    endDiscountPct: Number(endDiscountPctInput?.value || 1),
  });
  let discPct = discPctRaw; // 0..1
  const maxDiscPct = Number(rec.max_discount_pct || rec.maxDiscountPct || 0);
  if (maxDiscPct > 0) {
    const cap = Math.max(0, Math.min(1, maxDiscPct / 100));
    discPct = Math.min(discPct, cap);
  }
  const baseSeason = Math.floor(base * (1 + seasonPct / 100));
  const baseAdj = discPct ? Math.floor(baseSeason * (1 - discPct)) : baseSeason;
  // find LOS that covers 1 night
  const los =
    Array.isArray(rulesState.global_los) && rulesState.global_los.length
      ? rulesState.global_los
      : Array.isArray(rec.los)
        ? rec.los
        : [];
  const cover = los.find((r) => (r.min_days ?? 1) <= 1 && (r.max_days == null || r.max_days >= 1));
  let price = baseAdj;
  if (cover) price = Math.floor(baseAdj * (1 - Math.abs(cover.percent || 0) / 100));
  // Weekend uplift for Fri/Sat
  const d = new Date(ds + 'T00:00:00');
  const day = d.getDay();
  const isWeekend = day === 5 || day === 6;
  const weekendPct = Number(rec.weekend_pct || rec.weekendPct || rec.weekend || 0);
  if (isWeekend && weekendPct) price = Math.floor(price * (1 + Math.abs(weekendPct) / 100));
  const globalMin = Number(minPriceInput?.value || 0);
  // Determine nights reference from LOS that covers 1 night, else lowest min_days, else 2
  let nightsRef = 2;
  if (cover && cover.min_days) nightsRef = Math.max(1, Number(cover.min_days));
  else if (Array.isArray(los) && los.length) nightsRef = Math.max(1, Number(los[0].min_days || 2));
  // Optional: fold cleaning/service fees into nightly using LOS min_stay as amortization
  if (rulesState?.settings?.fold_fees_into_nightly) {
    const includeCleaning =
      rulesState.settings.fold_include_cleaning != null
        ? !!rulesState.settings.fold_include_cleaning
        : true;
    const includeService =
      rulesState.settings.fold_include_service != null
        ? !!rulesState.settings.fold_include_service
        : true;
    const feesTotal =
      (includeCleaning ? Number(rec.cleaning_fee || 0) : 0) +
      (includeService ? Number(rec.service_fee || 0) : 0);
    if (feesTotal > 0 && nightsRef > 0) {
      price = price + Math.floor(feesTotal / nightsRef);
    }
  }
  // Profit-based minimum clamp: uses both fees as cost basis regardless of fold-in toggles
  const minProfitPct = Number(rec.min_profit_pct || rec.minProfitPct || 0);
  const profitFeesTotal = Number(rec.cleaning_fee || 0) + Number(rec.service_fee || 0);
  let profitMin = 0;
  if (minProfitPct > 0 && profitFeesTotal > 0 && nightsRef > 0) {
    if (rulesState?.settings?.fold_fees_into_nightly) {
      profitMin = Math.floor((profitFeesTotal / nightsRef) * (1 + minProfitPct / 100));
    } else {
      profitMin = Math.floor((profitFeesTotal / nightsRef) * (minProfitPct / 100));
    }
  }
  price = Math.max(price, minRate || 0, globalMin || 0, profitMin || 0);
  return price;
}

// Build a price breakdown for tooltip: Base → Seasons → Discount → LOS → Weekend → Fees → Min clamp → Final
function computeOneNightBreakdown(ds, pid) {
  const rec = rulesState.baseRates[pid] || {};
  const base = Number(rec.base || 0);
  if (!base) return { note: 'No base rate', final: null };

  // Overrides are final and bypass all math
  const olist = rulesState.overrides?.[pid] || [];
  const ovr = Array.isArray(olist) ? olist.find((o) => o.date === ds) : null;
  if (ovr && ovr.price > 0) {
    return {
      override: { price: Math.floor(Number(ovr.price)), min_stay: ovr.min_stay ?? null, max_stay: ovr.max_stay ?? null },
      final: Math.floor(Number(ovr.price)),
    };
  }

  const minRate = Number(rec.min || 0);
  const globalMin = Number(minPriceInput?.value || 0);

  // Seasons
  const seasonPct = getSeasonPctForDate(ds);
  const afterSeason = Math.floor(base * (1 + seasonPct / 100));

  // Discount window (0..1), with per‑property cap
  const discPctRaw = computeDiscountPctLocal({
    date: ds,
    windowDays: Number(windowDaysInput?.value || 30),
    startDiscountPct: Number(startDiscountPctInput?.value || 30),
    endDiscountPct: Number(endDiscountPctInput?.value || 1),
  });
  const maxDiscPct = Number(rec.max_discount_pct || rec.maxDiscountPct || 0);
  const discPctCapped = maxDiscPct > 0 ? Math.min(discPctRaw, Math.max(0, Math.min(1, maxDiscPct / 100))) : discPctRaw;
  const afterDiscount = discPctCapped ? Math.floor(afterSeason * (1 - discPctCapped)) : afterSeason;

  // LOS for 1 night (preview)
  const los =
    Array.isArray(rulesState.global_los) && rulesState.global_los.length
      ? rulesState.global_los
      : Array.isArray(rec.los)
        ? rec.los
        : [];
  const losSorted = los.slice().sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0));
  const losCover = losSorted.find((r) => (r.min_days ?? 1) <= 1 && (r.max_days == null || r.max_days >= 1)) || null;
  const losPct = losCover ? -Math.abs(Number(losCover.percent || 0)) : 0;
  const afterLos = losPct ? Math.floor(afterDiscount * (1 + losPct / 100)) : afterDiscount;

  // Weekend uplift
  const d = new Date(ds + 'T00:00:00');
  const day = d.getDay();
  const isWeekend = day === 5 || day === 6;
  const weekendPct = isWeekend ? Math.abs(Number(rec.weekend_pct || rec.weekendPct || rec.weekend || 0)) : 0;
  const afterWeekend = weekendPct ? Math.floor(afterLos * (1 + weekendPct / 100)) : afterLos;

  // Fee fold‑in
  const foldEnabled = !!rulesState?.settings?.fold_fees_into_nightly;
  const includeCleaning = rulesState?.settings?.fold_include_cleaning != null ? !!rulesState.settings.fold_include_cleaning : true;
  const includeService = rulesState?.settings?.fold_include_service != null ? !!rulesState.settings.fold_include_service : true;
  const feesTotalIncluded = (includeCleaning ? Number(rec.cleaning_fee || 0) : 0) + (includeService ? Number(rec.service_fee || 0) : 0);
  // Nights reference from LOS tier that covers 1 night, else first tier min, else 2
  let nightsRef = 2;
  if (losCover?.min_days) nightsRef = Math.max(1, Number(losCover.min_days));
  else if (losSorted.length) nightsRef = Math.max(1, Number(losSorted[0].min_days || 2));
  const feesPerNight = foldEnabled && feesTotalIncluded > 0 && nightsRef > 0 ? Math.floor(feesTotalIncluded / nightsRef) : 0;
  const afterFees = afterWeekend + feesPerNight;

  // Profit‑based minimum
  const minProfitPct = Number(rec.min_profit_pct || rec.minProfitPct || 0);
  const profitFeesTotal = Number(rec.cleaning_fee || 0) + Number(rec.service_fee || 0);
  let profitMin = 0;
  if (minProfitPct > 0 && profitFeesTotal > 0 && nightsRef > 0) {
    profitMin = Math.floor((profitFeesTotal / nightsRef) * (foldEnabled ? 1 + minProfitPct / 100 : minProfitPct / 100));
  }

  const prelim = afterFees;
  const final = Math.max(prelim, minRate || 0, globalMin || 0, profitMin || 0);

  return {
    base,
    seasonPct,
    afterSeason,
    discountPctApplied: Math.round(discPctCapped * 1000) / 10, // one decimal percent
    afterDiscount,
    los: losCover ? { name: losCover.name || '', pct: losPct, min_days: losCover.min_days, max_days: losCover.max_days } : null,
    afterLos,
    weekendPct,
    afterWeekend,
    foldEnabled,
    fees: { includeCleaning, includeService, totalIncluded: feesTotalIncluded, nightsRef, perNight: feesPerNight },
    afterFees,
    floors: { minRate, globalMin, profitMin },
    final,
    jitterPct: 0,
  };
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
  const head = document.createElement('div');
  head.className = 'cal-header';
  for (const h of header) {
    const div = document.createElement('div');
    div.textContent = h;
    head.appendChild(div);
  }
  frag.appendChild(head);

  for (let i = 0; i < cells.length; i += 7) {
    const row = document.createElement('div');
    row.className = 'cal-row';
    for (let j = 0; j < 7; j++) {
      const cellDate = cells[i + j];
      const cell = document.createElement('div');
      cell.className = 'cal-cell' + (!cellDate ? ' muted' : '');
      if (cellDate) {
        const ds = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
        cell.dataset.date = ds;
        const dateEl = document.createElement('div');
        dateEl.className = 'cal-date';
        dateEl.textContent = cellDate.getDate();
        // Flags
        const olist = rulesState.overrides?.[pid] || [];
        const hasOverride = Array.isArray(olist) ? olist.some((o) => o.date === ds) : false;
        const blockedArr = (rulesState.blocked && rulesState.blocked[pid]) || [];
        const isBlocked = Array.isArray(blockedArr) ? blockedArr.includes(ds) : false;
        const day = cellDate.getDay();
        const isWeekend = day === 5 || day === 6;
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        if (isWeekend) cell.classList.add('weekend');
        if (ds === todayStr) cell.classList.add('today');
        if (hasOverride) cell.classList.add('override');
        if (isBlocked) cell.classList.add('blocked');
        // Background: override color > season color > derived shade
        if (hasOverride) {
          const baseCol = rulesState.settings?.override_color || '#ffd1dc';
          cell.style.background = hexToRgba(baseCol, 0.22);
        } else {
          // No season background fill — use a thin indicator bar instead
          const season = getSeasonForDate(ds);
          const bar = document.createElement('div');
          bar.className = 'cal-season';
          const col = season?.color || seasonColor(getSeasonPctForDate(ds));
          bar.style.background = col;
          cell.appendChild(bar);
        }
        const priceEl = document.createElement('div');
        priceEl.className = 'cal-price';
        if (isBlocked) {
          priceEl.innerHTML = '<span class="pill pill-blocked">Blocked</span>';
          priceEl.title = 'Blocked by rules';
          try { cell.title = priceEl.title; } catch {}
        } else {
          const p = computeOneNightPrice(ds, pid);
          priceEl.innerHTML =
            p !== '' ? `<span class="pill">£${p}</span>` : '<span class="pill">—</span>';
        }
        // Price breakdown tooltip
        try {
          const bd = computeOneNightBreakdown(ds, pid);
          const fmt = (n) => `£${Math.floor(Number(n || 0))}`;
          let title = '';
          if (bd?.override) {
            const parts = [`Override: ${fmt(bd.override.price)}`];
            if (bd.override.min_stay != null) parts.push(`min_stay=${bd.override.min_stay}`);
            if (bd.override.max_stay != null) parts.push(`max_stay=${bd.override.max_stay}`);
            title = parts.join(' · ');
          } else if (bd && bd.final != null) {
            const lines = [];
            lines.push(`Base: ${fmt(bd.base)}`);
            if (bd.seasonPct) lines.push(`Seasons: ${bd.seasonPct > 0 ? '+' : ''}${bd.seasonPct}% → ${fmt(bd.afterSeason)}`);
            if (bd.discountPctApplied) lines.push(`Discount: -${bd.discountPctApplied}% → ${fmt(bd.afterDiscount)}`);
            if (bd.los) lines.push(`LOS ${bd.los.min_days}${bd.los.max_days ? '-' + bd.los.max_days : '+'}: ${bd.los.pct}% → ${fmt(bd.afterLos)}`);
            if (bd.weekendPct) lines.push(`Weekend: +${bd.weekendPct}% → ${fmt(bd.afterWeekend)}`);
            if (bd.foldEnabled && bd.fees?.perNight) {
              const inc = [];
              if (bd.fees.includeCleaning) inc.push('cleaning');
              if (bd.fees.includeService) inc.push('service');
              lines.push(`Fees (${inc.join('+')}): +${fmt(bd.fees.perNight)} (nights=${bd.fees.nightsRef}) → ${fmt(bd.afterFees)}`);
            }
            const floors = [];
            if (bd.floors?.minRate) floors.push(`per‑prop ${fmt(bd.floors.minRate)}`);
            if (bd.floors?.globalMin) floors.push(`global ${fmt(bd.floors.globalMin)}`);
            if (bd.floors?.profitMin) floors.push(`profit ${fmt(bd.floors.profitMin)}`);
            if (floors.length) lines.push(`Min floors: ${floors.join(', ')}`);
            lines.push(`Final: ${fmt(bd.final)}`);
            title = lines.join('\n');
          } else if (bd?.note) {
            title = bd.note;
          }
          if (!isBlocked && title) {
            priceEl.title = title;
            // Also attach to the whole cell so hover anywhere shows it
            try { cell.title = title; } catch {}
          }
        } catch {}
        // LOS indicator: colored dot if a second LOS tier exists
        const rec = rulesState.baseRates[pid] || {};
        const los =
          Array.isArray(rulesState.global_los) && rulesState.global_los.length
            ? rulesState.global_los.slice().sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0))
            : Array.isArray(rec.los)
              ? rec.los.slice().sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0))
              : [];
        if (los.length > 1) {
          const second = los[1];
          const dot = document.createElement('div');
          dot.className = 'cal-dot';
          dot.style.background = second?.color || '#888888';
          dot.title = second?.name ? `Additional LOS: ${second.name}` : 'Additional LOS present';
          cell.appendChild(dot);
        }
        // Booking band at bottom for Booked status only
        try {
          const pidNum = Number(pid);
          const list = Array.isArray(bookingsCache?.items) ? bookingsCache.items : [];
          const matches = list.filter((b) => {
            const status = (b?.status ?? b?.bookingStatus ?? '').toString().toLowerCase();
            if (status !== 'booked') return false;
            const propId = Number(getBookingPropId(b));
            if (!isNaN(pidNum) && !isNaN(propId) && pidNum !== propId) return false;
            const [cin, cout] = getBookingDates(b);
            return dateInRange(ds, cin, cout);
          });
          if (matches.length > 0) {
            const ch = getBookingChannel(matches[0]);
            const band = document.createElement('div');
            band.className = `cal-booking ${ch}`;
            // Compute per-night paid if amounts are available
            const b = matches[0];
            const [cin, cout] = getBookingDates(b);
            let nights = 0;
            try {
              const a = new Date(cin + 'T00:00:00');
              const d2 = new Date(cout + 'T00:00:00');
              nights = Math.max(1, Math.round((d2 - a) / 86400000));
            } catch {}
            const total =
              Number(b?.total_amount || 0) ||
              Number(b?.amount_paid || 0) ||
              Number(b?.subtotals_stay || 0) ||
              0;
            // Channel-specific adjustments: subtract addon fees and remove uplift
            let adj = total;
            try {
              const rawSrc = (b?.channelName ?? b?.channel ?? b?.source ?? b?.origin ?? '')
                .toString()
                .toLowerCase();
              const s = rulesState?.settings || {};
              const add = (v) => Math.max(0, Number(v || 0));
              const pct = (v) => Math.max(0, Number(v || 0));
              if (rawSrc.includes('airbnb')) {
                adj = Math.max(0, adj - add(s.airbnb_addon_fee));
                const u = pct(s.airbnb_uplift_pct);
                if (u > 0) adj = adj / (1 + u / 100);
              } else if (rawSrc.includes('booking')) {
                adj = Math.max(0, adj - add(s.booking_addon_fee));
                const u = pct(s.booking_uplift_pct);
                if (u > 0) adj = adj / (1 + u / 100);
              } else if (
                rawSrc.includes('oh') ||
                rawSrc.includes('manual') ||
                rawSrc.includes('website')
              ) {
                adj = Math.max(0, adj - add(s.oh_addon_fee));
              } else {
                // For unknown channels, leave as-is
              }
            } catch {}
            if (nights > 0 && total > 0) {
              const per = Math.round((adj > 0 ? adj : 0) / nights);
              const paid = document.createElement('div');
              paid.className = 'cal-paid';
              const cur = (b?.currency_code || 'GBP').toUpperCase();
              const sym = cur === 'GBP' ? '£' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : '';
              paid.textContent = `${sym}${per}/d`;
              const parts = [];
              if (total > 0) parts.push(`raw ${sym}${total}`);
              parts.push(`adj ${sym}${Math.round(adj)}`);
              parts.push(`${nights} night(s)`);
              paid.title = parts.join(' · ');
              cell.appendChild(paid);
              band.title = paid.title;
            }
            band.textContent = 'Booked';
            cell.appendChild(band);
          }
        } catch {}

        cell.appendChild(dateEl);
        cell.appendChild(priceEl);
        // Range selection: mouse down to start, drag to extend, mouse up to finalize
        cell.addEventListener('mousedown', (e) => {
          if (!ds) return;
          e.preventDefault();
          calSelection.active = true;
          calSelection.start = ds;
          calSelection.end = ds;
          highlightRange(calSelection.start, calSelection.end);
          if (!calMouseUpHandler) {
            calMouseUpHandler = (ev) => {
              if (!calSelection.active) return;
              const start = calSelection.start;
              const end = calSelection.end || calSelection.start;
              const list = datesInRange(start, end);
              clearCalSelection();
              document.removeEventListener('mouseup', calMouseUpHandler);
              calMouseUpHandler = null;
              if (list.length > 1) openRangeOverrideModal(list);
              else if (list.length === 1) openOverrideModal(list[0]);
            };
            document.addEventListener('mouseup', calMouseUpHandler);
          }
        });
        cell.addEventListener('mouseenter', (e) => {
          if (!calSelection.active || !calSelection.start) return;
          calSelection.end = ds;
          highlightRange(calSelection.start, calSelection.end);
        });
      }
      row.appendChild(cell);
    }
    frag.appendChild(row);
  }
  calDiv.innerHTML = '';
  calDiv.appendChild(frag);
  // Mouseup handler is bound on demand when selection starts
}

propSelectCal?.addEventListener('change', renderCalendar);
monthInput?.addEventListener('change', renderCalendar);
// Re-render calendar when discount settings change to reflect preview accurately
windowDaysInput?.addEventListener('input', renderCalendar);
startDiscountPctInput?.addEventListener('input', renderCalendar);
endDiscountPctInput?.addEventListener('input', renderCalendar);
minPriceInput?.addEventListener('input', renderCalendar);

function changeMonth(delta) {
  if (!monthInput.value) return;
  const [yy, mm] = monthInput.value.split('-').map(Number);
  const d = new Date(yy, mm - 1 + delta, 1);
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
    item.appendChild(sw);
    item.appendChild(txt);
    frag.appendChild(item);
  }
  seasonLegendDiv.innerHTML = '';
  seasonLegendDiv.appendChild(frag);
}

function openOverrideModal(ds) {
  const pid = propSelectCal.value;
  const prop = (allPropsCache || []).find((p) => String(p.id) === String(pid));
  if (!rulesState.overrides) rulesState.overrides = {};
  const list = rulesState.overrides[pid] || (rulesState.overrides[pid] = []);
  const existing = list.find((o) => o.date === ds) || null;
  ovrDateDisplay.textContent = ds;
  ovrPropName.textContent = prop?.name ? `(${prop.name})` : `Property ${pid}`;
  ovrPrice.value = existing?.price ?? '';
  ovrMin.value = existing?.min_stay ?? '';
  ovrMax.value = existing?.max_stay ?? '';
  if (ovrLosHint) ovrLosHint.textContent = '';
  overrideModal.classList.add('show');
  overrideModal.setAttribute('aria-hidden', 'false');

  ovrSave.onclick = async () => {
    const price = Number(ovrPrice.value || 0);
    const min_stay = ovrMin.value ? Number(ovrMin.value) : null;
    const max_stay = ovrMax.value ? Number(ovrMax.value) : null;
    const idx = list.findIndex((o) => o.date === ds);
    if (price > 0) {
      const rec = { date: ds, price, min_stay, max_stay };
      if (idx >= 0) list[idx] = rec;
      else list.push(rec);
      await saveRules().catch((e) => showToast(e.message, 'error'));
      showToast('Override saved', 'success');
    } else {
      if (idx >= 0) list.splice(idx, 1);
      await saveRules().catch((e) => showToast(e.message, 'error'));
      showToast('Override removed', 'success');
    }
    closeOverrideModal();
    renderCalendar();
  };
  if (ovrBlock) ovrBlock.onclick = async () => {
    blockDates(pid, ds);
    await saveRules().catch((e) => showToast(e.message, 'error'));
    showToast('Date blocked', 'success');
    closeOverrideModal();
    renderCalendar();
  };
  if (ovrUnblock) ovrUnblock.onclick = async () => {
    unblockDates(pid, ds);
    await saveRules().catch((e) => showToast(e.message, 'error'));
    showToast('Date unblocked', 'success');
    closeOverrideModal();
    renderCalendar();
  };
  ovrDelete.onclick = async () => {
    const idx = list.findIndex((o) => o.date === ds);
    if (idx >= 0) list.splice(idx, 1);
    await saveRules().catch((e) => showToast(e.message, 'error'));
    showToast('Override removed', 'success');
    closeOverrideModal();
    renderCalendar();
  };
  ovrCancel.onclick = () => closeOverrideModal();
  const onBackdrop = (e) => {
    if (e.target === overrideModal) {
      closeOverrideModal();
      overrideModal.removeEventListener('click', onBackdrop);
    }
  };
  overrideModal.addEventListener('click', onBackdrop);
}

function openRangeOverrideModal(dateList) {
  if (!Array.isArray(dateList) || dateList.length === 0) return;
  const pid = propSelectCal.value;
  const prop = (allPropsCache || []).find((p) => String(p.id) === String(pid));
  if (!rulesState.overrides) rulesState.overrides = {};
  const list = rulesState.overrides[pid] || (rulesState.overrides[pid] = []);
  const sorted = dateList.slice().sort();
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  ovrDateDisplay.textContent = `${start} → ${end} (${sorted.length} days)`;
  ovrPropName.textContent = prop?.name ? `(${prop.name})` : `Property ${pid}`;
  // For range, do not prefill from a single day; leave empty
  ovrPrice.value = '';
  ovrMin.value = '';
  ovrMax.value = '';
  // Compute and display LOS-based suggestion for this range length
  try {
    if (ovrLosHint) {
      const nights = sorted.length;
      // Prefer global LOS; fallback to per-property LOS
      const rec = rulesState.baseRates[pid] || {};
      const losList = (
        Array.isArray(rulesState.global_los) && rulesState.global_los.length
          ? rulesState.global_los
          : Array.isArray(rec.los)
            ? rec.los
            : []
      )
        .slice()
        .sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0));
      const match = losList.find(
        (r) => (r.min_days ?? 1) <= nights && (r.max_days == null || nights <= r.max_days)
      );
      // Gather baseline prices for each selected date using current preview rules
      const perDayBase = sorted
        .map((ds) => computeOneNightPrice(ds, pid))
        .filter((v) => typeof v === 'number' && isFinite(v) && v > 0);
      if (perDayBase.length === 0) {
        ovrLosHint.textContent = '';
      } else if (match && (match.percent || match.percent === 0)) {
        const pct = Math.abs(Number(match.percent || 0));
        const perDayWithLos = perDayBase.map((p) => Math.floor(p * (1 - pct / 100)));
        const sum = perDayWithLos.reduce((a, b) => a + b, 0);
        const avg = Math.round(sum / perDayWithLos.length);
        const mn = Math.min(...perDayWithLos);
        const mx = Math.max(...perDayWithLos);
        const sym = '£';
        ovrLosHint.innerHTML = `LOS ${nights} night${nights === 1 ? '' : 's'}: -${pct}% → <strong>${sym}${avg}/night</strong> (range ${sym}${mn}–${sym}${mx}) <button type="button" id="ovrLosApply">Use ${sym}${avg}</button>`;
        const applyBtn = document.getElementById('ovrLosApply');
        if (applyBtn) {
          applyBtn.onclick = () => {
            ovrPrice.value = String(avg);
            try {
              ovrPrice.focus();
            } catch {}
          };
        }
      } else {
        const sum = perDayBase.reduce((a, b) => a + b, 0);
        const avg = Math.round(sum / perDayBase.length);
        const mn = Math.min(...perDayBase);
        const mx = Math.max(...perDayBase);
        const sym = '£';
        ovrLosHint.innerHTML = `No LOS tier for ${nights} night${nights === 1 ? '' : 's'} · Avg nightly <strong>${sym}${avg}</strong> (range ${sym}${mn}–${sym}${mx}) <button type="button" id="ovrLosApply">Use ${sym}${avg}</button>`;
        const applyBtn = document.getElementById('ovrLosApply');
        if (applyBtn) {
          applyBtn.onclick = () => {
            ovrPrice.value = String(avg);
            try {
              ovrPrice.focus();
            } catch {}
          };
        }
      }
    }
  } catch {
    if (ovrLosHint) ovrLosHint.textContent = '';
  }
  overrideModal.classList.add('show');
  overrideModal.setAttribute('aria-hidden', 'false');

  ovrSave.onclick = async () => {
    const price = Number(ovrPrice.value || 0);
    const min_stay = ovrMin.value ? Number(ovrMin.value) : null;
    const max_stay = ovrMax.value ? Number(ovrMax.value) : null;
    if (price > 0) {
      for (const ds of sorted) {
        const idx = list.findIndex((o) => o.date === ds);
        const rec = { date: ds, price, min_stay, max_stay };
        if (idx >= 0) list[idx] = rec;
        else list.push(rec);
      }
      await saveRules().catch((e) => showToast(e.message, 'error'));
      showToast(`Overrides saved for ${sorted.length} days`, 'success');
    } else {
      // If price not set, treat as removal for range
      for (const ds of sorted) {
        const idx = list.findIndex((o) => o.date === ds);
        if (idx >= 0) list.splice(idx, 1);
      }
      await saveRules().catch((e) => showToast(e.message, 'error'));
      showToast(`Overrides removed for ${sorted.length} days`, 'success');
    }
    closeOverrideModal();
    renderCalendar();
  };
  if (ovrBlock) ovrBlock.onclick = async () => {
    blockDates(pid, sorted);
    await saveRules().catch((e) => showToast(e.message, 'error'));
    showToast(`Blocked ${sorted.length} day(s)`, 'success');
    closeOverrideModal();
    renderCalendar();
  };
  if (ovrUnblock) ovrUnblock.onclick = async () => {
    unblockDates(pid, sorted);
    await saveRules().catch((e) => showToast(e.message, 'error'));
    showToast(`Unblocked ${sorted.length} day(s)`, 'success');
    closeOverrideModal();
    renderCalendar();
  };
  ovrDelete.onclick = async () => {
    for (const ds of sorted) {
      const idx = list.findIndex((o) => o.date === ds);
      if (idx >= 0) list.splice(idx, 1);
    }
    await saveRules().catch((e) => showToast(e.message, 'error'));
    showToast(`Overrides removed for ${sorted.length} days`, 'success');
    closeOverrideModal();
    renderCalendar();
  };
  ovrCancel.onclick = () => closeOverrideModal();
  const onBackdrop = (e) => {
    if (e.target === overrideModal) {
      closeOverrideModal();
      overrideModal.removeEventListener('click', onBackdrop);
    }
  };
  overrideModal.addEventListener('click', onBackdrop);
}

function closeOverrideModal() {
  overrideModal.classList.remove('show');
  overrideModal.setAttribute('aria-hidden', 'true');
}

// --- Blocked dates helpers ---
function getBlockedListFor(pid) {
  if (!rulesState.blocked) rulesState.blocked = {};
  if (!Array.isArray(rulesState.blocked[pid])) rulesState.blocked[pid] = [];
  return rulesState.blocked[pid];
}
function blockDates(pid, dates) {
  const list = getBlockedListFor(pid);
  const set = new Set(list);
  const src = Array.isArray(dates) ? dates : [dates];
  for (const ds of src) {
    if (typeof ds === 'string' && ds.length === 10) set.add(ds);
  }
  rulesState.blocked[pid] = Array.from(set).sort();
}
function unblockDates(pid, dates) {
  const remove = new Set(Array.isArray(dates) ? dates : [dates]);
  const list = getBlockedListFor(pid).filter((d) => !remove.has(d));
  rulesState.blocked[pid] = list;
}

// Keep rules file inputs in sync (3 fields)
// no secondary rules file inputs

// After loading properties or rules, sync calendar property select
const origLoadProps = loadPropertiesAndRender;
loadPropertiesAndRender = async function () {
  await origLoadProps();
  syncCalProps();
};
const origLoadRules = loadRules;
loadRules = async function () {
  await origLoadRules();
  renderSeasons();
  updateBaseMinForSelectedProp();
  renderGlobalLos();
  renderCalendar();
  renderSeasonLegend();
};
