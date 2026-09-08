# Changelog

All notable changes to Torn Market Edge are documented here.

The project uses semantic-style version numbers for public userscript releases.

## [Unreleased]

## [0.2.4] - 2026-09-08

### Fixed

- Detect the current Torn **Add items to your Bazaar** rows directly on desktop and mobile using Bazaar root/list/item structures instead of depending on a short ancestor climb from the section heading.
- Recognize current and legacy Bazaar amount/price controls, including `div.amount-main-wrap`, `input.input-money` and quantity-style inputs such as `input.clear-all`.
- Keep the older heading-based discovery path as a defensive fallback for future/legacy layouts.
- Preserve the explicit `>` interaction: it fills suggested price and maximum available quantity but never submits **ADD TO BAZAAR**.

## [0.2.3] - 2026-09-08

### Changed

- The `>` action in **Add items to your Bazaar** now fills both the suggested selling price and the maximum available quantity for that item.
- Quantity input detection prefers `Qty`/quantity-labelled fields and uses the row's visible `xN` stock as the maximum, respecting a smaller native input `max` when Torn provides one.
- The final **ADD TO BAZAAR** action remains manual; Market Edge only fills fields after the user's explicit tap.

## [0.2.2] - 2026-09-08

### Added

- Support the **Add items to your Bazaar** composer.
- Show a compact Market Edge suggested Bazaar selling price beside each addable item.
- Add an explicit `>` control that fills Torn's price field with the suggestion without selecting quantity or submitting the Bazaar form.

### Changed

- Bazaar add-form price inputs are detected defensively, preferring price-labelled or rightmost numeric fields while avoiding quantity fields.
- React-controlled Torn price inputs are updated through the native input setter plus `input` and `change` events for reliable mobile/desktop behavior.

## [0.2.1] - 2026-09-08

### Fixed

- Detect same-item SPA row remounts and re-annotate without requiring a refresh.
- Cancel obsolete queued list-price requests before they consume the API budget.
- Keep the official Torn Item Market API authoritative when visible page listings differ from the API cache.
- Use safer surface-specific price extraction on other Bazaars and travel shops instead of falling back to arbitrary dollar values.
- Protect newer row scans from cleanup performed by superseded async tasks.

### Testing

- Added executable economic regression coverage and hardening guard checks.

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
