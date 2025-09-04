# Lodgify Price Updater — Web

![CI](https://github.com/dejay2/lodgify-price-updater-web/actions/workflows/ci.yml/badge.svg)

A lightweight web app to compute Lodgify day rates from a base/min per property + seasonal rules and optional LOS tiers, preview in a calendar, and post updates via the Lodgify API.

- Quick start, features, and usage: see `README-WEB.md`.
- Recent additions:
  - Calendar booking overlays from Lodgify with color coding (no PII).
  - Import buttons for Upcoming and All bookings, plus incremental sync via updatedSince (UTC with seconds, `stayFilter=All`, 5‑minute overlap; optional auto‑sync via `BOOKING_SYNC_INTERVAL_MINUTES`).
  - Persistent `bookings_store.json` (Booked‑only) with automatic removal on cancel.
  - Consolidated runtime state in `data/app_state.json` (UTC with seconds) for `activeRulesFile` and `lastSyncAt`.
  - UI refactor: Settings (API key, rules file, override color), Discounts (window/start/end/min), Global LOS tab, Calendar as default.
  - Payload includes a required default `{ is_default: true }` entry to satisfy Lodgify API.
- License: MIT (see `LICENSE`).

Development

- Install Node 18+
- Install deps: `npm install`
- Start server: `npm start` and open http://localhost:3000
- Lint: `npm run lint`
- Format: `npm run format` (or check: `npm run format:check`)
