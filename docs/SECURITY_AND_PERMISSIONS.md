# Security and userscript permissions

Torn Market Edge deliberately uses a small userscript permission surface and has no external executable dependencies.

## Metadata permissions

### `@match https://www.torn.com/*`

Runs Market Edge only on Torn pages. The script determines the current Torn surface at runtime and removes its UI when the page is not supported.

### `@grant GM_xmlhttpRequest`

Used only for requests to Torn's official API. The userscript metadata restricts cross-origin access with:

`@connect api.torn.com`

Market Edge does not use this permission to fetch hidden Torn website pages.

### `@grant GM_getValue`, `GM_setValue`, `GM_deleteValue`

Used for local persistence of:

- API key;
- settings;
- compact recent market snapshots;
- derived local market-history points;
- cached item metadata;
- small UI state values.

### `@grant GM_addStyle`

Adds Market Edge's local CSS to the currently opened Torn page.

### `@grant GM_registerMenuCommand`

Adds userscript-manager menu commands for settings and a manual analysis of the current page.

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

## Reporting security problems

Do not include API keys or other credentials in public GitHub issues. For a normal bug that does not expose a secret, use the repository issue tracker with sanitized screenshots/logs.
