# Greasy Fork publication guide

This file contains the exact listing copy and repository/sync process for Torn Market Edge.

## Recommended Greasy Fork fields

**Name**

Torn Market Edge

**Language**

English

**Script type**

User script (not a library)

**License**

MIT

**Adult content**

No

**Short description**

Decision-support overlay for Torn markets using the official Torn API. Compares market prices, resale routes, fees, risk and local history. No automated trades.

## Source / sync URL

Use the branch-based raw file URL, not a commit-specific URL:

`https://raw.githubusercontent.com/JarbasFerro/torn-market-edge/main/torn-market-edge.user.js`

Keeping the production userscript at one stable path is important for Greasy Fork sync/webhook updates.

## Additional Info - copy/paste

```markdown
# Torn Market Edge

Torn Market Edge is a local decision-support userscript for Torn's player economy. It adds compact market intelligence directly to Torn pages you manually open.

## What it does

Market Edge can help evaluate:

- **Item Market** listings and cheap listing prefixes;
- **your Bazaar**, including resale/pricing targets;
- **other players' Bazaars** that you manually open;
- **Auction House** commodity bids;
- **foreign shops while travelling**;
- **items already in your inventory**.

It compares current prices with a robust market anchor, locally observed history, fees, configurable risk assumptions and conservative exit prices.

The goal is to answer questions such as:

> Is this listing meaningfully underpriced?

> How many can I reasonably buy within my capital limit?

> Is Bazaar or Item Market the better expected exit after fees?

> Is this foreign-shop item worth bringing back to Torn?

## Important: no trading automation

Market Edge is **decision support only**.

It does **not**:

- buy items;
- sell items;
- place bids;
- submit Torn forms;
- simulate clicks for game actions;
- refresh Torn pages automatically;
- bypass CAPTCHA;
- scrape Torn pages that you have not manually opened.

Actual trading actions remain completely manual.

## Commodity model

The current valuation model is designed for economically fungible/stackable items such as drugs, boosters, consumables, flowers, plushies and similar commodities.

Weapons, armor and other stat/bonus-dependent equipment are not treated as ordinary commodities. Advanced equipment valuation is intentionally postponed until a dedicated model exists.

## Market methodology

Market Edge does **not** assume the current lowest listing is fair value. A cheap lowest listing may be exactly the opportunity being detected.

The engine considers:

- current market floor;
- market depth;
- quantity-aware robust market anchor;
- locally observed 1h/24h/7d history when available;
- data freshness;
- volatility;
- expected resale route;
- Item Market selling fee;
- Bazaar discount assumption;
- configurable safety haircut;
- capital limits;
- expected profit and ROI;
- confidence.

Displayed profit and exit values are estimates, not guarantees.

## Performance

v0.2.0 uses:

- bounded concurrent Torn API loading;
- a conservative Market Edge request budget;
- API request deduplication;
- Torn `cache_timestamp` / `cache_delay` awareness;
- persistent recent snapshots;
- stale-while-revalidate rendering;
- fast shallow market snapshots on list pages;
- deeper order-book analysis only where useful;
- SPA-aware incremental inventory scanning;
- viewport-first loading.

This is intended to make category switching and revisiting previously analyzed items much faster on mobile.

## API key

An API key is entered in Market Edge settings and stored locally by your userscript manager.

The key is sent only to Torn's official API at `api.torn.com` using Torn's API authorization header.

Market Edge does not send the key to the script author, Greasy Fork, GitHub, analytics providers or any other service.

For safety, never publish your API key in a screenshot, bug report or console log. You can revoke the key at any time from Torn's API settings.

## Privacy

Market Edge has:

- no analytics;
- no advertising;
- no trackers;
- no miners;
- no external backend;
- no remote executable code.

Settings, market snapshots and derived local history are stored locally in userscript-manager storage.

## Current status

**v0.2.0 is a beta release.**

Torn is a dynamic SPA and its DOM can change. If an overlay is missing or positioned incorrectly, please report the affected page, device, browser/userscript manager and a screenshot.

## Support / source

Source code and issue tracker:

https://github.com/JarbasFerro/torn-market-edge

## Disclaimer

Torn Market Edge is an independent community userscript and is not affiliated with or endorsed by Torn Ltd. Market estimates can be wrong. Use it at your own risk and make trading decisions manually.
```

## Why this should satisfy Greasy Fork's current code rules

Before publication, verify the current rules again. At the time this guide was prepared, Market Edge is structured to comply because:

- the full primary functionality is in the userscript source published on Greasy Fork;
- the source is readable and not minified/obfuscated;
- it has no external executable code or remote loader;
- there are no ads/trackers/author antifeatures;
- the description discloses what the script does;
- the `@match` is limited to Torn;
- the userscript metadata includes name, namespace, version, description and license;
- outbound userscript permission is limited to `api.torn.com`.

## Initial Greasy Fork import

1. Sign in to Greasy Fork.
2. Choose **Publish a script / Import from URL**.
3. Use the raw sync URL above.
4. Review the imported code and metadata.
5. Set the listing language to **English**.
6. Use the Additional Info text above.
7. Publish the initial version.
8. From the script's Greasy Fork management page, confirm external sync points to the branch-based raw URL.

Greasy Fork rewrites its hosted copy so installs from Greasy Fork update from Greasy Fork. Do not add a custom `@updateURL`/`@downloadURL` for the Greasy Fork distribution.

## Recommended update strategy

Use GitHub as the source of truth, but do **not** auto-publish every development commit.

Recommended release flow:

1. Develop/test on GitHub.
2. Increment `@version` only when preparing a public release.
3. Update `CHANGELOG.md`.
4. Commit the final `torn-market-edge.user.js` to `main`.
5. Create a GitHub release/tag such as `v0.2.1`.
6. Configure Greasy Fork's GitHub webhook to react to **release events only** if you want automatic publication on releases.
7. Verify the new Greasy Fork version after every webhook delivery.

This separates normal development pushes from public Greasy Fork updates.

## GitHub webhook

Greasy Fork provides the exact webhook **Payload URL** and **Secret** from its script-management/webhook setup page after the script has been imported.

On GitHub:

1. Open repository **Settings** -> **Webhooks** -> **Add webhook**.
2. Copy the Payload URL supplied by Greasy Fork.
3. Use content type `application/json` if requested by Greasy Fork's current instructions.
4. Copy the Greasy Fork-generated secret.
5. For the recommended release-only workflow, choose individual events and enable **Releases** rather than normal pushes.
6. Keep the webhook active.
7. After the first release event, check GitHub **Recent Deliveries** and confirm Greasy Fork reports the script as updated.

Do not invent the Payload URL or Secret in advance; use the values Greasy Fork generates for the specific script/account.

## Greasy Fork metadata notes

Greasy Fork requires `@namespace`, `@version` and at least one `@match`/`@include`. It also reads the `@license` field for the script listing.

After initial publication, avoid changing the combination of `@name` and `@namespace`, because userscript managers use them to identify the installed script.
