# AGENTS

This file is for AI agents working on this repository. It summarizes the
architecture, key flows, and guardrails so you can ship changes quickly and
correctly.

## Tech Stack
- Node.js 18+, Express server (`server.js`)
- Frontend: vanilla JS + HTML/CSS in `public/`
- Data files in project root (JSON), e.g. `price_rules.json`, `bookings_*`
- CI: GitHub Actions `ci.yml` runs `npm install`, `npm run lint`, `npm run format:check`

## Runbook
- Install deps: `npm install`
- Start dev: `npm start` (server on `http://localhost:3000`)
- Lint: `npm run lint`
- Format check: `npm run format:check`

## Tabs (UI)
- Calendar (default): price preview, month navigation, booked overlays, override editor (click/drag).
- Settings: API Key (`#apiKey`), Rules File (`#rulesFile`), Override Color (`#overrideColor`).
- Discounts: Window Days, Start/End % and Minimum Price.
- Properties: Per‑property Base/Min, weekend %, max discount % (cap for Discount tab only), additional guest pricing.
- LOS: Global LOS table (optional). If populated, it overrides per‑property LOS.
- Seasons: Seasonal ranges with percent and optional color.
- Run: Property multi‑select, Run Update, Import Upcoming/All, Sync Updates, Last Sync.

## Key Files
- `server.js`: Express routes
  - `/api/properties`: GET Lodgify properties
  - `/api/rules` GET/POST: load/save `price_rules.json`
  - `/api/run-update`: compute rates (today → +18 months), build payloads, optionally post to Lodgify
  - Bookings: `/api/bookings/{upcoming,all,store,local,sync-state,sync-updates,merge}`
  - Auto‑sync: enabled by `BOOKING_SYNC_INTERVAL_MINUTES` (env)
- `src/rules.js`:
  - `loadRules/saveRules/normalizeRules`
  - `buildRatesFromRules` builds payload items. IMPORTANT: prepends a required
    default entry `{ is_default: true, price_per_day=<Base>, min_stay:2, max_stay:30 }`.
  - Uses `rules.global_los` if present; else per‑property `los`.
- `public/app.js`: UI logic, calendar render, override editing, bookings overlays, tabs.

## Rules Schema (price_rules.json)
```
{
  "baseRates": {
    "<propertyId>": {
      "base": 275,
      "min": 100,
      "weekend_pct": 20,
      "max_discount_pct": 25,
      "price_per_additional_guest": 5,
      "additional_guests_starts_from": 2,
      "los": [ { "name":"Default 2-6 nights", "min_days":2, "max_days":6, "percent":0, "color":"#888" } ]
    }
  },
  "global_los": [ { "name":"Default 2-6 nights", "min_days":2, "max_days":6, "percent":0 } ],
  "seasons": [ { "name":"", "start":"YYYY-MM-DD", "end":"YYYY-MM-DD", "percent":5, "color":"#abc" } ],
  "overrides": { "<propertyId>": [ { "date":"YYYY-MM-DD", "price": 150, "min_stay":2, "max_stay":10 } ] },
  "settings": { "override_color":"#ffd1dc" }
}
```

Notes:
- `global_los` is optional. If present and non‑empty it applies to all properties
  and is used for payload building and calendar preview. If empty/absent, the
  per‑property `los` list is used.
- LOS tiers must not overlap. Validation throws on overlaps when saving.

## Payload Contract (Lodgify v1 rates)
- We send an array of rate items. The first MUST be the default catch‑all:
```
{ "is_default": true, "price_per_day": <Base>, "min_stay": 2, "max_stay": 30,
  "price_per_additional_guest": <num>, "additional_guests_starts_from": <num> }
```
- Specific per‑day items follow with `{ is_default:false, start_date, end_date, price_per_day, min_stay, max_stay, ... }`.
- Weekend uplift and discount window applied in `buildRatesFromRules`.

## Bookings
- Import endpoints fetch Lodgify v2 `/reservations/bookings` and assemble a
  local store:
  - Only `status == 'Booked'` is stored; non‑Booked updates remove that id.
  - `bookings_store.json` is the persistent deduped store used by the calendar.
  - Incremental sync via `updatedSince` with last timestamp stored in `bookings_sync.json`.

## 18‑Month Window Rule
- Server enforces today → +18 months (inclusive of start day). Client presents
  this range but server is source of truth.

## Coding Guidelines
- Keep changes surgical; match existing style.
- Prefer small, focused patches. Keep payload contract intact.
- Validate LOS for overlaps; don’t silently change unrelated behavior.
- Run `npm run lint` and `npm run format:check` before pushing.

## Common Pitfalls
- Null derefs if moving inputs: guard with `if (el)` before accessing `.value`.
- Always include the default `is_default:true` rate first.
- Bookings store UI expects only Booked; do not surface PII.

## Release Notes Template
- Features:
  - ...
- Fixes:
  - ...
- Docs:
  - ...
