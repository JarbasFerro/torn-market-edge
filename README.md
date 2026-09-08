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

**v0.3.0 beta**

The current release adds official-API cold-start valuation, the full Item Market 2.0 fee model, an own-listings panel, museum set economics, weapon/armor comparables, an API-only watchlist and Torn PDA support. It should still be treated as a public beta while Torn DOM integration is validated across more pages and devices.

## Supported surfaces

- Item Market (including your own listings)
- Your Bazaar
- Other players' Bazaars when manually opened
- Auction House
- Foreign shops while travelling
- Inventory

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

Greasy Fork publication is being prepared. Once published, Greasy Fork will be the recommended installation and update channel.

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

- **Public**: Item Market analysis, Bazaar, Auction House, travel, inventory, museum sets, equipment comparables, watchlist.
- **Limited**: everything above plus the **Your Item Market listings** panel (`/user/itemmarket`).

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

For weapons and armor the engine instead groups listings by rarity and bonus set, matches quality softly, and caps the comparable median with ended Auction House sales from the last 30 days. To price a copy you own, open its item details on the Bazaar add form or inventory: the card that appears prices that exact quality and bonus roll and can fill the Bazaar form with `^`. Equipment rows on inventory and your own Bazaar make no market requests until you do that.

Displayed profit values are estimates, not guarantees. Market liquidity and future prices are uncertain.

## Watchlist and Torn's rules

The watchlist polls only the official Item Market API, only while a Torn tab is visible, at a user-configured interval of at least 30 seconds, and respects Torn's global cache delay. Alerts are an in-page toast and a title marker. Market Edge never buys, so acting on an alert remains a manual decision.

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
