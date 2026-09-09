"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require(path.join(__dirname, "..", "torn-market-edge.user.js"));
const ME = globalThis.__MARKET_EDGE_TEST__;

assert.ok(ME, "userscript must expose pure test helpers in Node");

function settings(overrides = {}) {
  return {
    ...ME.DEFAULTS,
    availableCapital: 1_000_000,
    maxCapitalOpportunity: 100_000,
    maxCapitalItem: 100_000,
    minimumROI: 0.02,
    minimumProfit: 1,
    minimumDiscount: 0.03,
    safetyHaircut: 0,
    bazaarDiscount: 0,
    allowedHistoricalPremium: 1.01,
    itemMarketUndercut: 0,
    minimumGreenConfidence: "MEDIUM",
    maxVolatility: 0.03,
    ...overrides,
  };
}

function snapshot(listings, overrides = {}) {
  return {
    itemId: 1,
    itemName: "Fixture Item",
    averagePrice: 100,
    cacheTimestamp: Math.floor(Date.now() / 1000),
    listings,
    lowestPrice: listings[0]?.price ?? null,
    secondPrice: listings[1]?.price ?? null,
    thirdPrice: listings[2]?.price ?? null,
    calculatedMarketAnchor: 100,
    depthMetrics: {
      listingCount: listings.length,
      top5Quantity: listings.slice(0, 5).reduce((sum, row) => sum + row.quantity, 0),
      top20Quantity: listings.slice(0, 20).reduce((sum, row) => sum + row.quantity, 0),
    },
    supportedCommodity: true,
    ...overrides,
  };
}

function history(overrides = {}) {
  return {
    historicalFairValue: 100,
    oneDay: { count: 20, volatility: 0.01, medianAnchor: 100 },
    sampleConfidence: "MEDIUM",
    ...overrides,
  };
}

test("obvious arbitrage is detected against a stable cluster", () => {
  const snap = snapshot([
    { price: 80, quantity: 1 },
    { price: 100, quantity: 10 },
    { price: 101, quantity: 10 },
    { price: 102, quantity: 10 },
    { price: 103, quantity: 10 },
  ]);
  const result = ME.evaluatePrefixes(snap, history(), settings());
  assert.ok(result.best);
  assert.equal(result.best.quantityBought, 1);
  assert.ok(result.best.expectedProfit > 0);
  assert.ok(["GREEN", "YELLOW"].includes(result.best.classification.state));
});

test("a fake second-ask gap is capped by historical fair value", () => {
  const exit = ME.calculateExit({
    snapshot: snapshot([{ price: 80, quantity: 1 }, { price: 1000, quantity: 1 }]),
    historyStats: history(),
    nextAsk: 1000,
    settings: settings(),
  });
  assert.equal(exit.exitAnchor, 101);
  assert.equal(exit.conservativeExitPrice, 101);
});

test("Item Market fee can destroy a nominal spread", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 96,
    quantity: 1,
    snapshot: snapshot([{ price: 100, quantity: 10 }, { price: 101, quantity: 10 }]),
    historyStats: history(),
    settings: settings({ bazaarEnabled: false }),
  });
  assert.ok(result);
  assert.ok(result.expectedProfit < 0);
  assert.equal(result.classification.state, "RED");
  assert.equal(ME.itemMarketNetFor(100, 1), 95);
});

test("Bazaar can be profitable while Item Market is not", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 97,
    quantity: 1,
    snapshot: snapshot([{ price: 100, quantity: 10 }, { price: 101, quantity: 10 }]),
    historyStats: history(),
    settings: settings({ bazaarEnabled: true }),
  });
  assert.ok(result);
  assert.equal(result.routes.bestRoute, "Bazaar");
  assert.equal(result.routes.bazaar.net, 100);
  assert.equal(result.routes.itemMarket.net, 95);
});

test("capital constraints clamp direct-buy quantity", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 100,
    quantity: 1000,
    snapshot: snapshot([{ price: 100, quantity: 1000 }, { price: 101, quantity: 1000 }]),
    historyStats: history(),
    settings: settings({ maxCapitalOpportunity: 1000, maxCapitalItem: 1000, availableCapital: 1000 }),
  });
  assert.ok(result);
  assert.equal(result.quantityBought, 10);
  assert.equal(result.capitalRequired, 1000);
});

test("no history cannot become green at the default confidence threshold", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 80,
    quantity: 1,
    snapshot: snapshot([
      { price: 100, quantity: 100 },
      { price: 101, quantity: 100 },
      { price: 102, quantity: 100 },
      { price: 103, quantity: 100 },
      { price: 104, quantity: 100 },
    ]),
    historyStats: { historicalFairValue: null, oneDay: { count: 0, volatility: null } },
    settings: settings(),
  });
  assert.ok(result);
  assert.notEqual(result.classification.state, "GREEN");
});

test("volatile history downgrades an otherwise profitable opportunity", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 80,
    quantity: 1,
    snapshot: snapshot([
      { price: 100, quantity: 100 },
      { price: 101, quantity: 100 },
      { price: 102, quantity: 100 },
      { price: 103, quantity: 100 },
      { price: 104, quantity: 100 },
    ]),
    historyStats: history({ oneDay: { count: 20, volatility: 0.20, medianAnchor: 100 } }),
    settings: settings(),
  });
  assert.ok(result);
  assert.equal(result.classification.state, "YELLOW");
});

test("stale API data downgrades an otherwise profitable opportunity", () => {
  const stale = snapshot([
    { price: 100, quantity: 100 },
    { price: 101, quantity: 100 },
    { price: 102, quantity: 100 },
    { price: 103, quantity: 100 },
    { price: 104, quantity: 100 },
  ], { cacheTimestamp: Math.floor(Date.now() / 1000) - 600 });
  const result = ME.evaluateDirectBuy({
    buyPrice: 80,
    quantity: 1,
    snapshot: stale,
    historyStats: history(),
    settings: settings(),
  });
  assert.ok(result);
  assert.equal(result.classification.state, "YELLOW");
});

test("single listing does not invent market depth", () => {
  const result = ME.evaluatePrefixes(snapshot([{ price: 80, quantity: 1 }]), history(), settings());
  assert.equal(result.best, null);
});

test("unsupported equipment is not commodity-valued", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 80,
    quantity: 1,
    snapshot: snapshot([{ price: 100, quantity: 1 }, { price: 101, quantity: 1 }], { supportedCommodity: false }),
    historyStats: history(),
    settings: settings(),
  });
  assert.equal(result, null);
});

test("Bazaar add form suggestion is explicit and user-triggered", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "torn-market-edge.user.js"), "utf8");
  assert.ok(source.includes("function collectBazaarAddItems()"));
  assert.ok(source.includes("function bazaarAddRouteActive()"));
  assert.ok(source.includes("function knownBazaarAddRows(section)"));
  assert.ok(source.includes("#bazaarRoot"));
  assert.ok(source.includes("itemsContainner___"));
  assert.ok(source.includes("rowItems___"));
  assert.ok(source.includes("li.clearfix:not(.disabled)"));
  assert.ok(source.includes("div.amount-main-wrap"));
  assert.ok(source.includes("input.input-money"));
  assert.ok(source.includes("input.clear-all"));
  assert.ok(source.includes("function findBazaarAddQuantityCheckbox(card)"));
  assert.ok(source.includes("choiceContainer___"));
  assert.ok(source.includes("me-bazaar-add-controls"));
  assert.ok(source.includes("me-bazaar-add-row"));
  assert.ok(source.includes("me-row-line"));
  assert.ok(source.includes("flex:0 0 100%"));
  assert.ok(source.includes("grid-column:1 / -1"));
  assert.ok(source.includes("me-fill-main"));
  assert.ok(source.includes("visible.quantityCheckbox.checked"));
  assert.ok(source.includes("knownBazaarAddRows(addSection)"));
  assert.ok(source.includes("function findBazaarAddPriceInput(card)"));
  assert.ok(source.includes("function setBazaarInputValue(input, value)"));
  assert.ok(source.includes("function findBazaarAddQuantityInput(card, priceInput = null)"));
  assert.ok(source.includes("visible.maxAvailable || visible.quantity"));
  assert.ok(source.includes("me-bazaar-fill-btn"));
  assert.ok(source.includes('dispatchEvent(new Event("input", { bubbles: true, composed: true }))'));
  assert.ok(source.includes('dispatchEvent(new Event("change", { bubbles: true, composed: true }))'));
  assert.ok(source.includes("event.preventDefault()"));
  assert.ok(source.includes("event.stopPropagation()"));
});

test("hardening guards remain present in the assembled userscript", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "torn-market-edge.user.js"), "utf8");
  assert.match(source, /cancelQueued\(predicate/);
  assert.match(source, /queueGroup/);
  assert.match(source, /listRowIds = new WeakMap/);
  assert.match(source, /priceForSurfaceCard/);
  assert.match(source, /liveMatchesApi/);
  assert.match(source, /listRowIdentity\(node\)/);
  assert.match(source, /liveRows\[index\]\?\.quantity === snapshot\.listings\[index\]\?\.quantity/);
  assert.doesNotMatch(source, /evaluatePrefixes\(analysisSnapshot/);
});
