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

**v0.4.0**

The current release adds a repricing workbench with per-item pricing rules and undercut alerts, a DOM-free portfolio panel with per-copy equipment pricing by uid, city shop runs and a travel plan from official shop data, Auction House transaction evidence with per-copy bid guidance and end-timing, and an Item Market browse-grid overlay. Torn DOM integration is still validated page by page, so treat new surfaces as beta.

## Supported surfaces

- Item Market (including your own listings)
- Your Bazaar
- Other players' Bazaars when manually opened
- Auction House
- Foreign shops while travelling
- Inventory
- Item Market browse grid (category and search cards)
- Item Market sell form (add listing)
- Torn city shops (shops.php, Big Al's)
- Panels that need no page at all: Portfolio, City shop runs, Travel plan

The commodity valuation model is intended for fungible/stackable items. Weapons and armor are valued separately through comparable groups (rarity + bonus set, quality matched) and ended Auction House sales; treat that as a floor check rather than a full valuation.

## Core features

- Official Torn API v2 integration (Public key for everything except your own listings)
- Robust market anchor instead of using only the lowest listing
- Torn's daily average price as a cold-start fair-value reference
- Fee-aware resale comparisons: Item Market 5% tax, optional 10% anonymous-listing fee, Auction House 3%, Bazaar and trades fee-free
- Museum set route for plushies and flowers (points market based)
- Prefix analysis for cheap Item Market listings
- Conservative exit-price model with configurable safety haircut
- ROI, expected profit, capital and confidence calculations
- Weapon/armor comparables with Auction House sales evidence
- Your Item Market listings versus the live floor (undercut detection)
- Repricing workbench: `^` fill and "Fill all" into Torn's price fields on your Item Market manage view and your Bazaar, with persistent per-item pricing rules (undercut floor, hold anchor, never fill, minimum price); saving stays manual
- Undercut alerts for your own Item Market and Bazaar prices, polled through the official order book
- Portfolio panel from the official inventory endpoint: sellable value per route, untradable and equipped flags, order-book refinement, and weapon/armor copies priced by uid without opening item details
- City shop runs from the official city shop endpoint (stock and price) and inline profit on city shop pages
- Travel plan from official foreign shop prices, ranked by profit per trip at your capacity
- Sell-to-shop exit route and museum pieces recognised by name (Meteorite Fragment, Patagonian Fossil, Arrowhead set)
- Auction House: ended-sales median as evidence and cap for stackable bids, per-copy maximum bid for weapons and armor, and a best end-time window from ended sales
- Item Market browse-grid overlay versus Torn's official market value with no per-item requests
- Watchlist with in-page alerts, polled only while a Torn tab is visible
- Local price-history observations
- `cache_timestamp`/`cache_delay` aware caching
- Persistent stale-while-revalidate snapshots
- Four-request bounded concurrency with a 70 requests/minute Market Edge ceiling
- In-flight request deduplication
- Fast 20-listing snapshots on list pages and deeper analysis on Item Market pages
- SPA-safe inventory category detection
- Incremental per-row overlays instead of large floating panels on list pages
- Viewport-first loading
- Foreground-only DOM analysis
- Torn PDA compatible (API key injection, PDA transport, on-page launcher)
- Local settings and API-key storage via userscript-manager storage

## Installation

### Greasy Fork

Greasy Fork is the recommended installation and update channel. It is synced automatically from this repository's `main` branch.

### Development / direct install

Install a compatible userscript manager such as Tampermonkey, then install:

`https://raw.githubusercontent.com/JarbasFerro/torn-market-edge/main/torn-market-edge.user.js`

After installation:

1. Open Torn.
2. Open the userscript menu and choose **Market Edge settings**.
3. Enter your Torn API key.
4. Use **Test API key**. The status line reports the key's access level.
5. Open a supported Torn market/inventory page.

### Torn PDA

Market Edge works inside Torn PDA. Add the script from the raw GitHub URL or Greasy Fork; PDA injects your API key automatically, and a small **ME** launcher at the bottom-left opens settings, page analysis, your listings and the watchlist because PDA has no userscript menu.

### API key access levels

- **Public**: Item Market analysis, Bazaar, Auction House, travel, inventory rows, museum sets, equipment comparables, watchlist, city shop runs, travel plan, browse-grid overlay.
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
- weapon/armor comparables on/off;
- minimum confidence for green classifications;
- maximum tolerated volatility;
- scan size;
- travel capacity;
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

For weapons and armor the engine instead groups listings by rarity and bonus set, matches quality softly, and caps the comparable median with ended Auction House sales from the last 30 days. Equipment rows on the inventory, the Bazaar add form and the Item Market sell form show the plain and bonus floors from one compact order book per item type. Rows that expose the copy's uid are priced as that exact copy automatically. Otherwise open the item's details: the card that appears prices that exact quality and bonus roll and can fill the form with `^`.

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
