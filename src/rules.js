import fs from 'fs/promises';
import path from 'path';

function rulesPath(file) {
  const baseDir = process.cwd();
  const name = file || 'price_rules.json';
  const abs = path.resolve(baseDir, name);
  const rel = path.relative(baseDir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid rulesFile path');
  }
  return abs;
}

export async function loadRules(file) {
  const p = rulesPath(file);
  try {
    const t = await fs.readFile(p, 'utf-8');
    const data = JSON.parse(t);
    return normalizeRules(data);
  } catch {
    return { baseRates: {}, seasons: [], overrides: {}, settings: { override_color: '#ffd1dc' } };
  }
}

export async function saveRules(file, rules) {
  const p = rulesPath(file);
  const data = normalizeRules(rules, { validate: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf-8');
}

function normalizeRules(r, opts = {}) {
  const raw = r || {};
  const baseRates = raw.baseRates || {};
  // Normalize each property record
  for (const pid of Object.keys(baseRates)) {
    const rec = baseRates[pid] || {};
    rec.base = Number(rec.base ?? rec.baseRate ?? 0);
    rec.min = Number(rec.min ?? rec.minRate ?? 0);
    // Weekend uplift percent (Fri/Sat)
    rec.weekend_pct = Number(
      rec.weekend_pct ?? rec.weekendPct ?? rec.weekend ?? rec.weekend_rate ?? 0
    );
    // Normalize LOS rules array
    let los = Array.isArray(rec.los) ? rec.los.map(x => ({
      name: x.name || '',
      min_days: x.min_days != null ? Number(x.min_days) : (x.min ?? 1),
      max_days: x.max_days != null ? Number(x.max_days) : (x.max ?? null),
      percent: Number(x.percent || 0), // discount percent
      color: typeof x.color === 'string' ? x.color : '',
    })) : [];
    // sort by min_days
    los.sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0));
    // Validate and ensure no overlaps; fix obvious issues
    const cleaned = [];
    for (const x of los) {
      const minD = Math.max(1, Number.isFinite(x.min_days) ? x.min_days : 1);
      const maxD = x.max_days == null ? null : Math.max(minD, Number(x.max_days));
      const item = { name: x.name || '', min_days: minD, max_days: maxD, percent: Number(x.percent || 0) };
      if (cleaned.length) {
        const prev = cleaned[cleaned.length - 1];
        const prevMax = prev.max_days;
        // Disallow overlaps: current min must be greater than previous max (if prev max exists)
        if (prevMax == null || minD <= prevMax) {
          if (opts.validate) {
            throw new Error(`LOS overlap for property ${pid}: ${prev.min_days}-${prev.max_days ?? '∞'} vs ${minD}-${maxD ?? '∞'}`);
          } else {
            continue; // skip invalid overlap silently when not validating
          }
        }
      }
      cleaned.push(item);
    }
    los = cleaned;
    rec.los = los;
    baseRates[pid] = rec;
  }
  const seasons = Array.isArray(raw.seasons) ? raw.seasons.map(s => ({
    name: s.name || '',
    start: s.start, // YYYY-MM-DD
    end: s.end,     // YYYY-MM-DD
    percent: Number(s.percent || 0),
    color: typeof s.color === 'string' ? s.color : '',
  })) : [];
  // Overrides per property
  const overrides = {};
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const pid of Object.keys(raw.overrides)) {
      const list = Array.isArray(raw.overrides[pid]) ? raw.overrides[pid] : [];
      overrides[pid] = list.map(o => ({
        date: o.date,
        price: Number(o.price || 0),
        min_stay: o.min_stay != null ? Number(o.min_stay) : null,
        max_stay: o.max_stay != null ? Number(o.max_stay) : null,
      })).filter(o => typeof o.date === 'string' && o.date.length === 10 && o.price > 0);
    }
  }
  const settings = {
    override_color: typeof raw.settings?.override_color === 'string' ? raw.settings.override_color : '#ffd1dc',
  };
  return { baseRates, seasons, overrides, settings };
}

export function seasonPercentForDate(date, seasons) {
  const d = new Date(date + 'T00:00:00');
  let seasonPct = 0;
  for (const s of seasons || []) {
    if (!s.start || !s.end) continue;
    const sd = new Date(s.start + 'T00:00:00');
    const ed = new Date(s.end + 'T00:00:00');
    if (d >= sd && d <= ed) seasonPct += Number(s.percent || 0);
  }
  return seasonPct;
}

export function computeBaseForDate({ date, base, seasons, discountPct = 0 }) {
  let price = Number(base || 0);
  if (isNaN(price) || price <= 0) return null;
  const seasonPct = seasonPercentForDate(date, seasons);
  price = Math.floor(price * (1 + seasonPct / 100));
  if (discountPct) price = Math.floor(price * (1 - discountPct));
  return price;
}

export function computeDiscountPct({ date, today = new Date(), windowDays = 30, startDiscountPct = 0.3, endDiscountPct = 0.01, startDate, endDate }) {
  const d = new Date(date + 'T00:00:00');
  const t0 = new Date(today.toDateString());
  const daysUntil = Math.floor((d - t0) / 86400000);
  if (daysUntil < 0) return 0;
  const effectiveWindow = Math.max(1, Number(windowDays || 30));
  if (daysUntil >= effectiveWindow) return 0;
  const startDec = Number(startDiscountPct || 0) / 100.0;
  const endDec = Number(endDiscountPct || 0) / 100.0;
  const progress = effectiveWindow > 1 ? daysUntil / (effectiveWindow - 1.0) : 0.0;
  return startDec + (endDec - startDec) * progress;
}

export function buildRatesFromRules({ propId, roomId, startDate, endDate, rules, settings }) {
  const out = [];
  const baseCfg = rules.baseRates[String(propId)] || rules.baseRates[propId] || null;
  if (!baseCfg) return out;
  const base = Number(baseCfg.base || baseCfg.baseRate || 0);
  const minRate = Number(baseCfg.min || baseCfg.minRate || 0);
  const weekendPct = Number(baseCfg.weekend_pct || 0);
  if (!base) return out;
  let losRules = Array.isArray(baseCfg.los) ? baseCfg.los.slice() : [];
  // Ensure non-overlapping, sorted tiers (defensive – saveRules also validates)
  losRules.sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0));
  for (let i = 1; i < losRules.length; i++) {
    const prev = losRules[i - 1];
    const cur = losRules[i];
    if (prev.max_days == null || cur.min_days <= prev.max_days) {
      throw new Error(`LOS tiers overlap for property ${propId}`);
    }
  }

  // iterate days inclusive
  const s = new Date(startDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  for (let d = new Date(s); d <= e; d = new Date(d.getTime() + 86400000)) {
    const ds = d.toISOString().slice(0, 10);
    // Overrides take precedence
    const ovrList = (rules.overrides && (rules.overrides[String(propId)] || rules.overrides[propId])) || [];
    const ovr = Array.isArray(ovrList) ? ovrList.find(o => o.date === ds) : null;
    if (ovr) {
      const de = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
      out.push({
        is_default: false,
        start_date: ds,
        end_date: de,
        price_per_day: Math.floor(Number(ovr.price)),
        min_stay: ovr.min_stay != null ? Number(ovr.min_stay) : 1,
        max_stay: ovr.max_stay != null ? Number(ovr.max_stay) : null,
        price_per_additional_guest: 0,
        additional_guests_starts_from: 0,
      });
      continue;
    }
    const discountPct = computeDiscountPct({ date: ds, windowDays: settings.windowDays, startDiscountPct: settings.startDiscountPct, endDiscountPct: settings.endDiscountPct });
    const baseAdj = computeBaseForDate({ date: ds, base, seasons: rules.seasons, discountPct });
    if (baseAdj == null) continue;
    const minClamp = Math.max(minRate || 0, settings.minPrice || 0);

    const tiers = [];
    for (const r of losRules) {
      tiers.push({ min_stay: r.min_days ?? 1, max_stay: r.max_days ?? null, percent: -Math.abs(r.percent) });
    }
    // Build rate entries per tier
    const de = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
    for (const t of tiers) {
      const discount = t.percent || 0; // negative values = discount
      let p = Math.floor(baseAdj * (1 + discount / 100));
      // Weekend uplift for Fri (5) and Sat (6)
      const day = d.getDay(); // Sun=0..Sat=6
      const isWeekend = day === 5 || day === 6;
      if (isWeekend && weekendPct) {
        p = Math.floor(p * (1 + Math.abs(weekendPct) / 100));
      }
      if (minClamp && p < minClamp) p = minClamp;
      out.push({
        is_default: false,
        start_date: ds,
        end_date: de,
        price_per_day: p,
        min_stay: t.min_stay ?? 1,
        max_stay: t.max_stay ?? null,
        price_per_additional_guest: 0,
        additional_guests_starts_from: 0,
      });
    }
  }
  return out;
}
