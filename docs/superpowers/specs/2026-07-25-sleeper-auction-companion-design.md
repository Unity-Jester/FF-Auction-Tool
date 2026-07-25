# Sleeper Auction Companion — Product Design

**Date:** July 25, 2026  
**Status:** Approved for implementation planning

## Product Summary

Build a public, polished web companion for Sleeper fantasy-football auction drafts. It will work with both real Sleeper auctions and Sleeper-hosted auction mock drafts. It will not host a draft or submit bids.

The app's main job is to continuously recalculate player values from:

- the league's scoring, roster, flex, team-count, and auction-budget settings;
- value over replacement player (VORP/VBD);
- the user's roster-construction and spending goals;
- the players, money, and roster openings remaining in the live draft.

The product must feel premium on both phones and laptops. A guest can use the complete core experience without creating an account.

## Goals

1. Connect to a Sleeper auction by username or pasted draft link.
2. Support both real and mock Sleeper auction drafts.
3. Import league and draft settings when Sleeper exposes them.
4. Produce transparent base and strategy-adjusted player values.
5. Recalculate values and recommended maximum bids as the draft changes.
6. Support positional budgets, spending curves, roster builds, targets, avoids, locks, and manual adjustments.
7. Work well beside Sleeper on a laptop and as a focused companion on a phone.
8. Keep the core product viable without a paid database.

## Non-Goals for the First Release

- Hosting drafts or submitting bids to Sleeper
- An internal auction simulator or computer-controlled bidders
- Snake-draft support
- Permanent draft-history storage
- Social features, league chat, or commissioner tools
- Paid projection feeds
- A database dependency for guest use

## Primary User Flow

### 1. Connect

The user enters a Sleeper username or pastes a Sleeper draft URL/ID.

- Username lookup lists discoverable current-season auction drafts.
- Pasted draft links are the reliable fallback, especially for mock drafts that are not returned in a user's normal draft list.
- Non-auction drafts are clearly identified as unsupported.

### 2. Confirm league setup

The app displays imported team count, total budget, roster slots, flex eligibility, scoring, and draft status. The user can correct any missing or inaccurate values locally without changing Sleeper.

### 3. Set strategy

The user starts from a recommended strategy or adjusts:

- balanced, stars-and-scrubs, or custom spending curve;
- total starter and bench budgets;
- position budgets;
- elite/value preference for quarterback and tight end;
- hero-RB, zero-RB, or neutral running-back construction;
- target, avoid, and lock flags;
- individual projection or value adjustments;
- minimum reserve money and desired roster flexibility.

All controls immediately update the projected roster blueprint and player values.

### 4. Draft

The live companion shows:

- the nominated or most recently purchased player;
- base value, adjusted value, and recommended maximum bid;
- a short explanation of the adjustment;
- best available players and best fits for the user's roster;
- the user's remaining money, maximum legal bid, open slots, and budget pace;
- every team's roster, remaining money, and maximum legal bid;
- position scarcity, tier breaks, and remaining supply;
- synchronization health and time of the last update.

The user can manually correct an assignment or sale price locally if Sleeper is delayed or returns incomplete data.

## Responsive Experience

### Laptop

The desktop layout uses three coordinated regions:

1. a dense, searchable player board;
2. the user's roster, budget, blueprint, and recommendations;
3. a league-wide roster and budget view.

The layout prioritizes fast scanning, sortable values, keyboard-friendly filtering, and remaining visible while Sleeper is open beside it.

### Mobile

The phone layout prioritizes:

1. current nomination or latest purchase;
2. maximum bid and explanation;
3. best fits now;
4. the user's roster and budget;
5. searchable players.

League-wide details move to a separate tab or drawer. All important actions remain usable without horizontal table scrolling.

## Valuation Model

### Projection input

The first release uses cached Sleeper season projections as the built-in free source. Because that projection feed is not part of Sleeper's documented public API, it is isolated behind a replaceable provider interface and never called directly by every browser.

The service stores only the latest normalized projection snapshot and its source/update metadata. If the source is unavailable, the app serves the last valid snapshot and labels it stale. Users can import a CSV to replace or supplement the built-in projections for their session.

Sleeper's documented API remains the source of truth for player identity, league settings, draft details, and completed picks.

### Scoring

Raw statistical projections are converted to fantasy points with the league's scoring rules. Common standard, half-PPR, PPR, passing-touchdown, interception, and position-premium rules are supported. Unsupported scoring fields are shown clearly and can be corrected with local projection adjustments.

### Replacement levels

Replacement levels are calculated by position from:

- team count;
- required starter slots;
- flex eligibility;
- bench depth;
- remaining roster openings;
- already drafted and kept players.

Flex replacement is allocation-aware so the same remaining player supply is not counted twice.

### Base value

For each player:

1. calculate projected fantasy points;
2. subtract the appropriate replacement-player projection;
3. floor negative VORP at zero for auction-dollar allocation;
4. reserve the minimum legal money needed to fill all remaining roster slots;
5. distribute the remaining league-wide auction dollars in proportion to positive VORP;
6. respect optional $1 caps for kicker and defense.

This produces a base auction value tied to the actual league.

### Adjusted value

The adjusted value starts from the base value and applies bounded, explainable changes for:

- the user's position and starter/bench budgets;
- the selected spending curve;
- roster openings and positional need;
- target, avoid, and lock preferences;
- remaining tier supply and position scarcity;
- the user's remaining money and minimum reserve;
- live inflation or deflation from money and value remaining across the league;
- the opportunity cost of losing roster flexibility.

The recommended maximum bid is the lower of:

- the strategy-adjusted value; and
- the user's maximum legal bid after reserving at least $1 for every required open slot.

The app always preserves and displays the unadjusted base value. Every adjustment is presented as a short breakdown, so users can understand why a number moved.

### Recalculation

After each observed purchase or manual correction, the engine recalculates:

- remaining replacement levels;
- available VORP;
- dollars remaining;
- draft inflation or deflation;
- team maximum bids;
- position and tier scarcity;
- the user's roster needs;
- base values, adjusted values, and maximum bids.

The valuation engine is a pure, deterministic module that does not depend on the interface, Sleeper, or Supabase. The same input state must always produce the same output.

## System Design

### Web application

A responsive TypeScript web application provides setup, strategy, and live-draft screens. It can perform guest setup and retain the active session without an account.

### Sleeper adapter

A focused Sleeper adapter handles:

- user lookup;
- draft discovery;
- draft URL/ID parsing;
- league, roster, user, player, and draft metadata;
- completed auction picks and sale prices;
- normalized error and rate-limit responses.

The rest of the app consumes normalized draft data rather than Sleeper-specific response shapes.

### Draft synchronization

The server checks an active draft every few seconds with shared caching, backoff, and deduplication. Browsers do not independently hammer Sleeper.

Each update is converted into an ordered draft state. Duplicate responses do nothing. Delayed or corrected data replaces the affected purchase and triggers one deterministic recalculation.

### Valuation service

The valuation service accepts normalized league settings, projections, strategy settings, rosters, purchases, and remaining budgets. It returns player values, bid guidance, scarcity, roster needs, and explanation records.

### Projection provider

Projection ingestion is a replaceable adapter that normalizes player identity and projected statistics. It refreshes on a scheduled basis, validates the new snapshot, and keeps the last valid snapshot if refresh fails.

### Browser storage

Browser storage is the primary persistence layer for:

- active guest session;
- connected draft reference;
- strategy settings;
- player preferences and overrides;
- local corrections;
- imported CSV projections.

Storage is versioned so future releases can migrate or safely reset incompatible local data.

### Optional Supabase account layer

Supabase free tier provides optional account sign-in and synchronization for small records only:

- profile;
- saved league presets;
- saved strategies;
- player preferences.

The app does not store raw projection datasets, full Sleeper responses, pick-by-pick draft histories, or analytics event streams in Supabase. Draft state is reconstructed from Sleeper and browser storage.

The account feature is separated behind a persistence interface. It can be disabled if free-tier limits become a problem without affecting guest setup, valuation, or live synchronization.

## Failure Handling

### Sleeper is unavailable or rate-limited

- Keep the last valid draft state.
- Mark the connection as stale with the last successful update time.
- Back off automatically rather than repeatedly retrying.
- Allow manual refresh and local purchase correction.

### A mock draft is not discoverable

- Prompt for the Sleeper draft link or ID.
- Parse and validate the ID.
- Explain if the draft is private, invalid, unsupported, or not yet accessible.

### Projection refresh fails

- Continue with the last valid cached snapshot.
- Show its age and source.
- Keep CSV import available.
- Never replace a valid snapshot with empty or malformed data.

### Player matching fails

- Quarantine unmatched projection rows instead of assigning them by name alone.
- Match primarily with stable Sleeper player IDs and verified aliases.
- Show unmatched rows in CSV import so the user can resolve them.

### Local and Sleeper state disagree

- Sleeper remains authoritative for completed draft purchases.
- Local corrections are visibly marked.
- When Sleeper later supplies the corrected purchase, the user is shown the conflict and the local correction is retired if the records match.

## Privacy and Cost Controls

- No account is required for the core product.
- Sleeper usernames and draft IDs are used only to retrieve requested public draft data.
- Guest strategy information stays in the user's browser.
- Optional account records remain deliberately small.
- Server caching reduces calls to Sleeper and projection providers.
- Costly features such as stored draft history, large analytics pipelines, and raw data archives are excluded.
- The product must remain fully usable if Supabase is disabled.

## Accessibility

- All core flows are keyboard accessible.
- Status and value changes are not communicated by color alone.
- Tables have meaningful headers and mobile equivalents.
- Controls have explicit labels and touch targets suitable for phones.
- Live updates avoid stealing focus and provide a restrained announcement mechanism.
- Light and dark presentation both meet readable contrast targets.

## Testing Strategy

### Valuation tests

- deterministic VORP and dollar allocation;
- standard, half-PPR, PPR, superflex, and tight-end-premium scoring;
- shallow and deep leagues;
- flex allocation without double-counting;
- keeper and already-drafted players;
- minimum $1 roster reserve;
- kicker/defense caps;
- inflation and deflation;
- targets, avoids, locks, and budget strategies;
- recalculation after every purchase.

### Sleeper integration tests

- username lookup and draft discovery;
- real and mock auction draft links;
- missing, invalid, and non-auction drafts;
- completed, in-progress, and pre-draft states;
- auction prices and roster assignment;
- duplicate, delayed, and corrected responses;
- reconnecting midway through a draft;
- rate limiting and upstream outages.

### Interface tests

- guest setup through live companion;
- strategy changes updating values immediately;
- local correction and later reconciliation;
- search, sorting, filtering, and player flags;
- optional sign-in without blocking guest use;
- phone and laptop breakpoints;
- keyboard navigation and accessible status changes.

### Production smoke test

Before launch, complete a Sleeper auction mock from a guest session and verify that:

1. the draft connects by link;
2. settings are imported or corrected;
3. a strategy changes adjusted values;
4. purchases appear automatically;
5. rosters and budgets stay accurate;
6. values and maximum bids recalculate;
7. a reload restores the guest session;
8. the complete flow remains usable on phone and laptop.

## Completion Criteria

The first release is complete when a public guest user can connect to a real or mock Sleeper auction, configure a strategy, follow the draft reliably, and receive transparent recalculated values throughout the draft on both phone and laptop.

The release must pass the production smoke test, remain functional without Supabase, and recover visibly from Sleeper or projection-source interruptions.
