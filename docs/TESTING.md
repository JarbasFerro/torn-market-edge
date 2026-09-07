# Testing guide

Torn Market Edge is a userscript running against a live SPA, so both economic regression tests and manual Torn integration checks are required.

## Economic regression scenarios

At minimum, preserve these cases:

1. **Obvious arbitrage** - a single cheap listing below a stable cluster should be detected.
2. **Fake gap** - a high second ask must not override a much lower historical fair value.
3. **Fees destroy profit** - a small apparent spread can become negative after the 5% Item Market fee.
4. **Bazaar profitable / Item Market not** - route recommendation must account for fees.
5. **Capital constraint** - huge cheap quantities must not exceed configured capital limits.
6. **No history** - confidence must stay low rather than inventing certainty.
7. **Volatile market** - large nominal discounts should be downgraded when volatility is excessive.
8. **Stale data** - stale API information must lower confidence/warn the user.
9. **Single listing** - do not invent market depth.
10. **Unsupported equipment** - do not apply the commodity model to stat-based equipment.

## Manual UI regression matrix

### Inventory

- Open Items -> Drugs.
- Confirm equipped items above **Your items** are not analyzed.
- Confirm every visible inventory row receives its own inline result.
- Switch Drugs -> Medical -> Boosters -> Candy -> Alcohol -> another category without refreshing.
- Confirm the new category starts processing automatically.
- Confirm cached items appear immediately when revisiting a category.
- Confirm multiple rows populate concurrently rather than strictly top-to-bottom.
- Confirm annotations remain on the same native quantity/name line.

### Your Bazaar

- Confirm Market Edge identifies your Bazaar pricing mode.
- Confirm it reads **Price per unit**, not RRP.
- Confirm changing the native price field updates/re-evaluates the inline information without submitting the Bazaar form.
- Confirm Market Edge does not click Save Changes or submit anything.

### Other Bazaar

- Manually open another player's Bazaar.
- Confirm only the currently opened page is read.
- Confirm visible commodity rows receive inline analysis.
- Confirm no hidden/background Bazaar navigation occurs.

### Item Market

- Open a supported stackable item.
- Confirm lowest price, current anchor and exit calculations load.
- Confirm the detailed page can use the deeper order-book limit.
- Confirm listing-level highlighting does not interfere with Torn's native purchase controls.

### Auction House

- Open the Auction House manually.
- Confirm supported commodity rows show maximum rational bid/headroom guidance.
- Confirm Market Edge never bids automatically.
- Confirm unsupported equipment is not valued using the commodity model.

### Travel shop

- While abroad, open the local shop manually.
- Confirm visible item prices are compared with Torn resale economics.
- Confirm configured travel capacity affects trip totals only when set.

## Mobile UX

Verify on a narrow/mobile viewport:

- native item name/quantity remains readable;
- Market Edge output does not create horizontal overflow;
- no large floating panel covers critical Torn controls on list pages;
- settings remain usable;
- no broken character encoding appears.

## Network/compliance audit

Before release, inspect the userscript for network/action primitives.

Expected outbound API mechanism:

- `GM_xmlhttpRequest` to `api.torn.com`.

There should be no code that:

- auto-clicks Torn controls;
- submits forms;
- reloads pages;
- downloads hidden Torn pages;
- executes remote JavaScript;
- sends the API key anywhere other than Torn's official API.

## API-rate behavior

- Maximum Market Edge budget: 45 requests/minute.
- Maximum in-flight concurrency: 4.
- Repeated item requests should use cache/in-flight deduplication when appropriate.
- List-style pages should use a small Item Market depth; detailed Item Market analysis may use deeper data.
