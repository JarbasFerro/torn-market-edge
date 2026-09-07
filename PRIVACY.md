# Privacy and data handling

Torn Market Edge is designed to operate locally in the user's browser.

## Data sent over the network

The userscript sends requests only to Torn's official API host:

`https://api.torn.com`

The API key is transmitted to Torn using the API authorization header. It is not intentionally transmitted to GitHub, Greasy Fork, the script author, analytics providers, advertising services, or any other third party.

Market Edge does not load or execute remote JavaScript.

## Data stored locally

Market Edge may persist the following in userscript-manager storage:

- API key;
- Market Edge settings;
- player ID used for page-context detection;
- UI/panel state;
- compact recent market snapshots;
- derived local market-history observations;
- cached Torn item metadata.

This data is used only to provide the script's market-analysis functionality, reduce unnecessary Torn API requests, and improve loading performance.

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
