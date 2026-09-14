"use strict";

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
const NOW = Math.floor(Date.now() / 1000);

function boot(html, url, { bazaarItems = [], imListings = [] } = {}) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const window = dom.window;
  const store = new Map();
  const requests = [];

  window.Element.prototype.getBoundingClientRect = () => ({ width: 320, height: 40, top: 10, bottom: 50, left: 0, right: 320, x: 0, y: 10 });
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get() { return this.textContent; },
    set(value) { this.textContent = value; }
  });

  window.GM_getValue = (key, fallback) => (store.has(key) ? store.get(key) : fallback);
  window.GM_setValue = (key, value) => { store.set(key, value); };
  window.GM_deleteValue = (key) => { store.delete(key); };

  window.GM_xmlhttpRequest = (opts) => {
    requests.push(opts.url);
    const url = opts.url;
    let payload = {};

    if (url.includes("/market/258/itemmarket")) {
      // Fox Plushie book with floor of 45000 (undercutting 50000)
      payload = {
        itemmarket: {
          item: { id: 258, name: "Fox Plushie", type: "Plushie", average_price: 48000 },
          listings: [{ price: 45000, amount: 10 }, { price: 48000, amount: 20 }],
          cache_timestamp: NOW - 5,
          cache_delay: 30
        },
        _metadata: { total: 2 }
      };
    } else if (url.includes("/user/bazaar")) {
      payload = { bazaar: bazaarItems };
    } else if (url.includes("/user/itemmarket")) {
      payload = { itemmarket: imListings, _metadata: { links: { next: null, prev: null } } };
    } else if (url.includes("/key/info")) {
      payload = {
        info: {
          selections: { user: ["basic", "itemmarket", "bazaar"], market: ["itemmarket"] },
          access: { type: "Limited Access", level: 3, faction: false, company: false, log: false },
          user: { id: 12345, faction_id: null, company_id: null }
        }
      };
    } else if (url.includes("/items")) {
      payload = { items: [{ id: 258, name: "Fox Plushie", type: "Plushie", is_tradable: true, value: { market_price: 48000, shops: [] } }] };
    }

    setTimeout(() => {
      opts.onload({
        status: 200,
        responseText: JSON.stringify(payload),
        responseHeaders: "Content-Type: application/json\r\nx-torn-cache: 30"
      });
    }, 0);
  };

  window.__MARKET_EDGE_EXPOSE_DOM__ = true;
  window.eval(SOURCE);
  const ME = window.__MARKET_EDGE_DOM__;
  ME.Store.setApiKey("test-key-sync");
  return { dom, window, document: window.document, ME, requests, close: () => window.close() };
}

run("normalizeOwnBazaar parses bazaar listings and filters invalid rows", () => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php");
  try {
    const norm = env.ME.normalizeOwnBazaar;
    assert.equal(typeof norm, "function");

    const parsed = norm({
      bazaar: [
        { ID: 258, name: "Fox Plushie", price: 50000, quantity: 3, type: "Plushie", UID: null },
        { id: 206, name: "Xanax", cost: 835000, amount: 10 },
        { ID: 0, price: 100 },
        { ID: 123, price: 0 }
      ]
    });

    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].itemId, 258);
    assert.equal(parsed[0].name, "Fox Plushie");
    assert.equal(parsed[0].price, 50000);
    assert.equal(parsed[0].amount, 3);
    assert.equal(parsed[0].type, "Plushie");

    assert.equal(parsed[1].itemId, 206);
    assert.equal(parsed[1].name, "Xanax");
    assert.equal(parsed[1].price, 835000);
    assert.equal(parsed[1].amount, 10);

    assert.equal(norm({}).length, 0);
    assert.equal(norm(null).length, 0);
    assert.equal(norm({ bazaar: [] }).length, 0);
  } finally {
    env.close();
  }
});

run("recordSellWatch with empty entries and prune:true clears venue listings down to 0", () => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php");
  try {
    // Record both a Bazaar item and an IM item
    env.ME.recordSellWatch([{ itemId: 258, name: "Fox Plushie", price: 50000, amount: 1 }], "Bazaar");
    env.ME.recordSellWatch([{ itemId: 206, name: "Xanax", price: 850000, amount: 5 }], "IM");

    assert.equal(env.ME.Store.sellWatch().length, 2);

    // Prune Bazaar with empty entries
    env.ME.recordSellWatch([], "Bazaar", { prune: true });
    const remaining = env.ME.Store.sellWatch();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].venue, "IM");
    assert.equal(remaining[0].itemId, 206);

    // Prune IM with empty entries
    env.ME.recordSellWatch([], "IM", { prune: true });
    assert.equal(env.ME.Store.sellWatch().length, 0);
  } finally {
    env.close();
  }
});

run("sellWatchTick syncs with API and prunes items no longer published for sale without alerting", async () => {
  // Setup: User has Fox Plushie in sellWatch, but user bazaar is empty in API response
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php", {
    bazaarItems: [] // nothing published for sale!
  });
  try {
    env.ME.recordSellWatch([{ itemId: 258, name: "Fox Plushie", price: 50000, amount: 1 }], "Bazaar");
    assert.equal(env.ME.Store.sellWatch().length, 1);

    // Run watch tick (which executes sellWatchTick -> syncSellWatchWithApi)
    await env.ME.watchTick({ force: true });

    // Fox Plushie should have been pruned automatically!
    assert.equal(env.ME.Store.sellWatch().length, 0, "Fox plushie must be removed since not in user bazaar");

    // No undercut toast should be raised
    const toast = env.document.querySelector(".me-toast");
    assert.equal(toast, null, "No toast should appear for items no longer published for sale");
  } finally {
    env.close();
  }
});

run("sellWatchTick updates price if listing price changed in bazaar", async () => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php", {
    bazaarItems: [{ ID: 258, name: "Fox Plushie", price: 44000, quantity: 2 }]
  });
  try {
    env.ME.recordSellWatch([{ itemId: 258, name: "Fox Plushie", price: 50000, amount: 1 }], "Bazaar");
    await env.ME.watchTick({ force: true });

    const watch = env.ME.Store.sellWatch();
    assert.equal(watch.length, 1);
    assert.equal(watch[0].price, 44000);
    assert.equal(watch[0].amount, 2);
  } finally {
    env.close();
  }
});

run("Undercut toast carries Dismiss alert button that removes item from sellWatch", async () => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php", {
    bazaarItems: [{ ID: 258, name: "Fox Plushie", price: 50000, quantity: 1 }]
  });
  try {
    env.ME.recordSellWatch([{ itemId: 258, name: "Fox Plushie", price: 50000, amount: 1 }], "Bazaar");
    await env.ME.watchTick({ force: true });

    const toast = env.document.querySelector(".me-toast");
    assert.ok(toast, "Toast is shown when item is undercut and still listed");
    assert.match(toast.textContent, /Undercut: Fox Plushie/);

    const dismissBtn = toast.querySelector(".me-toast-remove-sell");
    assert.ok(dismissBtn, "Toast has Dismiss alert button");

    dismissBtn.click();
    assert.equal(env.ME.Store.sellWatch().length, 0, "Clicking dismiss removes item from sellWatch");
    assert.equal(env.document.querySelector(".me-toast"), null, "Toast is removed");
  } finally {
    env.close();
  }
});

run("Watchlist panel Clear listings button wipes sellWatch", () => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php");
  try {
    env.ME.recordSellWatch([{ itemId: 258, name: "Fox Plushie", price: 50000, amount: 1 }], "Bazaar");
    assert.equal(env.ME.Store.sellWatch().length, 1);

    env.ME.renderWatchlistPanel();
    const clearBtn = env.document.querySelector(".me-sell-clear");
    assert.ok(clearBtn, "Clear listings button is present");

    clearBtn.click();
    assert.equal(env.ME.Store.sellWatch().length, 0, "Clear listings clears all sell watch entries");
  } finally {
    env.close();
  }
});
