# Torn Market Edge

Torn Market Edge is a Tampermonkey userscript for [Torn](https://www.torn.com/) that adds market decision support directly to the pages you already use.

It is designed to help answer questions such as:

- Is this Item Market listing meaningfully underpriced?
- Would Bazaar or Item Market be the better exit after fees?
- Is an Auction House bid still below a conservative resale value?
- Is an item in a foreign shop attractive to bring back to Torn?
- What is a reasonable resale target for items already in my inventory or Bazaar?

Torn Market Edge is **decision support, not trading automation**. It never buys, sells, bids, submits forms, refreshes Torn pages, or simulates game actions.

## Current status

**v0.6.1**

The current release is a performance and UI/UX pass: viewport-first scanning with cached layout reads and IntersectionObserver pickup, a bounded store with batched writes (Torn PDA's SQLite storage when available), a fix for PDA's duplicate-request behaviour, one theme-aware visual system that follows Torn's dark mode, rows written in words with a "why this price" toggle, an underprice guard on sell surfaces, and an in-row API key prompt with a grouped, keyboard-complete settings dialog. Torn DOM integration is still validated page by page, so treat new surfaces as beta.

## Supported surfaces

- Item Market (including your own listings)
- Your Bazaar
- Other players' Bazaars when manually opened
- Auction House
- Foreign shops while abroad: dollars per hour per item at your Bazaar resale price, bounded by free capacity, stock and cash, with a ranked "best buys" summary above the shop
- Inventory
- Item Market browse grid (category and search cards)
- Item Market sell form (add listing)
- Torn city shops (shops.php, Big Al's)
- Panels that need no page at all: Portfolio, City shop runs, Travel plan

The valuation model covers fungible/stackable items only. Weapons and armor are not priced; their rows are left untouched.

## Core features

- Official Torn API v2 integration (Public key for everything except your own listings)
- Robust market anchor instead of using only the lowest listing
- Torn's daily average price as a cold-start fair-value reference
- Fee-aware resale comparisons: Item Market 5% tax, optional 10% anonymous-listing fee, Auction House 3%, Bazaar and trades fee-free
- Museum set route for plushies and flowers (points market based)
- Prefix analysis for cheap Item Market listings
- Conservative exit-price model with configurable safety haircut
- ROI, expected profit, capital and confidence calculations
- Your Item Market listings versus the live floor (undercut detection)
- Repricing workbench: `^` fill and "Fill all" into Torn's price fields on your Item Market manage view and your Bazaar, with persistent per-item pricing rules (undercut floor, hold anchor, never fill, minimum price); saving stays manual
- Undercut alerts for your own Item Market and Bazaar prices, polled through the official order book
- Portfolio panel from the official inventory endpoint: sellable value per route, untradable and equipped flags, order-book refinement (weapons and armor listed but not priced)
- City shop runs from the official city shop endpoint (stock and price) and inline profit on city shop pages
- Travel plan from official foreign shop prices, ranked by profit per trip at your capacity
- Abroad shop rows: `+$13.2k/h | +$1.25k each | 28 units = +$35.0k/trip | sell $6.25k`, using the capacity Torn prints on the page, the round-trip flight time for your travel type and the Bazaar resale price
- Sell-to-shop exit route and museum pieces recognised by name (Meteorite Fragment, Patagonian Fossil, Arrowhead set)
- Auction House: ended-sales median as evidence and cap for stackable bids, and a best end-time window from ended sales
- Item Market browse-grid overlay versus Torn's official market value with no per-item requests
- Watchlist with in-page alerts, polled only while a Torn tab is visible (the timer only runs while there is something to poll)
- Every row line in plain words with a `?` toggle that explains the price (cheapest listing, Torn's value, net after fee, rule in force, order-book age); no tooltips, so it works in Torn PDA
- Underprice guard: sell suggestions below an NPC shop price or under half of Torn's value are flagged before you fill
- One visual system that follows Torn's light and dark theme, 12/11/10 px type with tabular figures, 32 px controls (40 px on touch screens)
- Local price-history observations (at most 400 points per item)
- `cache_timestamp`/`cache_delay` aware caching
- Persistent stale-while-revalidate snapshots
- Four-request bounded concurrency with a 70 requests/minute Market Edge ceiling
- In-flight request deduplication; buy-side lists reuse an order book for two minutes, sell surfaces for five
- Fast 20-listing snapshots on list pages and deeper analysis on Item Market pages
- SPA-safe inventory category detection
- Incremental per-row overlays instead of large floating panels on list pages
- Viewport-first loading: layout reads cached per pass, rows below the fold priced as they scroll into view (IntersectionObserver)
- Foreground-only DOM analysis; observers detach on pages with nothing to annotate; Torn PDA background tabs pause scanning
- Bounded storage: per-item records capped at 400 with batched writes; Torn PDA 3.15+ uses the app's SQLite script storage
- Torn PDA compatible (API key injection, PDA transport with duplicate-request retry, PDA_storage, on-page launcher)
- Local settings and API-key storage via userscript-manager storage

## Installation

### Greasy Fork

Greasy Fork is the recommended installation and update channel. It is synced automatically from this repository's `main` branch.

### Development / direct install

Install a compatible userscript manager such as Tampermonkey, then install:

`https://raw.githubusercontent.com/JarbasFerro/torn-market-edge/main/torn-market-edge.user.js`

After installation:

1. Open Torn.
2. On any supported page, rows show an **Add API key** button; it opens Market Edge settings (also available from the userscript menu or the **ME** launcher at the bottom-left of supported pages).
3. Enter your Torn API key.
4. Use **Test API key**. The status line reports the key's access level.
5. Open a supported Torn market/inventory page.

### Torn PDA

Market Edge works inside Torn PDA. Add the script from the raw GitHub URL or Greasy Fork; PDA injects your API key automatically, and a small **ME** launcher at the bottom-left opens settings, page analysis, your listings and the watchlist because PDA has no userscript menu.

### API key access levels

- **Public**: Item Market analysis, Bazaar, Auction House, travel, inventory rows, museum sets, watchlist, city shop runs, travel plan, browse-grid overlay.
- **Minimal**: everything above plus the **Portfolio** panel (`/user/inventory`).
- **Limited**: everything above plus the **Your Item Market listings** panel and workbench (`/user/itemmarket`).

A custom key that includes `user -> itemmarket` also works for the listings panel.

## API key and privacy

Market Edge stores the API key locally in userscript-manager storage and sends it only to `https://api.torn.com` using Torn's API authorization header.

The script has:

- no analytics;
- no ads;
- no trackers;
- no telemetry service;
- no remote executable code;
- no external server/backend.

See [PRIVACY.md](PRIVACY.md) for the full data-handling statement.

## Torn compliance

Market Edge is intentionally designed around manual player actions:

- no automatic purchases;
- no automatic sales;
- no automatic bids;
- no automatic form submission;
- no simulated clicks;
- no CAPTCHA interaction;
- no hidden non-API Torn requests;
- no background scraping of Torn pages the user has not manually opened.

The script may read and annotate the Torn page currently being viewed and may call the official Torn API for market/item information.

## Configuration

Current settings include:

- available trading capital;
- maximum capital per opportunity;
- maximum capital per item;
- minimum ROI;
- minimum expected profit;
- minimum discount;
- Bazaar enabled/disabled;
- Bazaar discount;
- safety haircut;
- historical premium cap;
- Item Market undercut;
- anonymous Item Market listings (+10% fee) and the company perk that waives it;
- museum set route on/off;
- minimum confidence for green classifications;
- maximum tolerated volatility;
- scan size;
- travel type (flight time for the abroad $/hour figures);
- travel capacity (fallback when the page does not print it);
- city shop run quantity;
- portfolio refine budget;
- ended-auction evidence on/off;
- browse-grid overlay on/off;
- undercut alerts on/off;
- local history retention;
- watchlist on/off, polling interval and watched items;
- developer diagnostics.

## How valuation works

Market Edge does not use the current lowest listing as fair value. The lowest listing may be the opportunity we are trying to detect.

The engine separates:

1. current market floor;
2. market depth;
3. robust current-market anchor;
4. Torn's official daily average (actual purchases) as a cold-start reference and cap;
5. locally observed historical reference once at least five observations exist;
6. conservative executable exit estimate;
7. Bazaar, Item Market, Auction House and Museum-set net proceeds after fees;
8. confidence and data freshness.

For weapons and armor the engine instead groups listings by rarity and bonus set, matches quality softly, and caps the comparable median with ended Auction House sales from the last 30 days. Inventory rows show one compact line per stackable item: best exit route, price per unit, owned quantity and the total at that price. Weapons and armor are skipped.

Where no order book has been fetched (portfolio quick pass, shop runs, travel plan, browse grid), the exit comes from Torn's official market value with an extra 2% haircut on top of your safety haircut. Ended Auction House sales are the only official transaction record; on the Auction House they cap the maximum rational bid for stackable items.

Displayed profit values are estimates, not guarantees. Market liquidity and future prices are uncertain.

## Watchlist, undercut alerts and Torn's rules

The watchlist polls only the official Item Market API, only while a Torn tab is visible, at a user-configured interval of at least 30 seconds, and respects Torn's global cache delay. Alerts are an in-page toast and a title marker. Market Edge never buys, so acting on an alert remains a manual decision.

Undercut alerts use the same loop for prices you have listed: opening **My listings** or your Bazaar records them locally, and a toast warns when the Item Market floor drops below one of them.

The repricing workbench writes values into Torn's own price fields and nothing else. Torn's save, update and add buttons are never pressed by the script.

## Reporting bugs

Use [GitHub Issues](https://github.com/JarbasFerro/torn-market-edge/issues). For UI problems, screenshots are especially useful.

Please include:

- Torn page/surface;
- inventory category/item if relevant;
- browser/device;
- userscript manager;
- script version;
- what you expected;
- what happened instead.

For a surface that looks wrong or slow, open **Market Edge settings > Diagnostics > Build page structure report** on that page and paste the report: it starts with a runtime self-check (rows found versus annotated, pass durations, captured errors) and never contains the API key.

**Never post your Torn API key in an issue, screenshot, console log, or diagnostic.**

## Development and releases

See:

- [CHANGELOG.md](CHANGELOG.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/TESTING.md](docs/TESTING.md)
- [docs/GREASY_FORK.md](docs/GREASY_FORK.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

Torn Market Edge is an independent community userscript and is not affiliated with or endorsed by Torn Ltd. Use it at your own risk. Market estimates can be wrong and do not guarantee profit.
