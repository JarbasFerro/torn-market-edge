# Privacy and data handling

Torn Market Edge is designed to operate locally in the user's browser.

## Data sent over the network

The userscript sends requests only to Torn's official API host:

`https://api.torn.com`

The API key is transmitted to Torn using the API authorization header. It is not intentionally transmitted to GitHub, Greasy Fork, the script author, analytics providers, advertising services, or any other third party.

Market Edge does not load or execute remote JavaScript.

## Torn API endpoints used

All requests go to `https://api.torn.com/v2` with the `comment=market-edge` parameter so they are identifiable in your Torn API log:

- `/market/{id}/itemmarket` (order books);
- `/market/pointsmarket` (museum set valuation);
- `/torn/{ids}/items` (item metadata and official market prices);
- `/key/info` (access level, when you test the key);
- `/user/basic` (fallback player identification);
- `/user/itemmarket` (your own listings, only when you open that panel and only with a Limited key);
- `/user/inventory` (your inventory, only when you open the Portfolio panel and only with a Minimal or higher key);
- `/torn/cityshops` (city shop stock and prices, Shops panel and city shop pages);
- `/torn/items` (item catalog for foreign shop prices, Travel plan, at most once per six hours);
- `/market/{id}/auctionhouse` (ended auctions, evidence for stackable items on the Item Market and Auction House pages).

Inside Torn PDA the requests go through PDA's own HTTP bridge to the same host. When neither the userscript bridge nor PDA is available, the browser's `fetch` is used, still only to `api.torn.com`.

## Data stored locally

Market Edge may persist the following in userscript-manager storage (or, inside Torn PDA without userscript storage, in the page's local storage):

- API key;
- Market Edge settings;
- player ID used for page-context detection;
- API key access level and permitted selections (never the key itself in that record);
- UI/panel state;
- watchlist entries (item IDs, names, target prices, last observed floor);
- compact recent market snapshots, including equipment floor summaries;
- recent ended Auction House sale prices per equipment item;
- the current points-market ask;
- derived local market-history observations;
- cached Torn item metadata;
- per-item pricing rules for the repricing workbench;
- your own listed prices (item, venue, price, quantity) recorded for undercut alerts;
- a compact copy of your inventory (item ids, amounts, uids) for the Portfolio panel;
- city shop stock and the compact shop catalog (item ids, names, market and shop prices).

This data is used only to provide the script's market-analysis functionality, reduce unnecessary Torn API requests, and improve loading performance. Your own Item Market listings are fetched on demand and are not persisted.

## Torn page data

Market Edge may read the DOM of the Torn page that the player has manually opened in order to identify visible items, prices, quantities and page context.

The script does not intentionally scrape Torn pages that the user has not opened. DOM processing is suspended when the page is not visible.

## Analytics, tracking and advertising

Market Edge contains no analytics, advertising, miners, tracking pixels or author telemetry.

## API key safety

Never post your API key in a GitHub issue, Greasy Fork discussion, screenshot, diagnostic export or console log.

To revoke access immediately, revoke/delete the key in Torn's API settings. You can also remove the key from Market Edge settings.

To remove Market Edge's locally stored data completely, remove the userscript and its associated userscript-manager storage.

## Changes to this policy

If future versions introduce any external service or additional data-sharing behavior, it must be disclosed here and in the userscript/Greasy Fork description before release.
