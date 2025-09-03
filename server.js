import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';

import {
  fetchProperties,
  postRates,
} from './src/lodgify.js';
import { runUpdate } from './src/logic.js';
import { loadRules, saveRules } from './src/rules.js';
import { fetchUpcomingBookingsPage, fetchAllBookingsPage, fetchUpcomingBookingsUpdatedSincePage } from './src/lodgify.js';
import fs from 'fs/promises';
// Baseline/calendar editing removed: rules-only mode

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const AUTO_SYNC_MINUTES = Number(process.env.BOOKING_SYNC_INTERVAL_MINUTES || 0) || 0; // 0 disables

app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Get properties
app.get('/api/properties', async (req, res) => {
  try {
    const apiKey = req.get('x-apikey') || req.query.apiKey || process.env.LODGIFY_API_KEY || '';
    if (!apiKey) return res.status(400).json({ error: 'Missing Lodgify API key' });
    const props = await fetchProperties(apiKey);
    res.json(props);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to fetch properties' });
  }
});

// Removed calendar and baseline edit endpoints in rules-only mode

// Run update end-to-end
app.post('/api/run-update', async (req, res) => {
  try {
    const apiKey = req.get('x-apikey') || req.body.apiKey || process.env.LODGIFY_API_KEY || '';
    if (!apiKey) return res.status(400).json({ error: 'Missing Lodgify API key' });

    // Always compute date range as today -> 18 months ahead (exclusive end)
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const today = new Date();
    const startLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endExclusive = new Date(startLocal.getFullYear(), startLocal.getMonth() + 18, startLocal.getDate());
    const endLocal = new Date(endExclusive.getFullYear(), endExclusive.getMonth(), endExclusive.getDate() - 1);

    const settings = {
      windowDays: Number(req.body.windowDays ?? 30),
      startDiscountPct: Number(req.body.startDiscountPct ?? 30.0),
      endDiscountPct: Number(req.body.endDiscountPct ?? 1.0),
      minPrice: Number(req.body.minPrice ?? 0),
      // ignore incoming dates; enforce computed range
      startDate: fmt(startLocal),
      endDate: fmt(endLocal),
      rulesFile: req.body.rulesFile || 'price_rules.json',
      dryRun: Boolean(req.body.dryRun ?? true),
      selectedPropertyIds: Array.isArray(req.body.selectedPropertyIds) ? req.body.selectedPropertyIds : [],
    };

    // Basic validation before heavy lifting
    if (!settings.startDate || !settings.endDate) {
      return res.status(400).json({ error: 'Failed to compute date range' });
    }
    const sDate = new Date(String(settings.startDate) + 'T00:00:00');
    const eDate = new Date(String(settings.endDate) + 'T00:00:00');
    if (isNaN(sDate) || isNaN(eDate)) {
      return res.status(400).json({ error: 'Invalid computed start or end date' });
    }
    if (eDate < sDate) {
      return res.status(400).json({ error: 'endDate must be on/after startDate' });
    }
    const monthsDiff = (eDate.getFullYear() - sDate.getFullYear()) * 12 + (eDate.getMonth() - sDate.getMonth());
    if (monthsDiff > 17) {
      return res.status(400).json({ error: 'Date range exceeds 18 months' });
    }
    const clamp01 = (v) => Math.max(0, Math.min(100, Number(v)));
    settings.startDiscountPct = clamp01(settings.startDiscountPct);
    settings.endDiscountPct = clamp01(settings.endDiscountPct);
    settings.windowDays = Math.max(0, Number(settings.windowDays));
    settings.minPrice = Math.max(0, Number(settings.minPrice));

    const summary = await runUpdate({ apiKey, settings, postRates });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Update failed' });
  }
});

// Rules (seasonal) config
app.get('/api/rules', async (req, res) => {
  try {
    const file = req.query.rulesFile || 'price_rules.json';
    const rules = await loadRules(file);
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load rules' });
  }
});

app.post('/api/rules', async (req, res) => {
  try {
    const file = req.body.rulesFile || 'price_rules.json';
    const body = req.body || {};
    if (!body.baseRates || !body.seasons) return res.status(400).json({ error: 'baseRates and seasons are required' });
    await saveRules(file, {
      baseRates: body.baseRates,
      seasons: body.seasons,
      overrides: body.overrides || {},
      settings: body.settings || {},
    });
    res.json({ ok: true });
  } catch (err) {
    // Surface validation errors clearly
    const msg = err?.message || 'Failed to save rules';
    const code = msg.includes('LOS overlap') || msg.includes('Invalid rulesFile') ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

// Import and persist all upcoming bookings to a JSON file
app.get('/api/bookings/upcoming', async (req, res) => {
  try {
    const apiKey = req.get('x-apikey') || req.query.apiKey || process.env.LODGIFY_API_KEY || '';
    if (!apiKey) return res.status(400).json({ error: 'Missing Lodgify API key' });
    const size = Math.max(1, Math.min(200, Number(req.query.size || 50)));
    // First page to get count
    const first = await fetchUpcomingBookingsPage(apiKey, { page: 1, size });
    const total = Number(first?.count || 0);
    const items = Array.isArray(first?.items) ? first.items.slice() : [];
    const totalPages = total > 0 ? Math.ceil(total / size) : (items.length > 0 ? 1 : 0);
    for (let page = 2; page <= totalPages; page++) {
      const data = await fetchUpcomingBookingsPage(apiKey, { page, size });
      if (Array.isArray(data?.items) && data.items.length) items.push(...data.items);
    }
    const payload = {
      fetchedAt: new Date().toISOString(),
      count: total,
      pageSize: size,
      totalPages,
      items,
    };
    const outPath = path.join(__dirname, 'upcoming_bookings.json');
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf-8');
    // Also merge into persistent store (only status Booked)
    const { merged, removed, totalInStore } = await mergeIntoBookingsStore(items);
    res.json({ ok: true, saved: outPath, count: payload.count, pages: totalPages, size, itemsSaved: items.length, mergedToStore: merged, removedFromStore: removed, storeCount: totalInStore });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to fetch upcoming bookings' });
  }
});

// Serve locally saved upcoming bookings (from upcoming_bookings.json)
app.get('/api/bookings/local', async (_req, res) => {
  try {
    const outPath = path.join(__dirname, 'upcoming_bookings.json');
    const txt = await fs.readFile(outPath, 'utf-8');
    res.setHeader('Content-Type', 'application/json');
    res.send(txt);
  } catch (err) {
    const code = err?.code === 'ENOENT' ? 404 : 500;
    res.status(code).json({ error: err?.message || 'Failed to read upcoming_bookings.json' });
  }
});

// --- Sync state helpers ---
async function readSyncState() {
  try {
    const p = path.join(__dirname, 'bookings_sync.json');
    const txt = await fs.readFile(p, 'utf-8');
    return JSON.parse(txt);
  } catch {
    return { lastSyncAt: null };
  }
}
async function writeSyncState(state) {
  const p = path.join(__dirname, 'bookings_sync.json');
  await fs.writeFile(p, JSON.stringify(state, null, 2), 'utf-8');
}
function fmtNowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Read sync state
app.get('/api/bookings/sync-state', async (_req, res) => {
  try {
    const s = await readSyncState();
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to read sync state' });
  }
});

// Sync updates since last run (or provided ?since=YYYY-MM-DD HH:mm) and merge Booked into store
async function runUpdatesSince({ apiKey, sinceOverride, size = 100 }) {
  const effectiveSize = Math.max(1, Math.min(200, Number(size || 50)));
  const state = await readSyncState();
  const today = new Date();
  const sinceDefault = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')} 00:00`;
  const since = sinceOverride || state.lastSyncAt || sinceDefault;
  const first = await fetchUpcomingBookingsUpdatedSincePage(apiKey, { page: 1, size: effectiveSize, updatedSince: since });
  const total = Number(first?.count || 0);
  const items = Array.isArray(first?.items) ? first.items.slice() : [];
  const totalPages = total > 0 ? Math.ceil(total / effectiveSize) : (items.length > 0 ? 1 : 0);
  for (let page = 2; page <= totalPages; page++) {
    const data = await fetchUpcomingBookingsUpdatedSincePage(apiKey, { page, size: effectiveSize, updatedSince: since });
    if (Array.isArray(data?.items) && data.items.length) items.push(...data.items);
  }
  const { merged, removed, totalInStore } = await mergeIntoBookingsStore(items);
  const nextSince = fmtNowLocal();
  await writeSyncState({ lastSyncAt: nextSince });
  return { ok: true, sinceUsed: since, nextSince, fetched: items.length, mergedToStore: merged, removedFromStore: removed, storeCount: totalInStore, pages: totalPages, size: effectiveSize };
}

app.get('/api/bookings/sync-updates', async (req, res) => {
  try {
    const apiKey = req.get('x-apikey') || req.query.apiKey || process.env.LODGIFY_API_KEY || '';
    if (!apiKey) return res.status(400).json({ error: 'Missing Lodgify API key' });
    const result = await runUpdatesSince({ apiKey, sinceOverride: req.query.since, size: req.query.size });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to sync booking updates' });
  }
});

// Import ALL bookings (historic + current + future), save snapshot and merge Booked into store
app.get('/api/bookings/all', async (req, res) => {
  try {
    const apiKey = req.get('x-apikey') || req.query.apiKey || process.env.LODGIFY_API_KEY || '';
    if (!apiKey) return res.status(400).json({ error: 'Missing Lodgify API key' });
    const size = Math.max(1, Math.min(200, Number(req.query.size || 50)));
    const first = await fetchAllBookingsPage(apiKey, { page: 1, size });
    const total = Number(first?.count || 0);
    const items = Array.isArray(first?.items) ? first.items.slice() : [];
    const totalPages = total > 0 ? Math.ceil(total / size) : (items.length > 0 ? 1 : 0);
    for (let page = 2; page <= totalPages; page++) {
      const data = await fetchAllBookingsPage(apiKey, { page, size });
      if (Array.isArray(data?.items) && data.items.length) items.push(...data.items);
    }
    const payload = {
      fetchedAt: new Date().toISOString(),
      count: total,
      pageSize: size,
      totalPages,
      items,
    };
    const outPath = path.join(__dirname, 'all_bookings.json');
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf-8');
    const { merged, removed, totalInStore } = await mergeIntoBookingsStore(items);
    res.json({ ok: true, saved: outPath, count: payload.count, pages: totalPages, size, itemsSaved: items.length, mergedToStore: merged, removedFromStore: removed, storeCount: totalInStore });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to fetch all bookings' });
  }
});

// Persistent store: merge-only, stores only status Booked
async function readBookingsStore() {
  try {
    const p = path.join(__dirname, 'bookings_store.json');
    const txt = await fs.readFile(p, 'utf-8');
    return JSON.parse(txt);
  } catch (e) {
    return { updatedAt: null, count: 0, items: [] };
  }
}
async function writeBookingsStore(store) {
  const p = path.join(__dirname, 'bookings_store.json');
  await fs.writeFile(p, JSON.stringify(store, null, 2), 'utf-8');
}
function normDate(s) { return (typeof s === 'string' && s.length >= 10) ? s.slice(0,10) : null; }
function normNumber(v) { const n = Number(v); return isFinite(n) ? n : null; }
function statusIsBooked(s) { return String(s||'').toLowerCase() === 'booked'; }
function pickSource(b) { return b?.source ?? b?.channelName ?? b?.channel ?? null; }
function toRecord(b) {
  return {
    id: normNumber(b?.id),
    property_id: normNumber(b?.property_id ?? b?.propertyId ?? b?.houseId ?? b?.accommodationId ?? b?.property?.id ?? b?.house?.id),
    arrival: normDate(b?.arrival ?? b?.arrivalDate ?? b?.checkIn ?? b?.checkInDate ?? b?.startDate),
    departure: normDate(b?.departure ?? b?.departureDate ?? b?.checkOut ?? b?.checkOutDate ?? b?.endDate),
    status: b?.status ?? b?.bookingStatus ?? null,
    source: pickSource(b),
  };
}
async function mergeIntoBookingsStore(items) {
  const store = await readBookingsStore();
  const byId = new Map(store.items.map(it => [it.id, it]));
  let merged = 0;
  let removed = 0;
  for (const b of Array.isArray(items) ? items : []) {
    const id = Number(b?.id);
    const isBooked = statusIsBooked(b?.status ?? b?.bookingStatus);
    if (!isFinite(id)) continue;
    if (!isBooked) {
      if (byId.has(id)) { byId.delete(id); removed++; }
      continue;
    }
    const rec = toRecord(b);
    if (!rec.id) continue;
    const existing = byId.get(rec.id);
    if (existing) {
      Object.assign(existing, Object.fromEntries(Object.entries(rec).filter(([, v]) => v != null)));
    } else {
      byId.set(rec.id, rec);
      merged++;
    }
  }
  store.items = Array.from(byId.values());
  store.updatedAt = new Date().toISOString();
  store.count = store.items.length;
  await writeBookingsStore(store);
  return { merged, removed, totalInStore: store.count };
}

// Merge arbitrary posted bookings (e.g., full historical dump) into store
app.post('/api/bookings/merge', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : (Array.isArray(req.body) ? req.body : []);
  const { merged, removed, totalInStore } = await mergeIntoBookingsStore(items);
  res.json({ ok: true, merged, removed, totalInStore });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to merge bookings' });
  }
});

// Serve the persistent store
app.get('/api/bookings/store', async (_req, res) => {
  try {
    const store = await readBookingsStore();
    res.json(store);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to read bookings store' });
  }
});

app.listen(PORT, () => {
  console.log(`Lodgify Price Updater web listening on http://localhost:${PORT}`);
  // Start automated sync if configured
  if (AUTO_SYNC_MINUTES > 0) {
    if (!process.env.LODGIFY_API_KEY) {
      console.warn('Auto-sync disabled: LODGIFY_API_KEY not set');
      return;
    }
    const intervalMs = AUTO_SYNC_MINUTES * 60 * 1000;
    let running = false;
    const kick = async () => {
      if (running) return; running = true;
      try {
        const r = await runUpdatesSince({ apiKey: process.env.LODGIFY_API_KEY, sinceOverride: null, size: 100 });
        console.log(`[auto-sync] ${new Date().toISOString()} since='${r.sinceUsed}' fetched=${r.fetched} merged=${r.mergedToStore} removed=${r.removedFromStore} store=${r.storeCount} next='${r.nextSince}'`);
      } catch (e) {
        console.error('[auto-sync] failed:', e?.message || e);
      } finally {
        running = false;
      }
    };
    // initial run after short delay, then on interval
    setTimeout(kick, 10_000);
    setInterval(kick, intervalMs);
    console.log(`Auto-sync enabled: every ${AUTO_SYNC_MINUTES} minute(s)`);
  }
});
