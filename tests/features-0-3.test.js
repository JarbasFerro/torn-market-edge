"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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

const NO_HISTORY = { historicalFairValue: null, oneDay: { count: 0, volatility: null } };

function deepBook(price = 100, count = 20, quantity = 100) {
  return Array.from({ length: count }, (_, index) => ({ price: price + index, quantity }));
}

// ---------------------------------------------------------------------------
// Fee model
// ---------------------------------------------------------------------------

test("Item Market fee is 5% by default and 15% for anonymous listings", () => {
  assert.equal(ME.itemMarketFeeBps(settings()), 500);
  assert.equal(ME.itemMarketFeeBps(settings({ anonymousListing: true })), 1500);
  assert.equal(ME.itemMarketFeeBps(settings({ anonymousListing: true, anonymousFeeWaived: true })), 500);
  assert.equal(ME.itemMarketNetFor(100, 1), 95);
  assert.equal(ME.itemMarketNetFor(100, 1, 1500), 85);
  assert.equal(ME.auctionNetFor(100, 1), 97);
});

test("anonymous listing fee flows through route economics and can flip the best route", () => {
  const exit = { conservativeExitPrice: 100, itemMarketSuggestedPrice: 100, bazaarSuggestedPrice: 90 };
  const normal = ME.routeEconomics(exit, 1, settings({ bazaarEnabled: true }));
  assert.equal(normal.itemMarket.net, 95);
  assert.equal(normal.bestRoute, "Item Market");
  const anonymous = ME.routeEconomics(exit, 1, settings({ bazaarEnabled: true, anonymousListing: true }));
  assert.equal(anonymous.itemMarket.net, 85);
  assert.equal(anonymous.itemMarket.feeBps, 1500);
  assert.equal(anonymous.bestRoute, "Bazaar");
  assert.equal(anonymous.auction.net, 97);
});

test("Auction House route is informational and never selected as best", () => {
  const exit = { conservativeExitPrice: 100, itemMarketSuggestedPrice: 100, bazaarSuggestedPrice: 100 };
  const routes = ME.routeEconomics(exit, 1, settings({ bazaarEnabled: false }));
  assert.equal(routes.auction.net, 97);
  assert.equal(routes.itemMarket.net, 95);
  assert.equal(routes.bestRoute, "Item Market");
});

// ---------------------------------------------------------------------------
// Cold-start valuation from official signals
// ---------------------------------------------------------------------------

test("official agreement is detected within tolerance", () => {
  assert.equal(ME.officialAgreement(snapshot([], { calculatedMarketAnchor: 100, averagePrice: 103 })).agrees, true);
  assert.equal(ME.officialAgreement(snapshot([], { calculatedMarketAnchor: 100, averagePrice: 120 })).agrees, false);
  assert.equal(ME.officialAgreement(snapshot([], { calculatedMarketAnchor: 100, averagePrice: 0 })).available, false);
});

test("warm-up haircut is waived when Torn daily average agrees with depth", () => {
  const agreeing = ME.calculateExit({ snapshot: snapshot(deepBook()), historyStats: NO_HISTORY, settings: settings() });
  assert.equal(agreeing.coldStart, true);
  assert.equal(agreeing.haircut, 0);
  const disagreeing = ME.calculateExit({
    snapshot: snapshot(deepBook(), { averagePrice: 130 }),
    historyStats: NO_HISTORY,
    settings: settings(),
  });
  assert.equal(disagreeing.haircut, 0.02);
});

test("without history the official daily average caps an inflated order book", () => {
  const exit = ME.calculateExit({
    snapshot: snapshot(deepBook(150), { calculatedMarketAnchor: 150, averagePrice: 100 }),
    historyStats: NO_HISTORY,
    settings: settings(),
  });
  assert.equal(exit.exitAnchor, 101);
});

test("cold-start confidence can reach MEDIUM with a deep agreeing book but never HIGH", () => {
  const deep = snapshot(deepBook(100, 20, 100));
  const confidence = ME.confidenceForOpportunity({ historyStats: NO_HISTORY, snapshot: deep, prefixCount: 0, nextAsk: null });
  assert.equal(confidence.label, "MEDIUM");
  const thin = snapshot(deepBook(100, 3, 1));
  const weak = ME.confidenceForOpportunity({ historyStats: NO_HISTORY, snapshot: thin, prefixCount: 0, nextAsk: null });
  assert.ok(["VERY LOW", "LOW"].includes(weak.label));
});

test("history still dominates the reference once available", () => {
  const reference = ME.chooseReference(snapshot(deepBook()), { historicalFairValue: 90, oneDay: { count: 20 } });
  assert.equal(reference.value, 90);
  assert.equal(reference.source, "24h observed median");
});

// ---------------------------------------------------------------------------
// Equipment comparables
// ---------------------------------------------------------------------------

function weaponListing(price, { rarity = null, bonuses = [], quality = 50, uid = price } = {}) {
  return {
    price,
    quantity: 1,
    itemDetails: {
      uid,
      stats: { damage: 60, accuracy: 55, armor: null, quality },
      bonuses: bonuses.map((title, index) => ({ id: index + 1, title, description: "", value: 10 })),
      rarity,
    },
  };
}

test("normalizeMarketResponse flags equipment and summarizes floors", () => {
  const payload = {
    itemmarket: {
      item: { id: 1, name: "Fixture Rifle", type: "Weapon", average_price: 1000 },
      listings: [
        { price: 900, amount: 1, item_details: { uid: 1, stats: { quality: 40 }, bonuses: [], rarity: null } },
        { price: 5000, amount: 1, item_details: { uid: 2, stats: { quality: 90 }, bonuses: [{ id: 1, title: "Bleed", description: "", value: 12 }], rarity: "yellow" } },
      ],
      cache_timestamp: 1, cache_delay: 30,
    },
    _metadata: { total: 2 },
  };
  const snap = ME.normalizeMarketResponse(1, payload);
  assert.equal(snap.supportedCommodity, false);
  assert.equal(snap.equipment, true);
  assert.equal(snap.equipmentSummary.plainFloor, 900);
  assert.equal(snap.equipmentSummary.bonusFloor, 5000);
  assert.equal(ME.equipmentGroupKey(payload.itemmarket.listings[1].item_details), "yellow|bleed");
});

test("equipment listings are compared within their rarity/bonus group", () => {
  const listings = [
    weaponListing(800, { quality: 52 }),
    weaponListing(1000, { quality: 50 }),
    weaponListing(1020, { quality: 48 }),
    weaponListing(1050, { quality: 55 }),
    weaponListing(1100, { quality: 53 }),
    weaponListing(3000, { rarity: "yellow", bonuses: ["Bleed"], quality: 80 }),
    weaponListing(9000, { rarity: "yellow", bonuses: ["Bleed"], quality: 82 }),
  ];
  const snap = { itemId: 1, listings, equipment: true };
  const analysis = ME.analyzeEquipmentListings(snap, { settings: settings() });
  const cheapPlain = analysis.rows.find((row) => row.price === 800);
  assert.equal(cheapPlain.groupLabel, "Plain");
  assert.equal(cheapPlain.comparableCount, 4);
  assert.ok(cheapPlain.discount > 0.2);
  assert.equal(cheapPlain.state, "GREEN");
  const bleed = analysis.rows.find((row) => row.price === 3000);
  assert.equal(bleed.groupLabel, "YELLOW bleed");
  assert.equal(bleed.comparableCount, 1);
  assert.notEqual(bleed.state, "GREEN");
  assert.equal(analysis.best.price, 800);
});

test("ended Auction House sales cap the comparable reference", () => {
  const listings = [
    weaponListing(800), weaponListing(1000), weaponListing(1020), weaponListing(1050), weaponListing(1100),
  ];
  const now = Math.floor(Date.now() / 1000);
  const sales = ME.normalizeAuctionSales({
    auctionhouse: [
      { id: 1, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: now - 3600, price: 700, bids: 3, item: { id: 1, uid: 9, name: "Fixture Rifle", type: "Weapon", sub_type: "Rifle", stats: { quality: 50 }, bonuses: [], rarity: null } },
      { id: 2, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: now - 7200, price: 720, bids: 1, item: { id: 1, uid: 10, name: "Fixture Rifle", type: "Weapon", sub_type: "Rifle", stats: { quality: 51 }, bonuses: [], rarity: null } },
      { id: 3, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: now - 90 * 86400, price: 5000, bids: 1, item: { id: 1, uid: 11, name: "Old", type: "Weapon", sub_type: "Rifle", stats: { quality: 51 }, bonuses: [], rarity: null } },
      { id: 4, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: now - 100, price: 500, bids: 1, item: { id: 206, uid: 12, name: "Xanax", type: "Drug" } },
    ],
  });
  assert.equal(sales.length, 3, "sales outside the 30 day window are dropped");
  assert.equal(sales.filter((sale) => sale.stackable).length, 1);
  const analysis = ME.analyzeEquipmentListings({ itemId: 1, listings }, { auctionSales: sales, settings: settings() });
  const cheap = analysis.rows.find((row) => row.price === 800);
  assert.equal(cheap.salesCount, 2);
  assert.equal(cheap.referenceSource, "listings + AH sales");
  assert.ok(cheap.reference <= 746, `reference ${cheap.reference} should be capped by AH sales`);
  assert.notEqual(cheap.state, "GREEN");
});

// ---------------------------------------------------------------------------
// Museum sets
// ---------------------------------------------------------------------------

test("museum set membership and implied value", () => {
  assert.equal(ME.museumSetFor(258).key, "plushie");
  assert.equal(ME.museumSetFor(260).key, "flower");
  assert.equal(ME.museumSetFor(206), null);
  assert.equal(ME.MUSEUM_SETS.plushie.items.length, 13);
  assert.equal(ME.MUSEUM_SETS.flower.items.length, 11);

  const memberPrices = {};
  ME.MUSEUM_SETS.flower.items.forEach((id) => { memberPrices[id] = 400_000; });
  const valuation = ME.museumValuation({ itemId: 260, memberPrices, pointValue: 45_000, settings: settings() });
  assert.equal(valuation.complete, true);
  assert.equal(valuation.setValue, 450_000);
  assert.equal(valuation.othersCost, 4_000_000);
  assert.equal(valuation.impliedValue, -3_550_000);

  const cheap = {};
  ME.MUSEUM_SETS.flower.items.forEach((id) => { cheap[id] = 10_000; });
  const good = ME.museumValuation({ itemId: 260, memberPrices: cheap, pointValue: 45_000, settings: settings() });
  assert.equal(good.impliedValue, 350_000);

  const partial = ME.museumValuation({ itemId: 260, memberPrices: { 263: 1 }, pointValue: 45_000, settings: settings() });
  assert.equal(partial.complete, false);
  assert.equal(partial.impliedValue, null);
});

test("museum route participates in best-route selection only when positive", () => {
  const exit = { conservativeExitPrice: 100, itemMarketSuggestedPrice: 100, bazaarSuggestedPrice: 100 };
  const withSet = ME.routeEconomics(exit, 2, settings(), { museum: { impliedValue: 150, label: "Flower set" } });
  assert.equal(withSet.bestRoute, "Museum set");
  assert.equal(withSet.museum.suggestedPrice, 150);
  assert.equal(withSet.bestNet, 300);
  const negative = ME.routeEconomics(exit, 2, settings(), { museum: { impliedValue: -5, label: "Flower set" } });
  assert.equal(negative.museum, null);
  assert.equal(negative.bestRoute, "Bazaar");
  const disabled = ME.routeEconomics(exit, 2, settings({ museumSetsEnabled: false }), { museum: { impliedValue: 150, label: "Flower set" } });
  assert.equal(disabled.bestRoute, "Bazaar");
});

test("points market normalization picks the cheapest ask", () => {
  const points = ME.normalizePointsMarket({ pointsmarket: [
    { id: 1, quantity: 10, cost: 46_000, total_cost: 460_000 },
    { id: 2, quantity: 5, cost: 45_500, total_cost: 227_500 },
    { id: 3, quantity: 0, cost: 1, total_cost: 0 },
  ] });
  assert.equal(points.cheapest, 45_500);
  assert.equal(points.listings, 2);
});

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

test("watchlist entries normalize and trigger with cooldown", () => {
  const entries = ME.normalizeWatchlist([
    { itemId: 206, name: "Xanax", target: 800_000 },
    { itemId: 206, name: "Xanax dup", target: 810_000 },
    { itemId: 0, target: 5 },
    { itemId: 7, target: 0 },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].target, 810_000);

  const nowMs = Date.now();
  const book = snapshot([{ price: 790_000, quantity: 3 }, { price: 805_000, quantity: 10 }, { price: 900_000, quantity: 5 }]);
  const first = ME.evaluateWatchItem({ itemId: 206, target: 810_000, lastAlertAt: 0, lastFloor: null }, book, nowMs);
  assert.equal(first.triggered, true);
  assert.equal(first.shouldAlert, true);
  assert.equal(first.quantityAtOrBelow, 13);

  const recent = ME.evaluateWatchItem({ itemId: 206, target: 810_000, lastAlertAt: Math.floor(nowMs / 1000) - 60, lastFloor: 790_000 }, book, nowMs);
  assert.equal(recent.shouldAlert, false, "cooldown suppresses repeat alerts");

  const dropped = ME.evaluateWatchItem({ itemId: 206, target: 810_000, lastAlertAt: Math.floor(nowMs / 1000) - 60, lastFloor: 850_000 }, book, nowMs);
  assert.equal(dropped.shouldAlert, true, "a further drop re-alerts inside the cooldown");

  const miss = ME.evaluateWatchItem({ itemId: 206, target: 700_000, lastAlertAt: 0 }, book, nowMs);
  assert.equal(miss.triggered, false);
});

// ---------------------------------------------------------------------------
// Own Item Market listings
// ---------------------------------------------------------------------------

test("own listings normalize from /user/itemmarket and evaluate against the floor", () => {
  const listings = ME.normalizeOwnListings({ itemmarket: [
    { id: 11, price: 850_000, average_price: 840_000, amount: 5, is_anonymous: true, available: 5, item: { id: 206, name: "Xanax", type: "Drug", rarity: null, uid: null } },
    { id: 12, price: 5_000_000, average_price: 4_000_000, amount: 1, is_anonymous: false, available: 1, item: { id: 1, name: "Rifle", type: "Weapon", rarity: "yellow", uid: 5, stats: { quality: 80 }, bonuses: [] } },
  ] });
  assert.equal(listings.length, 2);
  assert.equal(listings[0].anonymous, true);
  assert.equal(listings[1].equipment, true);

  const book = snapshot([
    { price: 820_000, quantity: 2 },
    { price: 830_000, quantity: 1 },
    { price: 850_000, quantity: 5 },
    { price: 900_000, quantity: 10 },
  ], { averagePrice: 840_000 });

  const undercut = ME.evaluateOwnListing(listings[0], book, settings({ itemMarketUndercut: 1 }));
  assert.equal(undercut.status, "CLOSE", "three units ahead of a five-unit listing is close");
  assert.equal(undercut.cheaperQuantity, 3);
  assert.equal(undercut.suggestedPrice, 819_999);
  assert.equal(undercut.feeBps, 1500);
  assert.equal(undercut.net, Math.floor(850_000 * 5 * 0.85));

  const cheapest = ME.evaluateOwnListing({ ...listings[0], price: 820_000, anonymous: false, amount: 1 }, book, settings());
  assert.equal(cheapest.status, "CHEAPEST");
  assert.equal(cheapest.suggestedPrice, null);
  assert.equal(cheapest.feeBps, 500);

  const deeply = ME.evaluateOwnListing({ ...listings[0], price: 950_000, anonymous: false, amount: 1 }, book, settings());
  assert.equal(deeply.status, "UNDERCUT");
  assert.equal(deeply.cheaperQuantity, 18);

  const flash = ME.evaluateOwnListing({ ...listings[0], price: 950_000, anonymous: false, amount: 1 }, snapshot([{ price: 600_000, quantity: 1 }, { price: 940_000, quantity: 50 }], { averagePrice: 840_000 }), settings());
  assert.match(flash.note, /flash sale/);
});

// ---------------------------------------------------------------------------
// Key access
// ---------------------------------------------------------------------------

test("key access rank and selection support", () => {
  const publicKey = { access: { type: "Public Only", level: 1 }, selections: { user: ["basic"], market: ["itemmarket"] } };
  const limitedKey = { access: { type: "Limited Access", level: 3 }, selections: { user: ["basic", "itemmarket"], market: ["itemmarket"] } };
  const customKey = { access: { type: "Custom", level: 4 }, selections: { user: ["basic"], market: ["itemmarket"] } };
  assert.equal(ME.keyAccessRank(publicKey), 1);
  assert.equal(ME.keyAccessRank(limitedKey), 3);
  assert.equal(ME.keySupports(publicKey, { section: "user", selection: "itemmarket", minimumType: "Limited Access" }), false);
  assert.equal(ME.keySupports(limitedKey, { section: "user", selection: "itemmarket", minimumType: "Limited Access" }), true);
  assert.equal(ME.keySupports(customKey, { section: "user", selection: "itemmarket", minimumType: "Limited Access" }), false, "custom keys are judged by their explicit selection list");
  assert.equal(ME.keySupports(null, { section: "user", selection: "itemmarket", minimumType: "Limited Access" }), null);
});

// ---------------------------------------------------------------------------
// Regression guards for the assembled userscript
// ---------------------------------------------------------------------------

test("v0.3.0 guards remain present in the assembled userscript", () => {
  const source = require("node:fs").readFileSync(path.join(__dirname, "..", "torn-market-edge.user.js"), "utf8");
  assert.match(source, /function transportGet\(url, headers\)/);
  assert.match(source, /PDA_httpGet/);
  assert.match(source, /###PDA-APIKEY###/);
  assert.match(source, /function officialAgreement\(snapshot\)/);
  assert.match(source, /ANONYMOUS_LISTING_FEE_BPS = 1000/);
  assert.match(source, /AUCTION_HOUSE_FEE_BPS = 300/);
  assert.match(source, /API_MAX_REQUESTS_PER_MINUTE = 70/);
  assert.match(source, /\/user\/itemmarket/);
  assert.match(source, /\/market\/pointsmarket/);
  assert.match(source, /auctionhouse\?limit=/);
  assert.match(source, /\/key\/info/);
  assert.match(source, /#mainContainer, \.content-wrapper/);
  const clicks = source.match(/\.click\(\)/g) || [];
  const checkboxClicks = source.match(/(?:quantityC|c)heckbox\.click\(\)/g) || [];
  assert.equal(clicks.length, checkboxClicks.length, "the only simulated click is the Bazaar max-quantity checkbox, inside the user's explicit fill tap");
  assert.doesNotMatch(source, /\.submit\(\)/, "the script must never submit forms");
  assert.doesNotMatch(source, /location\.reload/, "the script must never reload pages");
  assert.doesNotMatch(source, /@connect[ \t]+(?!api\.torn\.com)\S/, "only api.torn.com may be connected");
});

// ---------------------------------------------------------------------------
// Equipment sell-side pricing (Bazaar add form, inventory)
// ---------------------------------------------------------------------------

test("equipment sell pricing assumes a plain copy and never exceeds the plain floor", () => {
  const snap = {
    itemId: 1,
    averagePrice: 10_200,
    equipment: true,
    equipmentSummary: { listingCount: 20, plainFloor: 9_700, plainMedian: 10_500, bonusFloor: 250_000, groups: [] },
  };
  const now = Math.floor(Date.now() / 1000);
  const sales = ME.normalizeAuctionSales({ auctionhouse: [
    { id: 1, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: now - 100, price: 9_900, bids: 1, item: { id: 1, uid: 1, name: "AK", type: "Weapon", sub_type: "Rifle", stats: { quality: 50 }, bonuses: [], rarity: null } },
    { id: 2, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: now - 200, price: 10_100, bids: 1, item: { id: 1, uid: 2, name: "AK", type: "Weapon", sub_type: "Rifle", stats: { quality: 55 }, bonuses: [], rarity: null } },
    { id: 3, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: now - 300, price: 900_000, bids: 5, item: { id: 1, uid: 3, name: "AK", type: "Weapon", sub_type: "Rifle", stats: { quality: 90 }, bonuses: [{ id: 1, title: "Bleed", description: "", value: 10 }], rarity: "orange" } },
  ] });
  const pricing = ME.equipmentSellPricing(snap, settings({ safetyHaircut: 0.01, bazaarDiscount: 0.01, itemMarketUndercut: 1 }), sales);
  assert.equal(pricing.assumesPlain, true);
  assert.equal(pricing.salesCount, 2, "bonus sales are excluded from the plain reference");
  assert.equal(pricing.salesMedian, 10_000);
  assert.equal(pricing.reference, 10_500, "reference is the lowest of plain median, average*1.05 and AH*1.05");
  assert.equal(pricing.conservative, 10_395);
  assert.ok(pricing.bazaarSuggested <= 9_700, "never above the plain Item Market floor");
  assert.equal(pricing.bazaarSuggested, 9_603);
  assert.equal(pricing.itemMarketSuggested, 9_699);
  assert.equal(pricing.itemMarketNet, Math.floor(9_699 * 0.95));
  assert.equal(pricing.bestRoute, "Bazaar");
  assert.equal(pricing.bonusFloor, 250_000);

  const noFloor = ME.equipmentSellPricing({ itemId: 1, averagePrice: 0, equipmentSummary: { listingCount: 0, plainFloor: null, plainMedian: null, bonusFloor: 5_000 } }, settings(), []);
  assert.equal(noFloor, null, "without any plain evidence there is no sell price");
  assert.equal(ME.equipmentSellPricing({ itemId: 1 }, settings(), []), null);
});

// ---------------------------------------------------------------------------
// Owned-copy pricing from an expanded details panel
// ---------------------------------------------------------------------------

test("details panel text parsing extracts quality, stats and recognised bonuses", () => {
  const text = "The 9mm Uzi is a SMG Weapon. Buy: $1,100,000 (Mexico) Sell: $600,000 Value: $598,160 Circ: 64,028 Damage: 65.55 Accuracy: 44.21 Rate of Fire: 15-25 Stealth: 3.4 Quality: 17.61%";
  const plain = ME.parseEquipmentDetailsText(text, ["bonus-attachment-empty", "9mm Uzi"]);
  assert.equal(plain.quality, 17.61);
  assert.equal(plain.damage, 65.55);
  assert.equal(plain.accuracy, 44.21);
  assert.deepEqual(plain.bonuses, []);
  assert.equal(plain.rarity, null);

  const bonus = ME.parseEquipmentDetailsText(text, ["bonus-attachment-bleed yellow", "Bleed 12%", "9mm Uzi"]);
  assert.equal(bonus.bonuses.length, 1);
  assert.equal(bonus.bonuses[0].title, "Bleed");
  assert.equal(bonus.bonuses[0].value, 12);
  assert.equal(bonus.rarity, "yellow");
  assert.equal(ME.parseEquipmentDetailsText("Just a description without stats", []), null);
});

test("owned copy pricing matches quality within the same bonus group", () => {
  const plainAt = (price, quality) => ({ price, quantity: 1, itemDetails: { uid: price, stats: { quality }, bonuses: [], rarity: null } });
  const bleedAt = (price, quality) => ({ price, quantity: 1, itemDetails: { uid: price, stats: { quality }, bonuses: [{ id: 1, title: "Bleed", description: "", value: 10 }], rarity: "yellow" } });
  const snapshot = {
    itemId: 1,
    averagePrice: 600_000,
    equipment: true,
    listings: [
      plainAt(400_000, 12), plainAt(420_000, 18), plainAt(450_000, 22), plainAt(700_000, 80), plainAt(750_000, 85), plainAt(800_000, 90),
      bleedAt(3_000_000, 60), bleedAt(3_500_000, 65), bleedAt(4_000_000, 70), bleedAt(9_000_000, 95),
    ],
    equipmentSummary: { listingCount: 10, plainFloor: 400_000, plainMedian: 575_000, bonusFloor: 3_000_000, groups: [] },
  };
  const low = ME.priceOwnedEquipment({ snapshot, copy: { quality: 17.61, bonuses: [], rarity: null }, settings: settings({ safetyHaircut: 0.01, bazaarDiscount: 0.01, itemMarketUndercut: 1 }) });
  assert.equal(low.plain, true);
  assert.equal(low.comparables.count, 3, "only the low-quality plain copies are comparable");
  assert.equal(low.comparables.band, 10);
  assert.equal(low.comparables.median, 420_000);
  assert.equal(low.reference, 420_000, "low-quality comparables beat the Torn average");
  assert.equal(low.bazaarSuggested, Math.floor(400_000 * 0.99));
  assert.equal(low.cheaperAtSuggested, 0);
  assert.equal(low.bonusFloor, 3_000_000);

  const high = ME.priceOwnedEquipment({ snapshot, copy: { quality: 88, bonuses: [], rarity: null }, settings: settings() });
  assert.equal(high.comparables.count, 3);
  assert.equal(high.comparables.floor, 700_000);
  assert.ok(high.bazaarSuggested > low.bazaarSuggested, "a high-quality copy is priced above a low-quality one");
  assert.equal(high.cheaperAtSuggested, 3, "cheaper low-quality plain listings are flagged as selling first");

  const bleed = ME.priceOwnedEquipment({ snapshot, copy: { quality: 66, bonuses: [{ title: "Bleed", value: 12 }], rarity: "yellow" }, settings: settings() });
  assert.equal(bleed.plain, false);
  assert.equal(bleed.groupLabel, "YELLOW bleed");
  assert.equal(bleed.comparables.count, 3, "quality band excludes the 95% roll");
  assert.equal(bleed.referenceSource, "listings", "Torn average is ignored for bonus rolls");
  assert.equal(bleed.bazaarSuggested, 3_000_000, "test settings use no haircut/discount: capped by the cheapest comparable");
  assert.equal(bleed.bonusFloor, null);

  const unknown = ME.priceOwnedEquipment({ snapshot, copy: { quality: 50, bonuses: [{ title: "Wither", value: 5 }], rarity: "red" }, settings: settings() });
  assert.equal(unknown.bazaarSuggested, null, "no comparables and no sales gives no price");
  assert.equal(unknown.group.count, 0);
});

test("details text parsing reads Torn's text-form bonus and rarity", () => {
  const p90 = "The P90 is a SMG Weapon. Buy: $9,800 (Big Al's Gun Shop) Sell: $6,600 Value: $5,921 Circ: 408,027 Damage: 55.86 Accuracy: 55.56 Rate of Fire: 10-30 Stealth: 3.4 Caliber: 5.7mm High Vel. R... Ammo: 3 x 50 Bonus: 24% Proficience Quality: 124.26% Yellow";
  const copy = ME.parseEquipmentDetailsText(p90, []);
  assert.equal(copy.quality, 124.26);
  assert.equal(copy.damage, 55.86);
  assert.equal(copy.accuracy, 55.56);
  assert.deepEqual(copy.bonuses, [{ title: "Proficience", value: 24 }]);
  assert.equal(copy.rarity, "yellow");

  const split = ME.parseEquipmentDetailsText("Damage : 58.34 Accuracy : 54.69 Quality : 50.39 %", []);
  assert.equal(split.quality, 50.39, "colon and value may be separate nodes");
  assert.equal(split.damage, 58.34);
  assert.equal(split.bonuses.length, 0);
  assert.equal(split.rarity, null);

  const two = ME.parseEquipmentDetailsText("Damage: 60 Accuracy: 50 Bonus: 12% Bleed Bonus: 8% Cripple Quality: 88.10% Orange", []);
  assert.deepEqual(two.bonuses.map((bonus) => bonus.title), ["Bleed", "Cripple"]);
  assert.equal(two.rarity, "orange");
});
