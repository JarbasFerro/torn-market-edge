"use strict";

// DOM fixture tests. They exercise the Torn page collectors against saved
// HTML shapes so selector regressions are caught before release. jsdom is an
// optional development dependency: without it these tests are skipped.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM = null;
try {
  ({ JSDOM } = require("jsdom"));
} catch {
  JSDOM = null;
}

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "torn-market-edge.user.js"), "utf8");

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function boot(html, url, { responses = () => ({}), pda = false, source = SOURCE, gmMenu = true } = {}) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const window = dom.window;
  const store = new Map();
  const requests = [];

  // jsdom has no layout engine; give every element a plausible box so the
  // visibility filters in the collectors behave like a real browser.
  window.Element.prototype.getBoundingClientRect = function boundingBox() {
    const rows = 40;
    return { width: 320, height: rows, top: 10, bottom: 10 + rows, left: 0, right: 320, x: 0, y: 10 };
  };
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get() { return this.textContent; },
    set(value) { this.textContent = value; },
  });

  window.GM_getValue = (key, fallback) => (store.has(key) ? store.get(key) : fallback);
  window.GM_setValue = (key, value) => { store.set(key, value); };
  window.GM_deleteValue = (key) => { store.delete(key); };
  window.GM_addStyle = () => {};
  if (gmMenu) window.GM_registerMenuCommand = () => {};

  const answer = (requestUrl) => {
    const body = responses(requestUrl);
    return { status: 200, responseText: JSON.stringify(body) };
  };
  if (pda) {
    window.PDA_httpGet = (requestUrl, headers) => {
      requests.push({ url: requestUrl, headers, transport: "pda" });
      return Promise.resolve(answer(requestUrl));
    };
  } else {
    window.GM_xmlhttpRequest = (options) => {
      requests.push({ url: options.url, headers: options.headers, transport: "gm" });
      options.onload(answer(options.url));
    };
  }

  window.__MARKET_EDGE_EXPOSE_DOM__ = true;
  window.eval(source);
  const ME = window.__MARKET_EDGE_DOM__;
  assert.ok(ME, "DOM helpers must be exposed in test mode");
  return { dom, window, document: window.document, ME, store, requests, close: () => dom.window.close() };
}

const run = JSDOM ? test : test.skip;

run("Bazaar add rows expose price and quantity inputs without submitting", (t) => {
  const env = boot(fixture("bazaar-add.html"), "https://www.torn.com/bazaar.php#/add");
  t.after(env.close);
  assert.equal(env.ME.detectSurface(), "bazaar");
  const section = env.ME.bazaarAddSection();
  assert.ok(section, "bazaar add section must be found via #bazaarRoot");
  const rows = env.ME.knownBazaarAddRows(section);
  assert.equal(rows.length, 2, "disabled rows are excluded");
  const items = env.ME.collectBazaarAddItems();
  assert.equal(items.length, 2);
  const xanax = items.find((item) => item.itemId === 206);
  assert.ok(xanax);
  assert.equal(xanax.name, "Xanax");
  assert.equal(xanax.maxAvailable, 25);
  assert.ok(xanax.priceInput.classList.contains("input-money"));
  assert.ok(xanax.quantityInput.classList.contains("clear-all"));
  assert.equal(xanax.bazaarAdd, true);
  const plushie = items.find((item) => item.itemId === 258);
  assert.equal(plushie.maxAvailable, 3, "native max attribute caps the quantity");
});

run("Inventory collector ignores the equipped loadout above Your Items", (t) => {
  const env = boot(fixture("inventory.html"), "https://www.torn.com/item.php#drugs-items");
  t.after(env.close);
  assert.equal(env.ME.detectSurface(), "inventory");
  const marker = env.ME.inventoryListMarker();
  assert.ok(marker, "Your Items heading must be recognised");
  const items = env.ME.collectVisibleItems({ requireMoney: false });
  const ids = items.map((item) => item.itemId).sort((a, b) => a - b);
  assert.equal(ids.join(","), "206,258");
  const xanax = items.find((item) => item.itemId === 206);
  assert.equal(xanax.quantity, 10);
  assert.equal(xanax.name, "Xanax");
});

run("Own Bazaar managed rows read Price per unit and not RRP", (t) => {
  const env = boot(fixture("bazaar-manage.html"), "https://www.torn.com/bazaar.php#/manage");
  t.after(env.close);
  const items = env.ME.collectManagedBazaarItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].itemId, 206);
  assert.equal(items[0].price, 800000);
  assert.equal(items[0].quantity, 5);
  assert.ok(items[0].priceInput instanceof env.window.HTMLInputElement);
});

run("Auction House rows parse item id, name and current bid", (t) => {
  const env = boot(fixture("auction.html"), "https://www.torn.com/amarket.php");
  t.after(env.close);
  assert.equal(env.ME.detectSurface(), "auction");
  const rows = env.ME.collectAuctionItems();
  assert.equal(rows.length, 2);
  const xanax = rows.find((row) => row.itemId === 206);
  assert.equal(xanax.name, "Xanax");
  assert.equal(xanax.price, 500000);
  const noBid = rows.find((row) => row.itemId === 258);
  assert.equal(noBid.price, 0);
});

run("Item Market live listings are parsed and de-duplicated", (t) => {
  const env = boot(fixture("itemmarket.html"), "https://www.torn.com/page.php?sid=ItemMarket#/market/view=sell&itemID=206&itemName=Xanax");
  t.after(env.close);
  assert.equal(env.ME.detectSurface(), "itemmarket");
  assert.equal(env.ME.getItemIdFromLocation(), 206);
  const rows = env.ME.parseLiveItemMarketListings();
  assert.equal(JSON.stringify(rows.map((row) => [row.price, row.quantity])), JSON.stringify([[820000, 3], [825000, 10], [900000, 1]]));
  assert.equal(env.ME.ownListingsRouteActive(), false);
});

run("Manage-listings style routes open the own listings panel", (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/page.php?sid=ItemMarket#/market/view=manage");
  t.after(env.close);
  assert.equal(env.ME.ownListingsRouteActive(), true);
});

run("GM transport sends the ApiKey header and maps Torn error codes", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php", {
    responses: (url) => (url.includes("/key/info")
      ? { error: { code: 16, error: "Access level of this key is not high enough" } }
      : { itemmarket: { item: { id: 206, name: "Xanax", type: "Drug", average_price: 840000 }, listings: [{ price: 820000, amount: 3 }], cache_timestamp: 1, cache_delay: 30 } }),
  });
  t.after(env.close);
  env.ME.Store.setApiKey("ABCDEFGHIJKLMNOP");
  const payload = await env.ME.api.itemMarket(206);
  assert.equal(payload.itemmarket.item.name, "Xanax");
  assert.equal(env.requests[0].transport, "gm");
  assert.equal(env.requests[0].headers.Authorization, "ApiKey ABCDEFGHIJKLMNOP");
  assert.match(env.requests[0].url, /comment=market-edge/);
  await assert.rejects(env.ME.api.keyInfo({ cacheMs: 0 }), (error) => error.tornCode === 16);
});

run("Torn PDA transport and injected key are used when present", async (t) => {
  const pdaSource = SOURCE.replace("###PDA-APIKEY###", "PDAKEY1234567890");
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php", {
    pda: true,
    gmMenu: false,
    source: pdaSource,
    responses: () => ({ itemmarket: { item: { id: 206, name: "Xanax", type: "Drug", average_price: 840000 }, listings: [{ price: 820000, amount: 3 }], cache_timestamp: 1, cache_delay: 30 } }),
  });
  t.after(env.close);
  assert.equal(env.ME.ENV.isPda, true);
  assert.equal(env.ME.ENV.hasPdaRequest, true);
  assert.equal(env.ME.Store.apiKey(), "PDAKEY1234567890", "injected PDA key is the fallback when nothing is stored");
  await env.ME.api.itemMarket(206);
  assert.equal(env.requests[0].transport, "pda");
  assert.equal(env.requests[0].headers.Authorization, "ApiKey PDAKEY1234567890");
  env.ME.ensureLauncher();
  assert.ok(env.document.querySelector(".me-launcher"), "launcher is available without a userscript menu");
});

run("Settings modal exposes the fee, museum and watchlist controls", (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php");
  t.after(env.close);
  env.ME.showSettings();
  const modal = env.document.querySelector(".me-modal");
  assert.ok(modal);
  ["anonymousListing", "anonymousFeeWaived", "museumSetsEnabled", "watchlistEnabled", "watchlistIntervalSeconds"].forEach((key) => {
    assert.ok(modal.querySelector(`[data-setting="${key}"]`), `setting ${key} must be editable`);
  });
  assert.ok(modal.querySelector("#me-watch-add"));
  env.ME.addWatchItem({ itemId: 206, name: "Xanax", target: 800000 });
  assert.equal(env.ME.Store.watchlist().length, 1);
});

run("Inline inventory result shows the museum set route", (t) => {
  const env = boot(fixture("inventory.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  const items = env.ME.collectVisibleItems({ requireMoney: false });
  const plushie = items.find((item) => item.itemId === 258);
  const snapshot = {
    itemId: 258, itemName: "Jaguar Plushie", averagePrice: 100000, cacheTimestamp: Math.floor(Date.now() / 1000),
    listings: [{ price: 100000, quantity: 10 }, { price: 101000, quantity: 10 }], lowestPrice: 100000,
    calculatedMarketAnchor: 100000, depthMetrics: { listingCount: 2, top5Quantity: 20, top20Quantity: 20 }, supportedCommodity: true,
  };
  const history = { historicalFairValue: null, oneDay: { count: 0, volatility: null } };
  const result = env.ME.resultForSurface("inventory", plushie, snapshot, history, false, {}, { impliedValue: 150000, label: "Plushie set", complete: true });
  assert.equal(result.inventory.routes.bestRoute, "Museum set");
  const block = env.ME.renderInlineResult("inventory", result, false);
  assert.match(block.textContent, /Plushie set \$149k/, "museum set is the best route and leads the line, in words");
  assert.match(block.textContent, /3 owned/, "owned quantity");
  assert.match(block.textContent, /\$446k/, "total for the owned quantity");
  assert.equal(block.querySelector("[title]"), null, "no tooltip attributes on the line");
  assert.match(block.querySelector(".me-why").textContent, /Bazaar: \$98,010 per unit/, "other routes are in the why panel");
  const toggle = block.querySelector(".me-why-toggle");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "tapping ? opens the explanation");
  assert.ok(block.querySelector(".me-why").classList.contains("me-open"));
});

