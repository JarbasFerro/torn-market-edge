"use strict";

// v0.7.2: fill prices paced to the player's trips and backlog, and abroad
// resale priced at what Market Edge would fill after the trip.

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
require(path.join(__dirname, "..", "torn-market-edge.user.js"));
const ME = globalThis.__MARKET_EDGE_TEST__;

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

// 20 levels of 5 units, $1,000 apart.
function levels(lowest) {
  return Array.from({ length: 20 }, (_, index) => ({ price: lowest + index * 1000, quantity: 5 }));
}

test("tripUnitsFor: setting first, then the capacity seen abroad, then travel capacity; off when disabled", () => {
  assert.equal(ME.tripUnitsFor({ tripUnits: 30, travelCapacity: 10 }, 28), 30);
  assert.equal(ME.tripUnitsFor({ tripUnits: 0, travelCapacity: 10 }, 28), 28);
  assert.equal(ME.tripUnitsFor({ tripUnits: 0, travelCapacity: 10 }, 0), 10);
  assert.equal(ME.tripUnitsFor({ tripUnits: 0, travelCapacity: 0 }, 0), 0);
  assert.equal(ME.tripUnitsFor({ paceToTrips: false, tripUnits: 30 }, 28), 0);
});

test("pacedFloorSuggestion: floor with one trip or less, then linearly down to the anchor, reached at three trips", () => {
  const snapshot = { lowestPrice: 32475, listings: levels(32475) };
  const args = { snapshot, tripUnits: 28, undercut: 1, anchor: 29934 };
  const oneTrip = ME.pacedFloorSuggestion({ ...args, backlog: 28 });
  assert.equal(oneTrip.price, 32474);
  assert.equal(oneTrip.paced, false);

  // 2 trips: halfway from 32,474 to 29,934.
  const twoTrips = ME.pacedFloorSuggestion({ ...args, backlog: 56 });
  assert.equal(twoTrips.paced, true);
  assert.equal(twoTrips.weight, 0.5);
  assert.equal(twoTrips.price, 31204);
  assert.equal(twoTrips.trips, 2);

  assert.equal(ME.pacedFloorSuggestion({ ...args, backlog: 84 }).price, 29934, "3 trips: the anchor");
  assert.equal(ME.pacedFloorSuggestion({ ...args, backlog: 112 }).price, 29934, "never below the anchor");

  const anchorAbove = ME.pacedFloorSuggestion({ ...args, backlog: 112, anchor: 33000 });
  assert.equal(anchorAbove.price, 32474, "an anchor above the floor never lifts the price");
  assert.equal(anchorAbove.paced, false);

  assert.equal(ME.pacedFloorSuggestion({ ...args, backlog: 112, tripUnits: 0 }).price, 32474, "pacing off: the floor");
  assert.equal(ME.pacedFloorSuggestion({ ...args, backlog: 112, anchor: null }).price, 32474, "no anchor: the floor");
  assert.equal(ME.pacedFloorSuggestion({ snapshot: { lowestPrice: null, listings: [] }, backlog: 5, tripUnits: 28 }), null);
});

test("sellBacklog adds listed holdings to unlisted row units, and counts a listed row once", () => {
  assert.equal(ME.sellBacklog({ holding: { bazaar: 84, im: 0 }, rowUnits: 28 }), 112);
  assert.equal(ME.sellBacklog({ holding: { bazaar: 60, im: 24 }, rowUnits: 60, rowListed: true }), 84);
  assert.equal(ME.sellBacklog({ holding: null, rowUnits: 28 }), 28);
  assert.equal(ME.sellBacklog({ holding: { bazaar: 10, im: 0 }, rowUnits: 40, rowListed: true }), 40, "a fresher row count wins over a cached holding");
});

// ---------------------------------------------------------------------------
// DOM: the Bazaar add strip and abroad rows
// ---------------------------------------------------------------------------

function bookPayload(itemId, name, lowest, average) {
  return {
    itemmarket: {
      item: { id: itemId, name, type: "Plushie", average_price: average },
      listings: levels(lowest).map((row) => ({ price: row.price, amount: row.quantity })),
      cache_timestamp: Math.floor(Date.now() / 1000),
      cache_delay: 30,
    },
  };
}

function boot(html, url, { responses, settings = {} } = {}) {
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
  store.set("marketEdge.settings.v1", { ...ME.DEFAULTS, ...settings });
  window.GM_getValue = (k, fallback) => (store.has(k) ? store.get(k) : fallback);
  window.GM_setValue = (k, value) => { store.set(k, value); };
  window.GM_deleteValue = (k) => { store.delete(k); };
  window.GM_listValues = () => Array.from(store.keys());
  window.GM_addStyle = () => {};
  window.GM_registerMenuCommand = () => {};
  window.GM_xmlhttpRequest = (options) => {
    requests.push(options.url);
    options.onload({ status: 200, responseText: JSON.stringify(responses(options.url)) });
  };
  window.__MARKET_EDGE_EXPOSE_DOM__ = true;
  window.__MARKET_EDGE_PDA_WAIT_MS__ = 20;
  window.eval(SOURCE);
  const ME_DOM = window.__MARKET_EDGE_DOM__;
  ME_DOM.Store.setApiKey("test-key");
  return { dom, window, document: window.document, ME: ME_DOM, store, requests, close: () => dom.window.close() };
}

function marketResponses({ bazaar = [], lowest = 30000, average = 50000 } = {}) {
  return (url) => {
    const market = url.match(/\/market\/(\d+)\/itemmarket/);
    if (market) return bookPayload(Number(market[1]), `Item ${market[1]}`, lowest, average);
    if (url.includes("/user/bazaar")) return { bazaar };
    if (url.includes("/user/itemmarket")) return { error: { code: 16, error: "Access level of this key is not high enough" } };
    if (url.includes("/torn/") && url.includes("/items")) {
      const ids = (url.match(/\/torn\/([\d,]+)\/items/) || [])[1] || "";
      return { items: ids.split(",").filter(Boolean).map((id) => ({ id: Number(id), name: `Item ${id}`, type: "Plushie", value: { market_price: average, shops: [] }, is_tradable: true })) };
    }
    if (url.includes("/market/pointsmarket")) return { pointsmarket: [] };
    if (url.includes("/key/info")) return { info: { access: { type: "Public Only", level: 1 }, selections: {} } };
    return {};
  };
}

const run = JSDOM ? test : test.skip;

run("Bazaar add strip: with 84 already in the Bazaar, the 3 being added are priced at the anchor", async (t) => {
  const env = boot(fixture("bazaar-add.html"), "https://www.torn.com/bazaar.php#/add", {
    settings: { tripUnits: 28, museumSetsEnabled: false },
    // Torn's daily average under the floor: real sales happen below it.
    responses: marketResponses({ bazaar: [{ id: 258, name: "Jaguar Plushie", price: 31000, quantity: 84 }], average: 27000 }),
  });
  t.after(env.close);
  await env.ME.scanVisibleSurface("bazaar", { force: true });
  const strip = env.document.querySelector(".me-inline-analysis[data-me-item-id='258']");
  assert.ok(strip, "plushie row annotated");
  const why = strip.querySelector(".me-why").textContent;
  const anchor = Number((why.match(/down to the conservative anchor \(\$([\d,]+)\)/) || [])[1].replace(/,/g, ""));
  assert.ok(anchor > 20000 && anchor < 29999, `anchor below the floor (${anchor})`);
  assert.equal(strip.meFillInfo.target, anchor, "87 held = 3.1 trips: the anchor");
  assert.match(strip.textContent, /87 held \(3\.1 trips\) \u00b7 at anchor/);
  assert.match(why, /You hold 87 units \(3\.1 trips of 28\), so the price moves all the way from the floor \(\$29,999\)/);
  assert.ok(env.requests.some((url) => url.includes("/user/bazaar")), "Bazaar holdings read from the API");
});

run("Bazaar add strip: 2 trips held is halfway from the floor to the anchor", async (t) => {
  const env = boot(fixture("bazaar-add.html"), "https://www.torn.com/bazaar.php#/add", {
    settings: { tripUnits: 28, museumSetsEnabled: false },
    responses: marketResponses({ bazaar: [{ id: 258, name: "Jaguar Plushie", price: 31000, quantity: 53 }], average: 27000 }),
  });
  t.after(env.close);
  await env.ME.scanVisibleSurface("bazaar", { force: true });
  const strip = env.document.querySelector(".me-inline-analysis[data-me-item-id='258']");
  const why = strip.querySelector(".me-why").textContent;
  const anchor = Number((why.match(/conservative anchor \(\$([\d,]+)\)/) || [])[1].replace(/,/g, ""));
  assert.equal(strip.meFillInfo.target, Math.round(29999 - (29999 - anchor) * 0.5));
  assert.match(strip.textContent, /56 held \(2 trips\) \u00b7 50% to anchor/);
});

run("Bazaar add strip: one trip or less in hand stays at the floor minus the undercut", async (t) => {
  const env = boot(fixture("bazaar-add.html"), "https://www.torn.com/bazaar.php#/add", {
    settings: { tripUnits: 28, museumSetsEnabled: false },
    responses: marketResponses({ bazaar: [], average: 27000 }),
  });
  t.after(env.close);
  await env.ME.scanVisibleSurface("bazaar", { force: true });
  const strip = env.document.querySelector(".me-inline-analysis[data-me-item-id='258']");
  assert.equal(strip.meFillInfo.target, 29999);
  assert.match(strip.textContent, /IM floor \$30,000 − \$1/);
});

run("Pacing off: no holdings request and the floor minus the undercut", async (t) => {
  const env = boot(fixture("bazaar-add.html"), "https://www.torn.com/bazaar.php#/add", {
    settings: { paceToTrips: false, tripUnits: 28, museumSetsEnabled: false },
    responses: marketResponses({ bazaar: [{ id: 258, name: "Jaguar Plushie", price: 31000, quantity: 84 }] }),
  });
  t.after(env.close);
  await env.ME.scanVisibleSurface("bazaar", { force: true });
  const strip = env.document.querySelector(".me-inline-analysis[data-me-item-id='258']");
  assert.equal(strip.meFillInfo.target, 29999);
  assert.ok(!env.requests.some((url) => url.includes("/user/bazaar")), "no holdings request when pacing is off");
});

run("Abroad: capacity read from the page sets the trip size, and a backlog lowers that item's resale to the anchor", async (t) => {
  const responses = (bazaar) => (url) => {
    const market = url.match(/\/market\/(\d+)\/itemmarket/);
    if (market) {
      const id = Number(market[1]);
      const lowest = id === 263 ? 6400 : id === 206 ? 800000 : 150;
      return bookPayload(id, `Item ${id}`, lowest, id === 263 ? 6000 : lowest + 20000);
    }
    return marketResponses({ bazaar })(url);
  };
  const fresh = boot(fixture("travel-abroad.html"), "https://www.torn.com/page.php?sid=travel", { responses: responses([]) });
  t.after(fresh.close);
  await fresh.ME.scanVisibleSurface("travel", { force: true });
  assert.equal(fresh.ME.Store.get("marketEdge.lastTripCapacity.v1", 0), 28, "capacity remembered from Torn's message");
  const heatherFresh = fresh.document.querySelector(".me-inline-analysis[data-me-item-id='263']");
  assert.match(heatherFresh.querySelector(".me-why").textContent, /Resale in your Bazaar at \$6,399 per unit/, "no backlog: resale at the floor minus $1");
  assert.match(heatherFresh.querySelector(".me-why").textContent, /You hold 28 units, one trip \(28\) or less/);

  const backlog = boot(fixture("travel-abroad.html"), "https://www.torn.com/page.php?sid=travel", { responses: responses([{ id: 263, name: "Heather", price: 6500, quantity: 56 }]) });
  t.after(backlog.close);
  await backlog.ME.scanVisibleSurface("travel", { force: true });
  const heather = backlog.document.querySelector(".me-inline-analysis[data-me-item-id='263']");
  const why = heather.querySelector(".me-why").textContent;
  const resale = Number((why.match(/Resale in your Bazaar at \$([\d,]+)/) || [])[1].replace(/,/g, ""));
  const anchor = Number((why.match(/conservative anchor \(\$([\d,]+)\)/) || [])[1].replace(/,/g, ""));
  assert.equal(resale, anchor, "56 held + 28 this trip = 3 trips: the anchor");
  assert.ok(resale < 6399);
  assert.match(why, /You hold 84 units \(3 trips of 28\)/);
});
