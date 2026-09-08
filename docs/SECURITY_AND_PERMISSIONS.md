# Security and userscript permissions

Torn Market Edge deliberately uses a small userscript permission surface and has no external executable dependencies.

## Metadata permissions

### `@match https://www.torn.com/*`

Runs Market Edge only on Torn pages. The script determines the current Torn surface at runtime and removes its UI when the page is not supported.

### `@grant GM_xmlhttpRequest`

Used only for requests to Torn's official API. The userscript metadata restricts cross-origin access with:

`@connect api.torn.com`

Market Edge does not use this permission to fetch hidden Torn website pages.

Transport fallbacks, in order: Torn PDA's `PDA_httpGet` bridge when running inside PDA, `GM_xmlhttpRequest`, then the page's own `fetch`. All three are called with the same `https://api.torn.com/v2` URLs and the `Authorization: ApiKey` header; there is no other host. The regression tests assert that `@connect` lists only `api.torn.com`.

### `@grant GM_getValue`, `GM_setValue`, `GM_deleteValue`

Used for local persistence of:

- API key;
- settings;
- API key access level (from `/key/info`);
- watchlist entries;
- compact recent market snapshots and equipment floor summaries;
- recent ended Auction House sale prices per equipment item;
- the current points-market ask;
- derived local market-history points;
- cached item metadata;
- pricing rules, recorded own listing prices, a compact inventory snapshot, per-uid item details, city shop stock and the shop catalog (v0.4.0);
- small UI state values.

When GM storage is unavailable (some Torn PDA builds), the same values are kept in `localStorage` under a `marketEdge.local.` prefix.

### `@grant GM_addStyle`

Adds Market Edge's local CSS to the currently opened Torn page. Without it a `<style>` element is appended instead.

### `@grant GM_registerMenuCommand`

Adds userscript-manager menu commands for settings, manual analysis of the current page, your Item Market listings and the watchlist. Without a menu (Torn PDA) a small on-page **ME** launcher provides the same entries.

## Torn PDA API key injection

The source contains the literal `###PDA-APIKEY###`. Torn PDA replaces it with the player's key at load time; every other environment leaves it untouched and the script ignores it. The injected key is used only when no key has been entered in settings and is never written back to storage.

## API key handling

The key is stored locally through the userscript manager and transmitted only to `https://api.torn.com` in Torn's API authorization header.

The script must never:

- print the API key to the console;
- include it in diagnostics or exports;
- add it to page markup;
- transmit it to GitHub, Greasy Fork, analytics, ads or another service.

If a key may have been exposed, revoke it immediately in Torn and create a replacement.

## Remote code

Market Edge contains no `@require`, remote JavaScript loader, dynamic `<script>` injection, `eval()` of downloaded code, or external backend.

All primary executable functionality is present in the Greasy Fork/GitHub userscript source so users can inspect it before installation.

## Game-action safeguards

Market Edge is decision support only. It does not automatically:

- buy;
- sell;
- bid;
- submit forms;
- simulate clicks for game actions;
- refresh Torn pages;
- interact with CAPTCHA.

When page-derived information is needed, Market Edge reads only the Torn page the player has manually opened. DOM processing is suspended while the page is not visible.

The repricing workbench and the Bazaar fill controls only write values into Torn's own input fields after an explicit tap (or the explicit "Fill all" menu action); Torn's save, update and add buttons are never pressed. The only simulated click remains the Bazaar maximum-quantity checkbox inside the user's own fill tap.

The watchlist is API-only: it never loads Torn pages in the background, polls at a user-configured interval of at least 30 seconds only while a Torn tab is visible, and alerts with an in-page toast. Acting on an alert is a manual decision. The regression tests assert that the assembled script contains no `.click()`, `.submit()` or `location.reload` calls.

## Reporting security problems

Do not include API keys or other credentials in public GitHub issues. For a normal bug that does not expose a secret, use the repository issue tracker with sanitized screenshots/logs.
