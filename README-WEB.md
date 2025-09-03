Lodgify Price Updater — Web Version
===================================

This is a lightweight web app that computes Lodgify day rates from a single Base Rate + Min Rate per property and seasonal date ranges, then applies a discount window before posting — all via a browser UI backed by a Node/Express server.

Features
- Load Lodgify properties via your API key.
- Configure discount window, start/end discounts, min price, date range.
- Generate and save payloads under `payload_logs/` for inspection.
- Dry-run mode, or post updates to Lodgify `/v1/rates/savewithoutavailability`.
- Seasonal rules: define a single Base Rate and Min Rate per property, plus global seasonal date ranges with percentage adjustments and optional colors. At run time, the app computes each day’s price for the requested range (max 18 months) from Base ± Season % and then applies your discount window and min-rate clamp before posting. LOS tiers must be non-overlapping. If you want a default, put it in your `price_rules.json` (e.g., min 2, max 6 at 0%).
- Calendar preview: shows prices, season indicator bar, weekend hinting, and override highlights. You can drag‑select a date range to set overrides in bulk. Override background is translucent.
- Booking overlays: imports bookings from Lodgify and shows a thin “Booked” band per day on the calendar (Airbnb=red, Booking.com=blue, others=yellow). No PII is displayed.
- Persistent bookings store: only status "Booked" are stored; cancellations or non‑Booked updates remove entries from the store automatically.

Prerequisites
- Node.js 18+ recommended.
- Lodgify API Key.

Setup
1. Install dependencies:
   npm install

2. Create a `.env` in the project root (or paste the key in the UI):
   - Quick start: `cp .env.example .env` and then edit `.env` to add your real key.
   - Required entries:
     - `LODGIFY_API_KEY=your-api-key-here`
     - `PORT=3000`
   - Optional entries:
      - `BOOKING_SYNC_INTERVAL_MINUTES=15` to enable an automated incremental sync (0 disables).

3. Start the server:
   npm start

4. Open the app:
   http://localhost:3000

Usage
- Load Properties: Enter your API key (or leave blank to use `.env`) and click “Load Properties”.
- Select the properties to process.
- Adjust settings: window days, discounts, min price, start/end dates, and baseline options.
- Click “Run Update” to perform a dry run (default) or uncheck “Dry Run” to actually post rates.
- Seasonal Rules: set `Rules File` (default `price_rules.json`), pick a property and enter Base and Min rate; define one or more seasonal ranges with a percentage (additive if overlapping); click Save. When you Run Update, the app computes all day rates on-the-fly — no original/baseline rates are used.

Bookings import and calendar overlays
- Click “Import Upcoming Bookings” to fetch all upcoming bookings and save a snapshot to `upcoming_bookings.json`. All returned rows with status "Booked" are merged into `bookings_store.json` (dedupe by `id`).
- Click “Import All Bookings” to fetch historic + current + future (stayFilter=All) and merge Booked into the store. A snapshot of the fetch is saved to `all_bookings.json` for auditing.
- Click “Sync Updates (since last run)” to fetch only records changed since the last sync using `updatedSince=YYYY-MM-DD HH:mm`. The last sync time is tracked in `bookings_sync.json` and displayed under Run.
- The calendar reads from `bookings_store.json` and renders only status "Booked" dates. If a previously booked reservation is later cancelled, it is removed from the store on the next import/sync and disappears from the calendar.

Files created (ignored by git)
- `upcoming_bookings.json`, `all_bookings.json`: raw snapshots of fetches.
- `bookings_store.json`: persistent, deduped store of “Booked” records only.
- `bookings_sync.json`: tracks the last successful updatedSince timestamp.

Endpoints (server)
- `GET /api/bookings/upcoming` — fetch upcoming bookings (paginated) and merge Booked into store.
- `GET /api/bookings/all` — fetch all bookings (paginated) and merge Booked into store.
- `GET /api/bookings/store` — return the persistent store `{ updatedAt, count, items }`.
- `GET /api/bookings/sync-state` — return `{ lastSyncAt }`.
- `GET /api/bookings/sync-updates` — incremental sync with optional `since=YYYY-MM-DD HH:mm` and `size=N`.
- `POST /api/bookings/merge` — merge posted payload (array or `{items:[...]}`), storing Booked only and dropping non‑Booked entries that already exist.

Privacy
- The UI never shows guest names or PII. Booked bands render the word “Booked” only.

Tips
- If you see an “Unexpected token '<'” while importing, restart the server so routes are active; the UI now logs non‑JSON responses to help diagnosing authorization or network errors.

Notes
- Baseline is saved to `original_rates.json` (configurable) to avoid refetching each run.
- Generated rate payloads are saved under `payload_logs/`.
- The logic is ported from `lodgify_manager.py` (update_prices and baseline/calendar fetch) to JavaScript.

Troubleshooting
- If calls to Lodgify fail, confirm your API key, date ranges, and that your account has access to the endpoints used:
  - GET `/v1/properties`
  - POST `/v1/rates/savewithoutavailability`
- If prices don’t reflect rules, ensure that `price_rules.json` contains baseRates for your selected properties. The app is rules-only now — baseline/original rates are not read or used.
- Check the server console for detailed error messages.
