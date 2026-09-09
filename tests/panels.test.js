"use strict";

// End-to-end panel smoke tests in jsdom with a stubbed Torn API. They make
// sure the Item Market, equipment, own-listings and watchlist code paths run
// without throwing and render the expected facts.

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
const run = JSDOM ? test : test.skip;

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

const NOW = Math.floor(Date.now() / 1000);

function xanaxBook() {
  return {
    itemmarket: {
      item: { id: 206, name: "Xanax", type: "Drug", average_price: 840000 },
      listings: [
        { price: 790000, amount: 2 },
        { price: 835000, amount: 20 },
        { price: 836000, amount: 15 },
        { price: 838000, amount: 30 },
        { price: 840000, amount: 50 },
        { price: 845000, amount: 40 },
      ],
      cache_timestamp: NOW - 5,
      cache_delay: 30,
    },
    _metadata: { total: 6, links: { next: null, prev: null } },
  };
}

function rifleBook() {
  const plain = (price, quality, uid) => ({ price, amount: 1, item_details: { uid, stats: { damage: 60, accuracy: 55, armor: null, quality }, bonuses: [], rarity: null } });
  return {
    itemmarket: {
      item: { id: 1, name: "Fixture Rifle", type: "Weapon", average_price: 1000000 },
      listings: [
        plain(800000, 50, 1), plain(1000000, 52, 2), plain(1020000, 49, 3), plain(1050000, 51, 4), plain(1100000, 53, 5),
        { price: 9000000, amount: 1, item_details: { uid: 6, stats: { damage: 70, accuracy: 60, armor: null, quality: 90 }, bonuses: [{ id: 1, title: "Bleed", description: "", value: 15 }], rarity: "orange" } },
      ],
      cache_timestamp: NOW - 5,
      cache_delay: 30,
    },
    _metadata: { total: 6 },
  };
}

function responder(url) {
  if (url.includes("/market/206/itemmarket")) return xanaxBook();
  if (url.includes("/market/1/itemmarket")) return rifleBook();
  if (url.includes("/market/1/auctionhouse")) {
    return { auctionhouse: [
      { id: 1, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: NOW - 3600, price: 950000, bids: 3, item: { id: 1, uid: 9, name: "Fixture Rifle", type: "Weapon", sub_type: "Rifle", stats: { quality: 50 }, bonuses: [], rarity: null } },
    ] };
  }
  if (url.includes("/market/pointsmarket")) return { pointsmarket: [{ id: 1, quantity: 10, cost: 45000, total_cost: 450000 }] };
  if (url.includes("/user/itemmarket")) {
    return { itemmarket: [
      { id: 11, price: 850000, average_price: 840000, amount: 5, is_anonymous: true, available: 5, item: { id: 206, name: "Xanax", type: "Drug", rarity: null, uid: null } },
    ], _metadata: { links: { next: null, prev: null } } };
  }
  if (url.includes("/key/info")) {
    return { info: { selections: { user: ["basic", "itemmarket"], market: ["itemmarket"] }, access: { type: "Limited Access", level: 3, faction: false, company: false, log: false }, user: { id: 12345, faction_id: null, company_id: null } } };
  }
  if (url.includes("/items")) {
    const ids = (url.match(/\/torn\/([\d,]+)\/items/) || [])[1] || "";
    return { items: ids.split(",").filter(Boolean).map((id) => ({ id: Number(id), name: `Item ${id}`, type: Number(id) === 206 ? "Drug" : ([1, 2].includes(Number(id)) ? "Weapon" : "Plushie"), is_tradable: true, value: { market_price: 100000, shops: [] } })) };
  }
  return {};
}

function boot(html, url, { pda = false, delayMs = 0, fail = () => false } = {}) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const window = dom.window;
  const store = new Map();
  const requests = [];
  window.Element.prototype.getBoundingClientRect = () => ({ width: 320, height: 40, top: 10, bottom: 50, left: 0, right: 320, x: 0, y: 10 });
  Object.defineProperty(window.HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent; }, set(value) { this.textContent = value; } });
  window.GM_getValue = (key, fallback) => (store.has(key) ? store.get(key) : fallback);
  window.GM_setValue = (key, value) => { store.set(key, value); };
  window.GM_deleteValue = (key) => { store.delete(key); };
  window.GM_addStyle = () => {};
  window.GM_registerMenuCommand = () => {};
  const answer = (requestUrl) => ({ status: 200, responseText: JSON.stringify(fail(requestUrl) ? { error: { code: 5, error: "Too many requests" } } : responder(requestUrl)) });
  if (pda) {
    window.PDA_httpGet = (requestUrl, headers) => { requests.push(requestUrl); return new Promise((resolve) => setTimeout(() => resolve(answer(requestUrl)), delayMs)); };
  } else {
    window.GM_xmlhttpRequest = (options) => { requests.push(options.url); setTimeout(() => options.onload(answer(options.url)), delayMs); };
  }
  window.__MARKET_EDGE_EXPOSE_DOM__ = true;
  window.eval(SOURCE);
  const ME = window.__MARKET_EDGE_DOM__;
  ME.Store.setApiKey("ABCDEFGHIJKLMNOP");
  return { window, document: window.document, ME, requests, close: () => window.close() };
}

function panelText(env) {
  return env.document.querySelector("#market-edge-root")?.textContent || "";
}

run("Item Market panel renders a cold-start verdict with official agreement and fee label", async (t) => {
  const env = boot(fixture("itemmarket.html"), "https://www.torn.com/page.php?sid=ItemMarket#/market/view=sell&itemID=206&itemName=Xanax");
  t.after(env.close);
  await env.ME.renderItemMarket();
  const text = panelText(env);
  assert.match(text, /Xanax/);
  assert.match(text, /Torn daily average/);
  assert.match(text, /\$840k/);
  assert.match(text, /agree, so no warm-up penalty/);
  assert.match(text, /IM net after 5%/);
  assert.match(text, /Auction net after 3%/);
  assert.match(text, /Best opportunity/);
  assert.match(text, /Buy2 units/);
  assert.ok(env.document.querySelector(".me-watch"), "watch control is rendered");
  assert.ok(env.requests.some((url) => url.includes("/market/206/itemmarket?limit=100")));
  assert.ok(!env.requests.some((url) => url.includes("pointsmarket")), "non-set items do not touch the points market");
});

run("Watch button adds the item and the watchlist tick alerts when the floor is at or below target", async (t) => {
  const env = boot(fixture("itemmarket.html"), "https://www.torn.com/page.php?sid=ItemMarket#/market/view=sell&itemID=206&itemName=Xanax");
  t.after(env.close);
  await env.ME.renderItemMarket();
  env.document.querySelector(".me-watch-target").value = "800000";
  env.document.querySelector(".me-watch").click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const entries = env.ME.Store.watchlist();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].target, 800000);
  await env.ME.watchTick({ force: true });
  const toast = env.document.querySelector(".me-toast");
  assert.ok(toast, "an in-page toast is shown");
  assert.match(toast.textContent, /Xanax/);
  assert.match(toast.textContent, /\$790k/);
  assert.match(env.document.title, /^\[ME\]/);
  assert.equal(env.ME.Store.watchlist()[0].lastFloor, 790000);
  env.ME.renderWatchlistPanel();
  assert.match(panelText(env), /Watchlist/);
  assert.match(panelText(env), /Xanax/);
});

run("Own listings panel compares each listing with the live floor", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/page.php?sid=ItemMarket#/market/view=manage");
  t.after(env.close);
  await env.ME.api.keyInfo({ cacheMs: 0 });
  await env.ME.renderItemMarket();
  const text = panelText(env);
  assert.match(text, /Your Item Market listings/);
  assert.match(text, /Active listings1/);
  assert.match(text, /Xanax/);
  assert.match(text, /anon/);
  assert.match(text, /CLOSE|UNDERCUT/);
  assert.ok(env.ME.ui.pinned, "menu panels stay pinned until closed");
  env.document.querySelector(".me-close").click();
  assert.equal(env.document.querySelector("#market-edge-root"), null);
});

run("Own listings panel explains when the key level is too low", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/page.php?sid=ItemMarket#/market/view=manage");
  t.after(env.close);
  env.ME.Store.saveKeyInfo({ selections: { user: ["basic"], market: ["itemmarket"] }, access: { type: "Public Only", level: 1 }, user: { id: 1 } });
  await env.ME.renderOwnListingsPanel();
  assert.match(panelText(env), /needs a Limited access API key/);
  assert.ok(!env.requests.some((url) => url.includes("/user/itemmarket")), "no request is wasted on a key that cannot succeed");
});

run("Inventory scan renders museum set values for plushies using one metadata batch", async (t) => {
  const env = boot(fixture("inventory.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  const context = await env.ME.loadMuseumContext([206, 258]);
  assert.equal(context.has(206), false);
  const plushie = context.get(258);
  assert.ok(plushie);
  assert.equal(plushie.complete, true);
  assert.equal(plushie.setValue, 450000);
  assert.equal(plushie.othersCost, 12 * 100000);
  assert.equal(env.requests.filter((url) => url.includes("pointsmarket")).length, 1);
  const metaRequests = env.requests.filter((url) => /\/torn\/[\d,]+\/items/.test(url));
  assert.equal(metaRequests.length, 1, "all set members are fetched in one batch");
});

run("Torn PDA transport drives the full Item Market panel", async (t) => {
  const env = boot(fixture("itemmarket.html"), "https://www.torn.com/page.php?sid=ItemMarket#/market/view=sell&itemID=206", { pda: true });
  t.after(env.close);
  await env.ME.renderItemMarket();
  assert.match(panelText(env), /Best opportunity/);
  assert.ok(env.requests.length >= 1);
});

run("Inventory scan annotates commodity, plushie and unsupported rows end to end", async (t) => {
  const env = boot(fixture("inventory.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  await env.ME.scanVisibleSurface("inventory", { force: true });
  const blocks = Array.from(env.document.querySelectorAll(".me-inline-analysis"));
  assert.equal(blocks.length, 2);
  const byItem = Object.fromEntries(blocks.map((block) => [block.dataset.meItemId, block.textContent]));
  assert.match(byItem["206"], /Bazaar \$820k/);
  assert.match(byItem["206"], /10 owned/);
  assert.match(byItem["206"], /\$8\.20m/, "total for the owned quantity");
  assert.equal(byItem["258"].includes("Plushie set"), false, "set route is hidden when the implied value is negative");
  assert.ok(env.requests.some((url) => url.includes("/market/258/itemmarket")));
  assert.equal(env.requests.filter((url) => url.includes("pointsmarket")).length, 1);
});

run("Settings modal builds a page structure report without the API key", (t) => {
  const env = boot(fixture("inventory.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  env.ME.showSettings();
  env.document.querySelector("#me-build-diagnostics").click();
  const report = env.document.querySelector("#me-diagnostics").value;
  assert.match(report, /surface: inventory/);
  assert.match(report, /rows collected: 2/);
  assert.match(report, /item 206 "/);
  assert.doesNotMatch(report, /ABCDEFGHIJKLMNOP/);
});

