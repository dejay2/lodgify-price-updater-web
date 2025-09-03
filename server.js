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
// Baseline/calendar editing removed: rules-only mode

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`Lodgify Price Updater web listening on http://localhost:${PORT}`);
});
