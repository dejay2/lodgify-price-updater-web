import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchProperties } from './lodgify.js';
import { loadRules, buildRatesFromRules } from './rules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPropertyName(prop) {
  return prop?.name ?? `ID ${prop?.id ?? 'Unknown'}`;
}

function getRoomName(room) {
  return room?.name ?? `ID ${room?.id ?? 'Unknown'}`;
}

// Baseline/calendar pricing removed — rules-only mode

export async function runUpdate({ apiKey, settings, postRates, jitterMap = null }) {
  const logs = [];
  const log = (m) => logs.push(`[${new Date().toISOString()}] ${m}`);
  const summary = { success: 0, failed: 0, skipped: 0, dry_run: 0, logs };

  log('Fetching properties…');
  const allProps = await fetchProperties(apiKey);
  const selectedPropIds = settings.selectedPropertyIds?.length
    ? new Set(settings.selectedPropertyIds)
    : null;
  const propsToProcess = selectedPropIds
    ? allProps.filter((p) => selectedPropIds.has(String(p.id)))
    : allProps;

  if (!propsToProcess.length) {
    log('No properties to process');
    return { ...summary, note: 'No matching properties' };
  }

  // Validate inputs
  if (!settings.startDate || !settings.endDate) {
    throw new Error('startDate and endDate are required');
  }
  const sDate = new Date(String(settings.startDate) + 'T00:00:00');
  const eDate = new Date(String(settings.endDate) + 'T00:00:00');
  if (isNaN(sDate) || isNaN(eDate)) {
    throw new Error('Invalid startDate or endDate');
  }
  if (eDate < sDate) {
    throw new Error('endDate must be on/after startDate');
  }
  // Enforce max 18 months window (inclusive of start day; end must be < start + 18 months)
  const monthsDiff =
    (eDate.getFullYear() - sDate.getFullYear()) * 12 + (eDate.getMonth() - sDate.getMonth());
  const tooLong = monthsDiff > 18 || (monthsDiff === 18 && eDate.getDate() >= sDate.getDate());
  if (tooLong) {
    throw new Error('Date range exceeds 18 months. Please reduce the range.');
  }
  // Clamp and sanitize numeric settings
  settings.windowDays = Math.max(0, Number(settings.windowDays || 0));
  settings.startDiscountPct = Math.max(0, Math.min(100, Number(settings.startDiscountPct || 0)));
  settings.endDiscountPct = Math.max(0, Math.min(100, Number(settings.endDiscountPct || 0)));
  settings.minPrice = Math.max(0, Number(settings.minPrice || 0));

  // Load rules (base/min and seasons).
  let rules = null;
  try {
    rules = await loadRules(settings.rulesFile || 'price_rules.json');
  } catch (e) {
    log(`Rules not available: ${e.message}`);
  }
  log('Using rules mode (base/min + seasons)');

  // Merge runtime settings with rules.settings so server honors UI-toggles
  // for features like Fee Fold-In even when not explicitly included in body.
  const effectiveSettings = { ...(rules?.settings || {}), ...(settings || {}) };
  // Bridge snake_case ↔ camelCase for discount fields so persisted values work
  if (effectiveSettings.windowDays == null && effectiveSettings.window_days != null)
    effectiveSettings.windowDays = effectiveSettings.window_days;
  if (effectiveSettings.startDiscountPct == null && effectiveSettings.start_discount_pct != null)
    effectiveSettings.startDiscountPct = effectiveSettings.start_discount_pct;
  if (effectiveSettings.endDiscountPct == null && effectiveSettings.end_discount_pct != null)
    effectiveSettings.endDiscountPct = effectiveSettings.end_discount_pct;
  if (effectiveSettings.minPrice == null && effectiveSettings.min_price != null)
    effectiveSettings.minPrice = effectiveSettings.min_price;
  log(
    `Fee fold-in: ${effectiveSettings.fold_fees_into_nightly ? 'enabled' : 'disabled'} (cleaning=${
      effectiveSettings.fold_include_cleaning !== false
    }, service=${effectiveSettings.fold_include_service !== false})`
  );

  for (const prop of propsToProcess) {
    const pid = prop?.id;
    const rooms = prop.roomTypes?.length ? prop.roomTypes : prop.rooms || [];
    for (const room of rooms) {
      const rid = room?.id;
      const key = `${pid}-${rid}`;
      let rates = buildRatesFromRules({
        propId: pid,
        roomId: rid,
        startDate: settings.startDate,
        endDate: settings.endDate,
        rules: rules || { baseRates: {}, seasons: [] },
        settings: effectiveSettings,
        jitterMap: jitterMap || undefined,
      });
      const status = rates.length ? 'ok' : 'skipped_no_rates';

      const propName = getPropertyName(prop);
      const roomName = getRoomName(room);

      if (status !== 'ok') {
        log(`${propName}/${roomName}: skipped (${status})`);
        summary.skipped += 1;
        continue;
      }

      const payload = { property_id: pid, room_type_id: rid, rates };

      // Save payload for inspection
      try {
        const payloadDir = path.join(process.cwd(), 'payload_logs');
        await fs.mkdir(payloadDir, { recursive: true });
        const ts = new Date()
          .toISOString()
          .replaceAll(':', '')
          .replaceAll('-', '')
          .replace('T', '_')
          .slice(0, 15);
        const fname = path.join(payloadDir, `payload_${ts}_prop${pid}_room${rid}.json`);
        await fs.writeFile(fname, JSON.stringify(payload, null, 2), 'utf-8');
        log(`Saved payload: ${fname}`);
      } catch (e) {
        log(`Failed to write payload file: ${e.message}`);
      }

      if (settings.dryRun) {
        log(`${propName}/${roomName}: dry run`);
        summary.dry_run += 1;
        continue;
      }

      try {
        await postRates(apiKey, payload);
        log(`${propName}/${roomName}: updated successfully`);
        summary.success += 1;
      } catch (e) {
        log(`${propName}/${roomName}: update failed - ${e?.response?.status} ${e?.message}`);
        summary.failed += 1;
      }
    }
  }

  log('Done');
  return summary;
}
