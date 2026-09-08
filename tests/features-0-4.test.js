"use strict";

// v0.4.0 pure-function coverage: portfolio inventory/uid details, city and
// foreign shop economics, auction timing and bid guidance, browse-grid
// overlay, pricing rules and the sell-side (undercut) watch.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require(path.join(__dirname, "..", "torn-market-edge.user.js"));
const ME = globalThis.__MARKET_EDGE_TEST__;

function settings(overrides = {}) {
  return {
    ...ME.DEFAULTS,
    minimumROI: 0.02,
    minimumProfit: 1,
    minimumDiscount: 0.03,
    safetyHaircut: 0,
    bazaarDiscount: 0,
    itemMarketUndercut: 0,
    ...overrides,
  };
}

const NOW = Math.floor(Date.now() / 1000);

test("normalizeInventory keeps uids, equipped flags and drops empty rows", () => {
  const rows = ME.normalizeInventory({ inventory: { items: [
    { id: 206, amount: 12, equipped: false, name: "Xanax", faction_owned: false, uid: null },
    { id: 1, amount: 1, equipped: true, name: "Rifle", faction_owned: false, uid: 555 },
    { id: 2, amount: 0, equipped: false, name: "Nothing", faction_owned: false, uid: null },
  ], timestamp: NOW }, _metadata: { total: 3 } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, 12);
  assert.equal(rows[1].uid, 555);
  assert.equal(rows[1].equipped, true);
});

test("normalizeItemDetails accepts the array shape and the deprecated single-object shape", () => {
  const array = ME.normalizeItemDetails({ itemdetails: [
    { id: 1, uid: 555, name: "Rifle", type: "Weapon", sub_type: "Rifle", stats: { damage: 60, accuracy: 55, armor: null, quality: 51.2 }, bonuses: [{ id: 1, title: "Bleed", description: "", value: 15 }], rarity: "orange" },
  ] });
  assert.equal(array.length, 1);
  assert.equal(array[0].quality, 51.2);
  assert.equal(array[0].bonuses[0].title, "Bleed");
  assert.equal(array[0].rarity, "orange");
  assert.equal(ME.copyLabelFor(array[0]), "Q 51.2% ORANGE Bleed");
  const single = ME.normalizeItemDetails({ itemdetails: { id: 1, uid: 556, name: "Rifle", type: "Weapon", stats: { quality: 40 }, bonuses: [], rarity: null } });
  assert.equal(single.length, 1);
  assert.equal(ME.copyLabelFor(single[0]), "Q 40.0% plain");
});

test("officialExit is more conservative than the order-book exit and feeds routeEconomics", () => {
  const exit = ME.officialExit(100_000, settings({ safetyHaircut: 0.01 }));
  assert.equal(exit.haircut, 0.03);
  assert.equal(exit.conservativeExitPrice, 97_000);
  const routes = ME.routeEconomics(exit, 10, settings(), {});
  assert.equal(routes.bestRoute, "Bazaar");
  assert.equal(routes.bazaar.net, 970_000);
  assert.equal(ME.officialExit(0, settings()), null);
});

test("sell-to-shop route wins when the NPC shop pays more than the market exit", () => {
  const exit = ME.officialExit(50_000, settings());
  const routes = ME.routeEconomics(exit, 3, settings(), { shopSell: 60_000, shopLabel: "Sell to Jewelry Store" });
  assert.equal(routes.bestRoute, "Sell to shop");
  assert.equal(routes.shop.label, "Sell to Jewelry Store");
  assert.equal(routes.bestNet, 180_000);
  const meta = { shops: [{ country: "Torn", name: "Jewelry Store", buyPrice: 0, sellPrice: 60_000 }, { country: "Mexico", name: "Black Market", buyPrice: 40_000, sellPrice: 0 }] };
  assert.deepEqual(ME.shopSellFloor(meta), { price: 60_000, label: "Sell to Jewelry Store" });
  assert.equal(ME.shopSellFloor({ shops: [] }), null);
});

test("city shop runs are capped by stock and priced net of fees", () => {
  const shops = ME.normalizeCityShops({ cityshops: [{ id: 3, name: "Sally's Sweet Shop", items: [
    { id: 300, name: "Bag of Chocolate Kisses", price: 250, stock: { current: 40, default: 100 } },
    { id: 301, name: "Nothing", price: 0, stock: { current: 0, default: 0 } },
  ] }] });
  assert.equal(shops.length, 1);
  assert.equal(shops[0].items.length, 1);
  const exit = ME.officialExit(1_000, settings());
  const run = ME.evaluateShopRun({ shopItem: shops[0].items[0], exit, settings: settings({ shopRunQuantity: 100 }) });
  assert.equal(run.quantity, 40, "capped by current stock");
  assert.equal(run.buyPrice, 250);
  assert.ok(run.profitPerUnit > 0);
  assert.equal(run.state, "GREEN");
  const dead = ME.evaluateShopRun({ shopItem: { ...shops[0].items[0], price: 5_000 }, exit, settings: settings() });
  assert.equal(dead.state, "GREY");
});

test("foreign offers are derived from metadata and ranked per country by profit per unit", () => {
  const catalog = [
    { id: 206, name: "Xanax", type: "Drug", isTradable: true, marketPrice: 850_000, shops: [{ country: "Japan", name: "Black Market", buyPrice: 700_000, sellPrice: 0 }, { country: "South Africa", name: "Black Market", buyPrice: 760_000, sellPrice: 0 }] },
    { id: 258, name: "Jaguar Plushie", type: "Plushie", isTradable: true, marketPrice: 30_000, shops: [{ country: "Mexico", name: "General Store", buyPrice: 500, sellPrice: 0 }] },
    { id: 1, name: "Rifle", type: "Weapon", isTradable: true, marketPrice: 1_000_000, shops: [{ country: "Torn", name: "Big Al's Gun Shop", buyPrice: 900_000, sellPrice: 0 }] },
  ];
  const offers = ME.foreignOffers(catalog);
  assert.equal(offers.length, 3, "Torn shops are not foreign offers");
  const evaluations = offers.map((offer) => ME.evaluateForeignOffer({ offer, exit: ME.officialExit(offer.marketPrice, settings()), settings: settings(), capacity: 10 }));
  const plan = ME.rankTravelPlan(evaluations);
  assert.equal(plan[0].country, "Japan");
  assert.equal(plan[0].best.perTrip, evaluations.find((row) => row.country === "Japan").expectedProfit);
  assert.ok(plan.some((entry) => entry.country === "Mexico"));
  assert.ok(plan.every((entry) => entry.best.cashNeeded === entry.best.buyPrice * 10));
});

test("museum pieces are recognised by name: singles pay points, the arrowhead set needs six pieces", () => {
  const fossil = ME.museumByName({ meta: { id: 9001, name: "Patagonian Fossil", marketPrice: 500_000 }, pointValue: 40_000, settings: settings() });
  assert.equal(fossil.points, 20);
  assert.equal(fossil.impliedValue, 800_000);
  const heads = Array.from({ length: 6 }, (_, index) => ({ id: 9100 + index, name: `Arrowhead ${index + 1}`, marketPrice: 100_000 }));
  const set = ME.museumByName({ meta: heads[0], pointValue: 40_000, allMetas: heads, settings: settings() });
  assert.equal(set.complete, true);
  assert.equal(set.impliedValue, 25 * 40_000 - 5 * 100_000);
  const partial = ME.museumByName({ meta: heads[0], pointValue: 40_000, allMetas: heads.slice(0, 3), settings: settings() });
  assert.equal(partial.complete, false);
  assert.equal(ME.museumByName({ meta: { id: 206, name: "Xanax" }, pointValue: 40_000, settings: settings() }), null);
});

test("auction timing buckets ended sales by TCT window and names the best window", () => {
  const at = (hour, price) => ({ price, timestamp: Date.UTC(2026, 8, 1, hour, 30) / 1000 });
  const sales = [at(1, 90), at(2, 95), at(3, 92), at(19, 120), at(20, 118), at(21, 125), at(13, 100)];
  const timing = ME.auctionTimingStats(sales);
  assert.equal(timing.total, 7);
  assert.equal(timing.best.key, "18-24");
  assert.equal(timing.worst.key, "00-06");
  assert.equal(timing.buckets.find((bucket) => bucket.key === "12-18").count, 1);
  assert.equal(ME.auctionTimingStats([]).best, null);
});

test("stackable sales summary and sales-capped max bid", () => {
  const sales = ME.normalizeAuctionSales({ auctionhouse: [
    { id: 1, seller: { id: 1 }, buyer: { id: 2 }, timestamp: NOW - 3600, price: 700_000, bids: 2, item: { id: 206, uid: 1, name: "Xanax", type: "Drug" } },
    { id: 2, seller: { id: 1 }, buyer: { id: 2 }, timestamp: NOW - 7200, price: 720_000, bids: 5, item: { id: 206, uid: 2, name: "Xanax", type: "Drug" } },
  ] });
  const summary = ME.stackableSalesSummary(sales);
  assert.equal(summary.count, 2);
  assert.equal(summary.median, 710_000);
  const book = ME.normalizeMarketResponse(206, { itemmarket: { item: { id: 206, name: "Xanax", type: "Drug", average_price: 840_000 }, listings: [
    { price: 835_000, amount: 20 }, { price: 836_000, amount: 15 }, { price: 838_000, amount: 30 }, { price: 840_000, amount: 50 },
  ], cache_timestamp: NOW, cache_delay: 30 } });
  const uncapped = ME.maxRationalBid({ snapshot: book, historyStats: null, settings: settings() });
  const capped = ME.maxRationalBid({ snapshot: book, historyStats: null, settings: settings(), salesMedian: summary.median });
  assert.ok(uncapped > capped, "recent winning bids cap the rational bid");
  assert.equal(capped, 710_000);
});

test("equipment bid guidance derives a max bid from the copy's comparables", () => {
  const plain = (price, quality, uid) => ({ price, amount: 1, item_details: { uid, stats: { damage: 60, accuracy: 55, armor: null, quality }, bonuses: [], rarity: null } });
  const book = ME.normalizeMarketResponse(1, { itemmarket: { item: { id: 1, name: "Rifle", type: "Weapon", average_price: 1_000_000 }, listings: [
    plain(900_000, 50, 1), plain(1_000_000, 52, 2), plain(1_020_000, 49, 3), plain(1_050_000, 51, 4), plain(1_100_000, 53, 5),
  ], cache_timestamp: NOW, cache_delay: 30 } });
  const listing = ME.normalizeAuctionListing({ auctionhouselisting: { id: 777, seller: { id: 1 }, buyer: { id: 0 }, timestamp: NOW + 3600, price: 500_000, bids: 1, item: { id: 1, uid: 9, name: "Rifle", type: "Weapon", sub_type: "Rifle", stats: { damage: 61, accuracy: 55, armor: null, quality: 50.5 }, bonuses: [], rarity: null } } });
  assert.equal(listing.listingId, 777);
  assert.equal(listing.copy.quality, 50.5);
  const guidance = ME.equipmentBidGuidance({ snapshot: book, copy: listing.copy, auctionSales: [], settings: settings(), currentBid: listing.price });
  assert.ok(guidance.maxBid > 500_000 && guidance.maxBid < 900_000, `max bid ${guidance.maxBid} sits between the current bid and the plain floor`);
  assert.equal(guidance.headroom, guidance.maxBid - 500_000);
  assert.match(guidance.label, /Q 50\.5% plain/);
  assert.equal(ME.equipmentBidGuidance({ snapshot: book, copy: null, settings: settings() }), null);
});

test("browse-grid overlay classifies the displayed price against the official market value", () => {
  const strong = ME.evaluateBrowseCard({ price: 80_000, marketPrice: 100_000, settings: settings() });
  assert.equal(strong.state, "GREEN");
  assert.equal(strong.label, "STRONG");
  assert.ok(strong.profitPerUnit > 0);
  const consider = ME.evaluateBrowseCard({ price: 95_000, marketPrice: 100_000, settings: settings() });
  assert.equal(consider.label, "CONSIDER");
  const above = ME.evaluateBrowseCard({ price: 105_000, marketPrice: 100_000, settings: settings() });
  assert.equal(above.label, "ABOVE MV");
  assert.equal(above.state, "GREY");
  assert.equal(ME.evaluateBrowseCard({ price: 0, marketPrice: 100_000, settings: settings() }), null);
});

test("pricing rules: undercut by default, anchor mode, hold and minimum price clamp", () => {
  const rules = ME.normalizePricingRules({ 206: { mode: "anchor", minPrice: 0 }, 258: { mode: "undercut", minPrice: 0 }, 1: { mode: "hold" }, x: { mode: "anchor" } });
  assert.deepEqual(Object.keys(rules).sort(), ["1", "206"], "a default rule without a minimum is dropped");
  assert.equal(ME.applyPricingRule({ rule: null, floorSuggestion: 99, anchorSuggestion: 120 }).price, 99);
  assert.equal(ME.applyPricingRule({ rule: rules[206], floorSuggestion: 99, anchorSuggestion: 120 }).price, 120);
  assert.equal(ME.applyPricingRule({ rule: rules[1], floorSuggestion: 99, anchorSuggestion: 120 }).price, null);
  const clamped = ME.applyPricingRule({ rule: { mode: "undercut", minPrice: 110 }, floorSuggestion: 99, anchorSuggestion: 120 });
  assert.equal(clamped.price, 110);
  assert.equal(clamped.clamped, true);
  assert.equal(ME.applyPricingRule({ rule: null, floorSuggestion: null, anchorSuggestion: null }).price, null);
});

test("sell-side watch alerts when the floor undercuts the listed price, with cooldown and re-alert on a further drop", () => {
  const entries = ME.normalizeSellWatch([
    { itemId: 206, venue: "IM", name: "Xanax", price: 850_000, amount: 5 },
    { itemId: 206, venue: "IM", name: "dup", price: 1 },
    { itemId: 0, price: 5 },
  ]);
  assert.equal(entries.length, 1);
  const book = (floor) => ({ lowestPrice: floor, listings: [{ price: floor, quantity: 3 }, { price: 860_000, quantity: 10 }] });
  const quiet = ME.evaluateSellWatch(entries[0], book(850_000));
  assert.equal(quiet.undercut, false);
  const hit = ME.evaluateSellWatch(entries[0], book(840_000));
  assert.equal(hit.shouldAlert, true);
  assert.equal(hit.cheaperQuantity, 3);
  assert.equal(hit.gap, 10_000);
  const cooled = ME.evaluateSellWatch({ ...entries[0], lastAlertAt: NOW - 60, lastFloor: 840_000 }, book(839_000));
  assert.equal(cooled.shouldAlert, false, "inside the cooldown a tiny move does not re-alert");
  const drop = ME.evaluateSellWatch({ ...entries[0], lastAlertAt: NOW - 60, lastFloor: 840_000 }, book(800_000));
  assert.equal(drop.shouldAlert, true, "a further drop of over 2% re-alerts");
});

test("portfolio summary totals valued rows per route and counts untradable/equipped rows", () => {
  const summary = ME.summarizePortfolio([
    { unitNet: 100, amount: 10, route: "Bazaar" },
    { unitNet: 50, amount: 2, route: "Item Market", equipped: true },
    { unitNet: null, amount: 1, route: "-", untradable: true },
  ]);
  assert.equal(summary.total, 1_100);
  assert.equal(summary.valuedRows, 2);
  assert.equal(summary.unvaluedRows, 1);
  assert.equal(summary.untradable, 1);
  assert.equal(summary.equipped, 1);
  assert.equal(summary.byRoute.Bazaar, 1_000);
});

test("source guards for v0.4.0 endpoints and safeguards", () => {
  const source = require("node:fs").readFileSync(path.join(__dirname, "..", "torn-market-edge.user.js"), "utf8");
  assert.match(source, /\/user\/inventory\?limit=/);
  assert.match(source, /\/itemdetails`/);
  assert.match(source, /\/torn\/cityshops/);
  assert.match(source, /auctionhouselisting`/);
  assert.match(source, /@connect\s+api\.torn\.com/);
  assert.equal((source.match(/@connect/g) || []).length, 1, "only api.torn.com is contacted");
  assert.doesNotMatch(source, /\.submit\(\)/);
  assert.doesNotMatch(source, /location\.reload/);
});
