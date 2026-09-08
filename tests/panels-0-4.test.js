"use strict";

// v0.4.0 end-to-end panel tests in jsdom with a stubbed Torn API: portfolio,
// city shop runs, travel plan, browse-grid overlay, Auction House equipment
// guidance, the repricing workbench and the sell-side (undercut) watch.

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
        { price: 790000, amount: 2 }, { price: 835000, amount: 20 }, { price: 836000, amount: 15 },
        { price: 838000, amount: 30 }, { price: 840000, amount: 50 }, { price: 845000, amount: 40 },
      ],
      cache_timestamp: NOW - 5,
      cache_delay: 30,
    },
    _metadata: { total: 6 },
  };
}

function rifleBook() {
  const plain = (price, quality, uid) => ({ price, amount: 1, item_details: { uid, stats: { damage: 60, accuracy: 55, armor: null, quality }, bonuses: [], rarity: null } });
  return {
    itemmarket: {
      item: { id: 1, name: "Fixture Rifle", type: "Weapon", average_price: 1000000 },
      listings: [plain(800000, 50, 1), plain(1000000, 52, 2), plain(1020000, 49, 3), plain(1050000, 51, 4), plain(1100000, 53, 5)],
      cache_timestamp: NOW - 5,
      cache_delay: 30,
    },
    _metadata: { total: 5 },
  };
}

function itemMeta(id) {
  const n = Number(id);
  if (n === 206) return { id: 206, name: "Xanax", type: "Drug", is_tradable: true, value: { market_price: 840000, shops: [{ country: "Japan", shop: "Black Market", buy_price: 700000, sell_price: null }] } };
  if (n === 1) return { id: 1, name: "Fixture Rifle", type: "Weapon", is_tradable: true, value: { market_price: 1000000, shops: [] } };
  if (n === 300) return { id: 300, name: "Bag of Chocolate Kisses", type: "Candy", is_tradable: true, value: { market_price: 1200, shops: [{ country: "Torn", shop: "Sally's Sweet Shop", buy_price: 250, sell_price: 100 }] } };
  if (n === 9001) return { id: 9001, name: "Patagonian Fossil", type: "Other", is_tradable: true, value: { market_price: 500000, shops: [{ country: "Argentina", shop: "Black Market", buy_price: 400000, sell_price: null }] } };
  return { id: n, name: `Item ${n}`, type: "Plushie", is_tradable: true, value: { market_price: 100000, shops: [] } };
}

function responder(url) {
  if (url.includes("/market/206/itemmarket")) return xanaxBook();
  if (url.includes("/market/1/itemmarket")) return rifleBook();
  if (url.includes("/market/300/itemmarket")) return { itemmarket: { item: { id: 300, name: "Bag of Chocolate Kisses", type: "Candy", average_price: 1200 }, listings: [{ price: 1100, amount: 500 }, { price: 1150, amount: 800 }, { price: 1200, amount: 900 }], cache_timestamp: NOW - 5, cache_delay: 30 } };
  if (url.includes("/market/1/auctionhouse")) {
    return { auctionhouse: [
      { id: 1, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: NOW - 3600, price: 950000, bids: 3, item: { id: 1, uid: 9, name: "Fixture Rifle", type: "Weapon", sub_type: "Rifle", stats: { quality: 50 }, bonuses: [], rarity: null } },
    ] };
  }
  if (url.includes("/market/206/auctionhouse")) {
    return { auctionhouse: [
      { id: 5, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: NOW - 3600, price: 700000, bids: 2, item: { id: 206, uid: 50, name: "Xanax", type: "Drug" } },
      { id: 6, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: NOW - 7200, price: 720000, bids: 4, item: { id: 206, uid: 51, name: "Xanax", type: "Drug" } },
    ] };
  }
  if (url.includes("/market/777/auctionhouselisting")) {
    return { auctionhouselisting: { id: 777, seller: { id: 1, name: "a" }, buyer: { id: 0, name: "" }, timestamp: NOW + 3600, price: 500000, bids: 1, item: { id: 1, uid: 12, name: "Fixture Rifle", type: "Weapon", sub_type: "Rifle", stats: { damage: 61, accuracy: 55, armor: null, quality: 50.5 }, bonuses: [], rarity: null } } };
  }
  if (url.includes("/market/pointsmarket")) return { pointsmarket: [{ id: 1, quantity: 10, cost: 45000, total_cost: 450000 }] };
  if (url.includes("/user/inventory")) {
    return { inventory: { items: [
      { id: 206, amount: 12, equipped: false, name: "Xanax", faction_owned: false, uid: null },
      { id: 1, amount: 1, equipped: false, name: "Fixture Rifle", faction_owned: false, uid: 555 },
      { id: 9001, amount: 1, equipped: false, name: "Patagonian Fossil", faction_owned: false, uid: null },
    ], timestamp: NOW }, _metadata: { total: 3, links: { next: null, prev: null } } };
  }
  if (url.includes("/user/itemmarket")) {
    return { itemmarket: [
      { id: 11, price: 850000, average_price: 840000, amount: 5, is_anonymous: false, available: 5, item: { id: 206, name: "Xanax", type: "Drug", rarity: null, uid: null, stats: null, bonuses: [] } },
    ], _metadata: { links: { next: null, prev: null } } };
  }
  if (url.includes("/torn/555/itemdetails")) {
    return { itemdetails: [{ id: 1, uid: 555, name: "Fixture Rifle", type: "Weapon", sub_type: "Rifle", stats: { damage: 60, accuracy: 55, armor: null, quality: 51 }, bonuses: [], rarity: null }] };
  }
  if (url.includes("/torn/cityshops")) {
    return { cityshops: [
      { id: 3, name: "Sally's Sweet Shop", items: [{ id: 300, name: "Bag of Chocolate Kisses", price: 250, stock: { current: 40, default: 100 } }] },
      { id: 4, name: "Big Al's Gun Shop", items: [{ id: 1, name: "Fixture Rifle", price: 900000, stock: { current: 3, default: 3 } }] },
    ] };
  }
  if (url.includes("/key/info")) {
    return { info: { selections: { user: ["basic", "itemmarket", "inventory"], market: ["itemmarket"] }, access: { type: "Limited Access", level: 3, faction: false, company: false, log: false }, user: { id: 12345, faction_id: null, company_id: null } } };
  }
  if (/\/torn\/items(\?|$)/.test(url)) {
    return { items: [itemMeta(206), itemMeta(1), itemMeta(300), itemMeta(9001)] };
  }
  if (url.includes("/items")) {
    const ids = (url.match(/\/torn\/([\d,]+)\/items/) || [])[1] || "";
    return { items: ids.split(",").filter(Boolean).map(itemMeta) };
  }
  return {};
}

function boot(html, url) {
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
  window.GM_xmlhttpRequest = (options) => {
    requests.push(options.url);
    setTimeout(() => options.onload({ status: 200, responseText: JSON.stringify(responder(options.url)) }), 0);
  };
  window.__MARKET_EDGE_EXPOSE_DOM__ = true;
  window.eval(SOURCE);
  const ME = window.__MARKET_EDGE_DOM__;
  ME.Store.setApiKey("ABCDEFGHIJKLMNOP");
  return { window, document: window.document, ME, requests, close: () => window.close() };
}

function panelText(env) {
  return env.document.querySelector("#market-edge-root")?.textContent || "";
}

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

run("Portfolio panel values the official inventory, then refines commodities and equipment copies by uid", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/item.php");
  t.after(env.close);
  await env.ME.api.keyInfo({ cacheMs: 0 });
  await env.ME.renderPortfolioPanel();
  let text = panelText(env);
  assert.match(text, /Portfolio \(official inventory\)/);
  assert.match(text, /Xanax/);
  assert.match(text, /Fixture Rifle/);
  assert.match(text, /Patagonian Fossil/);
  assert.match(text, /museum/, "fossil is recognised as a museum piece by name");
  assert.ok(env.requests.some((url) => url.includes("/user/inventory?limit=250&offset=0")));
  assert.ok(!env.requests.some((url) => url.includes("/market/206/itemmarket")), "quick pass fetches no order books");
  env.document.querySelector(".me-portfolio-refine").click();
  for (let i = 0; i < 40 && !/comps/.test(panelText(env)); i += 1) await tick();
  text = panelText(env);
  assert.match(text, /book/, "commodity rows are refined from the order book");
  assert.match(text, /Q 51\.0% plain/, "the rifle copy is priced from its uid details");
  assert.ok(env.requests.some((url) => url.includes("/torn/555/itemdetails")));
  assert.ok(env.requests.some((url) => url.includes("/market/1/itemmarket?limit=100")));
});

run("Portfolio panel refuses without a Minimal key and spends no request", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/item.php");
  t.after(env.close);
  env.ME.Store.saveKeyInfo({ selections: { user: ["basic"], market: ["itemmarket"] }, access: { type: "Public Only", level: 1 }, user: { id: 1 } });
  await env.ME.renderPortfolioPanel();
  assert.match(panelText(env), /Minimal access API key/);
  assert.ok(!env.requests.some((url) => url.includes("/user/inventory")));
});

run("City shop runs panel ranks official shop stock by net profit and scopes to the current shop", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/shops.php?step=candy");
  t.after(env.close);
  assert.equal(env.ME.detectSurface(), "cityshop");
  assert.equal(env.ME.currentCityShopName(), "Sally's Sweet Shop");
  await env.ME.renderShopRunsPanel();
  const text = panelText(env);
  assert.match(text, /City shop runs - Sally's Sweet Shop/);
  assert.match(text, /Bag of Chocolate Kisses/);
  assert.doesNotMatch(text, /Fixture Rifle/, "other shops and equipment are excluded");
  assert.match(text, /Profitable after fees1/);
  assert.match(text, /x40/, "run quantity is capped by stock");
  assert.ok(env.requests.some((url) => url.includes("/torn/cityshops")));
});

run("Travel plan ranks countries from official foreign shop prices and uses capacity", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php");
  t.after(env.close);
  env.ME.Store.saveSettings({ ...env.ME.Store.settings(), travelCapacity: 10 });
  env.ME.reloadSettings();
  await env.ME.renderTravelPlanPanel();
  const text = panelText(env);
  assert.match(text, /Travel plan/);
  assert.match(text, /Japan - best Xanax/);
  assert.match(text, /Argentina/);
  assert.match(text, /10 items per trip/);
  assert.ok(env.requests.some((url) => /\/torn\/items(\?|$)/.test(url)), "one catalog request");
});

run("Item Market browse grid is annotated against the official market value without order-book requests", async (t) => {
  const env = boot(fixture("itemmarket-browse.html"), "https://www.torn.com/page.php?sid=ItemMarket#/market/view=category&categoryName=Drugs");
  t.after(env.close);
  await env.ME.renderItemMarket();
  for (let i = 0; i < 40 && env.document.querySelectorAll(".me-inline-analysis").length < 3; i += 1) await tick();
  const blocks = Array.from(env.document.querySelectorAll(".me-inline-analysis"));
  const byItem = Object.fromEntries(blocks.map((block) => [block.dataset.meItemId, block]));
  assert.match(byItem["206"].textContent, /-4\.8% vs MV/);
  assert.match(byItem["206"].textContent, /CONSIDER/);
  assert.match(byItem["258"].textContent, /\+20\.0% vs MV/);
  assert.match(byItem["258"].textContent, /ABOVE MV/);
  assert.ok(byItem["1"].classList.contains("me-hidden"), "equipment cards are left alone");
  assert.ok(!env.requests.some((url) => url.includes("/itemmarket?")), "no per-item order book on the grid");
  assert.equal(env.requests.filter((url) => /\/torn\/[\d,]+\/items/.test(url)).length, 1, "one metadata batch");
});

run("Auction House rows show sold evidence for commodities and a max bid for the exact equipment copy", async (t) => {
  const env = boot(fixture("auction-equipment.html"), "https://www.torn.com/amarket.php");
  t.after(env.close);
  await env.ME.scanVisibleSurface("auction", { force: true });
  for (let i = 0; i < 40 && !/Q 50\.5%/.test(env.document.body.textContent); i += 1) await tick();
  const blocks = Array.from(env.document.querySelectorAll(".me-inline-analysis"));
  const rifle = blocks.find((block) => block.dataset.meItemId === "1");
  const xanax = blocks.find((block) => block.dataset.meItemId === "206");
  assert.match(xanax.textContent, /sold \$710k/, "ended auction median is shown for stackable items");
  const maxBid = Number((xanax.textContent.match(/Max \$([\d.]+)k/) || [])[1]) * 1000;
  assert.ok(maxBid > 0 && maxBid <= 710000, `max bid ${maxBid} never exceeds the recent sold median`);
  assert.match(rifle.textContent, /Max \$/);
  assert.match(rifle.textContent, /Q 50\.5% plain/);
  assert.match(rifle.textContent, /CONSIDER/);
  assert.ok(env.requests.some((url) => url.includes("/market/777/auctionhouselisting")));
  assert.ok(env.requests.some((url) => url.includes("/market/206/auctionhouse")));
});

run("Own listings workbench fills Torn's price field on the manage page and persists pricing rules", async (t) => {
  const env = boot(fixture("itemmarket-manage.html"), "https://www.torn.com/page.php?sid=ItemMarket#/market/view=manage");
  t.after(env.close);
  await env.ME.api.keyInfo({ cacheMs: 0 });
  await env.ME.renderOwnListingsPanel();
  for (let i = 0; i < 40 && !env.document.querySelector(".me-listing-fill"); i += 1) await tick();
  const fill = env.document.querySelector(".me-listing-fill");
  assert.ok(fill, "a fill control is offered for the undercut listing");
  assert.equal(fill.dataset.price, "789999", "floor minus the default $1 undercut");
  fill.click();
  const input = env.document.querySelector("input[name='price']");
  assert.equal(input.value, "789999");
  assert.match(env.document.querySelector(".me-workbench-status").textContent, /Filled 1 field/);
  // Switch the rule to hold the anchor target and set a minimum.
  const mode = env.document.querySelector(".me-rule-mode");
  mode.value = "anchor";
  mode.dispatchEvent(new env.window.Event("change", { bubbles: true }));
  await tick();
  assert.equal(env.ME.Store.pricingRules()[206].mode, "anchor");
  const min = env.document.querySelector(".me-rule-min");
  min.value = "830000";
  min.dispatchEvent(new env.window.Event("change", { bubbles: true }));
  await tick();
  assert.equal(env.ME.Store.pricingRules()[206].minPrice, 830000);
  assert.ok(env.ME.Store.sellWatch().some((entry) => entry.itemId === 206 && entry.venue === "IM" && entry.price === 850000), "own listing is recorded for undercut alerts");
});

run("Sell-side watch raises an undercut toast for a recorded own listing", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php");
  t.after(env.close);
  env.ME.recordSellWatch([{ itemId: 206, name: "Xanax", price: 850000, amount: 5 }], "IM");
  assert.equal(env.ME.Store.sellWatch().length, 1);
  await env.ME.watchTick({ force: true });
  const toast = env.document.querySelector(".me-toast");
  assert.ok(toast, "toast is shown");
  assert.match(toast.textContent, /Undercut: Xanax/);
  assert.match(toast.textContent, /\$790k/);
  env.ME.renderWatchlistPanel();
  assert.match(panelText(env), /Your listings \(undercut alerts\)/);
  assert.match(panelText(env), /Xanax IM/);
  // Removing the listing from the recorded venue drops the entry.
  env.ME.recordSellWatch([{ itemId: 258, name: "Jaguar Plushie", price: 50000, amount: 1 }], "IM");
  assert.equal(JSON.stringify(env.ME.Store.sellWatch().map((entry) => entry.itemId)), "[258]");
});

run("Own Bazaar manage rows offer a fill control and fill-all writes every visible suggestion", async (t) => {
  const env = boot(fixture("bazaar-manage.html"), "https://www.torn.com/bazaar.php#/manage");
  t.after(env.close);
  await env.ME.scanVisibleSurface("bazaar", { force: true });
  const block = env.document.querySelector(".me-inline-analysis[data-me-item-id='206']");
  assert.ok(block, "row is annotated");
  assert.match(block.textContent, /floor \$790k/);
  const button = block.querySelector(".me-manage-fill");
  assert.ok(button, "manage row carries a fill control");
  const filled = env.ME.fillAllVisiblePrices();
  assert.equal(filled, 1);
  assert.equal(env.document.querySelector("input[name='price']").value, "789999");
  assert.ok(env.ME.Store.sellWatch().some((entry) => entry.venue === "Bazaar" && entry.itemId === 206), "own Bazaar price is recorded for undercut alerts");
});
