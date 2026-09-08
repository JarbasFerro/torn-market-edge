# Testing guide

Torn Market Edge is a userscript running against a live SPA, so both economic regression tests and manual Torn integration checks are required.

## Running the automated tests

```sh
npm ci            # installs jsdom (development only; the userscript itself has no dependencies)
npm run check     # builds the userscript, syntax-checks it and runs every test
```

`node --test tests/*.test.js` works without `npm ci` too; the jsdom-based DOM and panel tests are skipped when jsdom is missing.

Test files:

- `tests/economics.test.js` - original pure-function regression scenarios.
- `tests/features-0-3.test.js` - fee model, cold-start valuation, equipment comparables, museum sets, watchlist, own listings, key access and source guards.
- `tests/dom.test.js` - collectors against saved HTML fixtures in `tests/fixtures/` (Bazaar add form, own Bazaar rows, inventory, Auction House, Item Market), transport selection (GM vs Torn PDA), settings modal.
- `tests/panels.test.js` - end-to-end panel smoke tests with a stubbed Torn API (Item Market, equipment, own listings, watchlist tick, museum context).
- `tests/features-0-4.test.js` - v0.4.0 pure functions: inventory and uid details normalisation, official-value exit, sell-to-shop route, city shop runs, foreign offers and travel ranking, museum pieces by name, auction timing, sales-capped bids, equipment bid guidance, browse-grid classification, pricing rules, sell-side watch, portfolio summary.
- `tests/panels-0-4.test.js` - v0.4.0 panels in jsdom: portfolio (quick pass and refine by uid), key gating, city shop runs scoped to the current shop, travel plan, browse-grid overlay, Auction House commodity and equipment guidance, own listings workbench fill and rules, undercut toast, own Bazaar fill-all.

When Torn changes a page layout, update the matching fixture to the new markup and adjust the collector; the fixtures are the contract.

## Economic regression scenarios

At minimum, preserve these cases:

1. **Obvious arbitrage** - a single cheap listing below a stable cluster should be detected.
2. **Fake gap** - a high second ask must not override a much lower historical fair value.
3. **Fees destroy profit** - a small apparent spread can become negative after the 5% Item Market fee.
4. **Bazaar profitable / Item Market not** - route recommendation must account for fees.
5. **Capital constraint** - huge cheap quantities must not exceed configured capital limits.
6. **No history** - confidence must stay low rather than inventing certainty.
7. **Volatile market** - large nominal discounts should be downgraded when volatility is excessive.
8. **Stale data** - stale API information must lower confidence/warn the user.
9. **Single listing** - do not invent market depth.
10. **Unsupported equipment** - do not apply the commodity model to stat-based equipment.
11. **Anonymous listing fee** - a 15% total fee can flip the best route to Bazaar.
12. **Cold start with official agreement** - no warm-up haircut when Torn's daily average agrees with depth; the daily average caps an inflated book; confidence never exceeds MEDIUM without local history.
13. **Equipment comparables** - cheap plain listings are judged against their own group, bonus rolls against theirs, and ended Auction House sales cap the reference.
14. **Museum sets** - implied value is set value minus the other pieces; negative or incomplete sets never become a route.
15. **Watchlist** - alerts trigger at or below target, respect the cooldown and re-alert on a further drop.
16. **Own listings** - CHEAPEST / CLOSE / UNDERCUT statuses, anonymous fee and flash-sale warnings.
17. **Pricing rules** - undercut by default, anchor mode, hold, minimum price clamp; fill never submits.
18. **Undercut watch** - alert when the floor drops below an own price, cooldown, re-alert on a further drop, entries pruned when a listing disappears.
19. **Shop economics** - runs capped by stock, sell-to-shop route beats a sunk market, foreign offers ranked per country.
20. **Auction evidence** - ended sales cap the rational bid; equipment max bid stays between the current bid and the plain floor; timing buckets pick the best window.
21. **Browse grid** - STRONG / CONSIDER / FAIR / ABOVE MV from the official market value with no order-book request.

## Manual UI regression matrix

### Inventory

- Open Items -> Drugs.
- Confirm equipped items above **Your items** are not analyzed.
- Confirm every visible inventory row receives its own inline result.
- Switch Drugs -> Medical -> Boosters -> Candy -> Alcohol -> another category without refreshing.
- Confirm the new category starts processing automatically.
- Confirm cached items appear immediately when revisiting a category.
- Confirm multiple rows populate concurrently rather than strictly top-to-bottom.
- Confirm annotations remain on the same native quantity/name line.

### Your Bazaar

- Confirm Market Edge identifies your Bazaar pricing mode.
- Confirm it reads **Price per unit**, not RRP.
- Confirm changing the native price field updates/re-evaluates the inline information without submitting the Bazaar form.
- Confirm Market Edge does not click Save Changes or submit anything.

### Other Bazaar

- Manually open another player's Bazaar.
- Confirm only the currently opened page is read.
- Confirm visible commodity rows receive inline analysis.
- Confirm no hidden/background Bazaar navigation occurs.

### Item Market

- Open a supported stackable item.
- Confirm lowest price, current anchor and exit calculations load.
- Confirm the detailed page can use the deeper order-book limit.
- Confirm listing-level highlighting does not interfere with Torn's native purchase controls.

### Auction House

- Open the Auction House manually.
- Confirm supported commodity rows show maximum rational bid/headroom guidance.
- Confirm Market Edge never bids automatically.
- Confirm unsupported equipment is not valued using the commodity model.

### Travel shop

- While abroad, open the local shop manually.
- Confirm visible item prices are compared with Torn resale economics.
- Confirm configured travel capacity affects trip totals only when set.

### Your Item Market listings

- With a Limited key, open the Item Market manage view or use the menu command.
- Confirm each listing shows floor, units ahead and a status.
- Confirm suggested prices are never applied to Torn's form.
- With a Public key, confirm the panel explains the access requirement and makes no `/user/itemmarket` request.

### Equipment

- Open a weapon or armor on the Item Market.
- Confirm the comparables table groups by rarity/bonus and shows Auction House sales when any exist.
- On the Bazaar add form, confirm weapon rows show only "open details to price" until a copy is priced, then the copy's value and `^`.
- On inventory, confirm weapon rows show nothing and trigger no `/market/` request (developer diagnostics log requests) until a copy's details are opened.
- Expand a weapon's details on the Bazaar add form; confirm a Market Edge card appears below the stats with the copy's quality, a suggested price, comparables and `^`; confirm `^` fills the price and selects the item without submitting.

### Diagnostics

- Open settings, press **Build page structure report**; confirm the report lists the surface, stats panels and rows and contains no API key.

### Watchlist

- Add an item with a target above the current floor; confirm a toast and `[ME]` title marker appear within one interval.
- Hide the tab; confirm no polling happens (developer diagnostics log requests).
- Confirm alerts stop after removing the item.

### Torn PDA

- Install from the raw GitHub URL; confirm the **ME** launcher appears and settings open.
- Confirm the Item Market panel loads without entering a key (PDA injection).
- Confirm Bazaar add-form fill works with a tap.

## Mobile UX

Verify on a narrow/mobile viewport:

- native item name/quantity remains readable;
- Market Edge output does not create horizontal overflow;
- no large floating panel covers critical Torn controls on list pages;
- settings remain usable;
- no broken character encoding appears.

## Network/compliance audit

Before release, inspect the userscript for network/action primitives.

Expected outbound API mechanism:

- `GM_xmlhttpRequest` to `api.torn.com`.

There should be no code that:

- auto-clicks Torn controls;
- submits forms;
- reloads pages;
- downloads hidden Torn pages;
- executes remote JavaScript;
- sends the API key anywhere other than Torn's official API.

## API-rate behavior

- Maximum Market Edge budget: 70 requests/minute (Torn allows 100 per player across all keys).
- Maximum in-flight concurrency: 4.
- Watchlist polling: at most one pass per configured interval (minimum 30 s), low priority, only while visible, and cached snapshots are reused until Torn's cache delay has elapsed.
- Repeated item requests should use cache/in-flight deduplication when appropriate.
- List-style pages should use a small Item Market depth; detailed Item Market analysis may use deeper data.
