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
    // Max discount percent (applies only to Discount tab curve; does not affect LOS or seasons)
    rec.max_discount_pct = Number(
      rec.max_discount_pct ?? rec.maxDiscountPct ?? rec.discount_cap_pct ?? 0
    );
    // Additional guests pricing
    rec.price_per_additional_guest = Number(
      rec.price_per_additional_guest ?? rec.additional_guest_price ?? rec.ppag ?? 0
    );
    rec.additional_guests_starts_from = Number(
      rec.additional_guests_starts_from ?? rec.addl_from ?? rec.additional_guests_start ?? 0
    );
    // Per-property fees
    rec.cleaning_fee = Number(rec.cleaning_fee ?? rec.cleaningFee ?? rec.cleaning ?? 0);
    rec.service_fee = Number(rec.service_fee ?? rec.serviceFee ?? rec.service ?? 0);
    // Profit-based minimum price percent (per property)
    rec.min_profit_pct = Number(rec.min_profit_pct ?? rec.minProfitPct ?? 0);
    // Normalize LOS rules array
    let los = Array.isArray(rec.los)
      ? rec.los.map((x) => ({
          name: x.name || '',
          min_days: x.min_days != null ? Number(x.min_days) : (x.min ?? 1),
          max_days: x.max_days != null ? Number(x.max_days) : (x.max ?? null),
          percent: Number(x.percent || 0), // discount percent
          color: typeof x.color === 'string' ? x.color : '',
        }))
      : [];
    // sort by min_days
    los.sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0));
    // Validate and ensure no overlaps; fix obvious issues
    const cleaned = [];
    for (const x of los) {
      const minD = Math.max(1, Number.isFinite(x.min_days) ? x.min_days : 1);
      const maxD = x.max_days == null ? null : Math.max(minD, Number(x.max_days));
      const item = {
        name: x.name || '',
        min_days: minD,
        max_days: maxD,
        percent: Number(x.percent || 0),
        color: typeof x.color === 'string' ? x.color : '',
      };
      if (cleaned.length) {
        const prev = cleaned[cleaned.length - 1];
        const prevMax = prev.max_days;
        // Disallow overlaps: current min must be greater than previous max (if prev max exists)
        if (prevMax == null || minD <= prevMax) {
          if (opts.validate) {
            throw new Error(
              `LOS overlap for property ${pid}: ${prev.min_days}-${prev.max_days ?? '∞'} vs ${minD}-${maxD ?? '∞'}`
            );
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
  const seasons = Array.isArray(raw.seasons)
    ? raw.seasons.map((s) => ({
        name: s.name || '',
        start: s.start, // YYYY-MM-DD
        end: s.end, // YYYY-MM-DD
        percent: Number(s.percent || 0),
        color: typeof s.color === 'string' ? s.color : '',
      }))
    : [];
  // Global LOS (optional). If present, applies to all properties.
  let global_los = Array.isArray(raw.global_los)
    ? raw.global_los.map((x) => ({
        name: x.name || '',
        min_days: x.min_days != null ? Number(x.min_days) : (x.min ?? 1),
        max_days: x.max_days != null ? Number(x.max_days) : (x.max ?? null),
        percent: Number(x.percent || 0),
        color: typeof x.color === 'string' ? x.color : '',
      }))
    : [];
  global_los.sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0));
  const cleanedGlobal = [];
  for (const x of global_los) {
    const minD = Math.max(1, Number.isFinite(x.min_days) ? x.min_days : 1);
    const maxD = x.max_days == null ? null : Math.max(minD, Number(x.max_days));
    const item = {
      name: x.name || '',
      min_days: minD,
      max_days: maxD,
      percent: Number(x.percent || 0),
      color: typeof x.color === 'string' ? x.color : '',
    };
    if (cleanedGlobal.length) {
      const prev = cleanedGlobal[cleanedGlobal.length - 1];
      const prevMax = prev.max_days;
      if (prevMax == null || minD <= prevMax) {
        if (opts.validate) {
          throw new Error(
            `Global LOS overlap: ${prev.min_days}-${prev.max_days ?? '∞'} vs ${minD}-${maxD ?? '∞'}`
          );
        } else {
          continue;
        }
      }
    }
    cleanedGlobal.push(item);
  }
  global_los = cleanedGlobal;
  // Overrides per property
  const overrides = {};
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const pid of Object.keys(raw.overrides)) {
      const list = Array.isArray(raw.overrides[pid]) ? raw.overrides[pid] : [];
      overrides[pid] = list
        .map((o) => ({
          date: o.date,
          price: Number(o.price || 0),
          min_stay: o.min_stay != null ? Number(o.min_stay) : null,
          max_stay: o.max_stay != null ? Number(o.max_stay) : null,
        }))
        .filter((o) => typeof o.date === 'string' && o.date.length === 10 && o.price > 0);
    }
  }
  const settings = {
    override_color:
      typeof raw.settings?.override_color === 'string' ? raw.settings.override_color : '#ffd1dc',
    // Jitter settings (optional; UI-driven)
    auto_jitter_enabled: Boolean(raw.settings?.auto_jitter_enabled || false),
    jitter_interval_minutes: Math.max(5, Number(raw.settings?.jitter_interval_minutes || 60)),
    jitter_lookahead_days: Math.max(1, Number(raw.settings?.jitter_lookahead_days || 30)),
    jitter_block_near_days: Math.max(0, Number(raw.settings?.jitter_block_near_days || 2)),
    jitter_dates_per_run: Math.max(1, Number(raw.settings?.jitter_dates_per_run || 2)),
    jitter_markdown_min: Number(raw.settings?.jitter_markdown_min ?? 5),
    jitter_markdown_max: Number(raw.settings?.jitter_markdown_max ?? 8),
    jitter_markup_min: Number(raw.settings?.jitter_markup_min ?? 0),
    jitter_markup_max: Number(raw.settings?.jitter_markup_max ?? 2),
    jitter_seed_salt:
      typeof raw.settings?.jitter_seed_salt === 'string' ? raw.settings.jitter_seed_salt : '',
    // Channel fees / uplifts (numbers, default 0)
    airbnb_uplift_pct: Number(raw.settings?.airbnb_uplift_pct ?? 0),
    airbnb_addon_fee: Math.max(0, Number(raw.settings?.airbnb_addon_fee ?? 0)),
    booking_uplift_pct: Number(raw.settings?.booking_uplift_pct ?? 0),
    booking_addon_fee: Math.max(0, Number(raw.settings?.booking_addon_fee ?? 0)),
    oh_addon_fee: Math.max(0, Number(raw.settings?.oh_addon_fee ?? 0)),
    // Discounts (persisted)
    window_days: Math.max(0, Number(raw.settings?.window_days ?? raw.settings?.windowDays ?? 30)),
    start_discount_pct: Math.max(
      0,
      Math.min(
        100,
        Number(raw.settings?.start_discount_pct ?? raw.settings?.startDiscountPct ?? 30)
      )
    ),
    end_discount_pct: Math.max(
      0,
      Math.min(100, Number(raw.settings?.end_discount_pct ?? raw.settings?.endDiscountPct ?? 1))
    ),
    min_price: Math.max(0, Number(raw.settings?.min_price ?? raw.settings?.minPrice ?? 0)),
    // Fee fold-in (optional)
    fold_fees_into_nightly: Boolean(raw.settings?.fold_fees_into_nightly || false),
    fold_include_cleaning:
      raw.settings?.fold_include_cleaning != null
        ? Boolean(raw.settings.fold_include_cleaning)
        : true,
    fold_include_service:
      raw.settings?.fold_include_service != null
        ? Boolean(raw.settings.fold_include_service)
        : true,
    // Historic lead-in price (optional): when enabled, append a one-day rate row
    // for yesterday at a fixed price to influence channel "from" price displays.
    historic_lead_in_enabled: Boolean(
      raw.settings?.historic_lead_in_enabled || raw.settings?.historicLeadInEnabled || false
    ),
    historic_lead_in_price: Math.max(
      0,
      Number(raw.settings?.historic_lead_in_price ?? raw.settings?.historicLeadInPrice ?? 0)
    ),
    // Days back to apply the lead-in (default 1 = yesterday). Kept internal (no UI yet).
    historic_lead_in_days_back: Math.max(
      1,
      Number(raw.settings?.historic_lead_in_days_back ?? raw.settings?.historicLeadInDaysBack ?? 1)
    ),
  };
  return { baseRates, seasons, overrides, settings, global_los };
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

export function computeDiscountPct({
  date,
  today = new Date(),
  windowDays = 30,
  startDiscountPct = 0.3,
  endDiscountPct = 0.01,
  startDate,
  endDate,
}) {
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

export function buildRatesFromRules({
  propId,
  roomId,
  startDate,
  endDate,
  rules,
  settings,
  jitterMap,
}) {
  const out = [];
  const baseCfg = rules.baseRates[String(propId)] || rules.baseRates[propId] || null;
  if (!baseCfg) return out;
  const base = Number(baseCfg.base || baseCfg.baseRate || 0);
  const minRate = Number(baseCfg.min || baseCfg.minRate || 0);
  const weekendPct = Number(baseCfg.weekend_pct || 0);
  const maxDiscountPct = Number(baseCfg.max_discount_pct || 0);
  if (!base) return out;
  // Resolve fee fold-in options from runtime settings with fallback to rules.settings
  const ruleSettings = (rules && rules.settings) || {};
  const foldEnabled =
    (settings && settings.fold_fees_into_nightly) ?? ruleSettings.fold_fees_into_nightly ?? false;
  const foldIncludeCleaning =
    (settings && settings.fold_include_cleaning) ?? ruleSettings.fold_include_cleaning ?? true;
  const foldIncludeService =
    (settings && settings.fold_include_service) ?? ruleSettings.fold_include_service ?? true;
  // Precompute helper fns before output ordering
  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const nextDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

  // Default catch-all rate must be first. Lodgify requires an is_default=true
  // entry without dates. This is used for any dates not covered by specific
  // day entries. Price should be the Base Rate; min/max stay 2..30.
  {
    let defaultPrice = Math.floor(base);
    const profitFeesTotal = Number(baseCfg.cleaning_fee || 0) + Number(baseCfg.service_fee || 0);
    const minProfitPct = Math.max(0, Number(baseCfg.min_profit_pct || 0));
    // Default row uses 2 nights as the amortization reference
    const defaultNights = 2;
    // If folding fees into nightly, include fee share; profit clamp always uses both fees
    if (foldEnabled) {
      const feesTotal =
        (foldIncludeCleaning ? Number(baseCfg.cleaning_fee || 0) : 0) +
        (foldIncludeService ? Number(baseCfg.service_fee || 0) : 0);
      defaultPrice = Math.floor(base + (feesTotal > 0 ? feesTotal / defaultNights : 0));
    }
    // Apply min clamp(s) to default row as a safety floor
    const minClampDefault = Math.max(
      Number(baseCfg.min || 0) || 0,
      Number(settings?.minPrice || 0) || 0,
      minProfitPct > 0 && profitFeesTotal > 0
        ? Math.floor(
            (profitFeesTotal / defaultNights) *
              (foldEnabled ? 1 + minProfitPct / 100 : minProfitPct / 100)
          )
        : 0
    );
    if (minClampDefault && defaultPrice < minClampDefault) defaultPrice = minClampDefault;
    const row = {
      is_default: true,
      price_per_day: defaultPrice,
      min_stay: 2,
      max_stay: 30,
    };
    const addlPrice = Number(baseCfg.price_per_additional_guest || 0);
    const addlFrom = Number(baseCfg.additional_guests_starts_from || 0);
    if (addlPrice > 0 && addlFrom > 0) {
      row.price_per_additional_guest = addlPrice;
      row.additional_guests_starts_from = addlFrom;
    }
    out.push(row);
  }

  // Historic lead-in price: immediately follow the default row so payload stays in date order
  try {
    const leadInEnabled =
      (settings && (settings.historicLeadInEnabled ?? settings.historic_lead_in_enabled)) || false;
    const leadInPrice = Number(
      (settings && (settings.historicLeadInPrice ?? settings.historic_lead_in_price)) || 0
    );
    const daysBack = Math.max(
      1,
      Number(
        (settings && (settings.historicLeadInDaysBack ?? settings.historic_lead_in_days_back)) || 1
      )
    );
    if (leadInEnabled && isFinite(leadInPrice) && leadInPrice > 0) {
      const nowLocal = new Date();
      const today = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate());
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack);
      const end = nextDay(start);
      const ds = ymd(start);
      const de = ymd(end);
      const row = {
        is_default: false,
        start_date: ds,
        end_date: de,
        price_per_day: Math.floor(leadInPrice),
        min_stay: 2,
        max_stay: 2,
      };
      const addlPrice = Number(baseCfg.price_per_additional_guest || 0);
      const addlFrom = Number(baseCfg.additional_guests_starts_from || 0);
      if (addlPrice > 0 && addlFrom > 0) {
        row.price_per_additional_guest = addlPrice;
        row.additional_guests_starts_from = addlFrom;
      }
      out.push(row);
    }
  } catch {}
  let losRules =
    Array.isArray(rules.global_los) && rules.global_los.length
      ? rules.global_los.slice()
      : Array.isArray(baseCfg.los)
        ? baseCfg.los.slice()
        : [];
  // Ensure non-overlapping, sorted tiers (defensive – saveRules also validates)
  losRules.sort((a, b) => (a.min_days ?? 0) - (b.min_days ?? 0));
  for (let i = 1; i < losRules.length; i++) {
    const prev = losRules[i - 1];
    const cur = losRules[i];
    if (prev.max_days == null || cur.min_days <= prev.max_days) {
      throw new Error(`LOS tiers overlap for property ${propId}`);
    }
  }

  // iterate days inclusive using local dates
  const s = new Date(startDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  for (let d = new Date(s); d <= e; d = nextDay(d)) {
    const ds = ymd(d);
    // Overrides take precedence
    const ovrList =
      (rules.overrides && (rules.overrides[String(propId)] || rules.overrides[propId])) || [];
    const ovr = Array.isArray(ovrList) ? ovrList.find((o) => o.date === ds) : null;
    if (ovr) {
      const de = ymd(nextDay(d));
      out.push({
        is_default: false,
        start_date: ds,
        end_date: de,
        price_per_day: Math.floor(Number(ovr.price)),
        min_stay: ovr.min_stay != null ? Number(ovr.min_stay) : 1,
        max_stay: ovr.max_stay != null ? Number(ovr.max_stay) : null,
        price_per_additional_guest: Number(baseCfg.price_per_additional_guest || 0),
        additional_guests_starts_from: Number(baseCfg.additional_guests_starts_from || 0),
      });
      continue;
    }
    let discountPct = computeDiscountPct({
      date: ds,
      windowDays: settings.windowDays,
      startDiscountPct: settings.startDiscountPct,
      endDiscountPct: settings.endDiscountPct,
    });
    // Cap only the Discount tab’s curve using per-property max (if > 0)
    if (maxDiscountPct > 0) {
      const cap = Math.max(0, Math.min(1, maxDiscountPct / 100));
      discountPct = Math.min(discountPct, cap);
    }
    const baseAdj = computeBaseForDate({ date: ds, base, seasons: rules.seasons, discountPct });
    if (baseAdj == null) continue;
    const minClamp = Math.max(minRate || 0, settings.minPrice || 0);

    const tiers = [];
    for (const r of losRules) {
      tiers.push({
        min_stay: r.min_days ?? 1,
        max_stay: r.max_days ?? null,
        percent: -Math.abs(r.percent),
      });
    }
    // Build rate entries per tier
    const de = ymd(nextDay(d));
    for (const t of tiers) {
      const discount = t.percent || 0; // negative values = discount
      let p = Math.floor(baseAdj * (1 + discount / 100));
      // Weekend uplift for Fri (5) and Sat (6)
      const day = d.getDay(); // Sun=0..Sat=6
      const isWeekend = day === 5 || day === 6;
      if (isWeekend && weekendPct) {
        p = Math.floor(p * (1 + Math.abs(weekendPct) / 100));
      }
      // Apply optional jitter (per-property per-day percent), after LOS/weekend adjustments
      const j = jitterMap?.[String(propId)]?.[ds];
      if (typeof j === 'number' && isFinite(j) && j !== 0) {
        p = Math.floor(p * (1 + j / 100));
      }
      // Optional: fold cleaning/service fees into nightly based on LOS min_stay
      if (foldEnabled) {
        const feesTotal =
          (foldIncludeCleaning ? Number(baseCfg.cleaning_fee || 0) : 0) +
          (foldIncludeService ? Number(baseCfg.service_fee || 0) : 0);
        const nightsRef = Math.max(1, Number(t.min_stay ?? 1));
        if (feesTotal > 0 && nightsRef > 0) {
          p = p + Math.floor(feesTotal / nightsRef);
        }
      }
      // Profit-based minimum clamp (uses both fees as cost basis regardless of fold-in includes)
      const profitFeesTotal = Number(baseCfg.cleaning_fee || 0) + Number(baseCfg.service_fee || 0);
      const minProfitPct = Math.max(0, Number(baseCfg.min_profit_pct || 0));
      let profitMin = 0;
      if (minProfitPct > 0 && profitFeesTotal > 0) {
        const nightsRef = Math.max(1, Number(t.min_stay ?? 1));
        profitMin = Math.floor(
          (profitFeesTotal / nightsRef) *
            (foldEnabled ? 1 + minProfitPct / 100 : minProfitPct / 100)
        );
      }
      const finalFloor = Math.max(minClamp || 0, profitMin || 0);
      if (finalFloor && p < finalFloor) p = finalFloor;
      const row = {
        is_default: false,
        start_date: ds,
        end_date: de,
        price_per_day: p,
        min_stay: t.min_stay ?? 1,
        max_stay: t.max_stay ?? null,
      };
      const addlPrice = Number(baseCfg.price_per_additional_guest || 0);
      const addlFrom = Number(baseCfg.additional_guests_starts_from || 0);
      if (addlPrice > 0 && addlFrom > 0) {
        row.price_per_additional_guest = addlPrice;
        row.additional_guests_starts_from = addlFrom;
      }
      out.push(row);
    }
  }
  return out;
}
