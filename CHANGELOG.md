# Changelog

All notable changes to Torn Market Edge are documented here.

The project uses semantic-style version numbers for public userscript releases.

## [0.2.1] - 2026-09-07

### Fixed

- Prevented long inventory/categories from exhausting Torn's shared per-user API quota.
- Torn API error 5 / HTTP 429 now triggers a global Market Edge cooldown instead of rendering repeated red errors on every row.
- Queued API work from an old SPA category is cancelled when the user switches categories, so stale rows no longer consume quota after navigation.

### Changed

- Reduced the Market Edge API budget from 45 to 20 new requests/minute to leave headroom for TornTools, Torn PDA and other tools using the same Torn user quota.
- Reduced concurrent API requests from 4 to 3 and staggered new request starts by 300 ms.
- List pages now analyze only the current viewport plus a modest look-ahead, with a maximum 12 nearby rows per scan.
- Scrolling automatically discovers and analyzes newly visible rows.
- Item Market fallback cache timing now matches Torn's 30-second global cache window.
- Rate-limit recovery is automatic; cached prices remain visible while fresh requests are paused.

## [0.2.0] - 2026-09-07

### Added

- SPA-safe inventory/category detection so tab changes do not require a page refresh.
- Incremental row discovery and annotation.
- Four-request bounded API concurrency.
- Internal 45 requests/minute API ceiling.
- In-flight API request deduplication.
- Fast `limit=20` Item Market snapshots for list-style pages.
- Deep `limit=100` Item Market analysis on detailed Item Market views.
- `cache_timestamp`/`cache_delay` aware caching.
- Persistent compact snapshots with stale-while-revalidate behavior.
- Batched item metadata lookup.
- Early filtering of unsupported equipment.
- Viewport-first request priority.
- Foreground-only DOM processing.
- Surface-specific compact inline UI.
- `comment=market-edge` on Torn API requests for easier API diagnostics.

### Changed

- Inventory analysis now loads multiple item prices in parallel instead of a one-second sequential waterfall.
- List pages render Market Edge information directly in each item row.

## [0.1.3] - 2026-09-07

### Fixed

- Inventory row detection now covers all visible inventory rows rather than only the last matching item.

### Changed

- Inventory intelligence moved onto the native quantity/name line.

## [0.1.2] - 2026-09-07

### Fixed

- Your Bazaar now reads the editable **Price per unit** instead of accidentally interpreting RRP as the current Bazaar price.

### Changed

- Bazaar, Inventory, Auction House and travel-shop output moved from a large bottom panel to compact inline annotations.

## [0.1.1] - 2026-09-07

### Fixed

- Inventory scanning excludes equipped items above the **Your items** inventory section.
- Replaced problematic display characters with ASCII-safe UI text for better mobile userscript compatibility.

## [0.1.0] - 2026-09-07

Initial pilot release with:

- Item Market analysis;
- Bazaar analysis and own-Bazaar pricing mode;
- Auction House commodity bid guidance;
- travel-shop comparisons;
- inventory resale guidance;
- fee-aware Item Market/Bazaar calculations;
- robust current-market anchor;
- local market history;
- conservative exit estimates;
- confidence/classification diagnostics;
- persistent settings;
- compliance safeguards.
