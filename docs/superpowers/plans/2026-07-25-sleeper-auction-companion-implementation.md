# Sleeper Auction Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, responsive companion that follows real and mock Sleeper auction drafts and continuously provides transparent, strategy-adjusted player values.

**Architecture:** A Next.js TypeScript application keeps the valuation engine independent from Sleeper, storage, and the interface. Next.js server routes normalize and cache Sleeper data, while guest settings live in versioned browser storage; Supabase is an optional repository for small saved preferences only.

**Tech Stack:** Next.js, React, TypeScript, Zod, TanStack Query, Zustand, Vitest, Testing Library, Playwright, optional Supabase

---

## Milestones and File Structure

1. **Foundation:** application shell, test harness, responsive design tokens.
2. **Valuation core:** scoring, replacement levels, VORP, dollar allocation, strategy adjustments, explanations.
3. **Data adapters:** documented Sleeper APIs, isolated projection feed, CSV import, normalized contracts.
4. **Draft state:** polling, deduplication, reconciliation, browser persistence.
5. **Product screens:** connect, setup, strategy, and live companion.
6. **Optional accounts and launch:** small Supabase adapter, accessibility, end-to-end verification, deployment documentation.

Key boundaries:

- `src/domain/valuation/` contains deterministic calculations and imports no framework code.
- `src/integrations/sleeper/` translates Sleeper responses into domain models.
- `src/integrations/projections/` normalizes built-in and CSV projections.
- `src/features/draft-session/` owns live draft state and reconciliation.
- `src/features/*/components/` owns user-facing screens.
- `src/persistence/` hides browser and Supabase storage behind one interface.
- `src/app/api/` exposes narrow cached server routes.

## Task 1: Application and Test Foundation

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `next-env.d.ts`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `tests/app/home-page.test.tsx`

- [ ] **Step 1: Initialize the package and install dependencies**

Run:

```bash
npm init -y
npm install next react react-dom zod @tanstack/react-query zustand papaparse clsx @supabase/supabase-js @supabase/ssr
npm install -D typescript @types/node @types/react @types/react-dom @types/papaparse eslint eslint-config-next vitest jsdom @vitejs/plugin-react @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test prettier
npm pkg set private=true
npm pkg set scripts.dev="next dev"
npm pkg set scripts.build="next build"
npm pkg set scripts.start="next start"
npm pkg set scripts.lint="next lint"
npm pkg set scripts.typecheck="tsc --noEmit"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm pkg set scripts.test:e2e="playwright test"
```

Expected: `package.json` and `package-lock.json` exist and `npm install` completes without dependency errors.

- [ ] **Step 2: Create the TypeScript and Vitest configuration**

Create `vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
```

Create `vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = { reactStrictMode: true };
export default nextConfig;
```

- [ ] **Step 3: Write the first interface test**

Create `tests/app/home-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import HomePage from "@/app/page";

test("offers username and draft-link connection", () => {
  render(<HomePage />);
  expect(screen.getByRole("heading", { name: "Own the room" })).toBeVisible();
  expect(screen.getByLabelText("Sleeper username or draft link")).toBeVisible();
  expect(screen.getByRole("button", { name: "Connect draft" })).toBeEnabled();
});
```

- [ ] **Step 4: Run the test and verify it fails**

Run: `npm test -- tests/app/home-page.test.tsx`

Expected: FAIL because `src/app/page.tsx` does not exist.

- [ ] **Step 5: Add the application shell**

Create `src/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <section aria-labelledby="hero-title">
      <p>Auction intelligence for Sleeper</p>
      <h1 id="hero-title">Own the room</h1>
      <form>
        <label htmlFor="draft-reference">Sleeper username or draft link</label>
        <input id="draft-reference" name="draftReference" />
        <button type="submit">Connect draft</button>
      </form>
    </section>
  );
}
```

Create `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auction Room",
  description: "Live auction values for Sleeper drafts",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <main id="main-content">{children}</main>
      </body>
    </html>
  );
}
```

Define color, spacing, typography, focus, light, and dark tokens in `src/app/globals.css`; keep page-specific layout out of the global file.

- [ ] **Step 6: Verify the foundation**

Run:

```bash
npm test -- tests/app/home-page.test.tsx
npm run typecheck
npm run build
```

Expected: one passing test, no TypeScript errors, and a successful production build.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts next-env.d.ts vitest.config.ts vitest.setup.ts src/app tests/app
git commit -m "chore: scaffold auction companion"
```

## Task 2: Domain Contracts and League Normalization

**Files:**
- Create: `src/domain/league/types.ts`
- Create: `src/domain/league/defaults.ts`
- Create: `src/domain/players/types.ts`
- Create: `src/domain/draft/types.ts`
- Create: `src/domain/strategy/types.ts`
- Create: `tests/domain/league-defaults.test.ts`

- [ ] **Step 1: Write failing contract tests**

Create `tests/domain/league-defaults.test.ts`:

```ts
import { createLeagueConfig } from "@/domain/league/defaults";

test("normalizes a 12-team half-PPR auction", () => {
  const league = createLeagueConfig({
    teams: 12,
    budget: 200,
    starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 },
    bench: 6,
    flex: [{ count: 1, eligible: ["RB", "WR", "TE"] }],
    receptionPoints: 0.5,
  });

  expect(league.rosterSize).toBe(15);
  expect(league.minBid).toBe(1);
  expect(league.scoring.reception).toBe(0.5);
  expect(league.flex[0].eligible).toEqual(["RB", "WR", "TE"]);
});

test("rejects a budget that cannot fill the roster", () => {
  expect(() =>
    createLeagueConfig({
      teams: 12,
      budget: 10,
      starters: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 },
      bench: 6,
      flex: [{ count: 1, eligible: ["RB", "WR", "TE"] }],
      receptionPoints: 0.5,
    }),
  ).toThrow("Budget must cover every roster slot");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/domain/league-defaults.test.ts`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Define stable domain types**

Define:

```ts
export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";
export type FlexSlot = { count: number; eligible: Position[] };
export type ScoringRules = {
  passYard: number;
  passTd: number;
  interception: number;
  rushYard: number;
  rushTd: number;
  reception: number;
  receivingYard: number;
  receivingTd: number;
  fumbleLost: number;
  positionReceptionBonus: Partial<Record<Position, number>>;
};
export type LeagueConfig = {
  teams: number;
  budget: number;
  minBid: number;
  starters: Record<Position, number>;
  bench: number;
  rosterSize: number;
  flex: FlexSlot[];
  scoring: ScoringRules;
  capKickerDefenseAtOne: boolean;
};
```

Define the remaining contracts exactly:

```ts
export type ProjectionStats = {
  passYards?: number;
  passTds?: number;
  interceptions?: number;
  rushYards?: number;
  rushTds?: number;
  receptions?: number;
  receivingYards?: number;
  receivingTds?: number;
  fumblesLost?: number;
};

export type PlayerProjection = {
  playerId: string;
  name: string;
  team: string | null;
  positions: Position[];
  stats: ProjectionStats;
  source: string;
  updatedAt: string;
};

export type DraftPurchase = {
  draftId: string;
  playerId: string;
  rosterId: number;
  amount: number;
  pickNo: number;
  createdAt: string | null;
  source: "sleeper" | "local";
  keeper: boolean;
};

export type TeamDraftState = {
  rosterId: number;
  name: string;
  remainingBudget: number;
  openSlots: number;
  playerIds: string[];
};

export type DraftSnapshot = {
  draftId: string;
  status: "pre" | "drafting" | "complete";
  type: "auction";
  league: LeagueConfig;
  teams: TeamDraftState[];
  purchases: DraftPurchase[];
  lastUpdatedAt: string;
};

export type PlayerPreference = "target" | "avoid" | "lock" | "neutral";

export type StrategyConfig = {
  id: string;
  name: string;
  archetype: "recommended" | "balanced" | "stars-and-scrubs" | "custom";
  starterBudgetShare: number;
  positionBudgets: Record<Position, number>;
  spendingCurve: number[];
  qbApproach: "auto" | "elite" | "value";
  teApproach: "auto" | "elite" | "value";
  rbBuild: "auto" | "hero" | "zero";
  minReserve: number;
  preferences: Record<string, PlayerPreference>;
  projectionOverrides: Record<string, number>;
  valueOverrides: Record<string, number>;
};
```

`createLeagueConfig` validates integer counts, derives roster size, applies standard scoring defaults, and rejects impossible budgets.

- [ ] **Step 4: Run domain verification**

Run:

```bash
npm test -- tests/domain/league-defaults.test.ts
npm run typecheck
```

Expected: both tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/domain tests/domain/league-defaults.test.ts
git commit -m "feat: define auction domain contracts"
```

## Task 3: Projection Scoring

**Files:**
- Create: `src/domain/valuation/score-projection.ts`
- Create: `tests/domain/score-projection.test.ts`

- [ ] **Step 1: Write scoring tests**

Create tests using one projection with 4,000 passing yards, 30 passing touchdowns, 10 interceptions, 300 rushing yards, 3 rushing touchdowns, 80 receptions, 1,000 receiving yards, 8 receiving touchdowns, and 2 lost fumbles.

Assert:

```ts
expect(scoreProjection(stats, halfPprScoring, "WR")).toBe(492);
expect(scoreProjection(stats, fullPprScoring, "WR")).toBe(532);
expect(scoreProjection(stats, tePremiumScoring, "TE")).toBe(572);
```

Also assert that missing statistics contribute zero and do not produce `NaN`.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/domain/score-projection.test.ts`

Expected: FAIL because `scoreProjection` is undefined.

- [ ] **Step 3: Implement scoring as a pure function**

Implement:

```ts
export function scoreProjection(
  stats: ProjectionStats,
  scoring: ScoringRules,
  position: Position,
): number {
  const value =
    (stats.passYards ?? 0) * scoring.passYard +
    (stats.passTds ?? 0) * scoring.passTd +
    (stats.interceptions ?? 0) * scoring.interception +
    (stats.rushYards ?? 0) * scoring.rushYard +
    (stats.rushTds ?? 0) * scoring.rushTd +
    (stats.receptions ?? 0) *
      (scoring.reception + (scoring.positionReceptionBonus[position] ?? 0)) +
    (stats.receivingYards ?? 0) * scoring.receivingYard +
    (stats.receivingTds ?? 0) * scoring.receivingTd +
    (stats.fumblesLost ?? 0) * scoring.fumbleLost;

  return Math.round(value * 10) / 10;
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/domain/score-projection.test.ts`

Expected: all scoring cases pass.

```bash
git add src/domain/valuation/score-projection.ts tests/domain/score-projection.test.ts
git commit -m "feat: score projections from league rules"
```

## Task 4: Replacement Levels and Flex Allocation

**Files:**
- Create: `src/domain/valuation/replacement-levels.ts`
- Create: `tests/domain/replacement-levels.test.ts`

- [ ] **Step 1: Write replacement-level tests**

Use a four-team league with one QB, one RB, one WR, one TE, one RB/WR/TE flex, and two bench spots. Supply descending projections at every position.

Assert:

```ts
expect(result.starterRanks).toEqual({
  QB: 4,
  RB: 6,
  WR: 6,
  TE: 4,
  K: 0,
  DEF: 0,
});
expect(Object.values(result.benchRanks).reduce((sum, rank) => sum + rank, 0))
  .toBe(28);
expect(result.benchRanks.RB).toBeGreaterThanOrEqual(result.starterRanks.RB);
expect(result.benchRanks.WR).toBeGreaterThanOrEqual(result.starterRanks.WR);
```

Add a test showing that already drafted players are removed before the remaining replacement projection is chosen.
Add a superflex test showing that QB demand rises when QB is included in an eligible flex slot.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/domain/replacement-levels.test.ts`

Expected: FAIL because `calculateReplacementLevels` is undefined.

- [ ] **Step 3: Implement deterministic allocation**

Implement fixed starter demand as `slot count × teams`. Allocate each league-wide flex opening to the highest projected eligible remaining player, incrementing that player's position demand. Allocate league-wide bench openings proportionally to starter demand across QB/RB/WR/TE, using largest remainders so the exact bench total is preserved. K and DEF receive bench demand only when no offensive positions exist.

Return:

```ts
export type ReplacementLevels = {
  starterRanks: Record<Position, number>;
  benchRanks: Record<Position, number>;
  starterPoints: Record<Position, number>;
  benchPoints: Record<Position, number>;
  replacementPlayerIds: Partial<Record<Position, string>>;
};
```

Clamp every bench rank to its starter rank or later and use zero points when a rank exceeds the available player pool.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/domain/replacement-levels.test.ts
npm run typecheck
```

Expected: all replacement and flex cases pass.

```bash
git add src/domain/valuation/replacement-levels.ts tests/domain/replacement-levels.test.ts
git commit -m "feat: calculate replacement levels"
```

## Task 5: Base VORP and Auction-Dollar Allocation

**Files:**
- Create: `src/domain/valuation/base-values.ts`
- Create: `src/domain/valuation/round-money.ts`
- Create: `tests/domain/base-values.test.ts`

- [ ] **Step 1: Write failing value tests**

Create a two-team, $20, four-player roster fixture with six eligible players and one completed $6 purchase.

Assert:

```ts
expect(sumRemainingValues(result)).toBe(sumOfRemainingTeamBudgets);
expect(result.get("elite-rb")?.baseValue).toBeGreaterThan(
  result.get("replacement-rb")?.baseValue ?? 0,
);
expect(result.get("undraftable-rb")?.baseValue).toBe(0);
expect(result.get("kicker")?.baseValue).toBeLessThanOrEqual(1);
expect(result.get("elite-rb")?.inflationMultiplier).toBeGreaterThan(1);
```

Add a rounding test proving that distributed integer recommendations exactly match the remaining dollar pool.
Add a keeper test proving that the keeper's cost reduces its team's budget and the keeper is excluded from the remaining player pool.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/domain/base-values.test.ts`

Expected: FAIL because `calculateBaseValues` is undefined.

- [ ] **Step 3: Implement blended VORP and live dollar allocation**

For every remaining player:

```ts
const starterVorp = Math.max(0, points - starterReplacementPoints);
const benchVorp = Math.max(0, points - benchReplacementPoints);
const blendedVorp =
  starterVorp * strategy.starterBudgetShare +
  benchVorp * (1 - strategy.starterBudgetShare);
```

Calculate:

```ts
remainingSpendable =
  sum(team.remainingBudget - team.openSlots * league.minBid);
```

Distribute `remainingSpendable` proportionally across positive blended VORP for the number of players needed to fill the remaining league rosters. Add the minimum bid only when presenting a draftable player's total value. Use largest-remainder rounding with stable player-ID tie-breaking so integer values exactly match the available pool.

Return decimal `baseValue`, integer `displayValue`, VORP components, replacement reference, and `inflationMultiplier = liveValue / preDraftValue`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- tests/domain/base-values.test.ts
npm run typecheck
```

Expected: allocation, minimum reserve, cap, and inflation tests pass.

```bash
git add src/domain/valuation/base-values.ts src/domain/valuation/round-money.ts tests/domain/base-values.test.ts
git commit -m "feat: allocate live auction values"
```

## Task 6: Strategy Adjustments, Legal Bids, and Explanations

**Files:**
- Create: `src/domain/valuation/adjust-values.ts`
- Create: `src/domain/valuation/engine.ts`
- Create: `src/domain/valuation/explanations.ts`
- Create: `tests/domain/valuation-engine.test.ts`

- [ ] **Step 1: Write strategy tests**

Assert that:

```ts
expect(target.adjustedValue).toBeGreaterThan(target.baseValue);
expect(avoid.adjustedValue).toBeLessThan(avoid.baseValue);
expect(heroRb.adjustments).toContainEqual(
  expect.objectContaining({ code: "HERO_RB" }),
);
expect(result.recommendedMaxBid).toBeLessThanOrEqual(result.maximumLegalBid);
expect(result.explanation).toContain("Target");
```

Add cases for stars-and-scrubs, balanced depth, position-budget pace, a filled position, a tier with one remaining player, manual value override, and insufficient reserve money.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/domain/valuation-engine.test.ts`

Expected: FAIL because `runValuationEngine` is undefined.

- [ ] **Step 3: Implement bounded adjustments**

Represent every change as:

```ts
export type ValueAdjustment = {
  code:
    | "POSITION_BUDGET"
    | "ROSTER_NEED"
    | "SCARCITY"
    | "SPENDING_CURVE"
    | "TARGET"
    | "AVOID"
    | "LOCK"
    | "MANUAL";
  label: string;
  delta: number;
};
```

Apply non-manual percentage adjustments with a combined bound of `-35%` to `+35%`. Use target `+8%`, avoid `-20%`, lock `+15%`, roster need up to `+12%`, scarcity up to `+10%`, and strategy/position-budget pacing up to `±15%`. A manual value override replaces the adjusted value and is labeled.

Set:

```ts
maximumLegalBid =
  team.remainingBudget - Math.max(0, team.openSlots - 1) * league.minBid;
recommendedMaxBid = Math.max(
  0,
  Math.min(Math.round(adjustedValue), maximumLegalBid),
);
```

Generate one sentence from the three largest absolute adjustments and preserve the full structured breakdown.

- [ ] **Step 4: Verify the complete valuation core**

Run:

```bash
npm test -- tests/domain
npm run typecheck
```

Expected: all domain tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain/valuation tests/domain/valuation-engine.test.ts
git commit -m "feat: adjust values for draft strategy"
```

## Task 7: Sleeper Draft Discovery and Normalization

**Files:**
- Create: `src/integrations/sleeper/schemas.ts`
- Create: `src/integrations/sleeper/client.ts`
- Create: `src/integrations/sleeper/parse-draft-reference.ts`
- Create: `src/integrations/sleeper/normalize-draft.ts`
- Create: `src/app/api/sleeper/users/[username]/drafts/route.ts`
- Create: `src/app/api/sleeper/drafts/[draftId]/route.ts`
- Create: `tests/integrations/sleeper.test.ts`

- [ ] **Step 1: Write adapter tests with recorded fixtures**

Cover:

```ts
expect(parseDraftReference("https://sleeper.com/draft/nfl/1234567890"))
  .toBe("1234567890");
expect(parseDraftReference("1234567890")).toBe("1234567890");
expect(() => parseDraftReference("not-a-draft")).toThrow("Invalid Sleeper draft");
expect(normalized.type).toBe("auction");
expect(normalized.purchases[0]).toMatchObject({
  playerId: "4046",
  rosterId: 3,
  amount: 42,
});
```

Test that snake drafts return an `UNSUPPORTED_DRAFT_TYPE` result and malformed purchase amounts are quarantined rather than treated as zero.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/integrations/sleeper.test.ts`

Expected: FAIL because the Sleeper adapter does not exist.

- [ ] **Step 3: Implement a validated read-only client**

Use documented endpoints:

```text
GET https://api.sleeper.app/v1/user/{username}
GET https://api.sleeper.app/v1/user/{userId}/drafts/nfl/{season}
GET https://api.sleeper.app/v1/draft/{draftId}
GET https://api.sleeper.app/v1/draft/{draftId}/picks
GET https://api.sleeper.app/v1/league/{leagueId}
GET https://api.sleeper.app/v1/league/{leagueId}/users
GET https://api.sleeper.app/v1/league/{leagueId}/rosters
GET https://api.sleeper.app/v1/players/nfl
```

Validate responses with Zod `.passthrough()` schemas so new Sleeper fields do not break parsing. Normalize auction amounts from pick metadata only when they are finite positive numbers.

- [ ] **Step 4: Add narrow server routes and caching**

The username route returns discoverable current-season auction drafts. The draft route returns normalized settings, users, teams, and purchases. Use `fetch` revalidation of one day for players, five minutes for league metadata, and two seconds for active draft picks. Return stable error codes and never expose raw upstream bodies.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/integrations/sleeper.test.ts
npm run typecheck
```

Expected: all parsing, normalization, and error cases pass.

```bash
git add src/integrations/sleeper src/app/api/sleeper tests/integrations/sleeper.test.ts
git commit -m "feat: connect and normalize Sleeper auctions"
```

## Task 8: Built-In Projections and CSV Overrides

**Files:**
- Create: `src/integrations/projections/types.ts`
- Create: `src/integrations/projections/sleeper-provider.ts`
- Create: `src/integrations/projections/csv-provider.ts`
- Create: `src/integrations/projections/match-player.ts`
- Create: `src/app/api/projections/route.ts`
- Create: `data/projections/last-known.json`
- Create: `scripts/refresh-projections.mjs`
- Create: `.github/workflows/refresh-projections.yml`
- Create: `tests/integrations/projections.test.ts`

- [ ] **Step 1: Write normalization and fallback tests**

Assert:

```ts
expect(normalized[0]).toMatchObject({
  playerId: "4046",
  stats: { passYards: 4100, passTds: 31 },
});
expect(csvResult.matched).toHaveLength(2);
expect(csvResult.unmatched).toEqual([
  expect.objectContaining({ sourceName: "Unknown Player" }),
]);
expect(await providerWithFailedUpstream.load()).toEqual(lastKnownSnapshot);
```

Also verify that a malformed or empty upstream response cannot overwrite the last valid snapshot.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/integrations/projections.test.ts`

Expected: FAIL because projection providers do not exist.

- [ ] **Step 3: Implement the isolated built-in provider**

Fetch:

```text
https://api.sleeper.com/projections/nfl/{season}?season_type=regular
```

Normalize only the statistical fields required by `scoreProjection`. The server route returns `{ source, updatedAt, stale, projections }` and sends:

```text
Cache-Control: public, s-maxage=21600, stale-while-revalidate=86400
```

If validation fails, load `data/projections/last-known.json` and set `stale: true`.

- [ ] **Step 4: Implement CSV matching**

Accept `player_id`, `name`, `team`, `position`, and supported stat columns. Match by Sleeper ID first; otherwise require normalized full name plus compatible position and team. Never match by name alone when more than one candidate exists. Return matched rows, unmatched rows, and ambiguous rows for user review.

- [ ] **Step 5: Add the free snapshot refresh**

`scripts/refresh-projections.mjs` fetches, validates, sorts by Sleeper player ID, and writes the normalized snapshot only when it contains at least 100 offensive players. The GitHub workflow runs daily in July and August and weekly otherwise, then commits a changed snapshot with `chore: refresh projection snapshot`.

Create `.github/workflows/refresh-projections.yml`:

```yaml
name: Refresh projections
on:
  workflow_dispatch:
  schedule:
    - cron: "17 9 * 7,8 *"
    - cron: "17 9 * 1-6,9-12 1"
permissions:
  contents: write
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: node scripts/refresh-projections.mjs
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/projections/last-known.json
          git diff --cached --quiet || git commit -m "chore: refresh projection snapshot"
          git push
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- tests/integrations/projections.test.ts
node scripts/refresh-projections.mjs --check
npm run typecheck
```

Expected: provider tests pass and `--check` validates without writing.

```bash
git add src/integrations/projections src/app/api/projections data/projections scripts .github/workflows/refresh-projections.yml tests/integrations/projections.test.ts
git commit -m "feat: add free projection providers"
```

## Task 9: Draft Reconciliation and Versioned Browser State

**Files:**
- Create: `src/features/draft-session/reconcile.ts`
- Create: `src/features/draft-session/store.ts`
- Create: `src/features/draft-session/use-draft-sync.ts`
- Create: `src/persistence/session-storage.ts`
- Create: `tests/features/draft-reconciliation.test.ts`
- Create: `tests/persistence/session-storage.test.ts`

- [ ] **Step 1: Write reconciliation tests**

Cover:

```ts
expect(reconcile(previous, sameResponse)).toBe(previous);
expect(reconcile(previous, delayedNewPick).purchases).toHaveLength(2);
expect(reconcile(previous, correctedPrice).purchases[0].amount).toBe(37);
expect(reconcile(previous, sleeperMatchesLocalCorrection).localCorrections)
  .toHaveLength(0);
```

Storage tests must restore version 1 state, migrate a version 0 strategy, and discard malformed JSON without crashing.

- [ ] **Step 2: Verify failure**

Run:

```bash
npm test -- tests/features/draft-reconciliation.test.ts tests/persistence/session-storage.test.ts
```

Expected: FAIL because reconciliation and persistence do not exist.

- [ ] **Step 3: Implement stable reconciliation**

Use a purchase identity of `draftId + playerId + rosterId`. Sort by pick number, then timestamp, then player ID. A changed Sleeper purchase replaces the old Sleeper record. Local corrections remain separate and visibly marked until Sleeper returns a matching authoritative record.

- [ ] **Step 4: Implement browser persistence**

Store only:

```ts
type StoredSessionV1 = {
  version: 1;
  draftId: string;
  strategy: StrategyConfig;
  preferences: Record<string, PlayerPreference>;
  localCorrections: DraftPurchase[];
  csvProjectionOverrides: PlayerProjection[];
  savedAt: string;
};
```

Validate on read, migrate explicit older versions, and expose `loadSession`, `saveSession`, and `clearSession`.

- [ ] **Step 5: Add live polling**

`useDraftSync` uses TanStack Query with a three-second interval while active, 30 seconds before the draft, and no interval after completion. On consecutive errors, keep the last data and back off to 5, 10, then 30 seconds. Expose `fresh`, `stale`, `offline`, `lastUpdatedAt`, and `retry`.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- tests/features/draft-reconciliation.test.ts tests/persistence/session-storage.test.ts
npm run typecheck
```

Expected: all reconciliation, migration, and recovery tests pass.

```bash
git add src/features/draft-session src/persistence tests/features tests/persistence
git commit -m "feat: persist and reconcile live draft state"
```

## Task 10: Connect, Setup, and Strategy Screens

**Files:**
- Create: `src/app/providers.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/draft/[draftId]/setup/page.tsx`
- Create: `src/app/draft/[draftId]/strategy/page.tsx`
- Create: `src/features/connect/components/connect-form.tsx`
- Create: `src/features/setup/components/league-review.tsx`
- Create: `src/features/strategy/components/strategy-builder.tsx`
- Create: `src/features/strategy/default-strategies.ts`
- Create: `tests/features/connect-flow.test.tsx`
- Create: `tests/features/strategy-builder.test.tsx`

- [ ] **Step 1: Write user-flow tests**

Test that a username search renders discovered auctions, a pasted mock-draft URL routes directly to setup, a snake draft displays the unsupported message, and invalid drafts preserve the user's input.

For strategy, assert that selecting stars-and-scrubs changes the round spending curve, target/avoid controls update preferences, position budgets must total the configured spend, and clicking “Enter draft room” persists the strategy.

- [ ] **Step 2: Verify failure**

Run:

```bash
npm test -- tests/features/connect-flow.test.tsx tests/features/strategy-builder.test.tsx
```

Expected: FAIL because the feature screens do not exist.

- [ ] **Step 3: Implement providers and connect flow**

Add one client-side provider for TanStack Query. `connect-form.tsx` accepts a single string, distinguishes username from draft reference, fetches normalized results, and sends the user to `/draft/{draftId}/setup`.

- [ ] **Step 4: Implement league review**

Display every imported setting with source labels. Permit local corrections for teams, budget, minimum bid, roster slots, flex eligibility, scoring, and K/DEF cap. Validate that roster size and budget are possible before allowing strategy setup.

- [ ] **Step 5: Implement strategy builder**

Provide recommended, balanced, stars-and-scrubs, and custom presets. Show starter/bench budget, position budgets, spending curve, QB/TE approach, RB build, minimum reserve, and player preferences. Update a compact projected roster blueprint immediately after every change.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- tests/features/connect-flow.test.tsx tests/features/strategy-builder.test.tsx
npm run typecheck
npm run build
```

Expected: tests pass and all routes build.

```bash
git add src/app src/features/connect src/features/setup src/features/strategy tests/features
git commit -m "feat: add draft setup and strategy flow"
```

## Task 11: Responsive Live Draft Companion

**Files:**
- Create: `src/app/draft/[draftId]/page.tsx`
- Create: `src/features/draft-room/components/draft-room.tsx`
- Create: `src/features/draft-room/components/current-player.tsx`
- Create: `src/features/draft-room/components/player-board.tsx`
- Create: `src/features/draft-room/components/my-roster.tsx`
- Create: `src/features/draft-room/components/league-rosters.tsx`
- Create: `src/features/draft-room/components/value-breakdown.tsx`
- Create: `src/features/draft-room/components/sync-status.tsx`
- Create: `src/features/draft-room/draft-room.module.css`
- Create: `tests/features/draft-room.test.tsx`

- [ ] **Step 1: Write draft-room behavior tests**

Assert that:

- base value, adjusted value, and maximum bid are distinct labels;
- a target explanation is visible on demand;
- a purchase removes the player and updates remaining money;
- stale synchronization displays the timestamp and retry button;
- local correction is labeled;
- position filters and search narrow the table;
- mobile tabs expose “Now,” “Players,” “My team,” and “League.”

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/features/draft-room.test.tsx`

Expected: FAIL because the draft room does not exist.

- [ ] **Step 3: Implement the shared draft-room model**

Run the valuation engine with the latest reconciled snapshot, projections, league settings, and strategy. Memoize by stable input versions. Pass small view models to components rather than raw API data.

- [ ] **Step 4: Implement laptop layout**

Use a three-region grid: player board, personal strategy rail, and league roster rail. Pin player names within the scroll area, preserve keyboard navigation, and keep filter/search controls visible. Do not use generic card grids for the dense player board.

- [ ] **Step 5: Implement phone layout**

Below 768px, show the current player, maximum bid, best fits, budget, and roster first. Replace the wide table with compact player rows and move league rosters behind a labeled tab. Avoid horizontal scrolling for core information.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- tests/features/draft-room.test.tsx
npm run typecheck
npm run build
```

Expected: draft-room tests pass and the production build succeeds.

```bash
git add src/app/draft src/features/draft-room tests/features/draft-room.test.tsx
git commit -m "feat: build responsive live draft companion"
```

## Task 12: Optional Supabase Saving Without Core Dependency

**Files:**
- Create: `src/persistence/saved-strategy-repository.ts`
- Create: `src/persistence/browser-strategy-repository.ts`
- Create: `src/persistence/supabase-strategy-repository.ts`
- Create: `src/integrations/supabase/client.ts`
- Create: `src/integrations/supabase/server.ts`
- Create: `src/features/account/components/account-menu.tsx`
- Create: `src/app/auth/callback/route.ts`
- Create: `supabase/migrations/202607250001_saved_strategies.sql`
- Create: `tests/persistence/strategy-repository.test.ts`
- Create: `tests/features/account-menu.test.tsx`

- [ ] **Step 1: Write repository contract tests**

Run the same suite against the browser repository and a mocked Supabase repository:

```ts
await repository.save(strategy);
expect(await repository.list()).toEqual([
  expect.objectContaining({ id: strategy.id, name: strategy.name }),
]);
await repository.remove(strategy.id);
expect(await repository.list()).toEqual([]);
```

Assert that missing Supabase environment variables select the browser repository and do not block draft setup.
Assert that the account menu is absent when Supabase is unconfigured, offers email sign-in when configured, and never blocks the guest connection form.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/persistence/strategy-repository.test.ts`

Expected: FAIL because the repositories do not exist.

- [ ] **Step 3: Implement the small persistence contract**

Expose only:

```ts
export interface SavedStrategyRepository {
  list(): Promise<SavedStrategy[]>;
  save(strategy: SavedStrategy): Promise<void>;
  remove(id: string): Promise<void>;
}

export type SavedStrategy = {
  id: string;
  name: string;
  strategy: StrategyConfig;
  createdAt: string;
  updatedAt: string;
};
```

Store profile ID, strategy JSON, timestamps, and no draft history or projection data. Use browser persistence unless both Supabase URL and anonymous key are configured and a session exists.

- [ ] **Step 4: Add optional email sign-in**

Render `account-menu.tsx` only when Supabase public environment variables exist. Guests can request a magic link, sign out, and save strategies after authentication. `src/app/auth/callback/route.ts` exchanges the one-time code and returns to the original page. Authentication errors stay inside the account menu and never disable the guest draft flow.

- [ ] **Step 5: Add the database policy**

The migration creates `saved_strategies(id, user_id, name, strategy, created_at, updated_at)`, limits `strategy` to 32 KB, adds an index on `user_id`, enables row-level security, and allows authenticated users to select, insert, update, and delete only their own rows.

Create `supabase/migrations/202607250001_saved_strategies.sql`:

```sql
create table public.saved_strategies (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  strategy jsonb not null
    check (octet_length(strategy::text) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saved_strategies_user_id_idx
  on public.saved_strategies(user_id);

alter table public.saved_strategies enable row level security;

create policy "owners select saved strategies"
  on public.saved_strategies for select
  using (auth.uid() = user_id);

create policy "owners insert saved strategies"
  on public.saved_strategies for insert
  with check (auth.uid() = user_id);

create policy "owners update saved strategies"
  on public.saved_strategies for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "owners delete saved strategies"
  on public.saved_strategies for delete
  using (auth.uid() = user_id);
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- tests/persistence/strategy-repository.test.ts tests/features/account-menu.test.tsx
npm run typecheck
```

Expected: repository contracts pass with and without Supabase configuration.

```bash
git add src/persistence src/integrations/supabase src/features/account src/app/auth supabase tests/persistence/strategy-repository.test.ts tests/features/account-menu.test.tsx
git commit -m "feat: add optional free-tier strategy saving"
```

## Task 13: Accessibility, Error Recovery, and Help

**Files:**
- Create: `src/features/help/components/methodology.tsx`
- Create: `src/features/errors/components/recovery-panel.tsx`
- Create: `src/features/draft-room/components/manual-correction.tsx`
- Create: `tests/features/recovery.test.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write recovery and accessibility tests**

Assert that:

- upstream failures keep last-known values visible;
- the stale message includes the last update time;
- retry is keyboard operable;
- manual corrections require player, team, and price;
- value changes are explained in text, not color alone;
- modal focus returns to the invoking control;
- live updates use a polite status region and never move focus.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/features/recovery.test.tsx`

Expected: FAIL because recovery components do not exist.

- [ ] **Step 3: Implement visible recovery**

Map stable error codes to plain-language guidance. Keep the last valid player board during connection failures. Permit a local purchase correction, clearly badge it, and allow removal. Add methodology help for projections, replacement levels, base values, adjustments, and maximum legal bids.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all tests pass and the app builds.

```bash
git add src/features/help src/features/errors src/features/draft-room/components/manual-correction.tsx src/app/globals.css tests/features/recovery.test.tsx
git commit -m "feat: add transparent recovery and help"
```

## Task 14: End-to-End Verification and Launch Readiness

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/guest-mock-draft.spec.ts`
- Create: `tests/e2e/mobile-draft-room.spec.ts`
- Create: `tests/fixtures/sleeper/mock-draft.json`
- Create: `tests/fixtures/sleeper/mock-picks-sequence.json`
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Add deterministic test mode**

Allow server routes to use recorded Sleeper and projection fixtures only when `E2E_FIXTURES=1` and `NODE_ENV !== "production"`. Production must ignore the flag.

- [ ] **Step 2: Write the guest mock-draft smoke test**

The test must:

```ts
await page.goto("/");
await page.getByLabel("Sleeper username or draft link")
  .fill("https://sleeper.com/draft/nfl/1234567890");
await page.getByRole("button", { name: "Connect draft" }).click();
await page.getByRole("button", { name: "Confirm league settings" }).click();
await page.getByRole("button", { name: "Stars & scrubs" }).click();
await page.getByRole("button", { name: "Enter draft room" }).click();
await expect(page.getByText("Recommended max")).toBeVisible();
await expect(page.getByText("Synced")).toBeVisible();
```

Advance the recorded picks and assert that rosters, budgets, base values, adjusted values, and maximum bids update.

- [ ] **Step 3: Write responsive verification**

At 390×844, verify that the “Now,” “Players,” “My team,” and “League” tabs are usable and no core region exceeds the viewport width. At 1440×900, verify that the player board, personal rail, and league rail are simultaneously visible.

- [ ] **Step 4: Document local and public operation**

`README.md` explains:

- installation and commands;
- supported Sleeper draft URL formats;
- projection source and CSV format;
- guest browser storage;
- optional Supabase environment variables and migration;
- the absence of stored draft history;
- how to disable accounts;
- projection refresh workflow;
- production smoke-test steps.

`.env.example` contains names only:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
E2E_FIXTURES=
```

- [ ] **Step 5: Run the full release gate**

Run:

```bash
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
git status --short
```

Expected:

- all unit and component tests pass;
- no TypeScript errors;
- production build succeeds;
- desktop and mobile Playwright tests pass;
- Git shows only the intended Task 14 files before commit.

- [ ] **Step 6: Perform a live read-only Sleeper smoke test**

With a real public auction draft ID, verify:

1. connection succeeds;
2. settings and purchases normalize;
3. no write request is made to Sleeper;
4. disconnecting the network leaves the last valid state visible;
5. reconnecting resumes updates without duplicate purchases.

Record the tested draft ID and result in the implementation notes without committing user-identifying data.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts tests/e2e tests/fixtures .env.example README.md
git commit -m "test: verify public auction companion"
```

## Final Verification Checklist

- [ ] Guest use works without Supabase environment variables.
- [ ] Both username lookup and pasted real/mock auction links work.
- [ ] Non-auction drafts fail clearly.
- [ ] League settings can be reviewed and corrected locally.
- [ ] Projection source, age, and stale state are visible.
- [ ] CSV matching reports unmatched and ambiguous rows.
- [ ] VORP, base value, adjusted value, and maximum bid are explainable.
- [ ] Every purchase recalculates values, budgets, scarcity, and roster needs.
- [ ] Duplicate, delayed, corrected, and locally corrected picks reconcile safely.
- [ ] Phone and laptop layouts pass automated and visual inspection.
- [ ] Full test, typecheck, build, and end-to-end suites pass.
- [ ] The app remains usable if optional account saving is disabled.
