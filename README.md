# Travel Expense Tracker

A mobile-first web app for recording trip spending, tracking a budget, splitting shared costs with travel companions and exporting an end-of-trip report. It runs entirely in the browser, works offline after the first visit, and can be installed as an app (PWA).

> **Where your data lives.** Trips are stored in this browser's IndexedDB on this device. If shared trips are set up (see [Shared trips](#shared-trips)), you can sign in with your email and share a trip with 3–4 friends, who join with just a name; shared trips are also stored in your Supabase project and sync between members' devices. Trips you don't share never leave the device. Clearing browser data can erase local trips, so use **Settings & Backup → Download backup** regularly.

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
- **Look and feel**: a calm teal palette, colour-coded category icons, a budget card with a progress ring, and a bottom bar with one raised **Add** button (the less-used pages live under **More**). Subtle motion: totals count up, lists and screens fade in, bars fill, buttons respond to taps. All motion switches off when the phone's "reduce motion" setting is on. The screens pass an automated accessibility scan (axe, no violations) at phone and desktop widths.
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

## Settling up

The Home screen leads with **Settle up**: the fewest transfers that settle everyone. Tap **Mark paid** on a transfer (the full amount or part of it) and balances update; **Undo** removes a payment. Tap a person to see a line-by-line statement of why they owe or get back money. When everyone is settled you can mark the trip completed, which locks its expenses (reopen to change them). **Share summary** copies or shares a plain-text summary for your group chat. Pay in another currency by picking it in the Mark paid sheet (the rate can be fetched). **Share** sends a text summary and **Image** saves or shares a picture of it; the Report page lists recorded payments and prints to PDF. After the trip ends, Home reminds you while money is still owed. Home also shows spending pace against the budget, how much is safe to spend today, and progress against any per-category budgets set on the trip. The add-expense form remembers the last currency, payment method, payer and split for the trip.

## More features

- **Live exchange rates.** The add-expense and Mark paid forms have a **Use today's rate** button (European Central Bank reference rates via the free Frankfurter service; only the two currency codes are sent). It only fills the field: you can edit it, and it is a market rate, so it can differ from your card's. Offline, enter the rate yourself.
- **Repeat over days.** On a new expense, "Repeat for more days" creates one expense per day, either splitting the total (hotel nights) or charging the amount each day (a daily pass).
- **Split by item.** For a custom split, add each item, tick who had it, and optionally add a service charge or tax percentage. Everything adds up exactly.
- **Receipt photos.** Up to 3 photos per expense, shrunk on your phone to a few hundred KB. They stay on the device for personal trips; on shared trips they are uploaded to a private Supabase Storage bucket that only trip members can read. Photos are **not** included in the JSON backup.
- **Dark mode.** Settings → Preferences → Appearance: match the device, light or dark.

## Shared trips

Shared trips let several people record expenses for the same trip from their own phones. They are optional: without the settings below the app runs in local-only mode, exactly like version 1.

### How it works

**You (the owner), once per trip:**

1. Open the trip → **Split** tab → **Share with friends**. The first time, enter your email and open the sign-in link (or type the 6-digit code).
2. Tell the app which traveller you are. If that traveller is still called "Me", type your real name so friends see it on expenses.
3. Tap **Share with friends**, then **Send invite link**. The phone's share sheet opens (WhatsApp, Messages…); on a computer the message is copied instead. The same link works for everyone.

**Your friends:**

1. Tap the link. They see the trip name and the travellers.
2. Pick their name (or "I'm not on the list" and type it), then tap **Join trip**.

That's it: no email, no password, no app install. They land on the trip, their name is already set as "you", and it is the default payer when they add expenses.

**After that**

- **Everyone sees and edits the same trip.** Changes upload automatically and appear on other phones within seconds when online.
- **Offline still works.** Expenses are saved on the phone first and upload when the connection is back. The top bar shows "N to upload" while offline.
- **Conflicts:** if two people edit the same expense before syncing, the last edit to reach the server wins (the amounts and the split always stay together). Different expenses never conflict.
- **Owner and members:** the person who shared the trip is its owner. Only the owner can delete the trip (for everyone) or remove members. Members can leave a trip.
- **Removing someone** also switches the invite link off, so they can't rejoin with it. Create a new link for anyone else you still want to invite. **More options → Turn off invite link** does the same without removing anyone.
- **New phone?** A friend who joined without an email opens the invite link again and picks the same name; the old phone loses access.
- **Friends can't create or share their own trips** while joined without an email. Sign in with an email for that.
- **Signing out** removes shared trips from that device. Owners get them back by signing in again; friends who joined without an email need the invite link again. Trips you never shared are not affected.
- **Backups** still work. A restored trip is always a local, unshared copy.

The security rules live in the database (Row Level Security in `supabase/migrations`): people can only read or change trips they are a member of, and the publishable key in the app grants nothing on its own. Someone with the invite link can join as any listed friend name, which is why the link should only go to people you trust.

### Turn on shared trips (one-time setup, about 15 minutes)

You need a free [Supabase](https://supabase.com) account. The dashboard changes from time to time, so menu names may differ slightly from these steps.

1. **Create a project.** In Supabase, create a new project and choose a region near you (for Malaysia, Singapore). Save the database password somewhere safe; the app doesn't need it.
2. **Create the tables.** Open **SQL Editor** and run these four files, in this order, each pasted whole and run once. If you ran some earlier, run only the ones you haven't.
   1. [`supabase/migrations/20261021000000_shared_trips.sql`](supabase/migrations/20261021000000_shared_trips.sql): tables, security rules, realtime updates.
   2. [`supabase/migrations/20261022000000_join_by_name.sql`](supabase/migrations/20261022000000_join_by_name.sql): lets friends join with just a name.
   3. [`supabase/migrations/20261023000000_settlements.sql`](supabase/migrations/20261023000000_settlements.sql): recorded settlement payments, "added by" tracking, and locking of completed trips.
   4. [`supabase/migrations/20261024000000_extras.sql`](supabase/migrations/20261024000000_extras.sql): budgets per category, payments in other currencies, and receipt photos (a private Storage bucket).

   Supabase's security advisor may flag the `SECURITY DEFINER` functions; they are intentional (they let invites add members) and each one checks the caller.
3. **Allow the app's address for sign-in links.** Under **Authentication → URL Configuration**:
   - **Site URL:** `https://kahkean1993.github.io/travel-expense-tracker/`
   - **Redirect URLs:** add the same address, and `http://localhost:5173/` if you also run the app locally.
4. **Let friends join without an email.** Under **Authentication → Sign In / Providers**, switch on **Allow anonymous sign-ins** and save. Without it, friends see a message saying joining without an email is not switched on yet.
5. **(Recommended) Add the sign-in code to the email.** Under **Authentication → Email Templates → Magic Link**, include `{{ .Token }}` next to the link, for example `Your code: {{ .Token }}`. Then people whose email app opens links in a different browser can type the code instead.
6. **(Optional) Set up email sending.** Only you sign in by email now, so Supabase's built-in email service (a small number of emails per hour, meant for testing) is usually enough. If it becomes a problem, add your own SMTP provider under **Authentication → SMTP Settings** (providers such as Resend or Brevo have free tiers).
7. **Copy the connection details.** Under **Project Settings → API Keys** (or **Data API**), copy the **Project URL** and the **publishable key** (`sb_publishable_…`; on older projects, the `anon` key). Never use the `service_role` or secret key in the app.
8. **Give them to GitHub.** In the GitHub repository go to **Settings → Secrets and variables → Actions → Variables** and add two repository variables:
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = the publishable key
9. **Redeploy.** In the **Actions** tab, run the "Deploy to GitHub Pages" workflow again (or push any change). After it finishes, **Settings & Backup** shows **Account & shared trips**.

For local development, copy `.env.example` to `.env.local` and fill in the same two values.

### Costs and limits

- Supabase's free plan comfortably covers a few people sharing trips. Free projects are **paused after about a week without activity**; restore yours from the Supabase dashboard (no data is lost). While it is paused, the app keeps working offline and syncs once the project is back.
- Receipt photos count against the free plan's 1 GB of file storage (about 5,000 photos at the size this app produces), and viewing them counts towards the monthly bandwidth. The database limit (500 MB) is far away: expenses are about 1 KB each.
- Your email address is visible to the other members of trips you join. Friends who join without an email show only the name they picked.
- Anonymous sign-ins can in principle be created by anyone who finds your project's public key; they can't see or create anything (they can only join a trip with a valid invite link), but a flood of them would count against the free plan's monthly user limit. Supabase's CAPTCHA option can be enabled if that ever happens.

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
  components/     Reusable UI (buttons, fields, dialogs, icons, status indicators), visual language (look.ts, visuals.tsx)
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
  sync/           Shared trips: sync engine, Supabase adapter, sign-in and scheduling (cloud.ts)
  features/sharing/  Sign-in form, Share card, Join page, Account card
  types/          Domain model with storage conventions documented
  test/           Test setup, synthetic fixtures, in-memory sync server
supabase/
  migrations/     Database schema, security rules and invite functions
  tests/          Schema and security-rule tests (run in PGlite)
```

All screens read and write through `src/db/repositories.ts`. Writes to a shared trip also add an entry to a local outbox in the same transaction; `src/sync/engine.ts` uploads the outbox and downloads other members' changes.

### Database migrations

The schema lives in `src/db/schema.ts` (`DB_SCHEMA_VERSION = 2`; version 2 added the outbox and sync tables and marks existing trips as local). To change it, add a new `db.version(n + 1).stores({...}).upgrade(...)` block. Never edit released versions. Then bump the constant, and if the backup shape changes, bump `BACKUP_FORMAT_VERSION` in `src/lib/export/backup.ts` and teach `parseBackup` to read older files.

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

`npm test` runs 178 tests covering:

- money: precision, parsing and validation, conversion direction, half-up rounding, tiny amounts, mixed currencies, formatting
- splitting: equal and weighted remainders, custom amount validation, personal expenses, the payer's own share, balances summing to zero, and randomised settlement checks
- data layer (IndexedDB via `fake-indexeddb`): persistence after reopening, totals after add/edit/delete, cascade delete that leaves other trips alone, traveller protection, base currency lock, categories, traveller order
- backup: round-trip, merge never overwrites, invalid/newer/corrupted files rejected with data left untouched
- settling up: payments change balances and suggestions, partial payments and undo, per-person statements that match the balances, spending pace and safe-to-spend, remembered entry defaults, completed trips locking expenses, payments syncing between devices and in backups (older backups still restore)
- CSV escaping, formula guard and content
- expense form validation, and the router
- database schema and security rules (`supabase/tests`, run in PGlite, an in-process Postgres with a minimal stand-in for Supabase's `auth` schema): non-members and signed-out users see nothing, members can read and write, ownership can't be taken over, only the owner can delete, joining by picking a name or typing a new one (signed-out previews included), the owner's name can't be taken, people without an email can't create trips, invites can be revoked, share totals are enforced
- sync engine with two simulated devices against an in-memory server: sharing and joining, changes both ways with identical balances, offline queueing, unsent edits never overwritten, deletions, custom categories, rejected changes (retry/discard), joining by name, rejoining on a new phone, one reusable invite link, link switched off on removal, finishing an interrupted share, leaving and removal, sign-out, batching

What is **not** covered by automated tests: the real Supabase services (sign-in emails, the hosted Data API and Realtime). Check those by hand once your project is set up: sign in on two phones, share a trip, join it, and add an expense on each.

A browser smoke test was also run manually against the production build in Chromium. It covered phone (360 px) and desktop widths, creating a trip, adding expenses, a double-tap save, reload persistence, settlement, CSV export, print layout, backup, invalid import, delete then restore, and offline reload plus adding an expense while offline. It is not part of the repository, so add Playwright if you want it in CI.

## Known limitations

- Local-only trips stay per browser and per device; share a trip or use backups to move it.
- Shared-trip conflicts are resolved per expense, last edit wins; there is no edit history.
- Invite links can be used by anyone who has them until they expire (14 days) or are switched off. Switching off happens automatically when you remove someone.
- Custom categories used in a shared trip appear for other members as trip categories; renaming a category later doesn't rename it on other devices.
- Exchange rates are entered manually. There is no online rate lookup.
- iOS Safari may evict website data after a long period without use unless the app is added to the Home Screen. Keep backups.
- The offline badge relies on `navigator.onLine`, which some networks report imprecisely.
- Merge-restore adds whole trips only. It doesn't merge individual expenses into a trip that already exists.
