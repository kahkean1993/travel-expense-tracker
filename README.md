# Travel Expense Tracker

A mobile-first web app for recording trip spending, tracking a budget, splitting shared costs with travel companions and exporting an end-of-trip report. It runs entirely in the browser, works offline after the first visit, and can be installed as an app (PWA).

> **Your data stays on this device.** Version 1 stores everything in this browser's IndexedDB. It does **not** sync between your phone and laptop, or between people. Clearing browser data can erase it, so use **Settings & Backup → Download backup** regularly.

## Features

- **Trips**: create, edit, complete/reopen and delete trips (with confirmation). Each trip has a name, destination, dates, base currency (default MYR) and an optional budget. Trips never mix expenses.
- **Expenses**: amount and currency come first. Each expense has a description, date (defaults to today), category, payment method, an optional card or account nickname, payer, notes and split. You can add, view, edit, duplicate and delete expenses. There's also a "Save & add another" button for quick entry.
- **Currencies**: the common travel currencies (MYR, JPY, USD, CNY, THB, SGD, EUR, GBP, KRW, IDR, TWD, AUD) are listed, and you can enter any other valid ISO 4217 code. Exchange rates are entered manually as **"1 JPY = RM x"**, and the app suggests the last rate used for that currency on the trip. Every expense keeps its own saved rate; editing other expenses never recalculates history.
- **Search, filter and sort**: search by description or notes, filter by date range, category, payment method, payer and currency, and sort by date or amount.
- **Dashboard**: shows budget, spent, remaining (negative when over), % used, number of expenses, average per day, and spending by category and by day, with date and category filters. A quiet warning appears at 80% of the budget and a stronger one at 100%.
- **Splitting**: options are "just one person", "split equally", custom amounts or custom shares (weights). You see each person's share before saving. Custom amounts must match the total exactly. Leftover cents from an equal split are handed out one at a time in traveller order, so shares always add up exactly.
- **Balances and settlement**: for each person, paid − share = net balance. The app also suggests the fewest practical transfers to settle up. These are suggestions, not recorded payments.
- **Report**: a printable on-screen report (navigation and buttons are hidden when printed). It has trip details, budget difference, totals by category and by day, per-traveller balances, settlement suggestions and the full expense list with rates and splits.
- **Exports**: an Excel-compatible CSV (UTF-8 BOM, CRLF, RFC 4180 quoting, formula-injection guard) and a full JSON backup. Restoring a backup validates it, previews it, and then lets you either *add new trips* (merge) or *replace all data*.
- **Resilience**: a "Saving… / Saved" indicator that only says Saved after the write succeeds. Write failures show a visible error with recovery advice. Double taps can't create duplicate saves. After 20 changes, a gentle reminder suggests making a backup. On supported browsers you can ask the browser to protect stored data from automatic clearing.
- **Offline / PWA**: the app shell is precached by a service worker. After the first load you can open the app, view expenses and add expenses with no connection. An "Offline" badge appears when you're disconnected. When a new version is deployed, a banner offers to reload; the app never reloads by itself mid-entry.
- **Sample data**: Settings → Load sample data creates a fictional trip marked "Sample". You can remove it in one tap without touching your own trips.

## Getting started

Requirements: Node.js 22 (see `.nvmrc`) and npm.

```bash
npm install
npm run dev        # http://localhost:5173/
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server at `/` |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit and data-layer tests |
| `npm run check` | typecheck + lint + test |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |

To preview exactly as GitHub Pages will serve it:

```bash
BASE_PATH=/your-repo-name/ npm run build
BASE_PATH=/your-repo-name/ npm run preview   # http://localhost:4173/your-repo-name/
```

## Deploying to GitHub Pages

The workflow `.github/workflows/deploy.yml` installs dependencies, runs typecheck, lint and tests, builds with the right base path, and deploys `dist/` to Pages. It runs on every push to `main`; pull requests are built and checked but not deployed.

One-time setup in GitHub:

1. Create a repository (any name, e.g. `travel-expense-tracker`) and push this project to its `main` branch.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab). When the `deploy` job finishes, its summary shows the URL.

Published URL pattern:

- Project repository: `https://<your-username>.github.io/<repository-name>/`
- Repository named `<your-username>.github.io`: `https://<your-username>.github.io/`

The workflow derives `BASE_PATH` from the repository name automatically, so scripts, styles, the manifest, icons and the service worker all resolve under that subpath. Routes use hash URLs (`#/trips/…`), so refreshing any screen works without server rewrites.

## Backup and restore

- **Back up**: Settings & Backup → *Download backup* saves `travel-expenses-backup-YYYY-MM-DD.json`, which contains every trip, traveller, expense, exchange rate, share, category and preference. Store it somewhere safe.
- **Restore**: Settings & Backup → *Choose backup file*. The file is fully validated first (structure, currency codes, integer amounts, rates that reproduce the converted amounts, shares that add up, links between records). Nothing changes until you confirm one of these:
  - **Add new trips**: adds only trips whose IDs aren't already on this device, so existing trips are never overwritten. Custom categories with the same name as an existing one are merged into it. This is how you move a trip from one device to another.
  - **Replace all data**: deletes everything currently stored and loads the backup, in a single transaction. If it fails, nothing changes.
- **Moving between devices**: download a backup on device A, open the app on device B, then restore. There is no live sync in version 1.

## How money is handled

- Amounts are stored as **integers in the currency's minor unit** (sen for MYR, yen for JPY, etc.). The number of decimals comes from a fixed ISO 4217 table in `src/lib/money/money.ts` (MYR 2, IDR 2, JPY 0, KRW 0, KWD 3…), not from the browser, because browsers disagree (some report 0 decimals for IDR). Changing an entry in that table requires a data migration.
- Exchange rates are stored as **decimal strings** meaning "1 original currency = rate base currency" (up to 10 decimal places).
- Conversion uses **BigInt** arithmetic and rounds **half-up once**, at save time, to the base currency's precision. Totals are integer sums. No floating-point maths touches stored amounts.
- If the expense currency equals the trip base currency, the rate is forced to `1` and the amount is not converted.
- Display formatting uses `Intl.NumberFormat` in your browser's locale, so you may see "RM 12.50" or "MYR 12.50" depending on locale.

## Project structure

```
src/
  app/            App shell, navigation, hash router
  components/     Reusable UI (buttons, fields, dialogs, icons, status indicators)
  db/             Dexie schema + migrations note, repositories (data access layer), live-query hooks, save status
  features/
    trips/        Trip list and form
    expenses/     Expense list, form, detail; pure form validation (expenseDraft.ts)
    dashboard/    Dashboard and statistics (stats.ts)
    splitting/    Allocation & settlement maths (allocate.ts), travellers page
    reports/      Printable report
    settings/     Backup/restore UI, categories, sample data, backup reminder
  lib/
    money/        Currency precision, parsing, conversion, formatting
    export/       CSV export and JSON backup format/validation/restore
    dates.ts      Date display helpers
  types/          Domain model with storage conventions documented
  test/           Test setup and synthetic fixtures
```

All screens read and write through `src/db/repositories.ts`. A future cloud backend (e.g. Supabase) could replace that layer without rewriting the screens.

### Database migrations

The schema lives in `src/db/schema.ts` (`DB_SCHEMA_VERSION = 1`). To change it, add a new `db.version(n + 1).stores({...}).upgrade(...)` block. Never edit released versions. Then bump the constant, and if the backup shape changes, bump `BACKUP_FORMAT_VERSION` in `src/lib/export/backup.ts` and teach `parseBackup` to read older files.

## Assumptions and decisions

- **Hash-based routing** so GitHub Pages never returns 404 on refresh and nothing ends up in query strings except a duplicate-expense ID.
- **Travellers who appear in saved expenses can't be removed**, only renamed. This keeps past splits intact. Each expense also stores name snapshots of the payer and participants.
- **The base currency is locked once a trip has expenses**, because stored converted amounts are in that currency.
- **Custom categories are global** (available to all trips). Built-in categories can't be deleted. Custom ones can be renamed, or deleted while unused.
- **Shares (weights)** for custom splits are whole numbers from 1 to 1000. Custom amounts are entered in the trip base currency.
- **Average per day** = spent ÷ days from trip start to today (or to the end date for past trips). It isn't shown before the trip starts.
- **Settlement** uses a greedy largest-debtor → largest-creditor match. It always settles everyone in at most *n − 1* transfers. That is usually but not always the theoretical minimum.
- **Card/account nickname** fields reject long digit sequences so card numbers aren't stored by accident.
- **Remembering the last-opened trip** for navigation uses `localStorage`. This is optional; the app works without it.

## Testing

`npm test` runs 57 tests covering:

- money: precision, parsing and validation, conversion direction, half-up rounding, tiny amounts, mixed currencies, formatting
- splitting: equal and weighted remainders, custom amount validation, personal expenses, the payer's own share, balances summing to zero, and randomised settlement checks
- data layer (IndexedDB via `fake-indexeddb`): persistence after reopening, totals after add/edit/delete, cascade delete that leaves other trips alone, traveller protection, base currency lock, categories, traveller order
- backup: round-trip, merge never overwrites, invalid/newer/corrupted files rejected with data left untouched
- CSV escaping, formula guard and content
- expense form validation, and the router

A browser smoke test was also run manually against the production build in Chromium. It covered phone (360 px) and desktop widths, creating a trip, adding expenses, a double-tap save, reload persistence, settlement, CSV export, print layout, backup, invalid import, delete then restore, and offline reload plus adding an expense while offline. It is not part of the repository, so add Playwright if you want it in CI.

## Known limitations (version 1)

- No cloud sync, login or sharing. Data is per browser and per device; use backups to move it.
- Exchange rates are entered manually. There is no online rate lookup.
- iOS Safari may evict website data after a long period without use unless the app is added to the Home Screen. Keep backups.
- The offline badge relies on `navigator.onLine`, which some networks report imprecisely.
- Merge-restore adds whole trips only. It doesn't merge individual expenses into a trip that already exists.
