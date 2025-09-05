# AGENTS.md — Lodgify Price Updater (Web)

Purpose

This document is for AI agents and automation working in this repository. It explains what the project does, how to run and validate it, where state lives, guardrails to respect, and the patterns to follow when adding features or fixing bugs.

Project Overview

- What it is: A small web app to compute and post Lodgify day rates based on a rules file. It provides a calendar preview, seasonal adjustments, windowed discounts, optional LOS tiers, booking overlays, and an optional auto‑jitter scheduler.
- Tech: Node 18+ (ESM), Express server, vanilla JS UI served from `public/`.
- Data model: One rules file (default `price_rules.json`) drives all pricing. No baseline fetches — “rules‑only” mode.

Key Files (map)

- Server
  - `server.js`: Express routes, rules load/save, run‑update orchestration, booking import/sync, and auto‑jitter scheduler.
  - `src/logic.js`: End‑to‑end “run update” orchestration and payload writing.
  - `src/rules.js`: Rules IO, normalization/validation, season/discount/LOS computation; builds Lodgify payloads.
  - `src/jitter.js`: Computes small, randomized price adjustments for a few future dates.
  - `src/lodgify.js`: Lodgify API client helpers (properties, bookings, post rates).
- UI
  - `public/index.html`: Tabs for Calendar, Settings, Discounts, Properties, LOS, Seasons, Run.
  - `public/app.js`: Client logic: load/save rules, calendar preview (prices, seasons, bookings), discount window preview, overrides editor.
  - `public/styles.css`: Styles, including calendar and booking overlays.
- Data & examples
  - `price_rules.json`: Canonical rules file (default target of the UI).
  - `payload_logs/`: Saved Lodgify payloads (for inspection).
  - Generated/ignored JSON: `bookings_store.json`, `upcoming_bookings.json`, `all_bookings.json`, `data/app_state.json`.

How To Run (local)

1. Prereqs: Node 18+.
2. Install: `npm install`
3. Start: `npm start` then open http://localhost:3000
4. Optional env (`.env` or UI):
   - `LODGIFY_API_KEY` — required to call APIs or post rates (can also be entered in the UI).
   - `PORT` — defaults to `3000`.
   - `BOOKING_SYNC_INTERVAL_MINUTES` — enable automated “updated since” sync (0 disables).
5. Lint/format: `npm run lint`, `npm run format` (or `npm run format:check`).

Runtime State, Memory, and Files

- Runtime state (server‑managed):
  - `data/app_state.json`: `{ activeRulesFile, lastSyncAtUtc, updatedAtUtc, version }`.
  - `bookings_store.json`: persistent, deduped “Booked” records only; removed on cancellation.
- Snapshots: `upcoming_bookings.json`, `all_bookings.json` for auditing.
- All above files are git‑ignored and may not exist until first run.
- Durable project memory for agents:
  - Keep this `AGENTS.md` current when you introduce new concepts or flows.
  - If a change needs deeper context, create short notes under `docs/` (e.g., `docs/adr-YYYYMMDD-<topic>.md`) and link them here.
  - Use informative commit messages and PR descriptions as ephemeral memory.

Domain Model (rules summary)

- `baseRates[<propertyId>]` fields (normalized in `src/rules.js`):
  - `base`, `min`, `weekend_pct` (Fri/Sat uplift), `max_discount_pct` (cap for discount curve),
    `price_per_additional_guest`, `additional_guests_starts_from`, `cleaning_fee`, `service_fee`,
    `min_profit_pct` (profit-based minimum clamp), optional `los` tiers.
- `seasons[]`: `{ name, start, end, percent, color }`. Percents add if overlapping.
- `global_los[]` (optional): shared LOS tiers applied to all properties when present.
- `overrides[<propertyId>][]`: exact dates with `{ date, price, min_stay?, max_stay? }`.
- `settings`: UI + scheduler options including `override_color`, `auto_jitter_enabled`, jitter parameters, and channel fee/uplift sliders used by the calendar tooltip.
  - Optional Fee Fold‑In: `fold_fees_into_nightly` (bool), `fold_include_cleaning` (bool), `fold_include_service` (bool).

Pricing Flow (high level)

1. Build a required default Lodgify rate row (`is_default: true`) with the Base Rate and min/max stay 2..30.
2. Iterate dates from start..end (inclusive), applying:
   - Overrides (if any) — take precedence and emit one‑day rate block.
   - Season percent adjustments.
   - Discount window curve (start→end %) capped by `max_discount_pct` (if > 0).
   - LOS tier discounts (global or per property), weekend uplift for Fri/Sat.
   - Optional jitter (per‑day percent).
   - Optional Fee Fold‑In: add per‑night share of Cleaning/Service by LOS min_stay.
   - Final min‑price clamp: highest of per‑property `min`, global Minimum Price (Discounts tab),
     and Profit‑based minimum computed from `(cleaning_fee + service_fee) / LOS.min_stay`:
       - If fold‑in OFF → multiply by `(min_profit_pct / 100)` (profit only).
       - If fold‑in ON  → multiply by `(1 + min_profit_pct / 100)` (fees + profit).
3. Emit Lodgify payload rows with per‑additional‑guest pricing.

Endpoints (server)

- Health: `GET /api/health`
- Properties: `GET /api/properties`
- Run update: `POST /api/run-update` (computes today → +18 months; honors `dryRun`).
  - UI: Run tab exposes two actions — “Dry Run” (sends `dryRun: true`) and “Run Update” (posts rates).
- Rules: `GET /api/rules`, `POST /api/rules` (persists file and (re)schedules jitter).
- Bookings:
  - `GET /api/bookings/upcoming`, `GET /api/bookings/all`
  - `GET /api/bookings/sync-updates` (incremental, “updated since” with overlap)
  - `GET /api/bookings/store`, `GET /api/bookings/local`, `GET /api/bookings/sync-state`
  - `POST /api/bookings/merge` (merge arbitrary payload into persistent store)

Common Agent Tasks (and what to touch)

- Add a new per‑property rule field:
  - Normalize in `src/rules.js` (load/save paths).
  - Wire UI read/write in `public/app.js` (+ inputs in `public/index.html`).
  - Extend example in `price_rules.json` if helpful.
- Adjust pricing math:
  - Server‑side: `src/rules.js` (buildRatesFromRules), and mirror preview in `public/app.js`.
  - Keep default `is_default` row and max 18‑month window constraints.
  - Fee Fold‑In: add/change in `src/rules.js` and mirror in `public/app.js`. Do not alter day overrides.
- Booking overlays or store fields:
  - Normalize incoming fields in `server.js::toRecord` and keep the UI read‑only for PII.
- Auto‑jitter changes:
  - Update `src/jitter.js` and scheduler in `server.js`.
  - Configure via rules `settings` only (no new env vars).

Guardrails

- Privacy: Do not show or store PII in the UI; the calendar labels bands as “Booked”.
- Secrets: Never expose `LODGIFY_API_KEY` to the client; the UI may accept a key for server use only.
- Date range: Hard cap at 18 months inclusive of the start date.
- Lodgify payload: Always include a first `is_default: true` row; per‑day rows follow.
- Generated files: Don’t commit files that are in `.gitignore` (payload logs are ignored; use them locally for debugging).

Code Style & Conventions

- ESM modules, Node 18+. Keep changes minimal and consistent.
- Prefer clear names over cleverness; avoid one‑letter variables.
- UI is vanilla JS; keep event listeners colocated with the feature area and avoid frameworks.
- Use `rg` for search and small, targeted patches.
- Validate with `npm run lint` and `npm run format`.

How Agents Should Work (process)

1. Clarify the task and outline a short plan.
2. Make focused changes with small, reviewable diffs.
3. Update `AGENTS.md` or `docs/` when introducing new rules or flows.
4. Validate locally:
   - App loads; rules load/save round‑trip; calendar preview reflects changes.
   - If posting rates, run with a valid API key and default dry‑run first.
5. Commit with an informative message and push. Avoid committing generated JSON.

Verification Checklist (quick)

- `npm start` runs without errors on Node 18+.
- `GET /api/health` responds OK.
- UI can load/save the configured `rulesFile`.
- Calendar reflects seasons, discount window, weekend uplift, and overrides.
- Booking overlays render without PII; store endpoints respond.
- Auto‑jitter: disabled by default; enabling schedules and logs runs.

Troubleshooting

- Bad API responses during import: restart the server and verify the API key; the UI logs non‑JSON responses to aid debugging.
- No prices: ensure `price_rules.json` has `baseRates` entries for selected properties.
- “LOS overlap” or “Invalid rulesFile”: server returns 400; fix tiers or file path.

References

- Getting Started for Codex Agents (memory & docs): https://github.com/openai/codex/blob/main/docs/getting-started.md#memory--project-docs
- Agents.md pattern and best practices: https://agents.md/
