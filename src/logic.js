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

async function cleanupOldFiles({ dir, pattern, keep = 10 }) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && pattern.test(e.name))
      .map((e) => e.name)
      .sort();
    const excess = Math.max(0, files.length - keep);
    for (let i = 0; i < excess; i++) {
      const f = path.join(dir, files[i]);
      try {
        await fs.unlink(f);
      } catch {}
    }
  } catch {}
}

export async function runUpdate({
  apiKey,
  settings,
  postRates,
  jitterMap = null,
  savePayloads = true,
}) {
  const logs = [];
  const log = (m) => logs.push(`[${new Date().toISOString()}] ${m}`);
  const results = [];
  const summary = { success: 0, failed: 0, skipped: 0, dry_run: 0, logs, results };

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
        results.push({
          property_id: pid,
          room_id: rid,
          property_name: propName,
          room_name: roomName,
          status: 'skipped',
          reason: status,
        });
        continue;
      }

      const payload = { property_id: pid, room_type_id: rid, rates };
      let payloadPath = null;

      // Save payload for inspection (skip if disabled, e.g., auto-jitter)
      if (savePayloads) {
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
          payloadPath = fname;
          log(`Saved payload: ${fname}`);
          // Best-effort: keep only the latest N payload logs (default 10)
          const keepCount = Math.max(
            0,
            Number(process.env.PAYLOAD_LOGS_KEEP || process.env.LOGS_KEEP || 10) || 10
          );
          await cleanupOldFiles({
            dir: payloadDir,
            pattern: /^payload_\d{8}_\d{6}_prop.*_room.*\.json$/,
            keep: keepCount,
          });
        } catch (e) {
          log(`Failed to write payload file: ${e.message}`);
        }
      }

      if (settings.dryRun) {
        log(`${propName}/${roomName}: dry run`);
        summary.dry_run += 1;
        results.push({
          property_id: pid,
          room_id: rid,
          property_name: propName,
          room_name: roomName,
          status: 'dry_run',
          payload_path: payloadPath,
        });
        continue;
      }

      // Try posting; on 500s, progressively retry with safer payloads
      const postWithRetry = async () => {
        // Attempt 0: original payload
        try {
          await postRates(apiKey, payload);
          return { ok: true };
        } catch (e) {
          let status = e?.response?.status;
          let bodySnippet = '';
          try {
            const data = e?.response?.data;
            if (data != null) {
              const txt = typeof data === 'string' ? data : JSON.stringify(data);
              bodySnippet = String(txt).slice(0, 240);
            }
          } catch {}

          // Attempt 1: drop past-dated rows (keep is_default)
          const startDateStr = String(settings.startDate || '');
          if (status === 500 && startDateStr) {
            try {
              const filtered = Array.isArray(payload.rates)
                ? payload.rates.filter(
                    (r) => r.is_default || !r.start_date || r.start_date >= startDateStr
                  )
                : [];
              if (filtered.length && filtered.length !== payload.rates.length) {
                const payload2 = { ...payload, rates: filtered };
                await postRates(apiKey, payload2);
                return { ok: true, retried: true, mode: 'drop_past' };
              }
            } catch (e2) {
              status = e2?.response?.status || status;
              try {
                const d2 = e2?.response?.data;
                if (d2 != null) {
                  const t2 = typeof d2 === 'string' ? d2 : JSON.stringify(d2);
                  bodySnippet = String(t2).slice(0, 240) || bodySnippet;
                }
              } catch {}
            }
          }

          // Attempt 2: strip additional-guest fields from all rows
          if (status === 500) {
            try {
              const stripAddl = (r) => {
                const { price_per_additional_guest, additional_guests_starts_from, ...rest } =
                  r || {};
                return rest;
              };
              const payload3 = {
                ...payload,
                rates: Array.isArray(payload.rates) ? payload.rates.map(stripAddl) : [],
              };
              await postRates(apiKey, payload3);
              return { ok: true, retried: true, mode: 'strip_addl' };
            } catch (e3) {
              status = e3?.response?.status || status;
              try {
                const d3 = e3?.response?.data;
                if (d3 != null) {
                  const t3 = typeof d3 === 'string' ? d3 : JSON.stringify(d3);
                  bodySnippet = String(t3).slice(0, 240) || bodySnippet;
                }
              } catch {}
            }
          }

          // Attempt 3: default row only
          if (status === 500) {
            try {
              const onlyDefault = Array.isArray(payload.rates)
                ? payload.rates.filter((r) => r.is_default)
                : [];
              if (onlyDefault.length) {
                const payload4 = { ...payload, rates: onlyDefault };
                await postRates(apiKey, payload4);
                return { ok: true, retried: true, mode: 'default_only' };
              }
            } catch (e4) {
              status = e4?.response?.status || status;
              try {
                const d4 = e4?.response?.data;
                if (d4 != null) {
                  const t4 = typeof d4 === 'string' ? d4 : JSON.stringify(d4);
                  bodySnippet = String(t4).slice(0, 240) || bodySnippet;
                }
              } catch {}
            }
          }

          return { ok: false, status, bodySnippet };
        }
      };

      const res = await postWithRetry();
      if (res.ok) {
        let note = '';
        if (res.retried) {
          if (res.mode === 'strip_addl') note = ' (after stripping additional-guest fields)';
          else if (res.mode === 'default_only') note = ' (default row only)';
          else note = ' (after dropping past-dated rows)';
        }
        log(`${propName}/${roomName}: updated successfully${note}`);
        summary.success += 1;
        results.push({
          property_id: pid,
          room_id: rid,
          property_name: propName,
          room_name: roomName,
          status: res.retried ? `success_retry:${res.mode || 'drop_past'}` : 'success',
          payload_path: payloadPath,
        });
      } else {
        const bodySuffix = res.bodySnippet ? ` body=${res.bodySnippet}` : '';
        log(`${propName}/${roomName}: update failed - ${res.status} ${bodySuffix}`);
        summary.failed += 1;
        results.push({
          property_id: pid,
          room_id: rid,
          property_name: propName,
          room_name: roomName,
          status: 'failed',
          error_status: res.status,
          error_message: 'post failed',
          error_body_snippet: bodySuffix,
          payload_path: payloadPath,
        });
      }
    }
  }

  log('Done');
  return summary;
}
