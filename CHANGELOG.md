# Changelog

All notable changes to Torn Market Edge are documented here.

The project uses semantic-style version numbers for public userscript releases.

## [Unreleased]

## [0.3.1] - 2026-09-08

### Added

- **Weapon/armor sell pricing on the Bazaar add form and inventory.** Equipment rows now get a suggested Bazaar price for a plain (no bonus) copy, the `^` fill control that sets price and selects the item, and context: plain Item Market floor, ended Auction House sales median (30 days, plain copies) or Torn daily average, and the cheapest bonus/rarity listing so a bonus roll is not sold at plain prices. The suggestion never exceeds the current plain floor.
- Own-Bazaar weapon listings show the same target and a LOW/OK delta against the current price.
- Ended Auction House sales are fetched for sell-side equipment rows only, one request per item type, cached ten minutes.

## [0.3.0] - 2026-09-08

### Added

- **Cold-start valuation from official signals.** Torn's daily average price (actual purchases) is now used as a fair-value reference from the first request. When it agrees with the depth anchor within 5%, the warm-up haircut is waived and confidence can reach MEDIUM without local history. Without history the daily average also caps an inflated order book.
- **Full Item Market 2.0 fee model.** Settings for anonymous listings (+10% fee) and the 5-star company perk that waives it; Auction House 3% seller fee shown as an informational route; fee labels in the panel reflect the configured total.
- **Your Item Market listings panel** (Limited access key). Compares every active listing with the live floor, counts units listed ahead of yours, shows net after fees, flags CHEAPEST / CLOSE / UNDERCUT and suggests floor-minus-undercut prices. Opens automatically on manage-style Item Market routes, from the panel toolbar, or from the userscript menu.
- **Museum set economics.** Plushies and flowers get a set-implied value: 10 points at the current points-market ask minus the official market price of the other pieces. It appears as a "Museum set" route on inventory, Bazaar, Auction House and Item Market surfaces. One metadata batch per set per day plus the points market every five minutes.
- **Weapon and armor comparables.** Equipment listings are grouped by rarity and bonus set, quality matched within 10 points, and compared with ended Auction House sales from the last 30 days. The Item Market page shows a comparables table and best-value listing; list pages show plain and bonus floors instead of "unsupported".
- **API-only watchlist.** Watch items with a target price from the Item Market panel or settings. While a Torn tab is visible the script polls the official order book at a configurable interval (minimum 30 s, cache-delay aware) and raises an in-page toast plus a title marker. Alerts never buy anything.
- **Torn PDA support.** `###PDA-APIKEY###` injection, `PDA_httpGet` transport, localStorage fallback when GM storage is missing, style injection without `GM_addStyle`, and an on-page launcher when no userscript menu exists. Plain `fetch` is the last-resort transport.
- **Key diagnostics.** "Test API key" now calls `/key/info`, reports the access level and warns when the own-listings panel needs a Limited key. Torn error codes 2, 5 and 16 are translated into actionable messages.
- **DOM fixture tests** (jsdom, dev-only) for the Bazaar add form, own Bazaar rows, inventory, Auction House and Item Market parsers, plus panel smoke tests with a stubbed API.

### Changed

- Request budget raised from 45 to 70 requests per minute (Torn allows 100 per player).
- Mutation observation is scoped to Torn's content container instead of the whole document and no longer listens to character data.
- Persistent snapshots moved to a new storage prefix so equipment summaries can be cached; old snapshots are ignored.
- Floating panels opened from the menu stay pinned until closed or the page changes; the panel has a close button.

## [0.2.6] - 2026-09-08

### Changed

- Bazaar add-form intelligence now uses a dedicated second line below Torn's `Qty` and price controls, leaving the item-name cell untouched.
- Bazaar add rows expand vertically as needed so the Market Edge suggestion does not compete with or truncate Torn's native fields.
- The explicit fill button now uses `^` instead of `>`.
- The `^` action still fills the suggested price and maximum available quantity only; **ADD TO BAZAAR** remains manual.

## [0.2.5] - 2026-09-08

### Fixed

- Bazaar add-form Market Edge controls now render in Torn's description/title container instead of the ellipsis-clipped item-name text host, so the suggestion and `>` button stay visible on mobile.
- The `>` action now supports Torn's checkbox-style `Qty` control (select-max behavior) as well as normal quantity inputs.
- Bazaar add rows are included directly in the SPA signature so late-rendered/remounted rows trigger analysis even if Torn changes generic item-identity markup.
- Price-input detection is scoped to Torn's price wrapper before falling back to heuristic input scoring.

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
