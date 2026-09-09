# Changelog

All notable changes to Torn Market Edge are documented here.

The project uses semantic-style version numbers for public userscript releases.

## [Unreleased]

## [0.6.2] - 2026-09-09

### Fixed

- **Row strips were two lines tall.** The `?` toggle wrapped onto its own line under every abroad and inventory strip (a device report from the United Kingdom shop). The toggle is now pinned to the strip's right edge and no longer sets the strip's height, so a strip is one text line high.
- **Stale figures after buying abroad.** Torn updates the "purchased 28 / 28 items" message and your cash without touching the item rows, so nothing rescanned and the rows kept promising 28 units. The capacity and cash are now part of the page signature for the abroad shop; a change re-evaluates every row from the order books already held (no new requests) and the summary drops to "0 slots free".

## [0.6.1] - 2026-09-09

### Changed

- **Abroad shops answer "how much per hour".** A device report from the United Kingdom shop showed the row strips wedged into the image column: Torn renders each row as a CSS grid inside a list item, so a strip appended to the grid became a grid cell. The abroad page now has its own collector. The strip is a full-width line below the row grid and reads, for example, `+$13.2k/h | +$1.25k each | 28 units = +$35.0k/trip | sell $6.25k`: resale in your Bazaar (fee-free) minus the shop price, times the units you can carry this trip, divided by the round-trip flight time. Units are bounded by the free capacity Torn prints on the page ("purchased 0 / 28 items"), the shop's stock and your cash. The `?` panel shows the arithmetic, what limited the units, and the flight assumption.
- **Ranked summary above the shop.** "Best buys in United Kingdom" lists the five best rows by $/hour with units, profit per trip and the rate, plus the free slots and the flight time each way. The best row is green on the list.
- **Travel type setting** (standard, airstrip, private jet, business class) sets the flight time used for the hourly rate; the flight table covers all eleven countries. The travel capacity setting is now only a fallback for pages that do not print the capacity.
- The abroad page is recognised by Torn's body flag, its stock tables or the purchase message, and rows fall back to "any list row with an item image and a quantity field" if Torn renames its CSS modules. Unknown stock counts as unlimited rather than zero.

## [0.6.0] - 2026-09-09

Performance and UI/UX release, from a research pass over Torn's API (swagger v6.13.4: no market-relevant change), the Torn PDA source, the top Greasy Fork market scripts and their feedback pages, and an audit of this script.

### Performance

- **Viewport-first scanning.** Collectors no longer read a bounding box inside sort comparators (a forced reflow per comparison on Torn's large DOM). Layout reads are cached per pass, priorities are computed once per row, and money-text checks run before any layout read. Rows more than half a viewport below the fold, or beyond the per-scan limit, are handed to an IntersectionObserver and priced when they scroll into view instead of being fetched up front. The throttled scroll listener remains only where IntersectionObserver is unavailable.
- **Observers stop on pages with nothing to annotate.** Attack, chat and crime pages no longer trigger the document-wide signature query on every mutation; the content observer is attached on supported surfaces only. Surface detection is memoised per URL.
- **Request budget.** Buy-side lists (Bazaar browse, travel, Auction House, city shops) reuse an order book for two minutes, like the sell surfaces since 0.5.6, so rows that Torn re-renders cost no request. "Analyze page" from the menu still fetches fresh books. The in-memory API cache is capped at 300 entries.
- **Torn PDA transport.** PDA returns `undefined` (no request made) when the same URL was asked within two seconds; that was parsed as an empty order book. It is now retried once after the window. No nonce parameter is added because only service-cache hits are free of quota.
- **Bounded storage with batched writes.** Every read goes through memory; writes reach the backend in one batch shortly after (and on page hide). Per-item records (order books, history, metadata, auction sales) are capped at 400, oldest first, and history keeps at most 400 points per item. On Torn PDA 3.15+ the async SQLite `PDA_storage` is used instead of the shared, evictable localStorage; settings, key, watchlist and rules are migrated on first run.
- **Idle discipline.** The watchlist timer only runs while there is something to poll. Inside Torn PDA, background WebView tabs (reported through PDA's tab-state event) pause scanning like a hidden browser tab.

### UI/UX

- **One visual system that follows Torn's theme.** Colours, spacing and type come from tokens that switch with Torn's `dark-mode` body class, so strips no longer render as dark blobs on the light theme. Type scale 12/11/10 px with tabular figures; every control has at least a 32 px hit area, 40 px on touch screens; one responsive breakpoint at 784 px like the other Torn scripts.
- **Rows in words, with a "why".** Inventory lines read `Bazaar $820k each | 10 owned | $8.20m total` instead of `ME BZ $820k | x10 | $8.20m`; auction lines say `Max bid`; shop and travel lines say `each`; the browse grid compares "vs value". Every strip has a `?` toggle that opens a plain-language explanation underneath (cheapest listing, Torn's value, net after fee, rule in force, order-book age, what stays manual). Tooltips are gone from rows; Torn PDA cannot show them.
- **One status vocabulary.** STRONG / CONSIDER / PASS everywhere a verdict is given (the browse grid's FAIR and ABOVE MV are now PASS with the percentage alongside); own Bazaar rows say BELOW TARGET / ON TARGET; the workbench button says Fill instead of `^`.
- **Underprice guard on sell surfaces.** When the suggested price is below what an NPC shop pays or under half of Torn's daily value, the strip turns amber with a short warning and the why panel explains it. The fill stays available.
- **API key onboarding.** Without a key, every priced row shows an "Add API key" button that opens settings. The settings dialog is grouped into collapsible sections (API key, Selling, Buying, Watchlist, Panels and travel, Scanning and diagnostics), every control has a label, Escape closes it, Tab stays inside, and there is a "Reset to defaults" button plus a link to Torn's key page. The panel header uses icon buttons with accessible names; list removals and toast dismissals are real buttons.
- **On-page launcher on desktop too**, on supported pages, so the panels are reachable without the userscript menu. Panel toolbars sit at the top of the panel instead of below long tables.

## [0.5.6] - 2026-09-09

### Fixed

- **Lower rows on long sell forms never got a price.** A device report showed the request budget exhausted (70 per minute) with rows queued: every scan re-fetched each priced row as soon as Torn's 30-second cache expired. Inventory, Bazaar add and Item Market sell rows now reuse an order book for five minutes, so the budget goes to rows that have nothing yet.

### Changed

- **Sell-form strip.** The button is a small `Fill`; the quantity and exact price (`32 × $5,994`), the total and the net are plain text beside it. After a fill the strip shows a green tick and an `×` that clears the quantity and price fields (and unticks a single-copy checkbox), returning the strip to its unfilled state.

## [0.5.5] - 2026-09-09

### Changed

- **Sell-form strip redesigned (Bazaar add, Item Market add listing).** One full-width line under the row with a single explicit button, "Fill 28 × $29,175", followed by the total and, on the Item Market, the net after the fee. The cryptic `^` control and the rounded price are gone; the button shows the exact price it writes. After a fill the button becomes a green "Filled 28 × $29,175" confirmation, and that state is recognised again after Torn re-renders the row.
- **No tooltip bubbles.** Title attributes on the strip were popping up over the row on tap in Torn PDA; explanations moved to accessible labels only.
- Bazaar manage rows show "Fill $29,175" instead of `^`.

### Fixed

- **Item Market quantity was not filled.** Torn re-renders the row after the first field write, so the second field held a dead element. The quantity is now written first and every field is looked up again from the live page before it is written.

## [0.5.4] - 2026-09-09

### Fixed

Diagnosed from a real-device detection trace of Torn's inventory page.

- **Tabs that stayed unpriced until a refresh (root cause).** Torn's page wrapper carries the class `main-items-cont-wrap`; a substring selector treated it as an item list, so every visited tab's rows were candidates at once. Rows of collapsed tabs have no box and sorted as "top of the viewport", crowding the visible rows out of the scan limit. Item lists are now matched exactly (`ul.items-cont`) and nodes without a box are discarded before ranking.
- **Action entries treated as rows.** Each row's `Use`, `Send`, `Equip` and `Trash` entries are also `li[data-item]`; they are excluded by their `data-action` attribute and their `actions-wrap` container.
- **"unequipped" matched the equipped-region exclusion.** The exclusion now targets `equipped-items` containers only.
- **Empty dark bars under weapons and armor.** The invisible marker for unpriced rows lost a CSS specificity contest with the row-line style; unpriced rows now get an inline hidden marker with no layout changes to the row.

## [0.5.3] - 2026-09-09

### Fixed

- Inventory lists are no longer excluded on `aria-expanded="false"`; only lists hidden by style or with no box are skipped, and if that leaves nothing every list is considered.
- After an inventory tab switch, a scroll position that jumped to the top is restored (inventory only, within 1.5 s, only when the player was scrolled down).
- Row hosts no longer receive `position: relative` unless the floated fallback line is used.

### Added

- The page structure report includes an inventory detection trace: every item list with its attributes, box and row count, plus the collector's verdict on the first rows of the visible list.

## [0.5.2] - 2026-09-09

### Fixed

- **Some inventory tabs stayed unpriced until a refresh.** Rows were only recognised through their thumbnail image, which Torn loads lazily; a tab whose images arrived late had no detectable rows and, since attribute changes are no longer observed, was never rescanned. Rows are now keyed on Torn's `li[data-item]` attribute, present as soon as the tab renders.
- **Scans took half a second on long tabs.** Collapsed category lists (Torn keeps every visited tab in the DOM) are skipped before any layout read, and inventory rows are read without `innerText`. Row names come from the row's name node instead of the sort key (no more "1 Angle Grinder").
- The overlay visibility audit no longer counts rows of collapsed tabs as zero-size; it reports them separately.

## [0.5.1] - 2026-09-09

### Fixed

- **Inventory lines invisible on Torn PDA (real-device report: 54 overlays, all zero-size).** Torn's inventory row title block is a jQuery UI accordion header that collapses foreign children. The line is now a block-level element appended to the item row itself, outside that header, with its own background. After insertion it is measured; if Torn's CSS still gives it no box, it floats over the bottom edge of the row instead.
- **Inventory rows rejected at random.** Row acceptance depended on the "Your items" heading being before the rows in the DOM, which is not always the case; a real-device report showed zero rows collected on a tab that had 30 annotated moments earlier. Rows are now accepted structurally (inside Torn's item lists, never inside the equipped block); the heading is only a fallback.

## [0.5.0] - 2026-09-09

### Removed

- **All weapon and armor pricing.** Comparable groups, expanded-details pricing cards, per-copy pricing by uid, Auction House bid guidance for equipment, the equipment Item Market panel and the "Weapon/armor comparables" setting are gone. Equipment rows on every surface receive only an invisible completed marker: no request is made and nothing is shown. The Item Market item page says "NOT PRICED" for weapons and armor. Reason: the comparables were not reliable enough to act on.
- The `/torn/{uids}/itemdetails` and `/market/{id}/auctionhouselisting` endpoints are no longer called; the per-uid details cache is no longer written.

### Changed

- **Compact commodity line on inventory rows.** Each stackable item now shows one short line: best exit route, price per unit, the quantity you own and the total at that price (for example `ME BZ $820k | x10 | $8.20m`). The other routes, floor and Torn value moved to the tooltip.
- Bazaar add and Item Market sell rows show the total for the owned quantity next to the suggested price.
- The page structure report no longer lists stats panels or pricing cards.

## [0.4.4] - 2026-09-09

### Fixed

- **Inventory overlays invisible on Torn PDA.** A real-device report showed every row annotated and zero errors while nothing was visible: the badge was appended inside the item name span, which Torn ellipsises on phones. Inventory overlays now render on their own line inside the row's title block, and the row is allowed to grow, the same recipe that fixed the Bazaar add form in 0.2.5.
- **Item Market sell-form overlays** were appended inside Torn's money-input group. They are now hosted by the row's info/controls container with wrapping layout, like the Bazaar add form.
- Per-copy id discovery on inventory rows also accepts any attribute whose name mentions an armoury id or uid, whatever Torn's current naming.

### Added

- The page structure report now audits overlay visibility (visible, clipped by which ancestor, zero-size, off-screen), lists each sampled row's children and its per-copy id, and prints up to eight data attributes per node.

## [0.4.3] - 2026-09-08

### Added

- **Runtime self-check in the page structure report** (settings > Diagnostics). The report now opens with how the script actually behaved on this page: scans per surface with rows found versus rows annotated and average/worst pass duration, overlays and pricing cards present, request queue state, and the last errors raised by the script (row failures, scan, signature, observer or render errors, plus any uncaught error whose stack points at Market Edge). The API key is never included. One paste of this report from the inventory, the Bazaar add form or the Item Market sell form is enough to diagnose a misbehaving surface.

## [0.4.2] - 2026-09-08

### Fixed

Collectors reconciled with Torn's real markup, as verified from the sources of the public scripts that fill prices on the same pages (Torn Market Filler, Torn Bazaar Filler, Torn Junk Seller, Torn Price Filler, FLIPR, TornTools, Torn PDA). Fixtures now mirror those structures.

- **Item id parsed as 0 from `wai-itemInfo-{id}-0`.** The trailing slot index was taken as the id, which broke the Item Market item page fallback and every sell-form row whose id comes from the info button. The first number after the prefix is used now.
- **Equip buttons' `data-id` read as an item id.** Torn stores the per-copy armoury id there, so inventory rows carried two ids and fell off the fast path. Bare `data-id` is no longer an item id; `data-item` is.
- **Torn's money inputs come in pairs.** The visible field has a hidden twin in the same `.input-money-group` that holds the raw number; fills now write both, on the Bazaar add and manage views and the Item Market sell form.
- **Item Market sell form specifics.** Owned quantity is read from the quantity input's `data-money`; single-copy rows use the `itemRow-selectCheckbox` control (the anonymous-listing checkbox is never touched); greyed-out rows are skipped; `#/viewListing` rows (your active listings) get price-only fills and also open the listings panel.
- **React Bazaar manage rows** (`div[data-testid="sortable-item"]`, `div[class*="price___"]`) had no "Price per unit" label and were skipped; they are now recognised and filled.
- **Inventory rows** use `data-qty` and `data-sort` for quantity and name, are excluded inside `.equipped-items-wrap`, and the per-copy id comes from `data-armoryid` or the equip button's `data-id` (the API uid) instead of non-existent `data-uid` attributes. The heading finder scans headings and title bars only and caches for 2.5 s instead of walking every element every 400 ms.

## [0.4.1] - 2026-09-08

### Fixed

- **Stability under Torn's React re-renders.** The content observer now watches child-list changes only; attribute churn (hover classes, inline styles) no longer triggers signature passes. Scans are serialised: a scan requested while one is running is coalesced into a single follow-up pass, so mutation storms can no longer stack overlapping scans with duplicate overlays and wasted requests. Signature checks, observer callbacks and the Item Market render are isolated with error handling so one failure cannot stop the script.
- **Performance on long inventories.** Item ids are memoised per DOM node (keyed by the attributes that decide them), the expensive details-panel walk runs only when the page contains a quality figure, and the minimum quiet period between signature passes is 200 ms.
- **Rows beyond the scan limit.** A throttled scroll listener scans rows as they come into view instead of waiting for a DOM mutation.
- **Weapons and armor on every inventory tab, the Bazaar add form and the Item Market sell form.** Equipment rows no longer stay blank: they show the plain floor, the bonus floor and a hint to open the details, from one compact order book per item type. Rows that expose the copy's uid are priced as the exact copy (stats through `/torn/{uids}/itemdetails`, comparables and ended sales) without opening anything; such rows get the fill control on sell forms. A copy priced from its expanded details keeps that price across rescans.
- **Untradable items and empty books** are labelled ("untradable", "no listings" with Torn's market value) instead of a bare PASS.

### Added

- **Item Market sell form ("add listing") support.** Rows with an item image and price/quantity fields on the Item Market page are recognised (by route, or by their presence when Torn changes the route). Each row gets the suggested Item Market price through the item's pricing rule, the net after the configured fee, and a `^` fill for price and owned quantity. Listing stays manual.
- **Generic sell-form fallback for the Bazaar add form.** When Torn's class names or headings change, rows are found by structure (one item image plus a visible price field) so the suggestion and fill keep working.

## [0.4.0] - 2026-09-08

### Added

- **Repricing workbench.** Your own Item Market listings panel now carries a per-listing fill control (`^`) and a "Fill all on page" action that write the suggested price into Torn's price fields on the manage view; saving stays manual. Each item can have a persistent pricing rule: undercut the floor (default), hold the anchor target, or never fill, plus a minimum price that is never breached. Your own Bazaar listings get the same `^` fill next to the target, with the Item Market floor shown, and a "Fill all visible prices" entry in the userscript menu and PDA launcher fills every visible suggestion (add form and manage rows).
- **Undercut alerts.** Opening "My listings" or your Bazaar records your listed prices; the watch loop then polls the official order book at the watchlist interval and raises an in-page toast when the Item Market floor drops below one of your prices (30-minute cooldown, re-alert on a further 2% drop). The watchlist panel lists them with a remove control; a setting turns the feature off.
- **Portfolio panel** (Minimal access key). Reads your whole inventory through the official `/user/inventory` endpoint, values every row from Torn's market value with the fee model, and shows totals per route with untradable and equipped flags. "Refine" spends a configurable request budget on live order books for the most valuable commodities and prices each weapon/armor copy from its uid via `/torn/{uids}/itemdetails` and the comparables engine, without expanding any details panel on the page.
- **City shop runs.** The official `/torn/cityshops` endpoint (stock and price per NPC shop) is priced against the best exit after fees, capped by current stock and your run quantity, and ranked. The panel opens automatically on Torn city shop pages, scoped to that shop, and shop rows on those pages get inline profit per unit.
- **Travel plan.** Foreign shop prices per country now come from the official item catalog and are ranked by profit per unit and per trip at your travel capacity. The official API has no foreign stock, and the panel says so.
- **Sell-to-shop route.** The highest NPC shop sell price is now an exit candidate everywhere (contraband, sunk markets), and Torn city shop sell prices are read from the new `value.shops` array.
- **Museum pieces by name.** Meteorite Fragment (15 points), Patagonian Fossil (20 points) and a six-piece Arrowhead set (25 points) are valued through the points market like plushie and flower sets.
- **Auction House upgrade.** Stackable items on the Auction House show the median of ended sales next to the maximum rational bid, and recent winning bids cap that bid. Weapon and armor rows are priced as the exact copy (from the row's stats or the public per-listing endpoint) and get a maximum bid derived from comparables and ended sales. The Item Market panels show an auction timing section: which six-hour Torn City Time window closes sales at the best price.
- **Item Market browse grid overlay.** Category and search cards are compared with Torn's official market value from one batched metadata request (no order books): discount, STRONG / CONSIDER / FAIR / ABOVE MV.
- New settings: city shop run quantity, portfolio refine budget, auction evidence toggle, browse overlay toggle, undercut alerts toggle.

### Changed

- The toolbar under every panel now opens Portfolio, Shops and Travel as well as My listings and Watchlist; the userscript menu and the PDA launcher gained the same entries.
- Item Market panels show the ended-auction sold median and the sell-to-shop price as evidence rows.
- Bazaar rows that carry Torn's "Price per unit" label are never treated as add-form rows.

### Privacy

- New official endpoints: `/user/inventory` (portfolio, Minimal key), `/torn/{uids}/itemdetails`, `/torn/cityshops`, `/torn/items` (catalog), `/market/{id}/auctionhouselisting`. Everything still goes only to `api.torn.com`. New local storage: pricing rules, recorded own prices for undercut alerts, a compact inventory snapshot, per-uid item details, city shop stock and the shop catalog. See PRIVACY.md.

## [0.3.14] - 2026-09-08

### Fixed

- **Inventory tabs with many weapons froze for seconds (Torn PDA).** Three passes were quadratic or layout-bound on long lists: the "Your Items" heading finder serialised the text of every container on the page on every pass (now own-text only and memoized), the row resolver read layout text for up to nine ancestors per row including the whole list (now a direct fast path for Torn's `li[data-item]` rows plus a layout-free pre-check), and the name-host search read layout text per element (now plain text). Fewer candidate rows are inspected per scan.

## [0.3.13] - 2026-09-08

### Fixed

- **Row summary missing for equipment copies that share an item id.** The row collector kept a single row per item id, so with several AK-47s only one row existed for the script and the priced copy usually had nowhere to render. Rows are now keyed by their element; each copy keeps its own row and its own summary. The expanded details container (reached through its large picture) is excluded from the row set.

## [0.3.12] - 2026-09-08

### Fixed

- **The pricing card was rendered but invisible on the inventory page.** It was inserted inside Torn's React stats wrapper, whose grid layout hides an extra child. The card is now appended to the nearest plain block container around the stats, tracked by the copy's key instead of its DOM position, and cleaned up when that copy's details are no longer open.
- Cards whose price rests on no comparable listings and fewer than three Auction House sales are flagged as thin evidence.

## [0.3.11] - 2026-09-08

### Fixed

- **A details panel that React swapped mid-request could end up never priced.** If the stats block was replaced while the market request was pending, and its text briefly differed, the panel could not be re-located and the attempt ended without a card. Re-location now falls back to the same item (and quality) whose panel is still open, and transient failures (panel swapped, surface briefly undetected) are retried up to three times with a short delay.
- The page structure report lists retry counters and in-flight details for diagnosis.

## [0.3.10] - 2026-09-08

### Fixed

- **Inventory details pricing could be cancelled or lost silently.** The details request shared the list scan's cancellable queue group, so Torn's frequent inventory mutations could cancel it mid-flight, and a React re-render of the stats block orphaned the pending card. Details requests now use their own queue group, the panel is re-located by key after each await, and any failure renders an error card (with the Torn error translated) instead of removing the card.
- The pricing card is forced to a full-width block so grid/flex details wrappers cannot hide it.

### Changed

- The page structure report now includes the pricing cards present, the last details outcome and whether an API key is available, so a failed pricing step can be diagnosed from the report alone.

## [0.3.9] - 2026-09-08

### Fixed

- **Inventory details were priced but shown nowhere.** The large item picture inside Torn's details block is itself an item-identity node; with no readable row around it, the collector fell back to the image element as the item's row card, so the annotation was appended to an image and the details were tied to the wrong element. Bare-image cards are now rejected.
- Details panels are matched to their row by containment, which handles both layouts Torn uses: details nested inside the row (Bazaar add form, some inventory views) and details placed after the row (inventory).

### Added

- **Page structure report** in settings (Diagnostics). It lists what the script sees around item rows and expanded details (tags, classes, short text) so layout problems can be reported without developer tools. It never includes the API key.

## [0.3.8] - 2026-09-08

### Fixed

- **Opening a weapon's details after the page had already been scanned did nothing.** Once every row carried its completed marker, the scan exited before the details step. The details step now always runs, so expanding a copy at any time prices it.
- **Inventory details are matched to the item row.** Torn places the inventory details block after the row (on the Bazaar add form it is nested inside), so the panel is now associated with the known item rows around it in both layouts. The priced copy is promoted onto its inventory row as `BZ | IM | quality/bonus`.

## [0.3.7] - 2026-09-08

### Fixed

- **Details pricing card disappeared in 0.3.6.** The new text-node walker required "Quality:" inside one text node, but Torn splits the label, the colon and the value across nodes. Detection and parsing now tolerate a missing colon and separated nodes, and the walker scans the whole page instead of guessing the list container.
- **Bonus and rarity are now read from Torn's text**, as the panel shows them ("Bonus: 24% Proficience", "Quality: 124.26% Yellow"), including several bonus rows. Icon titles remain a secondary source. Bonus copies are therefore priced against their own bonus group instead of as plain.

## [0.3.6] - 2026-09-08

### Fixed

- **Torn PDA froze when switching item category tabs.** Every DOM mutation triggered a signature pass that read text and layout for each element in the list, which is quadratic on long categories. The pass is now linear: details panels are found through a text-node walker instead of scanning every element, the change signature no longer resolves rows (no innerText or layout per node), the Bazaar section lookup is memoized, and row collection only inspects the rows nearest the viewport. The debounce also adapts to how long a pass took, so slow devices are not asked to re-run it mid-render.

## [0.3.5] - 2026-09-08

### Fixed

- **Details-panel pricing was attached to the row above the expanded item.** An expanded row grows far beyond the normal row height and was dropped by the row detector, so the panel fell back to the previous row. Expanded rows are now kept, the panel is matched to the row that contains it, and the `^` fills that row only. Identical items above and below are untouched.
- **Pricing cards no longer outlive a collapsed details panel.** The card is inserted right below Torn's stats block and removed as soon as that block disappears, leaving only the compact row summary (price, `^`, quality and bonus label).
- Add-form rows are never mistaken for existing Bazaar listings: the managed-listing collector is skipped on the add route and ignores rows that carry the add controls.

## [0.3.4] - 2026-09-08

### Changed

- **No market requests for weapons and armor on inventory or your own Bazaar.** Item metadata (one cached batch) identifies equipment, and those rows are skipped: no order-book request, no Auction House request, no floor line. Inventory weapon rows show nothing until a copy is priced from its expanded details; Bazaar add rows only show "open details to price". Buy-side surfaces (Auction House, other Bazaars, travel) keep their plain/bonus floors.
- Removed the plain-assumption sell pricing on list rows entirely; the details-panel card is the only equipment sell pricing.

## [0.3.3] - 2026-09-08

### Changed

- Weapon rows on the Bazaar add form no longer show a floor glance. Until a copy has been priced from its expanded details, the row only says "open details to price".
- Once a copy is priced from its details panel, that copy's value (with its quality/bonus label) and the `^` fill move onto its row, and survive rescans until Torn re-renders the row. Inventory rows get the same BZ/IM values for the priced copy.

### Fixed

- After filling a price on an add-form row, a rescan could mistake that row for an existing Bazaar listing and replace the suggestion with a "Target" line. Add-form rows now take precedence over the managed-listing heuristics.

## [0.3.2] - 2026-09-08

### Changed

- **Weapon pricing moved into the expanded item-details panel.** Opening a weapon or armor on the Bazaar add form (or inventory) reveals the copy's quality, damage, accuracy and bonus icons; Market Edge now reads those and prices that exact copy against quality-matched comparables (same rarity and bonus set, quality within +/-10, then +/-20) from the deep Item Market book, capped by ended Auction House sales of the same group. The card shows the suggested Bazaar price with the `^` fill, comparables range, AH sales, Torn average (plain copies only), the Item Market alternative net of fees, and a warning when cheaper copies of the same group would sell first.
- Weapon rows on the Bazaar add form now show only the plain floor and a hint to open the details; the per-row fill was removed because the copy's stats are unknown at row level.

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
