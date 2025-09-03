Lodgify Price Updater — Web Version
===================================

This is a lightweight web app that computes Lodgify day rates from a single Base Rate + Min Rate per property and seasonal date ranges, then applies a discount window before posting — all via a browser UI backed by a Node/Express server.

Features
- Load Lodgify properties via your API key.
- Configure discount window, start/end discounts, min price, date range.
- Generate and save payloads under `payload_logs/` for inspection.
- Dry-run mode, or post updates to Lodgify `/v1/rates/savewithoutavailability`.
- Seasonal rules: define a single Base Rate and Min Rate per property, plus global seasonal date ranges with percentage adjustments and optional colors. At run time, the app computes each day’s price for the requested range (max 18 months) from Base ± Season % and then applies your discount window and min-rate clamp before posting. LOS tiers must be non-overlapping. If you want a default, put it in your `price_rules.json` (e.g., min 2, max 6 at 0%). The app does not hardcode defaults.

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
