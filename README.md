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

**v0.2.1 beta**

The current release focuses on fast, inline market intelligence and mobile-friendly UX. It should be treated as a public beta while Torn DOM integration is validated across more pages and devices.

## Supported surfaces

- Item Market
- Your Bazaar
- Other players' Bazaars when manually opened
- Auction House
- Foreign shops while travelling
- Inventory

The commodity valuation model is intended for fungible/stackable items. Advanced weapon and armor valuation is intentionally not supported yet.

## Core features

- Official Torn API v2 integration
- Robust market anchor instead of using only the lowest listing
- Item Market/Bazaar fee-aware resale comparisons
- Prefix analysis for cheap Item Market listings
- Conservative exit-price model with configurable safety haircut
- ROI, expected profit, capital and confidence calculations
- Local price-history observations
- `cache_timestamp`/`cache_delay` aware caching
- Persistent stale-while-revalidate snapshots
- Shared-quota-aware API scheduler: 20 new requests/minute, 3 concurrent requests, staggered starts
- Automatic cooldown/retry when Torn returns API error 5 / HTTP 429
- Cancellation of stale queued requests when SPA categories change
- Viewport-demand loading: current rows plus a modest look-ahead instead of whole-category prefetch
- In-flight request deduplication
- Fast 20-listing snapshots on list pages and deeper analysis on Item Market pages
- SPA-safe inventory category detection
- Incremental per-row overlays instead of large floating panels on list pages
- Viewport-first loading
- Foreground-only DOM analysis
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
4. Use **Test API key**.
5. Open a supported Torn market/inventory page.

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
- minimum confidence for green classifications;
- maximum tolerated volatility;
- nearby-row scan size;
- travel capacity;
- local history retention;
- developer diagnostics.

## How valuation works

Market Edge does not use the current lowest listing as fair value. The lowest listing may be the opportunity we are trying to detect.

The engine separates:

1. current market floor;
2. market depth;
3. robust current-market anchor;
4. locally observed historical reference;
5. conservative executable exit estimate;
6. Bazaar versus Item Market net proceeds;
7. confidence and data freshness.

Displayed profit values are estimates, not guarantees. Market liquidity and future prices are uncertain.

## API rate limits

Torn's API limit is shared per player across API keys and tools. Market Edge deliberately keeps its own budget well below Torn's overall limit. If Torn still reports a rate limit because other tools are consuming the same quota, Market Edge pauses API work, keeps cached values visible where possible, and retries later instead of filling rows with repeated errors.

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
