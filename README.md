# Sleeper Auction Companion

A read-only companion for Sleeper NFL auction drafts. It turns public draft data,
league settings, projections, and a personal auction plan into live budget guidance.
Guest mode is the default: no account, database, or paid service is required.

## Quick start

Use Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`, then paste a Sleeper draft link, numeric draft ID,
or Sleeper username. Direct links and IDs are the most reliable option. Username
discovery searches recent NFL leagues and mock drafts, so older or private drafts
may not appear.

The app supports Sleeper auction drafts only. Snake drafts are rejected with a
clear explanation. Sleeper does not expose a dependable live nomination through
its public API, so the app focuses on completed purchases and lets the user select
the current player.

## Guest mode and privacy

Guest mode provides the complete setup, strategy, draft-room, CSV import, and
local-correction experience. The browser stores league setup, strategy, selected
roster, CSV overrides, and local corrections on that device. Clearing site data
removes them. When account sync is configured, a signed-out page loads only the
local Account button. Supabase, CAPTCHA, and the account implementation are not
downloaded or contacted unless the user opens Account or the browser already has
evidence of an account session.

The server reads Sleeper's public endpoints with `GET` requests. It never bids,
drafts, changes a league, or writes to Sleeper. The app does not store raw Sleeper
draft responses or draft history in a database. The repository contains compact
public player and projection snapshots; it does not contain Sleeper usernames or
league-member profiles.

## Projections and CSV overrides

The bundled free projection snapshot is in `data/projections/last-known.json`.
The draft room shows its source and update date and warns when it is stale.

Validate the checked-in snapshots:

```bash
node scripts/refresh-sleeper-players.mjs --check
node scripts/refresh-projections.mjs --check
```

Refresh them manually by running either script without `--check`. The scheduled
workflows in `.github/workflows/` perform the same refresh and commit a changed
snapshot. Review unexpected source or schema changes before accepting an update.

A local projection CSV may contain only these headers:

```text
player_id,name,team,position,pass_yd,pass_td,pass_int,rush_yd,rush_td,rec,rec_yd,rec_td,fum_lost
```

At least one supported statistic is required per row. Files are limited to 1 MB
and 5,000 rows, with no more than 2,000 uniquely matched overrides per import so
the result always fits the session limit. The file size is checked before the
browser reads it. `player_id` is the safest match. Without it, matching uses the
normalized name plus optional team and position. The import review separately
reports matched, unmatched, ambiguous, duplicate, and unsupported rows. An import
over the matched limit is rejected with guidance while unmatched and ambiguous
rows remain visible for review. Only uniquely matched rows become local overrides;
formulas and non-plain numeric statistics are rejected.

## Optional account sync

Account sync is optional and can use Supabase's free tier. Copy `.env.example` to
`.env.local`, then configure the complete account group:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_CAPTCHA_SITE_KEY`

The publishable key is preferred. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is supported only
as a legacy fallback; do not use a secret or service-role key. If any required
account value is absent or invalid, the app safely stays in guest mode.

Apply `supabase/migrations/202607250001_saved_strategies.sql` to the project. It
creates the saved-strategy table, ownership rules, storage limits, and the safe
save function. Configure Supabase magic-link email delivery and the matching
hCaptcha site/secret settings in the Supabase dashboard. For production volume,
use a dedicated SMTP provider rather than the default development mail limits.

Existing guest data is not uploaded automatically. After sign-in, saving a strategy
creates an account-owned copy; the local guest copy remains available on that
browser. Account sync stores strategy documents only—not raw Sleeper responses,
league rosters, draft history, projections, or CSV source files.

## Rate limiting and deployment

Without extra services, each server instance applies a conservative in-memory
limit to public Sleeper proxy routes. For a multi-instance deployment, configure
both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for shared limiting.
Client addresses are converted to keyed HMAC values before a shared-store key is
created; raw addresses are never sent to Upstash. Set `RATE_LIMIT_KEY_SECRET` to
an independent, stable deployment secret if desired. Otherwise a configured
Upstash token supplies the key, while local-only mode uses a per-process key.
Set `TRUST_PROXY=true` only behind a trusted proxy that replaces forwarded client
addresses. Set `TRUST_CLOUDFLARE=true` only when Cloudflare is the trusted edge.
Vercel's platform headers are recognized automatically.

Each origin rate-limit check is one atomic Upstash command. A drafting browser
polls every three seconds, so the upper-bound estimate is about 20 commands per
active draft minute before the short one-second public edge cache combines
simultaneous requests for the same draft. Setup and username discovery add roughly
one command each, and the daily cached player snapshot normally reaches origin
only on an edge miss. Persisting an upstream 429 circuit break costs one additional
command. Monitor Upstash command totals together with route 429, protection 503,
and Sleeper 429 counts. If the shared store is unavailable, upstream-backed routes
return a safe protection error; a single-instance deployment can deliberately
fall back to the bounded in-memory store by removing both Upstash variables.

Deploy as a standard Next.js application:

```bash
npm ci
npm run build
npm start
```

Keep `E2E_FIXTURES` unset in deployed environments. Fixture mode additionally
checks `NODE_ENV` and is unavailable in production even if the flag is present.
The app disables the framework banner and sends clickjacking, content-sniffing,
referrer, device-permission, and Content Security Policy headers. The policy
automatically includes the configured HTTPS Supabase origin and hCaptcha origins.
Production builds also send HSTS; local development does not.

Snapshot refresh workflows use only Node built-ins, pin official GitHub actions
to reviewed commit SHAs, serialize runs, and open a pull request instead of
pushing to the selected base branch. A manual `workflow_dispatch` therefore
requires permission to create a branch and pull request in the repository, and
targets the branch selected when the workflow is started.

### Dependency audit status

As of July 26, 2026, `npm audit --omit=dev` reports three high findings in the
production tree: Next is marked through its pinned PostCSS dependency and its
supported Sharp range. The latest published Next 16.2.12 package still declares
PostCSS 8.4.31 exactly and Sharp `^0.34.5`; the audited fixed releases fall outside
those declared ranges, while npm's suggested automatic fix is an unsafe downgrade
to Next 9.3.3. The full audit reports 12 high findings: those three production
entries plus nine entries in the development-only ESLint/configuration chain,
whose suggested fixes are also incompatible major changes or invalid downgrades.
No advisory is suppressed and no unsupported override is applied. Re-run both
audits during release monitoring and upgrade when the upstream packages publish
compatible dependency sets.

## Verification

Run the complete local release gate:

```bash
npm test
npm run typecheck
npm run lint
npm run build
node scripts/refresh-sleeper-players.mjs --check
node scripts/refresh-projections.mjs --check
npx playwright install chromium
npm run test:e2e
```

Browser tests use anonymized, deterministic fixtures. They exercise the full guest
journey, username discovery, setup and strategy choices, auction updates, CSV
matching, local corrections, stale/offline recovery, reload persistence,
responsive layouts, keyboard tabs, clean browser logs, and automated accessibility
checks. Fixture state is enabled only for development and automated tests.

Before a release, also perform this read-only live smoke check:

1. Open a known public completed auction by exact draft ID.
2. Confirm league settings, rosters, purchases, budgets, and projection labels load.
3. If a public mock auction is available, repeat with its exact ID.
4. Confirm browser network activity to Sleeper uses `GET` only.
5. Exercise offline/reconnect with the deterministic browser test, not a live draft.
6. Confirm guest browsing does not request Supabase or hCaptcha resources.

Do not commit live API responses, usernames, member profiles, environment files,
or production secrets.
