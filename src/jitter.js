import fs from 'fs/promises';
import path from 'path';

function fmtYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Simple seeded RNG (Mulberry32)
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function readBookingsStore() {
  try {
    const p = path.join(process.cwd(), 'bookings_store.json');
    const txt = await fs.readFile(p, 'utf-8');
    const j = JSON.parse(txt);
    return j && Array.isArray(j.items) ? j : { updatedAt: null, count: 0, items: [] };
  } catch {
    return { updatedAt: null, count: 0, items: [] };
  }
}

function dateRange(start, endExclusive) {
  const out = [];
  for (
    let d = new Date(start);
    d < endExclusive;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    out.push(fmtYmd(d));
  }
  return out;
}

function buildBookedDateSets(store) {
  const byProp = new Map();
  for (const it of store.items || []) {
    const pid = String(it.property_id ?? '');
    if (!pid) continue;
    const arr = it.arrival ? new Date(it.arrival + 'T00:00:00') : null;
    const dep = it.departure ? new Date(it.departure + 'T00:00:00') : null;
    if (!arr || !dep || isNaN(arr) || isNaN(dep) || dep <= arr) continue;
    const set = byProp.get(pid) || new Set();
    for (const ds of dateRange(arr, dep)) set.add(ds);
    byProp.set(pid, set);
  }
  return byProp;
}

export function buildJitterMapForHour({
  props = [],
  now = new Date(),
  config = {},
  bookedByProp = new Map(),
}) {
  const {
    lookaheadDays = 30,
    blockNearDays = 2,
    datesPerRun = 2,
    markdownMin = 5,
    markdownMax = 8,
    markupMin = 0,
    markupMax = 2,
    seedSalt = '',
  } = config || {};

  const jitterByProp = {};
  const hourKey = `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}_${now.getUTCHours()}`;
  const oddHour = now.getHours() % 2 === 1; // local odd/even hour

  for (const p of Array.isArray(props) ? props : []) {
    const pid = String(p?.id || '');
    if (!pid) continue;
    const booked = bookedByProp.get(pid) || new Set();
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + Math.max(0, blockNearDays)
    );
    const endEx = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + Math.max(1, lookaheadDays)
    );
    const candidates = [];
    for (
      let d = new Date(start);
      d < endEx;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
      const ds = fmtYmd(d);
      if (!booked.has(ds)) candidates.push(ds);
    }
    if (!candidates.length) continue;

    const seed = hashString(`${seedSalt}|${pid}|${hourKey}`);
    const rnd = mulberry32(seed);
    const picks = new Set();
    const maxPicks = Math.min(Math.max(1, datesPerRun), candidates.length);
    while (picks.size < maxPicks) {
      const idx = Math.floor(rnd() * candidates.length);
      picks.add(candidates[idx]);
    }
    for (const ds of picks) {
      let pct;
      if (oddHour) {
        const min = Math.min(markdownMin, markdownMax);
        const max = Math.max(markdownMin, markdownMax);
        pct = -(min + (max - min) * rnd());
        pct = Math.round(pct * 10) / 10; // 1 decimal place
      } else {
        const min = Math.min(markupMin, markupMax);
        const max = Math.max(markupMin, markupMax);
        pct = min + (max - min) * rnd();
        pct = Math.round(pct * 10) / 10;
      }
      if (!jitterByProp[pid]) jitterByProp[pid] = {};
      jitterByProp[pid][ds] = pct;
    }
  }
  return jitterByProp;
}

export async function computeJitterMap({ props, now, config }) {
  const store = await readBookingsStore();
  const booked = buildBookedDateSets(store);
  return buildJitterMapForHour({ props, now, config, bookedByProp: booked });
}
