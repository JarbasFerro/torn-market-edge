"use strict";

// v0.6.0: viewport-first scanning, bounded store, PDA transport retry, the
// in-row API key prompt, the "why" explanation and the settings dialog.

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

function book(itemId, name, lowest) {
  const listings = [];
  for (let index = 0; index < 20; index += 1) listings.push({ price: lowest + index * 1000, amount: 5 });
  return { itemmarket: { item: { id: itemId, name, type: "Drug", average_price: lowest + 20000 }, listings, cache_timestamp: Math.floor(Date.now() / 1000), cache_delay: 30 } };
}

function defaultResponses(url) {
  const market = url.match(/\/market\/(\d+)\/itemmarket/);
  if (market) return book(Number(market[1]), `Item ${market[1]}`, 800000);
  if (url.includes("/torn/") && url.includes("/items")) {
    const ids = (url.match(/\/torn\/([\d,]+)\/items/) || [])[1] || "";
    return { items: ids.split(",").filter(Boolean).map((id) => ({ id: Number(id), name: `Item ${id}`, type: "Drug", value: { market_price: 820000, shops: [] }, is_tradable: true })) };
  }
  if (url.includes("/market/pointsmarket")) return { pointsmarket: [] };
  if (url.includes("/key/info")) return { info: { access: { type: "Public Only", level: 1 }, selections: {} } };
  return {};
}

function boot(html, url, { responses = defaultResponses, pda = false, pdaGet = null, gmMenu = true, key = "test-key" } = {}) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const window = dom.window;
  const store = new Map();
  const requests = [];
  window.Element.prototype.getBoundingClientRect = function boundingBox() {
    return { width: 320, height: 40, top: 10, bottom: 50, left: 0, right: 320, x: 0, y: 10 };
  };
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get() { return this.textContent; },
    set(value) { this.textContent = value; },
  });
  window.GM_getValue = (k, fallback) => (store.has(k) ? store.get(k) : fallback);
  window.GM_setValue = (k, value) => { store.set(k, value); };
  window.GM_deleteValue = (k) => { store.delete(k); };
  window.GM_listValues = () => Array.from(store.keys());
  window.GM_addStyle = () => {};
  if (gmMenu) window.GM_registerMenuCommand = () => {};
  const answer = (requestUrl) => ({ status: 200, responseText: JSON.stringify(responses(requestUrl)) });
  if (pda) {
    window.PDA_httpGet = pdaGet
      ? (requestUrl, headers) => { requests.push(requestUrl); return pdaGet(requestUrl, headers, answer); }
      : (requestUrl) => { requests.push(requestUrl); return Promise.resolve(answer(requestUrl)); };
  } else {
    window.GM_xmlhttpRequest = (options) => { requests.push(options.url); options.onload(answer(options.url)); };
  }
  window.__MARKET_EDGE_EXPOSE_DOM__ = true;
  window.__MARKET_EDGE_PDA_WAIT_MS__ = 20;
  window.eval(SOURCE);
  const ME = window.__MARKET_EDGE_DOM__;
  if (key) ME.Store.setApiKey(key);
  return { dom, window, document: window.document, ME, store, requests, close: () => dom.window.close() };
}

const run = JSDOM ? test : test.skip;

run("Torn PDA: an undefined response (duplicate URL within 2 s) is retried instead of parsed as an empty body", async (t) => {
  let marketCalls = 0;
  const env = boot(fixture("inventory.html"), "https://www.torn.com/item.php", {
    pda: true,
    pdaGet: (url, headers, answer) => {
      if (url.includes("/market/206/itemmarket")) {
        marketCalls += 1;
        if (marketCalls === 1) return Promise.resolve(undefined);
      }
      return Promise.resolve(answer(url));
    },
  });
  t.after(env.close);
  await env.ME.scanVisibleSurface("inventory", { force: true });
  const xanax = env.document.querySelector(".me-inline-analysis[data-me-item-id='206']");
  assert.ok(xanax, "row annotated");
  assert.match(xanax.textContent, /Bazaar \$/, "priced after the retry");
  assert.equal(env.requests.filter((url) => url.includes("/market/206/itemmarket")).length, 2, "one retry after the dedupe window");
});

run("Store batches writes, flushes them to the backend and prunes the oldest item records beyond the cap", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/item.php");
  t.after(env.close);
  const { Store } = env.ME;
  Store.set("marketEdge.snapshot.v3.900", { itemId: 900, timestampObserved: 0 });
  assert.equal(env.store.has("marketEdge.snapshot.v3.900"), false, "write is memory-first");
  assert.equal(Store.get("marketEdge.snapshot.v3.900", null).itemId, 900, "readable at once");
  Store.flush();
  assert.equal(env.store.has("marketEdge.snapshot.v3.900"), true, "flushed to GM storage");
  for (let index = 1; index <= 5; index += 1) Store.set(`marketEdge.itemMeta.v2.${index}`, { savedAt: index * 1000, meta: { id: index } });
  Store.flush();
  const pruned = Store.prune({ max: 3 });
  assert.equal(pruned, 3, "six item records, cap three");
  Store.flush();
  assert.equal(env.store.has("marketEdge.snapshot.v3.900"), false, "oldest record removed first");
  assert.equal(env.store.has("marketEdge.itemMeta.v2.1"), false);
  assert.equal(env.store.has("marketEdge.itemMeta.v2.5"), true, "newest records kept");
  assert.equal(Store.get("marketEdge.itemMeta.v2.1", null), null, "deleted records read as absent");
});

run("Rows far below the fold are deferred rather than fetched", async (t) => {
  const env = boot(fixture("inventory.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  const far = env.document.querySelector("img[src*='/items/258/']")?.closest("li");
  assert.ok(far, "fixture has the plushie row");
  far.querySelectorAll("*").forEach((node) => { node.getBoundingClientRect = () => ({ width: 320, height: 40, top: 5000, bottom: 5040, left: 0, right: 320, x: 0, y: 5000 }); });
  far.getBoundingClientRect = () => ({ width: 320, height: 40, top: 5000, bottom: 5040, left: 0, right: 320, x: 0, y: 5000 });
  await env.ME.scanVisibleSurface("inventory", { force: true });
  assert.ok(env.document.querySelector(".me-inline-analysis[data-me-item-id='206']"), "row on screen is priced");
  assert.equal(env.document.querySelector(".me-inline-analysis[data-me-item-id='258']"), null, "row far below the fold waits");
  assert.ok(!env.requests.some((url) => url.includes("/market/258/itemmarket")), "no order book for the deferred row");
});

run("Without an API key every row offers an Add API key button that opens settings", async (t) => {
  const env = boot(fixture("inventory.html"), "https://www.torn.com/item.php", { key: "" });
  t.after(env.close);
  await env.ME.scanVisibleSurface("inventory", { force: true });
  const cta = env.document.querySelector(".me-inline-analysis .me-key-cta");
  assert.ok(cta, "call to action on the row");
  assert.equal(env.requests.length, 0, "no request without a key");
  cta.click();
  assert.ok(env.document.querySelector(".me-modal"), "settings dialog opened from the row");
  assert.equal(env.document.activeElement?.id || "", "", "focus is scheduled, not forced synchronously");
});

run("Sell strip carries a why panel and warns when the suggested price is far below Torn's value", async (t) => {
  const env = boot(fixture("itemmarket-sell.html"), "https://www.torn.com/page.php?sid=ItemMarket#/addListing", {
    responses: (url) => {
      const market = url.match(/\/market\/(\d+)\/itemmarket/);
      if (market) {
        const data = book(Number(market[1]), `Item ${market[1]}`, 100000);
        data.itemmarket.item.average_price = 900000;
        return data;
      }
      return defaultResponses(url);
    },
  });
  t.after(env.close);
  await env.ME.scanVisibleSurface("imsell", { force: true });
  const xanax = env.document.querySelector(".me-inline-analysis[data-me-item-id='206']");
  assert.ok(xanax);
  assert.ok(xanax.classList.contains("YELLOW"), "warning state");
  assert.match(xanax.querySelector(".me-inline-warning").textContent, /Under half of Torn's value/);
  assert.equal(xanax.querySelector("[title]"), null, "still no tooltips");
  assert.match(xanax.querySelector(".me-why").textContent, /Cheapest Item Market listing \$100,000/);
  assert.match(xanax.querySelector(".me-why").textContent, /Listing stays manual/);
  assert.ok(xanax.querySelector(".me-fill-main"), "fill stays available");
});

run("Settings dialog: every control is labelled, Escape closes it and defaults can be restored", (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php");
  t.after(env.close);
  env.ME.showSettings();
  const modal = env.document.querySelector(".me-modal");
  assert.ok(modal);
  modal.querySelectorAll("[data-setting]").forEach((input) => {
    assert.ok(input.id && modal.querySelector(`label[for="${input.id}"]`), `${input.dataset.setting} has a label`);
  });
  assert.ok(modal.querySelector("details.me-section[open] #me-api-key"), "API key section is open first");
  env.ME.Store.saveSettings({ itemMarketUndercut: 7 });
  env.window.confirm = () => true;
  modal.querySelector("#me-reset-settings").click();
  assert.equal(env.ME.Store.settings().itemMarketUndercut, 1, "reset restores the default");
  const reopened = env.document.querySelector(".me-modal");
  assert.ok(reopened && reopened !== modal, "dialog reopened with defaults");
  env.document.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(env.document.querySelector(".me-modal"), null, "Escape closes the dialog");
});

test("v0.6.0 guards remain present in the assembled userscript", () => {
  assert.match(SOURCE, /body\.dark-mode \{ --me-bg/, "theme tokens follow Torn's dark mode class");
  assert.match(SOURCE, /@media \(pointer: coarse\) \{ body \{ --me-tap:40px; \} \}/, "touch targets grow on touch screens");
  assert.match(SOURCE, /new IntersectionObserver\(/, "deferred rows use IntersectionObserver");
  assert.match(SOURCE, /PDA_storage/, "Torn PDA SQLite storage adapter");
  assert.match(SOURCE, /API_MEMORY_CACHE_MAX = 300/, "bounded API memory cache");
  assert.match(SOURCE, /STORE_MAX_ITEM_RECORDS = 400/, "bounded persisted item records");
  assert.doesNotMatch(SOURCE, /[“”‘’]/, "no curly quotes: Torn PDA rewrites them in script source");
});
