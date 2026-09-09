// ==UserScript==
// @name         Torn Market Edge
// @namespace    https://github.com/JarbasFerro/torn-market-edge
// @version      0.5.0
// @description  Decision-support overlay for Torn markets using the official Torn API. No automated trades.
// @author       JarbasFerro
// @homepageURL  https://github.com/JarbasFerro/torn-market-edge
// @supportURL   https://github.com/JarbasFerro/torn-market-edge/issues
// @license      MIT
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

/* global GM_xmlhttpRequest, GM_getValue, GM_setValue, GM_deleteValue, GM_addStyle, GM_registerMenuCommand, PDA_httpGet */

(function marketEdgeBootstrap(global) {
  "use strict";

  // v0.3.0 (includes the v0.2.5/v0.2.6 Bazaar add-form UI fixes): official-API cold-start valuation, full Item Market 2.0 fee model
  // (5% tax, optional 10% anonymous fee, 3% Auction House fee), own Item
  // Market listings panel, museum set economics, weapon/armor comparables,
  // API-only watchlist alerts and Torn PDA transport support. Every action
  // remains user-triggered; the script never buys, sells, bids or submits.

  const APP = Object.freeze({
    name: "Market Edge",
    version: "0.5.0",
    schemaVersion: 1,
    logPrefix: "[MarketEdge]"
  });

  const ITEM_MARKET_FEE_BPS = 500;
  const ANONYMOUS_LISTING_FEE_BPS = 1000;
  const AUCTION_HOUSE_FEE_BPS = 300;
  const BPS = 10000;
  const ONE_MINUTE_MS = 60 * 1000;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const HISTORY_MIN_GAP_MS = ONE_MINUTE_MS;
  const HISTORY_MAX_POINTS = 1000;
  // Torn allows 100 requests/minute per player across all keys. Market Edge
  // keeps a comfortable margin so other tools sharing the key keep working.
  const API_MAX_REQUESTS_PER_MINUTE = 70;
  const API_CONCURRENCY = 4;
  const API_LIST_LIMIT = 20;
  const API_DEEP_LIMIT = 100;
  const API_AUCTION_LIMIT = 50;
  const API_COMMENT = "market-edge";
  const SNAPSHOT_FALLBACK_FRESH_MS = 25000;
  const ITEM_META_TTL_MS = 7 * ONE_DAY_MS;
  const SET_META_TTL_MS = ONE_DAY_MS;
  const POINTS_MARKET_TTL_MS = 5 * ONE_MINUTE_MS;
  const AUCTION_SALES_TTL_MS = 10 * ONE_MINUTE_MS;
  const AUCTION_SALES_WINDOW_MS = 30 * ONE_DAY_MS;
  const OFFICIAL_AGREEMENT_TOLERANCE = 0.05;
  const WATCHLIST_MIN_INTERVAL_SEC = 30;
  const WATCHLIST_MAX_ITEMS = 25;
  const WATCHLIST_ALERT_COOLDOWN_MS = 10 * ONE_MINUTE_MS;
  const OWN_LISTINGS_MAX = 25;
  // v0.5.0 surfaces: portfolio, shop runs, travel planner, auction guidance.
  const INVENTORY_TTL_MS = 60 * ONE_MINUTE_MS;
  const INVENTORY_PAGE_LIMIT = 250;
  const INVENTORY_MAX_PAGES = 8;
  const CITY_SHOPS_TTL_MS = 5 * ONE_MINUTE_MS;
  const FOREIGN_CATALOG_TTL_MS = 6 * 60 * ONE_MINUTE_MS;
  const SELL_WATCH_MAX_ITEMS = 40;
  const SELL_WATCH_ALERT_COOLDOWN_MS = 30 * ONE_MINUTE_MS;
  const PORTFOLIO_REFINE_DEFAULT = 30;
  const FOREIGN_COUNTRIES = Object.freeze([
    "Mexico", "Cayman Islands", "Canada", "Hawaii", "United Kingdom", "Argentina", "Switzerland", "Japan", "China", "UAE", "South Africa"
  ]);
  const CITY_SHOP_STEPS = Object.freeze({
    bigalgunshop: "Big Al's Gun Shop", bitsnbobs: "Bits 'n' Bobs", candy: "Sally's Sweet Shop", clothes: "TC Clothing",
    cyberforce: "Cyber Force", docks: "Docks", jewelry: "Jewelry Store", nikeh: "Nikeh Sports", pawnshop: "Pawn Shop",
    pharmacy: "Pharmacy", postoffice: "Post Office", printstore: "Print Shop", recycling: "Recycling Center", super: "Super Store"
  });
  // Torn PDA replaces this literal with the player's key at load time. When it
  // is untouched (desktop Tampermonkey), the stored key is used instead.
  const PDA_API_KEY_PLACEHOLDER = "###PDA-APIKEY###";

  const STORAGE_KEYS = Object.freeze({
    settings: "marketEdge.settings.v1",
    apiKey: "marketEdge.apiKey",
    playerId: "marketEdge.playerId",
    keyInfo: "marketEdge.keyInfo.v1",
    panelState: "marketEdge.panelState.v1",
    watchlist: "marketEdge.watchlist.v1",
    pointsMarket: "marketEdge.pointsMarket.v1",
    auctionSalesPrefix: "marketEdge.auctionSales.v1.",
    historyPrefix: "marketEdge.history.v1.",
    snapshotPrefix: "marketEdge.snapshot.v3.",
    pricingRules: "marketEdge.pricingRules.v1",
    sellWatch: "marketEdge.sellWatch.v1",
    inventory: "marketEdge.inventory.v1",
    cityShops: "marketEdge.cityShops.v1",
    foreignCatalog: "marketEdge.foreignCatalog.v1",
    itemMetaPrefix: "marketEdge.itemMeta.v2."
  });

  const DEFAULTS = Object.freeze({
    availableCapital: 500000000,
    maxCapitalOpportunity: 25000000,
    maxCapitalItem: 50000000,
    minimumROI: 0.02,
    minimumProfit: 250000,
    minimumDiscount: 0.03,
    safetyHaircut: 0.01,
    bazaarEnabled: true,
    bazaarDiscount: 0.01,
    allowedHistoricalPremium: 1.01,
    itemMarketUndercut: 1,
    anonymousListing: false,
    anonymousFeeWaived: false,
    museumSetsEnabled: true,
    watchlistEnabled: true,
    watchlistIntervalSeconds: 60,
    minimumGreenConfidence: "MEDIUM",
    maxVolatility: 0.03,
    historyRetentionDays: 14,
    scanMaxVisibleItems: 30,
    travelCapacity: 0,
    shopRunQuantity: 100,
    undercutAlerts: true,
    portfolioRefineRequests: PORTFOLIO_REFINE_DEFAULT,
    auctionEvidenceEnabled: true,
    browseOverlayEnabled: true,
    developerMode: false
  });

  // Museum set definitions (item IDs are stable Torn item identifiers).
  // Both sets exchange for 10 points at the Museum.
  const MUSEUM_SETS = Object.freeze({
    plushie: Object.freeze({
      key: "plushie",
      label: "Plushie set",
      points: 10,
      items: Object.freeze([186, 187, 215, 258, 261, 266, 268, 269, 273, 274, 281, 384, 618])
    }),
    flower: Object.freeze({
      key: "flower",
      label: "Flower set",
      points: 10,
      items: Object.freeze([260, 263, 264, 267, 271, 272, 276, 277, 282, 385, 617])
    })
  });

  // Contraband museum pieces (Patch #413) are matched by name because their
  // item ids are not fixed in this source. Singles pay points on their own;
  // the arrowhead set needs six distinct pieces.
  const MUSEUM_SINGLES_BY_NAME = Object.freeze({
    "meteorite fragment": 15,
    "patagonian fossil": 20
  });
  const MUSEUM_NAME_SETS = Object.freeze([
    Object.freeze({ key: "arrowhead", label: "Arrowhead set", pattern: /arrowhead/i, size: 6, points: 25 })
  ]);

  const KEY_ACCESS_RANK = Object.freeze({
    "Public Only": 1,
    "Minimal Access": 2,
    "Limited Access": 3,
    "Full Access": 4,
    Custom: 4
  });

  const CONFIDENCE_RANK = Object.freeze({
    "VERY LOW": 0,
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3
  });

  const CLASS_META = Object.freeze({
    GREEN: { label: "STRONG", icon: "OK" },
    YELLOW: { label: "CONSIDER", icon: "!" },
    GREY: { label: "PASS", icon: "-" },
    RED: { label: "AVOID", icon: "X" }
  });

  // ---------------------------------------------------------------------------
  // Pure numerical helpers
  // ---------------------------------------------------------------------------

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function asInt(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.trunc(n);
  }

  function median(values) {
    const clean = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!clean.length) return null;
    const middle = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
  }

  function mad(values, center = median(values)) {
    if (!Number.isFinite(center)) return null;
    return median(values.filter(Number.isFinite).map((value) => Math.abs(value - center)));
  }

  function weightedMedian(rows) {
    const clean = rows
      .filter((row) => Number.isFinite(row.price) && row.price > 0 && Number.isFinite(row.weight) && row.weight > 0)
      .slice()
      .sort((a, b) => a.price - b.price);
    if (!clean.length) return null;
    const total = clean.reduce((sum, row) => sum + row.weight, 0);
    let cumulative = 0;
    for (const row of clean) {
      cumulative += row.weight;
      if (cumulative >= total / 2) return row.price;
    }
    return clean[clean.length - 1].price;
  }

  function grossToNet(gross, feeBps) {
    const safeGross = Math.max(0, asInt(gross));
    const safeFee = clamp(asInt(feeBps, 0), 0, BPS);
    // Conservative integer arithmetic: the fee is applied to transaction gross,
    // then net proceeds are floored to whole Torn dollars.
    return Math.floor((safeGross * (BPS - safeFee)) / BPS);
  }

  // Item Market 2.0 fee model: 5% sales tax on every sale, plus an optional
  // 10% anonymous-listing fee. Five-star Car Dealership / Property Broker
  // company specials waive the anonymous fee, which the user can declare.
  function itemMarketFeeBps(settings) {
    const anonymous = Boolean(settings?.anonymousListing) && !settings?.anonymousFeeWaived;
    return ITEM_MARKET_FEE_BPS + (anonymous ? ANONYMOUS_LISTING_FEE_BPS : 0);
  }

  function grossToItemMarketNet(gross, feeBps = ITEM_MARKET_FEE_BPS) {
    return grossToNet(gross, feeBps);
  }

  function itemMarketNetFor(pricePerUnit, quantity, feeBps = ITEM_MARKET_FEE_BPS) {
    const price = Math.max(0, asInt(pricePerUnit));
    const qty = Math.max(0, asInt(quantity));
    return grossToItemMarketNet(price * qty, feeBps);
  }

  function auctionNetFor(pricePerUnit, quantity) {
    const price = Math.max(0, asInt(pricePerUnit));
    const qty = Math.max(0, asInt(quantity));
    return grossToNet(price * qty, AUCTION_HOUSE_FEE_BPS);
  }

  function isEquipmentType(type) {
    return /weapon|armor|armour/i.test(String(type || ""));
  }

  function robustMarketAnchor(listings) {
    const sorted = listings
      .filter((row) => Number.isFinite(row.price) && row.price > 0 && Number.isFinite(row.quantity) && row.quantity > 0)
      .slice()
      .sort((a, b) => a.price - b.price);
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0].price;

    const quantities = sorted.map((row) => row.quantity);
    const medianQuantity = Math.max(1, median(quantities) || 1);
    const weightCap = medianQuantity * 3;
    const weightedRows = sorted.map((row) => ({
      price: row.price,
      weight: Math.min(row.quantity, weightCap)
    }));

    const weightedAll = weightedMedian(weightedRows);
    const firstIsOutlier = sorted.length >= 3 && sorted[0].price <= sorted[1].price * 0.98;
    const weightedWithoutFirst = firstIsOutlier ? weightedMedian(weightedRows.slice(1)) : weightedAll;
    const listingMedian = median(sorted.map((row) => row.price));
    const candidates = [weightedWithoutFirst, sorted[1]?.price, sorted[2]?.price, listingMedian]
      .filter(Number.isFinite);
    return Math.round(median(candidates) || weightedAll || sorted[0].price);
  }

  function normalizeMarketResponse(itemId, payload, observedAtMs = Date.now()) {
    const book = payload?.itemmarket || payload?.item_market || payload;
    const item = book?.item || payload?.item || {};
    const rawListings = Array.isArray(book?.listings) ? book.listings : [];
    const listings = rawListings
      .map((row, index) => ({
        listingId: row.id ?? row.listing_id ?? null,
        sellerId: row.seller_id ?? row.seller?.id ?? null,
        price: asInt(row.price ?? row.cost ?? row.cost_each),
        quantity: asInt(row.amount ?? row.quantity ?? 1, 1),
        itemDetails: row.item_details ?? null,
        index
      }))
      .filter((row) => row.price > 0 && row.quantity > 0)
      .sort((a, b) => a.price - b.price || a.index - b.index);

    const itemType = String(item.type ?? item.category ?? "");
    const hasDetailedListings = listings.some((row) => row.itemDetails && typeof row.itemDetails === "object");
    const equipment = hasDetailedListings || isEquipmentType(itemType);
    const top20 = listings.slice(0, 20);
    const prices = listings.map((row) => row.price);
    const cacheTimestampSec = asInt(book?.cache_timestamp ?? payload?.cache_timestamp, 0);
    const totalListings = asInt(payload?._metadata?.total, 0);

    return {
      itemId: asInt(item.id ?? itemId),
      itemName: String(item.name ?? `Item ${itemId}`),
      itemType,
      averagePrice: asInt(item.average_price ?? item.market_value ?? item.value, 0),
      timestampObserved: Math.floor(observedAtMs / 1000),
      cacheTimestamp: cacheTimestampSec,
      cacheDelay: asInt(book?.cache_delay ?? payload?.cache_delay, 0),
      listings,
      lowestPrice: listings[0]?.price ?? null,
      secondPrice: listings[1]?.price ?? null,
      thirdPrice: listings[2]?.price ?? null,
      top20Quantity: top20.reduce((sum, row) => sum + row.quantity, 0),
      depthMetrics: {
        listingCount: listings.length,
        totalListings: totalListings || listings.length,
        top5Quantity: listings.slice(0, 5).reduce((sum, row) => sum + row.quantity, 0),
        top20Quantity: top20.reduce((sum, row) => sum + row.quantity, 0)
      },
      medianListingPrice: median(prices),
      calculatedMarketAnchor: robustMarketAnchor(listings),
      // The commodity model only applies to fungible stackable items.
      // Weapons and armor are never priced.
      supportedCommodity: !equipment,
      equipment
    };
  }

  // Agreement between Torn's official daily average (actual purchases) and
  // the robust depth anchor is the strongest cold-start evidence available
  // before local history has accumulated.
  function officialAgreement(snapshot) {
    const anchor = asInt(snapshot?.calculatedMarketAnchor, 0);
    const average = asInt(snapshot?.averagePrice, 0);
    if (anchor <= 0 || average <= 0) return { available: false, agrees: false, ratio: null };
    const ratio = Math.abs(anchor - average) / average;
    return { available: true, agrees: ratio <= OFFICIAL_AGREEMENT_TOLERANCE, ratio };
  }

  function calculateHistoryStats(points, nowMs = Date.now()) {
    const windows = {
      oneHour: ONE_MINUTE_MS * 60,
      oneDay: ONE_DAY_MS,
      sevenDays: ONE_DAY_MS * 7
    };
    const result = {};

    for (const [name, windowMs] of Object.entries(windows)) {
      const anchors = points
        .filter((point) => nowMs - asInt(point.timestamp) * 1000 <= windowMs)
        .map((point) => Number(point.marketAnchor))
        .filter((value) => Number.isFinite(value) && value > 0);
      const center = median(anchors);
      const deviation = mad(anchors, center);
      result[name] = {
        count: anchors.length,
        medianAnchor: Number.isFinite(center) ? Math.round(center) : null,
        mad: Number.isFinite(deviation) ? Math.round(deviation) : null,
        volatility: Number.isFinite(center) && center > 0 && Number.isFinite(deviation) ? deviation / center : null,
        low: anchors.length ? Math.min(...anchors) : null,
        high: anchors.length ? Math.max(...anchors) : null
      };
    }

    const day = result.oneDay;
    const sampleConfidence = day.count >= 50 ? "HIGH" : day.count >= 15 ? "MEDIUM" : day.count >= 5 ? "LOW" : "VERY LOW";
    return {
      ...result,
      historicalFairValue: day.count >= 5 ? day.medianAnchor : null,
      sampleConfidence
    };
  }

  function freshness(cacheTimestampSec, nowMs = Date.now()) {
    if (!cacheTimestampSec) return { ageSeconds: null, label: "UNKNOWN", score: 25 };
    const ageSeconds = Math.max(0, Math.round(nowMs / 1000 - cacheTimestampSec));
    if (ageSeconds <= 30) return { ageSeconds, label: "FRESH", score: 100 };
    if (ageSeconds <= 90) return { ageSeconds, label: "NORMAL", score: 75 };
    if (ageSeconds <= 180) return { ageSeconds, label: "STALE", score: 45 };
    return { ageSeconds, label: "STALE", score: 20 };
  }

  function confidenceForOpportunity({ historyStats, snapshot, prefixCount = 1, nextAsk, nowMs = Date.now() }) {
    const day = historyStats?.oneDay || { count: 0, volatility: null };
    let score = 0;

    if (day.count >= 50) score += 35;
    else if (day.count >= 15) score += 27;
    else if (day.count >= 5) score += 16;
    else score += Math.min(8, day.count * 2);

    const volatility = day.volatility;
    if (Number.isFinite(volatility)) {
      if (volatility <= 0.01) score += 20;
      else if (volatility <= 0.03) score += 14;
      else if (volatility <= 0.06) score += 7;
    }

    const listings = snapshot?.listings || [];
    const depthQuantity = snapshot?.depthMetrics?.top20Quantity || 0;
    const listingCount = listings.length;
    if (listingCount >= 20) score += 12;
    else if (listingCount >= 10) score += 9;
    else if (listingCount >= 5) score += 5;
    if (depthQuantity >= 1000) score += 8;
    else if (depthQuantity >= 100) score += 5;
    else if (depthQuantity >= 20) score += 2;

    const fresh = freshness(snapshot?.cacheTimestamp, nowMs);
    score += Math.round(fresh.score * 0.15);

    if (Number.isFinite(nextAsk) && prefixCount > 0) {
      const boughtPrice = listings[Math.min(prefixCount - 1, listings.length - 1)]?.price;
      const after = listings.slice(prefixCount, Math.min(prefixCount + 5, listings.length));
      const afterMedian = median(after.map((row) => row.price));
      if (Number.isFinite(boughtPrice) && Number.isFinite(afterMedian) && afterMedian >= boughtPrice * 1.02) score += 7;
    }

    // Official daily average agreeing with current depth substitutes for
    // missing local history during cold start, and adds a little on top of it
    // once history exists.
    const agreement = officialAgreement(snapshot);
    if (agreement.agrees) score += day.count >= 5 ? 6 : 20;

    score = clamp(score, 0, 100);
    // Without local observations the model cannot vouch for stability, so the
    // label is capped at MEDIUM regardless of score.
    if (day.count < 5 && score >= 78) score = 77;
    const label = score >= 78 ? "HIGH" : score >= 55 ? "MEDIUM" : score >= 32 ? "LOW" : "VERY LOW";
    return { score, label, freshness: fresh };
  }

  function chooseReference(snapshot, historyStats) {
    const historicalFairValue = historyStats?.historicalFairValue || null;
    if (historicalFairValue) return { value: historicalFairValue, source: "24h observed median" };
    const currentAnchor = snapshot?.calculatedMarketAnchor || null;
    const averagePrice = snapshot?.averagePrice || null;
    if (currentAnchor && averagePrice) {
      const agreement = officialAgreement(snapshot);
      return {
        value: Math.min(currentAnchor, Math.round(averagePrice * 1.05)),
        source: agreement.agrees ? "Torn daily average confirmed by current depth" : "current depth + Torn value sanity check",
        officialAgreement: agreement
      };
    }
    if (currentAnchor) return { value: currentAnchor, source: "current market depth" };
    if (averagePrice) return { value: averagePrice, source: "Torn value sanity check" };
    return { value: null, source: "unavailable" };
  }

  function calculateExit({ snapshot, historyStats, nextAsk = null, settings }) {
    const currentAnchor = snapshot?.calculatedMarketAnchor || null;
    const historicalFair = historyStats?.historicalFairValue || null;
    const averagePrice = snapshot?.averagePrice || null;
    const agreement = officialAgreement(snapshot);
    let exitAnchor = null;

    if (historicalFair && Number.isFinite(nextAsk)) {
      exitAnchor = Math.min(nextAsk, Math.floor(historicalFair * settings.allowedHistoricalPremium));
    } else if (historicalFair && currentAnchor) {
      exitAnchor = Math.min(currentAnchor, Math.floor(historicalFair * settings.allowedHistoricalPremium));
    } else if (historicalFair) {
      exitAnchor = historicalFair;
    } else if (Number.isFinite(nextAsk) && currentAnchor) {
      exitAnchor = Math.min(nextAsk, currentAnchor);
    } else {
      exitAnchor = currentAnchor || nextAsk || null;
    }

    // Cold start: Torn's daily average reflects actual purchases. Without local
    // history it caps the exit so a temporarily inflated order book cannot
    // inflate the expected resale.
    if (!historicalFair && Number.isFinite(exitAnchor) && averagePrice) {
      const officialCap = Math.floor(averagePrice * settings.allowedHistoricalPremium);
      exitAnchor = Math.min(exitAnchor, officialCap);
    }

    if (!Number.isFinite(exitAnchor) || exitAnchor <= 0) return null;
    const coldStart = (historyStats?.oneDay?.count || 0) < 5;
    // The warm-up penalty is waived when the official average and the depth
    // anchor agree; the two independent sources corroborate each other.
    const warmupExtra = coldStart && !agreement.agrees ? 0.02 : 0;
    const haircut = clamp(settings.safetyHaircut + warmupExtra, 0, 0.10);
    const conservativeExitPrice = Math.max(1, Math.floor(exitAnchor * (1 - haircut)));
    const itemMarketSuggestedPrice = Math.max(1, conservativeExitPrice - Math.max(0, asInt(settings.itemMarketUndercut)));
    const bazaarSuggestedPrice = Math.max(1, Math.floor(conservativeExitPrice * (1 - settings.bazaarDiscount)));

    return {
      exitAnchor,
      haircut,
      coldStart,
      officialAgreement: agreement,
      conservativeExitPrice,
      itemMarketSuggestedPrice,
      bazaarSuggestedPrice
    };
  }

  function routeEconomics(exit, quantity, settings, extras = {}) {
    const qty = Math.max(1, asInt(quantity, 1));
    const feeBps = itemMarketFeeBps(settings);
    const itemMarketGross = exit.itemMarketSuggestedPrice * qty;
    const itemMarketNet = itemMarketNetFor(exit.itemMarketSuggestedPrice, qty, feeBps);
    const bazaarGross = exit.bazaarSuggestedPrice * qty;
    const bazaarNet = settings.bazaarEnabled ? bazaarGross : Number.NEGATIVE_INFINITY;
    const auctionGross = exit.conservativeExitPrice * qty;
    const auctionNet = auctionNetFor(exit.conservativeExitPrice, qty);

    // Museum set route: value implied by completing a set and exchanging it for
    // points. Informational unless the set model produced a positive value.
    const museum = extras?.museum && Number.isFinite(extras.museum.impliedValue) && extras.museum.impliedValue > 0
      ? {
        suggestedPrice: Math.max(1, Math.floor(extras.museum.impliedValue * (1 - clamp(settings.safetyHaircut, 0, 0.10)))),
        label: extras.museum.label || "Museum set"
      }
      : null;
    const museumGross = museum ? museum.suggestedPrice * qty : Number.NEGATIVE_INFINITY;
    const museumNet = museum && settings.museumSetsEnabled !== false ? museumGross : Number.NEGATIVE_INFINITY;
    // NPC shops buy instantly at a fixed price (no fee, no waiting). It is a
    // legitimate exit for contraband and for items whose market has sunk
    // below the shop's offer.
    const shopSellPrice = Number.isFinite(extras?.shopSell) && extras.shopSell > 0 ? Math.floor(extras.shopSell) : null;
    const shopGross = shopSellPrice ? shopSellPrice * qty : Number.NEGATIVE_INFINITY;

    const candidates = [
      { route: "Bazaar", net: bazaarNet },
      { route: "Item Market", net: itemMarketNet },
      { route: "Museum set", net: museumNet },
      { route: "Sell to shop", net: shopGross }
    ].filter((candidate) => Number.isFinite(candidate.net));
    candidates.sort((a, b) => b.net - a.net);
    const bestRoute = candidates[0]?.route || "Item Market";
    const bestNet = candidates[0]?.net ?? itemMarketNet;

    return {
      itemMarket: {
        suggestedPrice: exit.itemMarketSuggestedPrice,
        gross: itemMarketGross,
        net: itemMarketNet,
        fee: itemMarketGross - itemMarketNet,
        feeBps
      },
      bazaar: settings.bazaarEnabled ? {
        suggestedPrice: exit.bazaarSuggestedPrice,
        gross: bazaarGross,
        net: bazaarNet,
        fee: 0
      } : null,
      // Auction House is reported for sellers comparing exits but never
      // chosen automatically: auction outcomes are uncertain.
      auction: {
        suggestedPrice: exit.conservativeExitPrice,
        gross: auctionGross,
        net: auctionNet,
        fee: auctionGross - auctionNet,
        feeBps: AUCTION_HOUSE_FEE_BPS
      },
      museum: museum ? {
        suggestedPrice: museum.suggestedPrice,
        gross: museumGross,
        net: museumGross,
        fee: 0,
        label: museum.label
      } : null,
      shop: shopSellPrice ? {
        suggestedPrice: shopSellPrice,
        gross: shopGross,
        net: shopGross,
        fee: 0,
        label: extras.shopLabel || "Sell to shop"
      } : null,
      bestRoute,
      bestNet,
      bestNetPerUnit: Math.floor(bestNet / qty)
    };
  }

  function classificationForEconomics({ roi, profit, discount, confidence, historyStats, fresh, settings, forceYellow = false }) {
    const reasons = [];
    const economicPass = roi >= settings.minimumROI && profit >= settings.minimumProfit && discount >= settings.minimumDiscount;

    reasons.push({ pass: roi >= settings.minimumROI, text: `ROI ${(roi * 100).toFixed(2)}% ${roi >= settings.minimumROI ? ">=" : "<"} ${(settings.minimumROI * 100).toFixed(2)}%` });
    reasons.push({ pass: profit >= settings.minimumProfit, text: `Profit ${formatMoney(profit)} ${profit >= settings.minimumProfit ? ">=" : "<"} ${formatMoney(settings.minimumProfit)}` });
    reasons.push({ pass: discount >= settings.minimumDiscount, text: `Discount ${(discount * 100).toFixed(2)}% ${discount >= settings.minimumDiscount ? ">=" : "<"} ${(settings.minimumDiscount * 100).toFixed(2)}%` });

    if (profit < 0) {
      return { state: "RED", reasons: [{ pass: false, text: "Expected net profit is negative after exit costs" }, ...reasons] };
    }
    if (!economicPass) return { state: "GREY", reasons };

    const minConfidence = CONFIDENCE_RANK[settings.minimumGreenConfidence] ?? CONFIDENCE_RANK.MEDIUM;
    const confidencePass = (CONFIDENCE_RANK[confidence.label] ?? 0) >= minConfidence;
    const volatility = historyStats?.oneDay?.volatility;
    const volatilityPass = !Number.isFinite(volatility) || volatility <= settings.maxVolatility;
    const freshnessPass = fresh.label !== "STALE";

    reasons.push({ pass: confidencePass, text: `Confidence ${confidence.label}${confidencePass ? " is sufficient" : " is below green threshold"}` });
    reasons.push({ pass: volatilityPass, text: Number.isFinite(volatility) ? `24h MAD volatility ${(volatility * 100).toFixed(2)}%` : "Volatility unknown during warm-up" });
    reasons.push({ pass: freshnessPass, text: `Market snapshot ${fresh.label.toLowerCase()}` });

    if (forceYellow || !confidencePass || !volatilityPass || !freshnessPass) return { state: "YELLOW", reasons };
    return { state: "GREEN", reasons };
  }

  function opportunityScore({ roi, profit, confidence, snapshot, capitalRequired, settings, historyStats }) {
    const roiComponent = clamp(roi / Math.max(0.08, settings.minimumROI * 3), 0, 1);
    const profitTarget = Math.max(settings.minimumProfit * 5, settings.maxCapitalOpportunity * 0.05, 1);
    const profitComponent = clamp(profit / profitTarget, 0, 1);
    const confidenceComponent = clamp(confidence.score / 100, 0, 1);
    const volatility = historyStats?.oneDay?.volatility;
    const stability = Number.isFinite(volatility) ? clamp(1 - volatility / Math.max(settings.maxVolatility * 2, 0.01), 0, 1) : 0.35;
    const depth = clamp((snapshot?.depthMetrics?.listingCount || 0) / 20, 0, 1);
    const stabilityDepth = (stability + depth) / 2;
    const capitalEfficiency = clamp(1 - capitalRequired / Math.max(settings.maxCapitalOpportunity, 1), 0, 1);
    return Math.round(100 * (0.30 * roiComponent + 0.25 * profitComponent + 0.20 * confidenceComponent + 0.15 * stabilityDepth + 0.10 * capitalEfficiency));
  }

  function evaluatePrefixes(snapshot, historyStats, settings, nowMs = Date.now(), extras = {}) {
    if (!snapshot?.supportedCommodity) return { best: null, all: [], unsupported: true };
    const listings = snapshot.listings || [];
    if (listings.length < 2) return { best: null, all: [], unsupported: false };
    const reference = chooseReference(snapshot, historyStats);
    if (!reference.value) return { best: null, all: [], unsupported: false };

    const all = [];
    let quantityBought = 0;
    let capitalRequired = 0;

    for (let k = 0; k < listings.length - 1; k += 1) {
      const row = listings[k];
      const nextAsk = listings[k + 1]?.price;
      if (!Number.isFinite(nextAsk)) break;
      if (row.price >= reference.value) break;

      quantityBought += row.quantity;
      capitalRequired += row.price * row.quantity;
      if (capitalRequired > settings.maxCapitalOpportunity || capitalRequired > settings.maxCapitalItem || capitalRequired > settings.availableCapital) break;

      const averageBuyPrice = capitalRequired / quantityBought;
      const exit = calculateExit({ snapshot, historyStats, nextAsk, settings });
      if (!exit) continue;
      const routes = routeEconomics(exit, quantityBought, settings, extras);
      const expectedProfit = routes.bestNet - capitalRequired;
      const roi = capitalRequired > 0 ? expectedProfit / capitalRequired : 0;
      const discount = 1 - averageBuyPrice / reference.value;
      const confidence = confidenceForOpportunity({ historyStats, snapshot, prefixCount: k + 1, nextAsk, nowMs });
      const classification = classificationForEconomics({
        roi,
        profit: expectedProfit,
        discount,
        confidence,
        historyStats,
        fresh: confidence.freshness,
        settings
      });
      const score = opportunityScore({ roi, profit: expectedProfit, confidence, snapshot, capitalRequired, settings, historyStats });

      all.push({
        prefixCount: k + 1,
        quantityBought,
        capitalRequired,
        averageBuyPrice,
        nextAsk,
        referenceValue: reference.value,
        referenceSource: reference.source,
        exit,
        routes,
        expectedProfit,
        roi,
        profitPerUnit: expectedProfit / quantityBought,
        discountToFairValue: discount,
        confidence,
        classification,
        score
      });
    }

    const eligible = all.filter((opp) => opp.expectedProfit > 0);
    eligible.sort((a, b) => {
      const stateRank = { GREEN: 4, YELLOW: 3, GREY: 2, RED: 1 };
      return (stateRank[b.classification.state] - stateRank[a.classification.state]) || b.expectedProfit - a.expectedProfit || b.roi - a.roi;
    });
    return { best: eligible[0] || all[0] || null, all, unsupported: false };
  }

  function evaluateDirectBuy({ buyPrice, quantity = 1, snapshot, historyStats, settings, nowMs = Date.now(), forceYellow = false, museum = null, shopSell = null }) {
    const unitPrice = Math.max(1, asInt(buyPrice));
    const reference = chooseReference(snapshot, historyStats);
    if (!unitPrice || !reference.value || !snapshot?.supportedCommodity) return null;
    const affordableByOpp = Math.floor(settings.maxCapitalOpportunity / unitPrice);
    const affordableByItem = Math.floor(settings.maxCapitalItem / unitPrice);
    const affordableTotal = Math.floor(settings.availableCapital / unitPrice);
    const requestedQty = Math.max(1, asInt(quantity, 1));
    const qty = Math.max(0, Math.min(requestedQty, affordableByOpp, affordableByItem, affordableTotal));
    if (qty < 1) return null;

    const capitalRequired = unitPrice * qty;
    const exit = calculateExit({ snapshot, historyStats, settings });
    if (!exit) return null;
    const routes = routeEconomics(exit, qty, settings, { museum, shopSell });
    const expectedProfit = routes.bestNet - capitalRequired;
    const roi = expectedProfit / capitalRequired;
    const discount = 1 - unitPrice / reference.value;
    const confidence = confidenceForOpportunity({ historyStats, snapshot, prefixCount: 0, nextAsk: null, nowMs });
    const classification = classificationForEconomics({
      roi,
      profit: expectedProfit,
      discount,
      confidence,
      historyStats,
      fresh: confidence.freshness,
      settings,
      forceYellow
    });
    const score = opportunityScore({ roi, profit: expectedProfit, confidence, snapshot, capitalRequired, settings, historyStats });

    return {
      quantityBought: qty,
      capitalRequired,
      averageBuyPrice: unitPrice,
      referenceValue: reference.value,
      referenceSource: reference.source,
      exit,
      routes,
      expectedProfit,
      roi,
      profitPerUnit: expectedProfit / qty,
      discountToFairValue: discount,
      confidence,
      classification,
      score
    };
  }

  function maxRationalBid({ snapshot, historyStats, settings, quantity = 1, museum = null, shopSell = null, salesMedian = null }) {
    if (!snapshot?.supportedCommodity) return null;
    const qty = Math.max(1, asInt(quantity, 1));
    const exit = calculateExit({ snapshot, historyStats, settings });
    if (!exit) return null;
    const routes = routeEconomics(exit, qty, settings, { museum, shopSell });
    const reference = chooseReference(snapshot, historyStats).value;
    const maxByRoi = Math.floor((routes.bestNet / qty) / (1 + settings.minimumROI));
    const maxByProfit = Math.floor((routes.bestNet - settings.minimumProfit) / qty);
    const maxByDiscount = reference ? Math.floor(reference * (1 - settings.minimumDiscount)) : Number.POSITIVE_INFINITY;
    // Ended auctions are actual transactions: a rational bid does not exceed
    // what winners have recently paid for the same stackable item.
    const maxBySales = Number.isFinite(salesMedian) && salesMedian > 0 ? Math.floor(salesMedian) : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(maxByRoi, maxByProfit, maxByDiscount, maxBySales));
  }

  function estimateInventoryExit({ quantity, snapshot, historyStats, settings, museum = null, shopSell = null }) {
    const qty = Math.max(1, asInt(quantity, 1));
    if (!snapshot?.supportedCommodity) return null;
    const exit = calculateExit({ snapshot, historyStats, settings });
    if (!exit) return null;
    const routes = routeEconomics(exit, qty, settings, { museum, shopSell });
    return { quantity: qty, exit, routes, reference: chooseReference(snapshot, historyStats) };
  }

  // Exit model from Torn's official market value alone. Used where no order
  // book has been fetched yet (portfolio quick pass, shop runs, travel plan,
  // browse grid). It is deliberately more conservative than calculateExit:
  // the market value is a daily average of purchases, not a live floor.
  function officialExit(marketPrice, settings) {
    const value = asInt(marketPrice, 0);
    if (value <= 0) return null;
    const haircut = clamp(settings.safetyHaircut + 0.02, 0, 0.10);
    const conservativeExitPrice = Math.max(1, Math.floor(value * (1 - haircut)));
    return {
      exitAnchor: value,
      haircut,
      coldStart: true,
      official: true,
      officialAgreement: { available: false, agrees: false, ratio: null },
      conservativeExitPrice,
      itemMarketSuggestedPrice: Math.max(1, conservativeExitPrice - Math.max(0, asInt(settings.itemMarketUndercut))),
      bazaarSuggestedPrice: Math.max(1, Math.floor(conservativeExitPrice * (1 - settings.bazaarDiscount)))
    };
  }

  // Resolve the best available exit for an item: the live order book when a
  // snapshot exists (commodities), otherwise the official market value.
  function bestAvailableExit({ snapshot = null, historyStats = null, marketPrice = 0, settings }) {
    if (snapshot?.supportedCommodity) {
      const exit = calculateExit({ snapshot, historyStats, settings });
      if (exit) return { exit, source: "order book" };
    }
    const exit = officialExit(marketPrice || snapshot?.averagePrice || 0, settings);
    return exit ? { exit, source: "official market value" } : { exit: null, source: "unavailable" };
  }

  function formatMoney(value, exact = false) {
    if (!Number.isFinite(value)) return "-";
    const sign = value < 0 ? "-" : "";
    const absolute = Math.abs(value);
    if (exact) return `${sign}$${Math.round(absolute).toLocaleString("en-US")}`;
    if (absolute >= 1e9) return `${sign}$${(absolute / 1e9).toFixed(absolute >= 1e10 ? 1 : 2).replace(/\.0+$/, "")}b`;
    if (absolute >= 1e6) return `${sign}$${(absolute / 1e6).toFixed(absolute >= 1e7 ? 1 : 2).replace(/\.0+$/, "")}m`;
    if (absolute >= 1e3) return `${sign}$${(absolute / 1e3).toFixed(absolute >= 1e5 ? 0 : 1).replace(/\.0+$/, "")}k`;
    return `${sign}$${Math.round(absolute).toLocaleString("en-US")}`;
  }

  function formatAge(ageSeconds) {
    if (!Number.isFinite(ageSeconds)) return "unknown";
    if (ageSeconds < 60) return `${ageSeconds}s`;
    const minutes = Math.floor(ageSeconds / 60);
    const seconds = ageSeconds % 60;
    if (minutes < 60) return `${minutes}m ${seconds}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  function parseMoney(text) {
    if (!text) return null;
    const match = String(text).match(/\$\s*([\d,.]+)/);
    if (!match) return null;
    return asInt(match[1].replace(/[,.]/g, ""), null);
  }

  function parseIntegerField(value) {
    if (value === null || value === undefined) return null;
    const digits = String(value).replace(/[^0-9]/g, "");
    return digits ? asInt(digits, null) : null;
  }

  function parseQuantity(text) {
    if (!text) return 1;
    const patterns = [
      /(?:qty|quantity|amount|stock|available)\s*:?\s*([\d,]+)/i,
      /(?:^|\s)(?:x|\u00d7)\s*([\d,]+)/i,
      /([\d,]+)\s*(?:in stock|available)/i
    ];
    for (const pattern of patterns) {
      const match = String(text).match(pattern);
      if (match) return Math.max(1, asInt(match[1].replace(/,/g, ""), 1));
    }
    return 1;
  }


  // ---------------------------------------------------------------------------
  // Pure evaluators added in v0.3.0: equipment comparables, museum sets,
  // watchlist triggers, own Item Market listings and API key access.
  // ---------------------------------------------------------------------------

  function normalizeAuctionSales(payload, nowMs = Date.now()) {
    const rows = Array.isArray(payload?.auctionhouse) ? payload.auctionhouse : [];
    const cutoffSec = Math.floor((nowMs - AUCTION_SALES_WINDOW_MS) / 1000);
    return rows
      .map((row) => {
        const item = row?.item || {};
        const detailed = item && typeof item === "object" && (item.stats || Array.isArray(item.bonuses) || item.rarity !== undefined);
        return {
          id: asInt(row?.id, 0),
          price: asInt(row?.price, 0),
          bids: asInt(row?.bids, 0),
          timestamp: asInt(row?.timestamp, 0),
          itemId: asInt(item?.id, 0),
          stackable: !detailed,
          details: detailed ? {
            uid: item.uid ?? null,
            stats: item.stats || {},
            bonuses: Array.isArray(item.bonuses) ? item.bonuses : [],
            rarity: item.rarity ?? null
          } : null
        };
      })
      .filter((sale) => sale.price > 0 && sale.timestamp >= cutoffSec)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  function museumSetFor(itemId) {
    const id = asInt(itemId, 0);
    if (!id) return null;
    for (const set of Object.values(MUSEUM_SETS)) {
      if (set.items.includes(id)) return set;
    }
    return null;
  }

  function normalizePointsMarket(payload, observedAtMs = Date.now()) {
    const rows = Array.isArray(payload?.pointsmarket) ? payload.pointsmarket : [];
    const asks = rows
      .map((row) => ({ quantity: asInt(row?.quantity, 0), cost: asInt(row?.cost, 0) }))
      .filter((row) => row.quantity > 0 && row.cost > 0)
      .sort((a, b) => a.cost - b.cost);
    return {
      cheapest: asks[0]?.cost ?? null,
      medianTop10: median(asks.slice(0, 10).map((row) => row.cost)),
      listings: asks.length,
      observedAt: Math.floor(observedAtMs / 1000)
    };
  }

  // Value of one set piece implied by completing the set and exchanging it for
  // museum points: set value minus the cost of buying every other piece at
  // Torn's official market price. Negative or incomplete results mean the set
  // route is not attractive for this piece right now.
  function museumValuation({ itemId, memberPrices = {}, pointValue = null, settings = {} }) {
    const set = museumSetFor(itemId);
    const point = asInt(pointValue, 0);
    if (!set || point <= 0) return null;
    const id = asInt(itemId, 0);
    const others = set.items.filter((member) => member !== id);
    const missing = others.filter((member) => !(asInt(memberPrices?.[member], 0) > 0));
    const setValue = set.points * point;
    if (missing.length) {
      return { setKey: set.key, label: set.label, points: set.points, pointValue: point, setValue, othersCost: null, impliedValue: null, complete: false, missing };
    }
    const othersCost = others.reduce((sum, member) => sum + asInt(memberPrices[member], 0), 0);
    const impliedValue = setValue - othersCost;
    return {
      setKey: set.key,
      label: set.label,
      points: set.points,
      pointValue: point,
      setValue,
      othersCost,
      impliedValue,
      complete: true,
      missing: [],
      enabled: settings.museumSetsEnabled !== false
    };
  }

  function normalizeWatchlist(raw) {
    const rows = Array.isArray(raw) ? raw : [];
    const byId = new Map();
    rows.forEach((row) => {
      const itemId = asInt(row?.itemId, 0);
      const target = asInt(row?.target, 0);
      if (!itemId || target <= 0) return;
      byId.set(itemId, {
        itemId,
        name: String(row?.name || `Item ${itemId}`).slice(0, 80),
        target,
        addedAt: asInt(row?.addedAt, 0) || Math.floor(Date.now() / 1000),
        lastAlertAt: asInt(row?.lastAlertAt, 0) || 0,
        lastFloor: asInt(row?.lastFloor, 0) || null,
        lastCheckedAt: asInt(row?.lastCheckedAt, 0) || 0
      });
    });
    return Array.from(byId.values()).slice(0, WATCHLIST_MAX_ITEMS);
  }

  function evaluateWatchItem(entry, snapshot, nowMs = Date.now()) {
    const target = asInt(entry?.target, 0);
    const floor = asInt(snapshot?.lowestPrice, 0) || null;
    const triggered = Boolean(floor && target > 0 && floor <= target);
    const quantityAtOrBelow = triggered
      ? (snapshot?.listings || []).filter((row) => row.price <= target).reduce((sum, row) => sum + row.quantity, 0)
      : 0;
    const lastAlertMs = asInt(entry?.lastAlertAt, 0) * 1000;
    const cooldownActive = lastAlertMs > 0 && nowMs - lastAlertMs < WATCHLIST_ALERT_COOLDOWN_MS;
    const droppedFurther = Number.isFinite(entry?.lastFloor) && entry.lastFloor > 0 && floor && floor < entry.lastFloor * 0.98;
    return {
      triggered,
      shouldAlert: triggered && (!cooldownActive || droppedFurther),
      floor,
      target,
      quantityAtOrBelow,
      discountToTarget: floor && target ? 1 - floor / target : null
    };
  }

  function normalizeOwnListings(payload) {
    const rows = Array.isArray(payload?.itemmarket) ? payload.itemmarket : [];
    return rows
      .map((row) => {
        const item = row?.item || {};
        const detailed = Boolean(item?.stats || (Array.isArray(item?.bonuses) && item.bonuses.length) || item?.rarity);
        return {
          listingId: asInt(row?.id, 0),
          itemId: asInt(item?.id, 0),
          name: String(item?.name || `Item ${item?.id || ""}`).trim(),
          type: String(item?.type || ""),
          uid: item?.uid ?? null,
          price: asInt(row?.price, 0),
          averagePrice: asInt(row?.average_price, 0),
          amount: asInt(row?.amount, 0),
          available: asInt(row?.available, 0),
          anonymous: Boolean(row?.is_anonymous),
          equipment: detailed || isEquipmentType(item?.type),
          rarity: item?.rarity ?? null
        };
      })
      .filter((row) => row.itemId > 0 && row.price > 0);
  }

  function evaluateOwnListing(listing, snapshot, settings = {}) {
    const listings = snapshot?.listings || [];
    const floor = asInt(snapshot?.lowestPrice, 0) || null;
    const averagePrice = asInt(listing?.averagePrice, 0) || asInt(snapshot?.averagePrice, 0) || null;
    const feeBps = ITEM_MARKET_FEE_BPS + (listing?.anonymous && !settings.anonymousFeeWaived ? ANONYMOUS_LISTING_FEE_BPS : 0);
    const gross = listing.price * Math.max(1, listing.amount);
    const net = grossToNet(gross, feeBps);
    const cheaperRows = listings.filter((row) => row.price < listing.price);
    const cheaperQuantity = cheaperRows.reduce((sum, row) => sum + row.quantity, 0);
    const undercut = floor && floor < listing.price ? 1 - floor / listing.price : 0;
    const versusAverage = averagePrice ? listing.price / averagePrice - 1 : null;
    const undercutAmount = Math.max(0, asInt(settings.itemMarketUndercut ?? DEFAULTS.itemMarketUndercut));

    let status = "NO DATA";
    if (floor) {
      if (listing.price <= floor) status = "CHEAPEST";
      else if (cheaperQuantity <= Math.max(1, listing.amount)) status = "CLOSE";
      else status = "UNDERCUT";
    }

    let suggestedPrice = null;
    let note = "";
    if (status === "UNDERCUT" || status === "CLOSE") {
      suggestedPrice = Math.max(1, floor - undercutAmount);
      if (averagePrice && floor < averagePrice * 0.9) {
        note = `Floor is ${((1 - floor / averagePrice) * 100).toFixed(0)}% under Torn's daily average; matching it may be chasing a flash sale.`;
      }
    } else if (status === "CHEAPEST" && averagePrice && listing.price < averagePrice * 0.95) {
      note = `Listed ${((1 - listing.price / averagePrice) * 100).toFixed(0)}% below Torn's daily average.`;
    }

    return {
      status,
      floor,
      averagePrice,
      cheaperListings: cheaperRows.length,
      cheaperQuantity,
      undercut,
      versusAverage,
      feeBps,
      gross,
      net,
      suggestedPrice,
      note
    };
  }

  function keyAccessRank(info) {
    const type = String(info?.access?.type || "");
    if (KEY_ACCESS_RANK[type]) return KEY_ACCESS_RANK[type];
    return 0;
  }

  function keyAllowsSelection(info, section, selection) {
    const list = info?.selections?.[section];
    if (!Array.isArray(list)) return null;
    return list.includes(selection);
  }

  function keySupports(info, { section, selection, minimumType }) {
    if (!info) return null;
    const explicit = keyAllowsSelection(info, section, selection);
    if (explicit !== null) return explicit;
    const required = KEY_ACCESS_RANK[minimumType] || 0;
    return keyAccessRank(info) >= required;
  }


  // ---------------------------------------------------------------------------
  // v0.4.0 pure helpers: inventory portfolio, item details by uid, city and
  // foreign shops, auction guidance, browse-grid overlay, pricing rules and
  // sell-side (undercut) watch. All DOM-free and covered by unit tests.
  // ---------------------------------------------------------------------------

  function normalizeInventory(payload) {
    const rows = Array.isArray(payload?.inventory?.items) ? payload.inventory.items : (Array.isArray(payload?.inventory) ? payload.inventory : []);
    return rows
      .map((row) => ({
        itemId: asInt(row?.id ?? row?.item_id, 0),
        name: String(row?.name || `Item ${row?.id || ""}`).trim(),
        amount: Math.max(0, asInt(row?.amount ?? row?.quantity, 1)),
        equipped: row?.equipped === true,
        factionOwned: row?.faction_owned === true,
        uid: row?.uid == null ? null : asInt(row.uid, 0) || null
      }))
      .filter((row) => row.itemId > 0 && row.amount > 0);
  }

  function normalizeCityShops(payload) {
    const shops = Array.isArray(payload?.cityshops) ? payload.cityshops : [];
    return shops.map((shop) => ({
      shopId: asInt(shop?.id, 0),
      name: String(shop?.name || `Shop ${shop?.id || ""}`),
      items: (Array.isArray(shop?.items) ? shop.items : []).map((item) => ({
        itemId: asInt(item?.id, 0),
        name: String(item?.name || `Item ${item?.id || ""}`),
        price: asInt(item?.price, 0),
        stock: Math.max(0, asInt(item?.stock?.current, 0)),
        defaultStock: Math.max(0, asInt(item?.stock?.default, 0))
      })).filter((item) => item.itemId > 0 && item.price > 0)
    })).filter((shop) => shop.items.length);
  }

  // Highest price a Torn NPC shop pays for the item (instant, fee-free exit).
  function shopSellFloor(meta) {
    const shops = Array.isArray(meta?.shops) ? meta.shops : [];
    let best = 0;
    let label = "";
    shops.forEach((shop) => {
      if (shop.country && shop.country !== "Torn") return;
      if (shop.sellPrice > best) {
        best = shop.sellPrice;
        label = shop.name ? `Sell to ${shop.name}` : "Sell to shop";
      }
    });
    return best > 0 ? { price: best, label } : null;
  }

  // Foreign shop offers from item metadata (official buy prices per country;
  // stock is not part of the official API).
  function foreignOffers(metaList) {
    const offers = [];
    (metaList || []).forEach((meta) => {
      if (!meta || !Array.isArray(meta.shops)) return;
      meta.shops.forEach((shop) => {
        if (!shop.country || shop.country === "Torn" || !(shop.buyPrice > 0)) return;
        offers.push({
          itemId: meta.id,
          name: meta.name,
          type: meta.type,
          country: shop.country,
          shop: shop.name,
          buyPrice: shop.buyPrice,
          marketPrice: asInt(meta.marketPrice, 0),
          isTradable: meta.isTradable !== false
        });
      });
    });
    return offers;
  }

  // Profit for buying `quantity` units at `buyPrice` and exiting through the
  // best route. `exit` comes from bestAvailableExit(); extras carry the
  // museum and shop-sell routes.
  function evaluateBuyAtPrice({ buyPrice, quantity = 1, exit, settings, museum = null, shopSell = null }) {
    const unit = asInt(buyPrice, 0);
    const qty = Math.max(1, asInt(quantity, 1));
    if (!unit || !exit) return null;
    const routes = routeEconomics(exit, qty, settings, { museum, shopSell: shopSell?.price ?? shopSell, shopLabel: shopSell?.label });
    const capital = unit * qty;
    const profit = routes.bestNet - capital;
    return {
      quantity: qty,
      capitalRequired: capital,
      expectedProfit: profit,
      profitPerUnit: Math.floor(profit / qty),
      roi: capital > 0 ? profit / capital : 0,
      routes,
      exit
    };
  }

  // City shop run: how much one restock-limited purchase at the NPC price is
  // worth after fees. Quantity is capped by current stock.
  function evaluateShopRun({ shopItem, exit, settings, museum = null, shopSell = null, quantity = null }) {
    if (!shopItem || !exit) return null;
    const requested = Math.max(1, asInt(quantity ?? settings.shopRunQuantity, 100));
    const qty = Math.max(1, Math.min(requested, shopItem.stock > 0 ? shopItem.stock : requested));
    const evaluation = evaluateBuyAtPrice({ buyPrice: shopItem.price, quantity: qty, exit, settings, museum, shopSell });
    if (!evaluation) return null;
    return {
      ...evaluation,
      itemId: shopItem.itemId,
      name: shopItem.name,
      buyPrice: shopItem.price,
      stock: shopItem.stock,
      outOfStock: shopItem.stock <= 0,
      state: evaluation.profitPerUnit <= 0 ? "GREY" : (evaluation.roi >= settings.minimumROI ? "GREEN" : "YELLOW")
    };
  }

  // Travel plan: profit per unit and per trip for a foreign offer, and the
  // cash needed to fill the capacity.
  function evaluateForeignOffer({ offer, exit, settings, capacity = 0, museum = null, shopSell = null }) {
    if (!offer || !exit) return null;
    const qty = capacity > 0 ? capacity : 1;
    const evaluation = evaluateBuyAtPrice({ buyPrice: offer.buyPrice, quantity: qty, exit, settings, museum, shopSell });
    if (!evaluation) return null;
    return {
      ...evaluation,
      itemId: offer.itemId,
      name: offer.name,
      country: offer.country,
      shop: offer.shop,
      buyPrice: offer.buyPrice,
      perTrip: capacity > 0 ? evaluation.expectedProfit : null,
      cashNeeded: capacity > 0 ? offer.buyPrice * capacity : offer.buyPrice,
      state: evaluation.profitPerUnit <= 0 ? "GREY" : (evaluation.roi >= settings.minimumROI ? "GREEN" : "YELLOW")
    };
  }

  function rankTravelPlan(evaluations, { perCountry = 3 } = {}) {
    const byCountry = new Map();
    (evaluations || []).forEach((row) => {
      if (!row || !(row.profitPerUnit > 0)) return;
      if (!byCountry.has(row.country)) byCountry.set(row.country, []);
      byCountry.get(row.country).push(row);
    });
    const countries = Array.from(byCountry.entries()).map(([country, rows]) => {
      rows.sort((a, b) => b.profitPerUnit - a.profitPerUnit);
      return { country, best: rows[0], rows: rows.slice(0, perCountry) };
    });
    countries.sort((a, b) => b.best.profitPerUnit - a.best.profitPerUnit);
    return countries;
  }

  // Museum pieces recognised by name (contraband singles and the arrowhead
  // set). Returns a valuation shaped like museumValuation().
  function museumByName({ meta, pointValue, allMetas = [], settings = {} }) {
    if (!meta?.name || !(pointValue > 0) || settings.museumSetsEnabled === false) return null;
    const lower = String(meta.name).toLowerCase().trim();
    const singlePoints = MUSEUM_SINGLES_BY_NAME[lower];
    if (singlePoints) {
      const implied = singlePoints * pointValue;
      return { label: `Museum piece (${singlePoints} pts)`, points: singlePoints, pointValue, othersCost: 0, setValue: implied, impliedValue: implied, complete: true, single: true };
    }
    for (const set of MUSEUM_NAME_SETS) {
      if (!set.pattern.test(meta.name)) continue;
      const members = allMetas.filter((other) => other && set.pattern.test(other.name));
      const distinct = new Map(members.map((other) => [other.id, other]));
      if (distinct.size < set.size) return { label: set.label, points: set.points, pointValue, complete: false, impliedValue: null };
      const othersCost = Array.from(distinct.values()).filter((other) => other.id !== meta.id).slice(0, set.size - 1).reduce((sum, other) => sum + asInt(other.marketPrice, 0), 0);
      const setValue = set.points * pointValue;
      return { label: set.label, points: set.points, pointValue, othersCost, setValue, impliedValue: setValue - othersCost, complete: true };
    }
    return null;
  }

  // Ended auction timing: when do sales of this item close at the best price?
  // Buckets are 6-hour windows in Torn City Time (UTC). Ratios are relative
  // to the overall median so equipment groups and commodities compare alike.
  function auctionTimingStats(sales, { minCount = 3 } = {}) {
    const rows = (sales || []).filter((sale) => Number.isFinite(sale?.price) && sale.price > 0 && asInt(sale?.timestamp, 0) > 0);
    if (!rows.length) return { buckets: [], best: null, overallMedian: null, total: 0 };
    const overallMedian = median(rows.map((sale) => sale.price));
    const buckets = [
      { key: "00-06", label: "00:00-06:00 TCT", start: 0 },
      { key: "06-12", label: "06:00-12:00 TCT", start: 6 },
      { key: "12-18", label: "12:00-18:00 TCT", start: 12 },
      { key: "18-24", label: "18:00-24:00 TCT", start: 18 }
    ].map((bucket) => ({ ...bucket, prices: [] }));
    rows.forEach((sale) => {
      const hour = new Date(sale.timestamp * 1000).getUTCHours();
      const bucket = buckets[Math.min(3, Math.floor(hour / 6))];
      bucket.prices.push(sale.price);
    });
    const result = buckets.map((bucket) => {
      const value = median(bucket.prices);
      return {
        key: bucket.key,
        label: bucket.label,
        count: bucket.prices.length,
        median: Number.isFinite(value) ? Math.round(value) : null,
        ratio: Number.isFinite(value) && overallMedian > 0 ? value / overallMedian : null
      };
    });
    const eligible = result.filter((bucket) => bucket.count >= minCount && Number.isFinite(bucket.ratio));
    eligible.sort((a, b) => b.ratio - a.ratio || b.count - a.count);
    return { buckets: result, best: eligible[0] || null, worst: eligible.length > 1 ? eligible[eligible.length - 1] : null, overallMedian: Math.round(overallMedian), total: rows.length };
  }

  function stackableSalesSummary(sales, nowMs = Date.now()) {
    const rows = (sales || []).filter((sale) => sale?.stackable && Number.isFinite(sale.price) && sale.price > 0 && nowMs - asInt(sale.timestamp, 0) * 1000 <= AUCTION_SALES_WINDOW_MS);
    if (!rows.length) return { count: 0, median: null, low: null, high: null };
    const prices = rows.map((sale) => sale.price);
    return { count: rows.length, median: Math.round(median(prices)), low: Math.min(...prices), high: Math.max(...prices) };
  }

  // Browse-grid overlay: discount of the displayed cheapest price against
  // Torn's official market value. No order book is fetched for the grid.
  function evaluateBrowseCard({ price, marketPrice, settings }) {
    const unit = asInt(price, 0);
    const value = asInt(marketPrice, 0);
    if (!unit || !value) return null;
    const discount = 1 - unit / value;
    const exit = officialExit(value, settings);
    const routes = exit ? routeEconomics(exit, 1, settings) : null;
    const netPerUnit = routes ? routes.bestNetPerUnit : null;
    const profit = Number.isFinite(netPerUnit) ? netPerUnit - unit : null;
    let state = "GREY";
    let label = "FAIR";
    if (discount < 0) label = "ABOVE MV";
    else if (profit > 0 && discount >= Math.max(0.10, settings.minimumDiscount * 2)) { state = "GREEN"; label = "STRONG"; }
    else if (profit > 0 && discount >= settings.minimumDiscount) { state = "YELLOW"; label = "CONSIDER"; }
    return { discount, profitPerUnit: profit, bestRoute: routes?.bestRoute || null, state, label, marketPrice: value };
  }

  // Per-item pricing rules for the repricing workbench.
  const PRICING_MODES = Object.freeze(["undercut", "anchor", "hold"]);

  function normalizePricingRules(raw) {
    const rules = {};
    if (!raw || typeof raw !== "object") return rules;
    Object.entries(raw).forEach(([key, value]) => {
      const itemId = asInt(key, 0);
      if (!itemId || !value || typeof value !== "object") return;
      const mode = PRICING_MODES.includes(value.mode) ? value.mode : "undercut";
      const minPrice = Math.max(0, asInt(value.minPrice, 0));
      if (mode === "undercut" && !minPrice) return;
      rules[itemId] = { mode, minPrice };
    });
    return rules;
  }

  // Resolve the price to fill for one listing given the rule and the two
  // candidate suggestions. Returns null price when the rule says hold or when
  // the floor-based suggestion would breach the item's minimum.
  function applyPricingRule({ rule = null, floorSuggestion = null, anchorSuggestion = null }) {
    const mode = rule?.mode || "undercut";
    const minPrice = Math.max(0, asInt(rule?.minPrice, 0));
    if (mode === "hold") return { price: null, mode, reason: "held by rule" };
    let price = mode === "anchor" ? anchorSuggestion : floorSuggestion;
    if (!Number.isFinite(price) || price <= 0) price = Number.isFinite(anchorSuggestion) && anchorSuggestion > 0 ? anchorSuggestion : null;
    if (!Number.isFinite(price) || price <= 0) return { price: null, mode, reason: "no suggestion" };
    if (minPrice && price < minPrice) return { price: minPrice, mode, reason: "raised to minimum", clamped: true };
    return { price: Math.floor(price), mode, reason: "" };
  }

  // Sell-side watch: the player's own listed prices, alerted when the Item
  // Market floor drops below them.
  function normalizeSellWatch(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const rows = [];
    raw.forEach((entry) => {
      const itemId = asInt(entry?.itemId, 0);
      const price = asInt(entry?.price, 0);
      const venue = entry?.venue === "Bazaar" ? "Bazaar" : "IM";
      if (!itemId || price <= 0) return;
      const key = `${venue}:${itemId}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        itemId,
        venue,
        name: String(entry?.name || `Item ${itemId}`),
        price,
        amount: Math.max(1, asInt(entry?.amount, 1)),
        recordedAt: asInt(entry?.recordedAt, 0),
        lastAlertAt: asInt(entry?.lastAlertAt, 0),
        lastFloor: asInt(entry?.lastFloor, 0) || null,
        lastCheckedAt: asInt(entry?.lastCheckedAt, 0)
      });
    });
    return rows.slice(0, SELL_WATCH_MAX_ITEMS);
  }

  function evaluateSellWatch(entry, snapshot, nowMs = Date.now()) {
    const floor = asInt(snapshot?.lowestPrice, 0);
    if (!floor) return { undercut: false, shouldAlert: false, floor: null, cheaperQuantity: 0 };
    const cheaper = (snapshot.listings || []).filter((row) => row.price < entry.price);
    const cheaperQuantity = cheaper.reduce((sum, row) => sum + row.quantity, 0);
    const undercut = floor < entry.price;
    const lastAlertMs = asInt(entry.lastAlertAt, 0) * 1000;
    const inCooldown = lastAlertMs && nowMs - lastAlertMs < SELL_WATCH_ALERT_COOLDOWN_MS;
    const furtherDrop = entry.lastFloor && floor < entry.lastFloor * 0.98;
    return { undercut, shouldAlert: undercut && (!inCooldown || furtherDrop), floor, cheaperQuantity, gap: entry.price - floor };
  }

  // Portfolio aggregation: one row per item id (commodities) or per copy
  // (equipment), each with a unit value, route and net total.
  function summarizePortfolio(rows) {
    const valued = rows.filter((row) => Number.isFinite(row.unitNet) && row.unitNet > 0);
    const total = valued.reduce((sum, row) => sum + row.unitNet * row.amount, 0);
    const byRoute = {};
    valued.forEach((row) => { byRoute[row.route] = (byRoute[row.route] || 0) + row.unitNet * row.amount; });
    return {
      total,
      valuedRows: valued.length,
      unvaluedRows: rows.length - valued.length,
      untradable: rows.filter((row) => row.untradable).length,
      equipped: rows.filter((row) => row.equipped).length,
      byRoute
    };
  }

  const TEST_EXPORTS = Object.freeze({
    APP,
    DEFAULTS,
    MUSEUM_SETS,
    ITEM_MARKET_FEE_BPS,
    ANONYMOUS_LISTING_FEE_BPS,
    AUCTION_HOUSE_FEE_BPS,
    median,
    mad,
    weightedMedian,
    robustMarketAnchor,
    normalizeMarketResponse,
    calculateHistoryStats,
    freshness,
    confidenceForOpportunity,
    officialAgreement,
    chooseReference,
    calculateExit,
    routeEconomics,
    grossToNet,
    grossToItemMarketNet,
    itemMarketFeeBps,
    itemMarketNetFor,
    auctionNetFor,
    evaluatePrefixes,
    evaluateDirectBuy,
    maxRationalBid,
    estimateInventoryExit,
    normalizeAuctionSales,
    museumSetFor,
    museumValuation,
    normalizePointsMarket,
    normalizeWatchlist,
    evaluateWatchItem,
    normalizeOwnListings,
    evaluateOwnListing,
    keyAccessRank,
    keySupports,
    formatMoney,
    parseMoney,
    parseQuantity,
    officialExit,
    bestAvailableExit,
    normalizeInventory,
    normalizeCityShops,
    shopSellFloor,
    foreignOffers,
    evaluateBuyAtPrice,
    evaluateShopRun,
    evaluateForeignOffer,
    rankTravelPlan,
    museumByName,
    auctionTimingStats,
    stackableSalesSummary,
    evaluateBrowseCard,
    normalizePricingRules,
    applyPricingRule,
    normalizeSellWatch,
    evaluateSellWatch,
    summarizePortfolio
  });

  global.__MARKET_EDGE_TEST__ = TEST_EXPORTS;
  if (typeof document === "undefined" || typeof window === "undefined") return;

  // ---------------------------------------------------------------------------
  // Environment detection (Tampermonkey/Violentmonkey vs Torn PDA)
  // ---------------------------------------------------------------------------

  const ENV = Object.freeze({
    hasGmStorage: typeof GM_getValue === "function" && typeof GM_setValue === "function",
    hasGmDelete: typeof GM_deleteValue === "function",
    hasGmRequest: typeof GM_xmlhttpRequest === "function",
    hasGmStyle: typeof GM_addStyle === "function",
    hasGmMenu: typeof GM_registerMenuCommand === "function",
    hasPdaRequest: typeof PDA_httpGet === "function",
    pdaKey: PDA_API_KEY_PLACEHOLDER.startsWith("###") ? "" : PDA_API_KEY_PLACEHOLDER.trim(),
    isPda: typeof PDA_httpGet === "function" || !PDA_API_KEY_PLACEHOLDER.startsWith("###") ||
      typeof window.flutter_inappwebview !== "undefined"
  });

  // ---------------------------------------------------------------------------
  // Configuration and storage
  // ---------------------------------------------------------------------------

  const LOCAL_STORAGE_PREFIX = "marketEdge.local.";

  function localFallbackGet(key, fallback) {
    try {
      const raw = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function localFallbackSet(key, value) {
    try {
      window.localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${key}`, JSON.stringify(value));
    } catch (error) {
      console.warn(APP.logPrefix, "Local storage write failed", key, error);
    }
  }

  function localFallbackDelete(key) {
    try {
      window.localStorage.removeItem(`${LOCAL_STORAGE_PREFIX}${key}`);
    } catch {
      // ignore
    }
  }

  class Store {
    static get(key, fallback) {
      if (!ENV.hasGmStorage) return localFallbackGet(key, fallback);
      try {
        const value = GM_getValue(key, fallback);
        if (value === undefined) return fallback;
        // Some userscript bridges (Torn PDA) persist values as strings.
        if (typeof value === "string" && fallback !== undefined && typeof fallback !== "string") {
          try { return JSON.parse(value); } catch { return value; }
        }
        return value;
      } catch (error) {
        console.warn(APP.logPrefix, "Storage read failed", key, error);
        return localFallbackGet(key, fallback);
      }
    }

    static set(key, value) {
      if (!ENV.hasGmStorage) {
        localFallbackSet(key, value);
        return;
      }
      try {
        GM_setValue(key, value);
      } catch (error) {
        console.warn(APP.logPrefix, "Storage write failed", key, error);
        localFallbackSet(key, value);
      }
    }

    static delete(key) {
      if (!ENV.hasGmStorage || !ENV.hasGmDelete) {
        localFallbackDelete(key);
        return;
      }
      try {
        GM_deleteValue(key);
      } catch (error) {
        console.warn(APP.logPrefix, "Storage delete failed", key, error);
      }
    }

    static settings() {
      const stored = Store.get(STORAGE_KEYS.settings, {});
      return { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
    }

    static saveSettings(settings) {
      Store.set(STORAGE_KEYS.settings, { ...DEFAULTS, ...settings });
    }

    static apiKey() {
      const stored = String(Store.get(STORAGE_KEYS.apiKey, "") || "").trim();
      // Torn PDA injects the player's key; use it when nothing was stored.
      return stored || ENV.pdaKey;
    }

    static setApiKey(key) {
      Store.set(STORAGE_KEYS.apiKey, String(key || "").trim());
    }

    static keyInfo() {
      const raw = Store.get(STORAGE_KEYS.keyInfo, null);
      return raw && typeof raw === "object" && raw.info ? raw : null;
    }

    static saveKeyInfo(info) {
      if (!info || typeof info !== "object") return;
      Store.set(STORAGE_KEYS.keyInfo, { savedAt: Date.now(), info });
    }

    static watchlist() {
      return normalizeWatchlist(Store.get(STORAGE_KEYS.watchlist, []));
    }

    static saveWatchlist(entries) {
      Store.set(STORAGE_KEYS.watchlist, normalizeWatchlist(entries));
    }

    static pointsMarket() {
      const raw = Store.get(STORAGE_KEYS.pointsMarket, null);
      if (!raw || typeof raw !== "object" || !raw.savedAt) return null;
      return raw;
    }

    static savePointsMarket(points) {
      if (!points) return;
      Store.set(STORAGE_KEYS.pointsMarket, { ...points, savedAt: Date.now() });
    }

    static auctionSales(itemId) {
      const raw = Store.get(`${STORAGE_KEYS.auctionSalesPrefix}${asInt(itemId)}`, null);
      if (!raw || typeof raw !== "object" || !raw.savedAt || !Array.isArray(raw.sales)) return null;
      return raw;
    }

    static saveAuctionSales(itemId, sales) {
      if (!asInt(itemId)) return;
      Store.set(`${STORAGE_KEYS.auctionSalesPrefix}${asInt(itemId)}`, { savedAt: Date.now(), sales: sales.slice(0, API_AUCTION_LIMIT) });
    }

    static snapshot(itemId) {
      const raw = Store.get(`${STORAGE_KEYS.snapshotPrefix}${asInt(itemId)}`, null);
      if (!raw || typeof raw !== "object") return null;
      const listings = Array.isArray(raw.listings)
        ? raw.listings.map((row) => ({ price: asInt(row.price), quantity: Math.max(1, asInt(row.quantity, 1)) })).filter((row) => row.price > 0)
        : [];
      if (!asInt(raw.itemId) || !listings.length) return null;
      return {
        ...raw,
        itemId: asInt(raw.itemId),
        cacheTimestamp: asInt(raw.cacheTimestamp),
        cacheDelay: asInt(raw.cacheDelay),
        timestampObserved: asInt(raw.timestampObserved),
        listings,
        lowestPrice: asInt(raw.lowestPrice, null),
        secondPrice: asInt(raw.secondPrice, null),
        thirdPrice: asInt(raw.thirdPrice, null),
        top20Quantity: asInt(raw.top20Quantity),
        medianListingPrice: Number(raw.medianListingPrice) || null,
        calculatedMarketAnchor: asInt(raw.calculatedMarketAnchor, null),
        depthMetrics: raw.depthMetrics && typeof raw.depthMetrics === "object" ? raw.depthMetrics : {
          listingCount: listings.length,
          top5Quantity: listings.slice(0, 5).reduce((sum, row) => sum + row.quantity, 0),
          top20Quantity: listings.slice(0, 20).reduce((sum, row) => sum + row.quantity, 0)
        },
        supportedCommodity: raw.supportedCommodity !== false,
        equipment: raw.equipment === true
      };
    }

    static saveSnapshot(snapshot) {
      if (!snapshot?.itemId || !Array.isArray(snapshot.listings) || !snapshot.listings.length) return;
      Store.set(`${STORAGE_KEYS.snapshotPrefix}${snapshot.itemId}`, {
        itemId: snapshot.itemId,
        itemName: snapshot.itemName,
        itemType: snapshot.itemType,
        averagePrice: snapshot.averagePrice,
        cacheTimestamp: snapshot.cacheTimestamp,
        cacheDelay: snapshot.cacheDelay,
        timestampObserved: snapshot.timestampObserved,
        listings: snapshot.listings.slice(0, API_LIST_LIMIT).map((row) => ({ price: row.price, quantity: row.quantity })),
        lowestPrice: snapshot.lowestPrice,
        secondPrice: snapshot.secondPrice,
        thirdPrice: snapshot.thirdPrice,
        top20Quantity: snapshot.top20Quantity,
        depthMetrics: snapshot.depthMetrics,
        medianListingPrice: snapshot.medianListingPrice,
        calculatedMarketAnchor: snapshot.calculatedMarketAnchor,
        supportedCommodity: snapshot.supportedCommodity,
        equipment: snapshot.equipment === true
      });
    }

    static itemMeta(itemId, maxAgeMs = ITEM_META_TTL_MS) {
      const raw = Store.get(`${STORAGE_KEYS.itemMetaPrefix}${asInt(itemId)}`, null);
      if (!raw || typeof raw !== "object" || !raw.savedAt) return null;
      if (Date.now() - asInt(raw.savedAt) > maxAgeMs) return null;
      return raw.meta && typeof raw.meta === "object" ? raw.meta : null;
    }

    static saveItemMeta(meta) {
      if (!meta?.id) return;
      Store.set(`${STORAGE_KEYS.itemMetaPrefix}${asInt(meta.id)}`, { savedAt: Date.now(), meta });
    }

    static pricingRules() {
      return normalizePricingRules(Store.get(STORAGE_KEYS.pricingRules, {}));
    }

    static savePricingRule(itemId, rule) {
      const rules = Store.pricingRules();
      const id = asInt(itemId, 0);
      if (!id) return rules;
      if (!rule) delete rules[id];
      else rules[id] = rule;
      Store.set(STORAGE_KEYS.pricingRules, normalizePricingRules(rules));
      return Store.pricingRules();
    }

    static sellWatch() {
      return normalizeSellWatch(Store.get(STORAGE_KEYS.sellWatch, []));
    }

    static saveSellWatch(entries) {
      Store.set(STORAGE_KEYS.sellWatch, normalizeSellWatch(entries));
    }

    static inventory() {
      const raw = Store.get(STORAGE_KEYS.inventory, null);
      if (!raw || typeof raw !== "object" || !raw.savedAt || !Array.isArray(raw.items)) return null;
      return raw;
    }

    static saveInventory(items) {
      Store.set(STORAGE_KEYS.inventory, { savedAt: Date.now(), items });
    }

    static cityShops() {
      const raw = Store.get(STORAGE_KEYS.cityShops, null);
      if (!raw || typeof raw !== "object" || !raw.savedAt || !Array.isArray(raw.shops)) return null;
      return raw;
    }

    static saveCityShops(shops) {
      Store.set(STORAGE_KEYS.cityShops, { savedAt: Date.now(), shops });
    }

    static foreignCatalog() {
      const raw = Store.get(STORAGE_KEYS.foreignCatalog, null);
      if (!raw || typeof raw !== "object" || !raw.savedAt || !Array.isArray(raw.items)) return null;
      return raw;
    }

    static saveForeignCatalog(items) {
      Store.set(STORAGE_KEYS.foreignCatalog, { savedAt: Date.now(), items });
    }

    static history(itemId) {
      const raw = Store.get(`${STORAGE_KEYS.historyPrefix}${itemId}`, []);
      return Array.isArray(raw) ? raw : [];
    }

    static appendHistory(snapshot, settings) {
      if (!snapshot?.itemId || !snapshot?.calculatedMarketAnchor) return false;
      const key = `${STORAGE_KEYS.historyPrefix}${snapshot.itemId}`;
      const points = Store.history(snapshot.itemId);
      const cacheTimestamp = snapshot.cacheTimestamp || snapshot.timestampObserved;
      const last = points[points.length - 1];
      if (last && last.cacheTimestamp === cacheTimestamp) return false;
      if (last && snapshot.timestampObserved * 1000 - last.timestamp * 1000 < HISTORY_MIN_GAP_MS) return false;

      points.push({
        timestamp: snapshot.timestampObserved,
        cacheTimestamp,
        lowestPrice: snapshot.lowestPrice,
        secondPrice: snapshot.secondPrice,
        marketAnchor: snapshot.calculatedMarketAnchor,
        totalQuantityTop20: snapshot.top20Quantity,
        medianListingPrice: snapshot.medianListingPrice
      });

      const cutoff = Date.now() - clamp(settings.historyRetentionDays, 1, 90) * ONE_DAY_MS;
      const trimmed = points
        .filter((point) => point.timestamp * 1000 >= cutoff)
        .slice(-HISTORY_MAX_POINTS);
      Store.set(key, trimmed);
      return true;
    }
  }

  let settings = Store.settings();

  function log(...args) {
    if (settings.developerMode) console.log(APP.logPrefix, ...args);
  }

  // ---------------------------------------------------------------------------
  // Torn API client
  // ---------------------------------------------------------------------------

  class RequestScheduler {
    constructor({ maxPerMinute, concurrency }) {
      this.maxPerMinute = maxPerMinute;
      this.concurrency = concurrency;
      this.requestTimes = [];
      this.active = 0;
      this.queue = [];
      this.sequence = 0;
      this.timer = null;
    }

    schedule(task, priority = 0, meta = {}) {
      return new Promise((resolve, reject) => {
        this.queue.push({ task, priority, meta, resolve, reject, sequence: this.sequence++ });
        this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
        this.pump();
      });
    }

    cancelQueued(predicate, reason = "Market Edge request superseded by page navigation.") {
      const kept = [];
      let canceled = 0;
      for (const job of this.queue) {
        if (!predicate(job)) {
          kept.push(job);
          continue;
        }
        const error = new Error(reason);
        error.name = "AbortError";
        error.marketEdgeCanceled = true;
        job.reject(error);
        canceled += 1;
      }
      this.queue = kept;
      if (canceled) this.pump();
      return canceled;
    }

    pump() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      const now = Date.now();
      this.requestTimes = this.requestTimes.filter((time) => now - time < ONE_MINUTE_MS);

      while (this.active < this.concurrency && this.queue.length) {
        if (this.requestTimes.length >= this.maxPerMinute) {
          const waitMs = Math.max(100, ONE_MINUTE_MS - (now - this.requestTimes[0]) + 25);
          this.timer = setTimeout(() => this.pump(), waitMs);
          return;
        }

        const job = this.queue.shift();
        this.active += 1;
        this.requestTimes.push(Date.now());
        Promise.resolve()
          .then(job.task)
          .then(job.resolve, job.reject)
          .finally(() => {
            this.active -= 1;
            this.pump();
          });
      }
    }
  }

  // Transport abstraction: Torn PDA exposes PDA_httpGet, userscript managers
  // expose GM_xmlhttpRequest, and plain fetch is the last resort (the Torn API
  // sends permissive CORS headers). All three only ever talk to api.torn.com.
  function transportGet(url, headers) {
    if (ENV.hasPdaRequest) {
      return Promise.resolve(PDA_httpGet(url, headers)).then((response) => ({
        status: asInt(response?.status, 200),
        responseText: String(response?.responseText ?? "")
      }));
    }
    if (ENV.hasGmRequest) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          headers,
          timeout: 20000,
          onload: (response) => resolve({ status: response.status, responseText: response.responseText }),
          onerror: () => reject(new Error("Unable to reach the Torn API.")),
          ontimeout: () => reject(new Error("Torn API request timed out."))
        });
      });
    }
    if (typeof fetch === "function") {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
      return fetch(url, { method: "GET", headers, signal: controller?.signal })
        .then(async (response) => ({ status: response.status, responseText: await response.text() }))
        .catch((error) => {
          throw new Error(error?.name === "AbortError" ? "Torn API request timed out." : "Unable to reach the Torn API.");
        })
        .finally(() => { if (timer) clearTimeout(timer); });
    }
    return Promise.reject(new Error("No HTTP transport is available in this userscript environment."));
  }

  class TornApi {
    constructor() {
      this.base = "https://api.torn.com/v2";
      this.scheduler = new RequestScheduler({
        maxPerMinute: API_MAX_REQUESTS_PER_MINUTE,
        concurrency: API_CONCURRENCY
      });
      this.memoryCache = new Map();
      this.inFlight = new Map();
    }

    buildUrl(path) {
      const url = new URL(`${this.base}${path}`);
      if (!url.searchParams.has("comment")) url.searchParams.set("comment", API_COMMENT);
      return url.toString();
    }

    async request(path, { cacheMs = 25000, priority = 0, queueGroup = null } = {}) {
      const key = Store.apiKey();
      if (!key) throw new Error("API key missing. Open Market Edge settings.");

      const cacheKey = path;
      const cached = this.memoryCache.get(cacheKey);
      if (cacheMs > 0 && cached && Date.now() - cached.at < cacheMs) return cached.data;
      if (this.inFlight.has(cacheKey)) return this.inFlight.get(cacheKey);

      const promise = this.scheduler.schedule(() => {
        log("API request", path);
        const headers = {
          Authorization: `ApiKey ${key}`,
          Accept: "application/json"
        };
        return transportGet(this.buildUrl(path), headers).then((response) => {
          let body;
          try {
            body = JSON.parse(response.responseText || "{}");
          } catch {
            throw new Error(`Torn API returned invalid JSON (HTTP ${response.status}).`);
          }
          if (body?.error) {
            const error = new Error(`Torn API: ${body.error.error || body.error.message || "Unknown error"}`);
            error.tornCode = asInt(body.error.code, 0);
            throw error;
          }
          if (response.status < 200 || response.status >= 300) {
            throw new Error(`Torn API: HTTP ${response.status}`);
          }
          return body;
        });
      }, priority, { path, queueGroup })
        .then((data) => {
          this.memoryCache.set(cacheKey, { at: Date.now(), data });
          return data;
        })
        .finally(() => this.inFlight.delete(cacheKey));
      this.inFlight.set(cacheKey, promise);
      return promise;
    }

    async keyInfo({ priority = 100, cacheMs = ONE_DAY_MS } = {}) {
      const data = await this.request("/key/info", { cacheMs, priority });
      const info = data?.info && typeof data.info === "object" ? data.info : null;
      if (info) {
        Store.saveKeyInfo(info);
        const playerId = asInt(info?.user?.id, 0);
        if (playerId) Store.set(STORAGE_KEYS.playerId, playerId);
      }
      return info;
    }

    async testKey() {
      // /key/info is available to every key type and reports the access
      // level, which drives which optional features are offered.
      const info = await this.keyInfo({ cacheMs: 0 });
      let playerId = asInt(info?.user?.id, 0);
      if (!playerId) {
        const data = await this.request("/user/basic", { cacheMs: 0, priority: 100 });
        playerId = asInt(data?.profile?.id ?? data?.basic?.id ?? data?.player_id ?? data?.id, 0);
        if (playerId) Store.set(STORAGE_KEYS.playerId, playerId);
      }
      return {
        ok: true,
        playerId: playerId || null,
        accessType: String(info?.access?.type || "Unknown"),
        accessRank: keyAccessRank(info),
        info
      };
    }

    async itemMarket(itemId, { limit = API_LIST_LIMIT, priority = 0, queueGroup = null } = {}) {
      const safeLimit = clamp(asInt(limit, API_LIST_LIMIT), 1, API_DEEP_LIMIT);
      return this.request(`/market/${asInt(itemId)}/itemmarket?limit=${safeLimit}&offset=0`, { priority, queueGroup });
    }

    async items(itemIds, { priority = 120, cacheMs = ONE_DAY_MS } = {}) {
      const ids = Array.from(new Set(itemIds.map((id) => asInt(id)).filter(Boolean))).slice(0, 100);
      if (!ids.length) return { items: [] };
      return this.request(`/torn/${ids.join(",")}/items`, { cacheMs, priority });
    }

    async auctionSales(itemId, { priority = 40 } = {}) {
      return this.request(`/market/${asInt(itemId)}/auctionhouse?limit=${API_AUCTION_LIMIT}&sort=DESC`, {
        cacheMs: AUCTION_SALES_TTL_MS,
        priority
      });
    }

    async pointsMarket({ priority = 60 } = {}) {
      return this.request("/market/pointsmarket", { cacheMs: POINTS_MARKET_TTL_MS, priority });
    }

    async ownListings({ priority = 150 } = {}) {
      // Requires a Limited access key. Callers translate error code 16.
      return this.request("/user/itemmarket", { cacheMs: 20000, priority });
    }

    async inventoryPage({ offset = 0, cat = "", priority = 120 } = {}) {
      // Minimal access key; Torn caches this selection for one hour.
      const category = cat ? `&cat=${encodeURIComponent(cat)}` : "";
      return this.request(`/user/inventory?limit=${INVENTORY_PAGE_LIMIT}&offset=${Math.max(0, asInt(offset))}${category}`, { cacheMs: INVENTORY_TTL_MS, priority });
    }

    async cityShops({ priority = 100 } = {}) {
      return this.request("/torn/cityshops", { cacheMs: CITY_SHOPS_TTL_MS, priority });
    }

    async itemCatalog(cat = "All", { priority = 30 } = {}) {
      const category = cat && cat !== "All" ? `?cat=${encodeURIComponent(cat)}` : "";
      return this.request(`/torn/items${category}`, { cacheMs: FOREIGN_CATALOG_TTL_MS, priority });
    }

  }

  const api = new TornApi();

  function describeApiError(error, { feature = "This feature" } = {}) {
    if (!error) return "Unknown error";
    if (error.tornCode === 16) return `${feature} needs a Limited access API key (current key is ${Store.keyInfo()?.info?.access?.type || "lower access"}).`;
    if (error.tornCode === 2) return "Torn rejected the API key. Re-check it in Market Edge settings.";
    if (error.tornCode === 5) return "Torn API rate limit reached; Market Edge will retry on the next refresh.";
    return error.message || String(error);
  }

  function normalizeItemMeta(item) {
    if (!item || !asInt(item.id)) return null;
    return {
      id: asInt(item.id),
      name: String(item.name || `Item ${item.id}`),
      type: String(item.type || ""),
      subType: item.sub_type == null ? null : String(item.sub_type),
      isTradable: item.is_tradable !== false,
      marketPrice: asInt(item?.value?.market_price ?? item?.market_price, 0),
      shops: Array.isArray(item?.value?.shops) ? item.value.shops.map((shop) => ({
        country: String(shop?.country || ""),
        name: String(shop?.name || ""),
        buyPrice: asInt(shop?.buy_price, 0),
        sellPrice: asInt(shop?.sell_price, 0)
      })) : []
    };
  }

  function metadataSupportsCommodity(meta) {
    if (!meta) return true;
    return !isEquipmentType(meta.type);
  }

  async function loadItemMetadataBatch(itemIds, { maxAgeMs = ITEM_META_TTL_MS, priority = 150 } = {}) {
    const ids = Array.from(new Set(itemIds.map((id) => asInt(id)).filter(Boolean)));
    const result = new Map();
    const missing = [];
    ids.forEach((id) => {
      const cached = Store.itemMeta(id, maxAgeMs);
      if (cached) result.set(id, cached);
      else missing.push(id);
    });
    if (!missing.length) return result;

    const payload = await api.items(missing, { priority, cacheMs: Math.min(ONE_DAY_MS, maxAgeMs) });
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    rows.forEach((item) => {
      const meta = normalizeItemMeta(item);
      if (!meta) return;
      Store.saveItemMeta(meta);
      result.set(meta.id, meta);
    });
    return result;
  }

  async function loadPointsMarket({ priority = 60 } = {}) {
    const cached = Store.pointsMarket();
    if (cached && Date.now() - asInt(cached.savedAt) < POINTS_MARKET_TTL_MS) return cached;
    try {
      const payload = await api.pointsMarket({ priority });
      const points = normalizePointsMarket(payload);
      Store.savePointsMarket(points);
      return { ...points, savedAt: Date.now() };
    } catch (error) {
      log("Points market unavailable", error.message);
      return cached || null;
    }
  }

  // Museum context: one batched metadata request per set (daily) plus the
  // points market (every five minutes) gives set-implied values for every
  // plushie/flower without touching per-item order books.
  async function loadMuseumContext(itemIds, { priority = 60, metadata = null } = {}) {
    const result = new Map();
    if (settings.museumSetsEnabled === false) return result;
    const sets = new Map();
    itemIds.forEach((itemId) => {
      const set = museumSetFor(itemId);
      if (set) sets.set(set.key, set);
    });
    // Name-matched museum pieces (contraband singles, arrowhead set) need the
    // caller's metadata; without it they are simply not recognised here.
    const namedMetas = metadata instanceof Map
      ? itemIds.map((itemId) => metadata.get(asInt(itemId))).filter((meta) => meta && (MUSEUM_SINGLES_BY_NAME[String(meta.name).toLowerCase().trim()] || MUSEUM_NAME_SETS.some((set) => set.pattern.test(meta.name))))
      : [];
    if (!sets.size && !namedMetas.length) return result;

    const points = await loadPointsMarket({ priority });
    const pointValue = asInt(points?.cheapest, 0);
    if (!pointValue) return result;
    namedMetas.forEach((meta) => {
      const valuation = museumByName({ meta, pointValue, allMetas: Array.from(metadata.values()), settings });
      if (valuation) result.set(meta.id, valuation);
    });
    if (!sets.size) return result;

    const memberIds = Array.from(sets.values()).flatMap((set) => set.items);
    let memberMetadata = new Map();
    try {
      memberMetadata = await loadItemMetadataBatch(memberIds, { maxAgeMs: SET_META_TTL_MS, priority });
    } catch (error) {
      log("Museum set metadata unavailable", error.message);
      return result;
    }
    const memberPrices = {};
    memberMetadata.forEach((meta, id) => { memberPrices[id] = asInt(meta?.marketPrice, 0); });

    itemIds.forEach((itemId) => {
      if (!museumSetFor(itemId)) return;
      const valuation = museumValuation({ itemId, memberPrices, pointValue, settings });
      if (valuation) result.set(asInt(itemId), valuation);
    });
    return result;
  }

  async function loadAuctionSales(itemId, { priority = 40 } = {}) {
    const cached = Store.auctionSales(itemId);
    if (cached && Date.now() - asInt(cached.savedAt) < AUCTION_SALES_TTL_MS) return cached.sales;
    try {
      const payload = await api.auctionSales(itemId, { priority });
      const sales = normalizeAuctionSales(payload);
      Store.saveAuctionSales(itemId, sales);
      return sales;
    } catch (error) {
      log("Auction sales unavailable", itemId, error.message);
      return cached?.sales || [];
    }
  }

  // Whole inventory through the official API (Minimal key). Paged in 250s;
  // a key that cannot read the selection surfaces its Torn error.
  async function loadInventory({ force = false, priority = 120 } = {}) {
    const cached = Store.inventory();
    if (!force && cached && Date.now() - asInt(cached.savedAt) < INVENTORY_TTL_MS) return cached.items;
    if (force) {
      Array.from(api.memoryCache.keys()).filter((key) => key.startsWith("/user/inventory")).forEach((key) => api.memoryCache.delete(key));
    }
    const items = [];
    let offset = 0;
    for (let page = 0; page < INVENTORY_MAX_PAGES; page += 1) {
      const payload = await api.inventoryPage({ offset, priority });
      const rows = normalizeInventory(payload);
      items.push(...rows);
      const total = asInt(payload?._metadata?.total, 0);
      offset += INVENTORY_PAGE_LIMIT;
      if (!rows.length || rows.length < INVENTORY_PAGE_LIMIT || (total && offset >= total)) break;
    }
    Store.saveInventory(items);
    return items;
  }

  async function loadCityShops({ force = false, priority = 100 } = {}) {
    const cached = Store.cityShops();
    if (!force && cached && Date.now() - asInt(cached.savedAt) < CITY_SHOPS_TTL_MS) return cached.shops;
    if (force) api.memoryCache.delete("/torn/cityshops");
    const payload = await api.cityShops({ priority });
    const shops = normalizeCityShops(payload);
    Store.saveCityShops(shops);
    return shops;
  }

  // Compact catalog of every item sold by a shop (Torn or abroad) or bought
  // back by a Torn shop, from one daily /torn/items request. Only the fields
  // the planner needs are persisted.
  const FOREIGN_FALLBACK_CATEGORIES = Object.freeze(["Drug", "Flower", "Plushie", "Temporary", "Alcohol", "Other", "Clothing", "Jewelry", "Melee", "Primary", "Secondary", "Armor", "Defensive"]);

  async function loadForeignCatalog({ force = false, priority = 30 } = {}) {
    const cached = Store.foreignCatalog();
    if (!force && cached && Date.now() - asInt(cached.savedAt) < FOREIGN_CATALOG_TTL_MS) return cached.items;
    const reduce = (payload) => (Array.isArray(payload?.items) ? payload.items : [])
      .map(normalizeItemMeta)
      .filter((meta) => meta && meta.shops.length)
      .map((meta) => ({ id: meta.id, name: meta.name, type: meta.type, isTradable: meta.isTradable, marketPrice: meta.marketPrice, shops: meta.shops }));
    let items = [];
    try {
      items = reduce(await api.itemCatalog("All", { priority }));
    } catch (error) {
      log("Item catalog (All) failed", error.message);
    }
    if (!items.length) {
      for (const category of FOREIGN_FALLBACK_CATEGORIES) {
        try {
          items.push(...reduce(await api.itemCatalog(category, { priority })));
        } catch (error) {
          log("Item catalog category failed", category, error.message);
        }
      }
    }
    if (items.length) Store.saveForeignCatalog(items);
    return items.length ? items : (cached?.items || []);
  }

  function snapshotCacheState(snapshot, nowMs = Date.now()) {
    if (!snapshot) return { canChange: true, ageMs: Number.POSITIVE_INFINITY, ageSeconds: Number.POSITIVE_INFINITY };
    const cacheTimestampMs = asInt(snapshot.cacheTimestamp) > 0 ? asInt(snapshot.cacheTimestamp) * 1000 : 0;
    const observedMs = asInt(snapshot.timestampObserved) > 0 ? asInt(snapshot.timestampObserved) * 1000 : 0;
    const cacheDelayMs = Math.max(0, asInt(snapshot.cacheDelay)) * 1000;
    const baseMs = cacheTimestampMs || observedMs;
    const nextPossibleChangeMs = cacheTimestampMs && cacheDelayMs
      ? cacheTimestampMs + cacheDelayMs
      : baseMs + SNAPSHOT_FALLBACK_FRESH_MS;
    const ageMs = baseMs ? Math.max(0, nowMs - baseMs) : Number.POSITIVE_INFINITY;
    return {
      canChange: !baseMs || nowMs >= nextPossibleChangeMs,
      ageMs,
      ageSeconds: Number.isFinite(ageMs) ? Math.floor(ageMs / 1000) : Number.POSITIVE_INFINITY,
      nextPossibleChangeMs
    };
  }

  function snapshotBundle(snapshot) {
    if (!snapshot) return null;
    const history = Store.history(snapshot.itemId);
    return { snapshot, historyStats: calculateHistoryStats(history) };
  }

  async function loadSnapshot(itemId, { limit = API_LIST_LIMIT, priority = 0, onCached = null, queueGroup = null } = {}) {
    const persisted = Store.snapshot(itemId);
    const persistedState = snapshotCacheState(persisted);
    if (persisted && typeof onCached === "function") {
      onCached({
        ...snapshotBundle(persisted),
        cacheState: persistedState,
        refreshing: limit > API_LIST_LIMIT || persistedState.canChange
      });
    }

    if (persisted && limit <= API_LIST_LIMIT && !persistedState.canChange) {
      return { ...snapshotBundle(persisted), cacheState: persistedState, source: "persistent-cache" };
    }

    const payload = await api.itemMarket(itemId, { limit, priority, queueGroup });
    const snapshot = normalizeMarketResponse(itemId, payload);
    Store.saveSnapshot(snapshot);
    Store.appendHistory(snapshot, settings);
    const history = Store.history(itemId);
    const historyStats = calculateHistoryStats(history);
    const cacheState = snapshotCacheState(snapshot);
    log("Snapshot", {
      itemId: snapshot.itemId,
      cacheTimestamp: snapshot.cacheTimestamp,
      cacheDelay: snapshot.cacheDelay,
      anchor: snapshot.calculatedMarketAnchor,
      historySamples: historyStats.oneDay.count,
      limit
    });
    return { snapshot, historyStats, cacheState, source: "api" };
  }

  // ---------------------------------------------------------------------------
  // DOM/page detection and visible-page parsing
  // ---------------------------------------------------------------------------

  function detectSurface() {
    const url = new URL(location.href);
    const sid = String(url.searchParams.get("sid") || "").toLowerCase();
    const path = url.pathname.toLowerCase();
    const hash = location.hash.toLowerCase();
    if (sid === "itemmarket" || hash.includes("itemmarket")) {
      // Item Market 2.0 sell flow: the "add listing" view lists inventory
      // rows with price and quantity fields. Recognised by its route or, when
      // Torn changes the route, by the presence of those rows.
      const hasItemId = /(?:itemID|itemId|item_id)=\d+/i.test(`${location.search}${location.hash}`);
      // #/addListing (sell form) and #/viewListing (your active listings,
      // editable prices) both carry per-row price fields.
      if (!hasItemId && (/addlisting|add-listing|viewlisting|view-listing|sellitems|sell-items|view=add|p=add|\/add\b/i.test(hash) || sellFormRowsPresent())) return "imsell";
      return "itemmarket";
    }
    if (path.endsWith("/bazaar.php") || path.endsWith("bazaar.php")) return "bazaar";
    if (path.endsWith("/amarket.php") || path.endsWith("amarket.php") || sid.includes("auction")) return "auction";
    if (sid === "travel" || path.endsWith("travelagency.php")) return "travel";
    if (path.endsWith("/item.php") || path.endsWith("item.php")) return "inventory";
    if (path.endsWith("shops.php") || path.endsWith("bigalgunshop.php")) return "cityshop";
    return "other";
  }

  // Which Torn city shop the current page shows, when identifiable.
  function currentCityShopName() {
    const url = new URL(location.href);
    if (url.pathname.toLowerCase().endsWith("bigalgunshop.php")) return CITY_SHOP_STEPS.bigalgunshop;
    const step = String(url.searchParams.get("step") || "").toLowerCase();
    return CITY_SHOP_STEPS[step] || "";
  }

  let sellFormProbeCache = { at: 0, href: "", present: false };

  // Cheap probe: is there an item image with a visible text/number input in a
  // small container around it (a sell/add form row)? Cached briefly because
  // detectSurface() runs on every mutation.
  function sellFormRowsPresent() {
    const now = Date.now();
    if (sellFormProbeCache.href === location.href && now - sellFormProbeCache.at < 700) return sellFormProbeCache.present;
    let present = false;
    try {
      const images = document.querySelectorAll("img[src*='/items/'], img[srcset*='/items/']");
      const limit = Math.min(images.length, 40);
      for (let index = 0; index < limit && !present; index += 1) {
        let node = images[index].parentElement;
        for (let depth = 0; node && depth < 7 && node !== document.body; depth += 1, node = node.parentElement) {
          if (node.closest("#market-edge-root")) break;
          if ((node.textContent || "").length > 700) break;
          const input = node.querySelector("input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='search'])");
          if (input && !/search|filter/i.test(`${input.name || ""} ${input.placeholder || ""} ${input.className || ""}`)) {
            present = true;
            break;
          }
        }
      }
    } catch {
      present = false;
    }
    sellFormProbeCache = { at: now, href: location.href, present };
    return present;
  }

  function getItemIdFromLocation() {
    const combined = `${location.search}&${location.hash}`;
    const patterns = [/(?:itemID|itemId|item_id|ID)=(\d+)/i, /(?:item\/|items\/)(\d+)/i];
    for (const pattern of patterns) {
      const match = combined.match(pattern);
      if (match) return asInt(match[1]);
    }
    // Torn's current Item Market also exposes the selected item ID through
    // aria-controls="wai-itemInfo-{itemId}-0" controls (the trailing -0 is a
    // slot index, not part of the id). Visible-DOM fallback, no request.
    const controls = document.querySelector('button[aria-controls^="wai-itemInfo-"]')?.getAttribute("aria-controls") || "";
    const match = controls.match(/wai-itemInfo-(\d+)/i);
    return match ? asInt(match[1]) || null : null;
  }

  // Item ids are resolved for every identity node on every signature pass;
  // memoise per node, keyed by the attributes that could change the answer.
  const itemIdCache = new WeakMap();

  function itemIdFingerprint(element) {
    return `${element.getAttribute?.("data-item") || ""}|${element.getAttribute?.("data-itemid") || ""}|${element.getAttribute?.("item") || ""}|${element.getAttribute?.("src") || ""}|${element.getAttribute?.("href") || ""}|${element.getAttribute?.("aria-controls") || ""}`;
  }

  function itemIdFromElement(element) {
    if (!element) return null;
    if (typeof element !== "object") return null;
    const fingerprint = itemIdFingerprint(element);
    const cached = itemIdCache.get(element);
    if (cached && cached.fingerprint === fingerprint) return cached.id;
    const id = itemIdFromElementUncached(element);
    itemIdCache.set(element, { fingerprint, id });
    return id;
  }

  function itemIdFromElementUncached(element) {
    if (!element) return null;
    // data-item (inventory rows) and data-itemid are item ids. A bare data-id
    // is NOT: Torn puts the per-copy armoury id there on equip buttons.
    const attrNames = ["data-item", "data-itemid", "data-item-id", "item"];
    let node = element;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      for (const attr of attrNames) {
        const raw = node.getAttribute?.(attr);
        if (raw && /^\d+$/.test(raw)) return asInt(raw);
      }
      for (const [key, value] of Object.entries(node.dataset || {})) {
        if (/^item(?:id)?$|item.*id|id.*item/i.test(key) && !/armo|uid|row/i.test(key) && /^\d+$/.test(String(value))) return asInt(value);
      }
      const controls = node.getAttribute?.("aria-controls") || "";
      if (controls.startsWith("wai-itemInfo-")) {
        const match = controls.match(/wai-itemInfo-(\d+)/i);
        if (match) return asInt(match[1]);
      }
      const href = node.getAttribute?.("href");
      if (href) {
        const match = href.match(/(?:itemID|itemId|item_id|ID)=(\d+)/i) || href.match(/(?:item\/|items\/)(\d+)/i);
        if (match) return asInt(match[1]);
      }
      const imageSource = `${node.getAttribute?.("src") || ""} ${node.getAttribute?.("srcset") || ""} ${node.getAttribute?.("style") || ""}`;
      const imagePatterns = [
        /\/images\/items\/(\d+)(?:\/|\.|_|\?)/i,
        /\/items\/(\d+)(?:\/|\.|_|\?)/i,
        /(?:item|items)[_-]?(\d+)\.(?:png|gif|jpe?g|webp)/i
      ];
      for (const pattern of imagePatterns) {
        const imageMatch = imageSource.match(pattern);
        if (imageMatch) return asInt(imageMatch[1]);
      }
    }
    return null;
  }

  function findCompactCard(start, requireMoney = false) {
    const tornItemCard = start?.closest?.('[data-testid="item"]') || start?.closest?.('[class*="item___"]');
    if (tornItemCard && (!requireMoney || tornItemCard.querySelector('[data-testid="price"]') || /\$\s*[\d,.]+/.test(tornItemCard.innerText || ""))) {
      return tornItemCard;
    }
    let node = start;
    let fallback = start;
    for (let depth = 0; node && depth < 7 && node !== document.body; depth += 1, node = node.parentElement) {
      // textContent is layout-free; only elements that could plausibly be a
      // card pay for innerText.
      const rawLength = (node.textContent || "").length;
      if (rawLength === 0 || rawLength > 2000) continue;
      const text = (node.innerText || "").trim();
      if (text.length > 0 && text.length < 900) fallback = node;
      if (text.length > 0 && text.length < 650 && (!requireMoney || /\$\s*[\d,.]+/.test(text))) return node;
    }
    return fallback;
  }

  function elementItemName(card, anchor) {
    const candidates = [
      card?.querySelector?.('[data-testid="name"]')?.textContent,
      card?.querySelector?.('[class^="name___"], [class*=" name___"]')?.textContent,
      anchor?.getAttribute?.("title"),
      card?.querySelector?.("img[alt]")?.getAttribute("alt"),
      card?.querySelector?.("[title]")?.getAttribute("title"),
      anchor?.getAttribute?.("aria-label"),
      anchor?.textContent
    ].filter(Boolean).map((value) => String(value).trim()).filter((value) => value.length >= 2 && value.length <= 80);
    return candidates[0] || `Item ${itemIdFromElement(anchor || card) || ""}`.trim();
  }

  let inventoryMarkerCache = { at: 0, node: null, href: "" };

  function inventoryListMarker() {
    if (detectSurface() !== "inventory") return null;
    const now = Date.now();
    if (inventoryMarkerCache.href === location.href && now - inventoryMarkerCache.at < 2500 && (inventoryMarkerCache.node === null || inventoryMarkerCache.node.isConnected)) {
      return inventoryMarkerCache.node;
    }
    const node = inventoryListMarkerUncached();
    inventoryMarkerCache = { at: now, node, href: location.href };
    return node;
  }

  function inventoryListMarkerUncached() {

    // On Torn's Items page, the equipped paper-doll/loadout appears before the
    // actual inventory list. Prefer the visible "Your Items - <category>"
    // heading as a structural boundary so only inventory rows below it are
    // analyzed. Headings and title bars only: scanning every div/span on a
    // long inventory is what froze slow devices.
    const selectors = "h1,h2,h3,h4,h5,h6,[class*='title'],[class*='header'],[class*='heading']";
    const candidates = [];
    document.querySelectorAll(selectors).forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      if (element.closest("#market-edge-root")) return;
      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      // Only an element's own text can be the heading. Reading textContent of
      // every container would serialise the whole page once per element.
      const text = ownText || (element.childElementCount <= 2 && (element.textContent || "").length <= 100
        ? (element.textContent || "").replace(/\s+/g, " ").trim()
        : "");
      if (!text || !/^Your Items(?:\s*[-:]\s*.*)?$/i.test(text)) return;
      if (text.length > 100) return;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      candidates.push({ element, textLength: text.length, childCount: element.childElementCount });
    });

    candidates.sort((a, b) => a.childCount - b.childCount || a.textLength - b.textLength);
    return candidates[0]?.element || null;
  }

  function isInventoryListCandidate(card, marker) {
    if (detectSurface() !== "inventory") return true;
    if (!card || card.closest("#market-edge-root")) return false;

    // The "Your Items" heading is the strongest boundary. Anything before it
    // belongs to the equipped paper-doll/loadout and must never be scanned.
    if (marker) {
      if (marker.contains(card)) return true;
      const relation = marker.compareDocumentPosition(card);
      return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
    }

    // Without the heading: the equipped/loadout region is excluded first
    // (Torn's .equipped-items-wrap), then cards inside known inventory list
    // containers (ul.items-cont) are accepted.
    const equippedAncestor = card.closest(
      ".equipped-items-wrap,[class*='equipped'],[class*='loadout'],[class*='paperdoll'],[class*='paper-doll'],[class*='characterEquipment'],[class*='character-equipment']"
    );
    if (equippedAncestor) return false;
    return Boolean(card.closest(".items-cont, [class*='itemsCont'], [class*='items-cont'], [class*='inventoryList'], [class*='inventory-list'], .category-wrap, #category-wrap"));
  }

  function itemIdentitySelector() {
    return [
      "[data-itemid]",
      "[data-item-id]",
      "[item]",
      "button[aria-controls^='wai-itemInfo-']",
      "a[href*='itemID=']",
      "a[href*='itemId=']",
      "a[href*='item_id=']",
      "img[src*='/items/']",
      "img[srcset*='/items/']",
      "[style*='/items/']"
    ].join(",");
  }

  function directItemIdsWithin(element) {
    const ids = new Set();
    if (!element?.querySelectorAll) return ids;
    if (itemIdFromElement(element)) ids.add(itemIdFromElement(element));
    element.querySelectorAll(itemIdentitySelector()).forEach((node) => {
      const id = itemIdFromElement(node);
      if (id) ids.add(id);
    });
    return ids;
  }

  function findInventoryRow(start) {
    if (!start) return null;
    // Fast path: Torn's inventory rows are list items carrying data-item.
    // No text or layout reads beyond one bounding box.
    const direct = start.closest?.("li[data-item]");
    if (direct && !direct.classList.contains("show-item-info") && directItemIdsWithin(direct).size === 1) {
      const rect = direct.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return direct;
    }
    let node = start instanceof HTMLElement ? start : start.parentElement;
    let fallback = null;
    for (let depth = 0; node && depth < 9 && node !== document.body; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      // Layout-free pre-check: a row never has hundreds of characters.
      if ((node.textContent || "").length > 600) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 180) continue;
      const ids = directItemIdsWithin(node);
      if (ids.size !== 1) continue;
      if (rect.height > 125) continue;
      fallback = node;
      if (node.matches("li,tr,[role='row'],[class*='row'],[class*='itemRow'],[class*='item-row']")) return node;
      if (/^(?:x|\u00d7)?\s*[\d,]*\s*[A-Za-z0-9]/i.test(text) && rect.width >= 180) return node;
    }
    return fallback || findCompactCard(start, false);
  }

  function findItemTextHost(card, name = "") {
    if (!card) return null;
    const normalizedName = String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = [];
    card.querySelectorAll("span,div,a,strong,p,td").forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      if (element.closest(".me-inline-analysis")) return;
      if (element.querySelector("img,[style*='/items/']")) return;
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 120) return;
      if (/^(?:RRP|Remove|Price per unit)\s*:/i.test(text)) return;
      const lower = text.toLowerCase();
      const nameMatch = normalizedName && (lower === normalizedName || lower.endsWith(` ${normalizedName}`) || lower.includes(normalizedName));
      const itemish = nameMatch || /^(?:x|\u00d7)?\s*[\d,]+\s+\S+/i.test(text);
      if (!itemish) return;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      candidates.push({ element, area: rect.width * rect.height, length: text.length });
    });
    candidates.sort((a, b) => a.area - b.area || a.length - b.length);
    return candidates[0]?.element || card;
  }

  function priceForSurfaceCard(surface, card, explicitElement = null) {
    if (!card) return null;
    const explicit = parseMoney(explicitElement?.textContent || "");
    if (explicit) return explicit;

    const candidates = [];
    const selector = [
      "[data-testid*='price']",
      "[class*='price']",
      "[aria-label*='price']",
      "button",
      "a",
      "span",
      "strong",
      "b",
      "div"
    ].join(",");

    card.querySelectorAll(selector).forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      if (element.closest(".me-inline-analysis,#market-edge-root")) return;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const directText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const text = directText || (element.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 140) return;
      const price = parseMoney(text);
      if (!price) return;

      const metadata = `${element.getAttribute("data-testid") || ""} ${element.className || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`;
      let score = 0;
      if (/price/i.test(element.getAttribute("data-testid") || "")) score += 100;
      if (/price|cost/i.test(metadata)) score += 45;
      if (element.matches("button,a")) score += 15;

      if (surface === "bazaar") {
        if (/\brrp\b|market\s+(?:value|price)|estimated\s+value|\bvalue\s*:/i.test(text)) score -= 250;
        if (/\bprice\b|\bbuy\b|\beach\b|\bunit\b/i.test(`${text} ${metadata}`)) score += 35;
      } else if (surface === "travel") {
        if (/market\s+(?:value|price)|resale|\bsell\b|\bvalue\s*:/i.test(text)) score -= 200;
        if (/\bcost\b|\bprice\b|\bbuy\b|\beach\b|\bunit\b/i.test(`${text} ${metadata}`)) score += 35;
      }

      candidates.push({ price, score, textLength: text.length, area: rect.width * rect.height });
    });

    candidates.sort((a, b) => b.score - a.score || a.textLength - b.textLength || a.area - b.area);
    if (candidates.length && candidates[0].score > -100) return candidates[0].price;

    // On Bazaar/travel pages a missing value is safer than falling back to an
    // arbitrary dollar amount from the card (RRP, market value, etc.).
    if (surface === "bazaar" || surface === "travel") return null;
    return parseMoney(card.innerText || "");
  }

  function collectVisibleItems({ requireMoney = false } = {}) {
    const candidates = new Set();
    const selector = itemIdentitySelector();

    const inventoryMarker = inventoryListMarker();

    // Prefer Torn's actual inventory-list containers when available. This
    // prevents equipped items from ever entering the candidate set.
    if (detectSurface() === "inventory") {
      const roots = Array.from(document.querySelectorAll(
        ".items-cont, [class*='itemsCont'], [class*='items-cont'], [class*='inventoryList'], [class*='inventory-list']"
      )).filter((root) => !root.closest("#market-edge-root,.equipped-items-wrap,[class*='equipped']"));
      if (roots.length) {
        roots.forEach((root) => root.querySelectorAll(selector).forEach((node) => candidates.add(node)));
      } else {
        document.querySelectorAll(selector).forEach((node) => candidates.add(node));
      }
    } else {
      document.querySelectorAll(selector).forEach((node) => candidates.add(node));
    }

    const byId = new Map();
    const limit = clamp(settings.scanMaxVisibleItems, 1, 50);
    const ordered = Array.from(candidates)
      .map((node) => {
        const rect = node.getBoundingClientRect?.();
        return { node, priority: rect ? viewportPriority({ card: node }) : 0 };
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit * 2)
      .map((entry) => entry.node);
    for (const node of ordered) {
      const itemId = itemIdFromElement(node);
      if (!itemId) continue;
      const card = detectSurface() === "inventory" ? findInventoryRow(node) : findCompactCard(node, requireMoney);
      // A bare image (for example the large picture inside an expanded
      // details block) is not a row: it would hijack the item entry and
      // swallow the annotation.
      if (!card || card === node || card.tagName === "IMG" || !(card.textContent || "").trim()) continue;
      if (!isInventoryListCandidate(card, inventoryMarker)) continue;
      const rect = card?.getBoundingClientRect?.();
      if (rect && (rect.width <= 0 || rect.height <= 0)) continue;
      const text = card?.innerText || "";
      const priceElement = card?.querySelector?.('[data-testid="price"]');
      const price = requireMoney ? priceForSurfaceCard(detectSurface(), card, priceElement) : null;
      if (requireMoney && !price) continue;
      // Torn's inventory rows carry the quantity as data-qty and the item
      // name as data-sort; both beat text parsing.
      const quantity = asInt(card?.dataset?.qty, 0) || parseQuantity(text);
      const name = String(card?.dataset?.sort || "").trim() || elementItemName(card, node);
      const equipped = String(card?.dataset?.equipped || "") === "true";
      // Key by row element, not item id: equipment copies share an item id
      // but each occupies its own row and gets its own annotation. Several
      // identity nodes inside one row still collapse to a single entry.
      const existing = byId.get(card);
      const score = Math.min(text.length, 900);
      if (!existing || score < existing.domTextLength) {
        // Inventory rows get their own line inside Torn's title block: the
        // name span is ellipsised on phones and would clip an inline badge.
        const inventoryRow = detectSurface() === "inventory";
        byId.set(card, {
          itemId,
          name,
          price,
          quantity,
          equipped,
          card,
          inlineAnchor: inventoryRow ? (card.querySelector(":scope > .title-wrap, .title-wrap") || card) : findItemTextHost(card, name),
          inlineMode: inventoryRow ? "row-line" : "inline",
          rowLine: inventoryRow,
          domTextLength: score
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => viewportPriority(b) - viewportPriority(a)).slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }


  function findOwnBazaarCard(start) {
    // React manage view: div[data-testid="sortable-item"] / div[class*="row___"]
    // > div[class*="item___"] with the price in div[class*="price___"].
    const reactRow = start?.closest?.('[data-testid="sortable-item"], div[class*="row___"]');
    if (reactRow && reactRow.querySelector("input") && directItemIdsWithin(reactRow).size <= 1) return reactRow;
    let node = start;
    let fallback = null;
    for (let depth = 0; node && depth < 10 && node !== document.body; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (/price per unit\s*:/i.test(text) && node.querySelector("input")) {
        fallback = node;
        if (node.matches("li,[class*='item'],[class*='manage']") || /RRP\s*:/i.test(text)) return node;
      }
    }
    return fallback || findCompactCard(start, false);
  }

  function findOwnBazaarPriceContext(card) {
    if (!card) return { input: null, row: null, price: null };
    const inputs = Array.from(card.querySelectorAll("input"));
    let best = null;

    for (const input of inputs) {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""}`;
      let score = /price/i.test(metadata) && !/remove/i.test(metadata) ? 100 : 0;
      let row = null;
      let ancestor = input.parentElement;
      for (let depth = 0; ancestor && depth < 5 && ancestor !== card.parentElement; depth += 1, ancestor = ancestor.parentElement) {
        const text = (ancestor.innerText || "").replace(/\s+/g, " ").trim();
        if (/price per unit\s*:/i.test(text)) {
          score = Math.max(score, 90 - depth * 10);
          row = ancestor;
          break;
        }
      }
      if (!score) continue;
      const price = parseIntegerField(input.value);
      if (!price) continue;
      if (!best || score > best.score) best = { input, row: row || input.parentElement, price, score };
    }

    if (best) return best;

    // React manage rows: the price sits in div[class*="price___"] as an
    // input-money group (visible input plus a hidden twin).
    const reactPrice = card.querySelector("div[class*='price___'] .input-money-group input:not([type='hidden']), div[class*='price___'] input:not([type='hidden']), [class*='priceMobile___'] input:not([type='hidden'])");
    if (reactPrice instanceof HTMLInputElement) {
      const price = parseIntegerField(reactPrice.value);
      if (price) return { input: reactPrice, row: reactPrice.closest("div[class*='price___']") || reactPrice.parentElement, price, score: 80 };
    }

    // Fallback: locate the visible "Price per unit" label and then the nearest
    // input in the same small container. This avoids ever confusing Torn's RRP
    // value or the "Remove" quantity field with the actual Bazaar unit price.
    const textNodes = Array.from(card.querySelectorAll("label,span,div,p"));
    for (const label of textNodes) {
      const text = (label.textContent || "").replace(/\s+/g, " ").trim();
      if (!/^price per unit\s*:/i.test(text)) continue;
      let container = label.parentElement;
      for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
        const input = container.querySelector("input");
        const price = parseIntegerField(input?.value);
        if (price) return { input, row: container, price, score: 50 };
      }
    }
    return { input: null, row: null, price: null };
  }

  function bazaarAddRouteActive() {
    if (detectSurface() !== "bazaar") return false;
    const hash = String(location.hash || "").toLowerCase();
    return hash === "#/add" || hash.startsWith("#/add/") || hash.startsWith("#/add?") ||
      hash.includes("#/p=add") || hash.includes("/p=add");
  }

  let bazaarSectionCache = { at: 0, node: null, href: "" };

  function bazaarAddSection() {
    const now = Date.now();
    if (bazaarSectionCache.href === location.href && now - bazaarSectionCache.at < 250 && (bazaarSectionCache.node === null || bazaarSectionCache.node.isConnected)) {
      return bazaarSectionCache.node;
    }
    const node = bazaarAddSectionUncached();
    bazaarSectionCache = { at: now, node, href: location.href };
    return node;
  }

  function bazaarAddSectionUncached() {
    if (detectSurface() !== "bazaar") return null;

    // Torn's current Bazaar add page has a stable root/list shape even though
    // the CSS-module suffixes change between front-end builds. Prefer those
    // structural containers instead of relying on ancestor distance from the
    // visible heading; the latter is especially fragile on the mobile layout.
    const root = document.querySelector("#bazaarRoot, .bazaar-main-wrap");
    const directList = document.querySelector(
      "ul.items-cont, div[class*='itemsContainner___'], div[class*='rowItems___']"
    );
    if (bazaarAddRouteActive()) {
      if (root) return root;
      if (directList) return directList.closest("#bazaarRoot,.bazaar-main-wrap") || directList.parentElement || directList;
    }

    const candidates = [];
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,div,span,strong").forEach((element) => {
      if (!(element instanceof HTMLElement) || element.closest("#market-edge-root,.me-inline-analysis")) return;
      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!/^Add items to your Bazaar$/i.test(ownText)) return;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      candidates.push(element);
    });

    for (const heading of candidates) {
      const knownRoot = heading.closest("#bazaarRoot,.bazaar-main-wrap");
      if (knownRoot) return knownRoot;
      let node = heading;
      let fallback = heading.parentElement;
      for (let depth = 0; node && depth < 15 && node !== document.body; depth += 1, node = node.parentElement) {
        if (!(node instanceof HTMLElement)) continue;
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        if (text.length > 12000) continue;
        if (node.querySelector("input")) fallback = node;
        if (/You are adding\s+\d+\s+items?\s+across\s+\d+\s+categor/i.test(text) && /ADD TO BAZAAR/i.test(text) && node.querySelector("input")) {
          return node;
        }
      }
      if (fallback?.querySelector?.("input")) return fallback;
    }

    // Some PDA/mobile layouts do not preserve the heading text as a distinct
    // DOM node. A recognized item list is still sufficient to identify this
    // view because we later require each candidate row to contain an item image
    // and Bazaar amount/price controls.
    return directList?.closest?.("#bazaarRoot,.bazaar-main-wrap") || directList || null;
  }

  function knownBazaarAddRows(section) {
    if (!section?.querySelectorAll) return [];
    const selector = [
      "ul.items-cont li.clearfix:not(.disabled)",
      "div[class*='itemsContainner___'] div[class*='item___']",
      "div[class*='rowItems___'] div[class*='item___']"
    ].join(",");
    const candidates = Array.from(section.querySelectorAll(selector)).filter((row) => {
      if (!(row instanceof HTMLElement) || row.classList.contains("disabled")) return false;
      if (String(row.className || "").includes("item___UN3Mg")) return false;
      const rect = row.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (rect.height > 300) return false;
      const image = row.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']");
      const amount = row.querySelector("div[class*='amount___'], div.amount-main-wrap") || row;
      const input = Array.from(amount.querySelectorAll("input")).find((candidate) => {
        const inputRect = candidate.getBoundingClientRect();
        return inputRect.width > 0 && inputRect.height > 0 && candidate.type !== "hidden";
      });
      return Boolean(image && input);
    });

    // CSS-module selectors can match both a wrapper and its nested item node.
    // Keep the smallest candidate that owns the controls so each item is only
    // analyzed once.
    return candidates.filter((row) => !candidates.some((other) => other !== row && row.contains(other)));
  }

  function findBazaarAddRow(start, section) {
    if (!start || !section) return null;
    const known = start.closest?.("ul.items-cont li.clearfix:not(.disabled), div[class*='itemsContainner___'] div[class*='item___'], div[class*='rowItems___'] div[class*='item___']");
    if (known && section.contains(known) && !String(known.className || "").includes("item___UN3Mg")) return known;

    let node = start instanceof HTMLElement ? start : start.parentElement;
    let fallback = null;
    for (let depth = 0; node && depth < 12 && node !== section.parentElement; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement) || !section.contains(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.height > 280) continue;
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 500) continue;
      const ids = directItemIdsWithin(node);
      const hasItemImage = Boolean(node.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']"));
      if (ids.size !== 1 && !hasItemImage) continue;
      const visibleInputs = Array.from(node.querySelectorAll("input")).filter((input) => {
        const inputRect = input.getBoundingClientRect();
        return inputRect.width > 0 && inputRect.height > 0 && input.type !== "hidden";
      });
      if (!visibleInputs.length) continue;
      fallback = node;
      if (/^(?:x|\u00d7)\s*[\d,]+\s+\S+/i.test(text) || /\bQty\b/i.test(text)) return node;
      if (node.matches("li.clearfix,li,tr,[role='row'],[class*='row'],[class*='item___'],[class*='item']")) return node;
    }
    return fallback;
  }

  function bazaarAddInputs(card) {
    const amount = card?.querySelector?.("div[class*='amount___'], div.amount-main-wrap") || card;
    if (!amount) return [];
    return Array.from(amount.querySelectorAll("input")).filter((input) => {
      const rect = input.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !["hidden", "checkbox", "radio"].includes(input.type);
    });
  }

  function findBazaarAddPriceInput(card) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const priceWrap = amount.querySelector("div[class*='price___'], div.price");
    const explicit = priceWrap?.querySelector("input.input-money, input") || amount.querySelector("input[name*='price' i]");
    if (explicit) {
      const rect = explicit.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && explicit.type !== "hidden") return explicit;
    }

    const candidates = bazaarAddInputs(card);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const scored = candidates.map((input) => {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.className || ""}`;
      let score = 0;
      if (/price|cost|unit|money/i.test(metadata)) score += 160;
      if (/qty|quantity|amount|count|clear-all/i.test(metadata)) score -= 220;
      const rect = input.getBoundingClientRect();
      return { input, score, left: rect.left };
    });
    scored.sort((a, b) => b.score - a.score || b.left - a.left);
    return scored[0]?.input || null;
  }

  function findBazaarAddQuantityCheckbox(card) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const control = amount.querySelector("div.choice-container, [class*='choiceContainer___']");
    let checkbox = control?.querySelector?.("input[type='checkbox'], input");
    let box = control;
    if (!(checkbox instanceof HTMLInputElement)) {
      // Item Market sell form: single-copy rows use a select checkbox with a
      // stable id prefix. Only that id is trusted, because the anonymous
      // listing toggle is also a checkbox and must never be touched.
      checkbox = card.querySelector("input[type='checkbox'][id*='selectCheckbox' i]");
      box = checkbox?.closest("[class*='checkboxContainer___'], [class*='checkboxWrapper___']") || checkbox?.parentElement || null;
    }
    if (!(checkbox instanceof HTMLInputElement) || !box) return null;
    const rect = box.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? checkbox : null;
  }

  function findBazaarAddQuantityInput(card, priceInput = null) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const explicitCandidates = Array.from(amount.querySelectorAll(
      "input.clear-all, input[placeholder*='qty' i], input[aria-label*='qty' i], input[name*='qty' i], input[name*='quantity' i], input[class*='quantity']"
    ));
    for (const explicit of explicitCandidates) {
      if (explicit === priceInput) continue;
      const rect = explicit.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && explicit.type !== "hidden") return explicit;
    }

    const candidates = bazaarAddInputs(card).filter((input) => input !== priceInput);
    if (!candidates.length) return null;
    const scored = candidates.map((input) => {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.className || ""}`;
      let score = 0;
      if (/qty|quantity|amount|count|clear-all/i.test(metadata)) score += 220;
      if (/price|cost|unit|money/i.test(metadata)) score -= 180;
      const rect = input.getBoundingClientRect();
      return { input, score, left: rect.left };
    });
    scored.sort((a, b) => b.score - a.score || a.left - b.left);
    return scored[0]?.input || null;
  }

  function collectBazaarAddItems() {
    const section = bazaarAddSection();
    if (!section) return bazaarAddRouteActive() ? collectSellFormRows() : [];

    const byCard = new Map();
    const directRows = knownBazaarAddRows(section);
    const candidatePairs = [];

    if (directRows.length) {
      directRows.forEach((card) => {
        const image = card.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']");
        candidatePairs.push({ card, node: image || card });
      });
    } else {
      section.querySelectorAll(itemIdentitySelector()).forEach((node) => {
        if (node.closest("#market-edge-root,.me-inline-analysis")) return;
        const card = findBazaarAddRow(node, section);
        if (card) candidatePairs.push({ card, node });
      });
    }

    // Only the rows nearest the viewport get the expensive text/input
    // inspection; long categories would otherwise thrash layout. Rows that
    // carry Torn's "Price per unit" label are existing listings (manage
    // view), never add rows.
    const limit = clamp(settings.scanMaxVisibleItems, 1, 50);
    const nearest = candidatePairs
      .filter(({ card }) => !/price per unit\s*:/i.test(card.textContent || ""))
      .map((pair) => ({ pair, priority: viewportPriority({ card: pair.card }) }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit * 2)
      .map((entry) => entry.pair);

    for (const { card, node } of nearest) {
      if (!card || card.closest("#market-edge-root")) continue;
      const itemId = itemIdFromElement(node) || itemIdFromElement(card);
      if (!itemId) continue;
      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) continue;
      const quantityCheckbox = findBazaarAddQuantityCheckbox(card);
      const quantityInput = quantityCheckbox ? null : findBazaarAddQuantityInput(card, priceInput);
      const title = card.querySelector("div[class*='name___'], div.title-wrap");
      const controlHost = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
      const text = `${title?.innerText || ""} ${card.innerText || ""}`.trim();
      const quantity = parseQuantity(text);
      const maxFromInput = parseIntegerField(quantityInput?.getAttribute("max"));
      const maxAvailable = Math.max(1, Math.min(quantity, maxFromInput || quantity));
      const name = elementItemName(card, node);
      const score = Math.min(text.length, 1200);
      const existing = byCard.get(card);
      if (!existing || score < existing.domTextLength) {
        byCard.set(card, {
          itemId,
          name,
          price: parseIntegerField(priceInput.value) || 0,
          quantity,
          maxAvailable,
          card,
          priceInput,
          quantityInput,
          quantityCheckbox,
          bazaarAdd: true,
          bazaarControls: controlHost,
          inlineAnchor: controlHost,
          inlineMode: "bazaar-below-controls",
          domTextLength: score
        });
      }
    }

    if (!byCard.size && bazaarAddRouteActive()) return collectSellFormRows();
    return Array.from(byCard.values())
      .sort((a, b) => viewportPriority(b) - viewportPriority(a))
      .slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  // Generic sell-form rows: any small container holding one item image and a
  // visible price/quantity field. Serves the Item Market "add listing" view
  // and is the fallback for the Bazaar add form when Torn's class names
  // change. Rows are shaped like Bazaar add rows so the same renderer and
  // fill controls apply.
  function collectSellFormRows({ root = document, limit = clamp(settings.scanMaxVisibleItems, 1, 50) } = {}) {
    const byCard = new Map();
    const images = Array.from(root.querySelectorAll("img[src*='/items/'], img[srcset*='/items/'], [style*='/items/']"))
      .filter((node) => !node.closest("#market-edge-root,.me-inline-analysis"));
    const nearest = images
      .map((node) => ({ node, priority: viewportPriority({ card: node }) }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit * 2);
    for (const { node } of nearest) {
      const itemId = itemIdFromElement(node);
      if (!itemId) continue;
      let card = null;
      let probe = node.parentElement;
      for (let depth = 0; probe && depth < 9 && probe !== document.body; depth += 1, probe = probe.parentElement) {
        if (!(probe instanceof HTMLElement)) continue;
        const textLength = (probe.textContent || "").length;
        if (textLength > 700) break;
        const ids = directItemIdsWithin(probe);
        if (ids.size > 1) break;
        const input = Array.from(probe.querySelectorAll("input")).find((candidate) => {
          if (["hidden", "checkbox", "radio", "search", "submit", "button"].includes(candidate.type)) return false;
          if (/search|filter/i.test(`${candidate.name || ""} ${candidate.placeholder || ""} ${candidate.className || ""}`)) return false;
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (!input) continue;
        if (/price per unit\s*:/i.test(probe.textContent || "")) break;
        card = probe;
        break;
      }
      if (!card || byCard.has(card)) continue;
      // Item Market rows that cannot be listed are greyed out.
      if (/grayedOut|greyedOut|disabled___/i.test(`${card.className || ""} ${card.parentElement?.className || ""}`) || card.classList.contains("disabled")) continue;
      const rect = card.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) continue;
      const quantityCheckbox = findBazaarAddQuantityCheckbox(card);
      const quantityInput = quantityCheckbox ? null : findBazaarAddQuantityInput(card, priceInput);
      // Text nodes joined with spaces: adjacent inline spans ("Xanax" + "x12")
      // must not merge into one token.
      const text = spacedText(card);
      // Torn's quantity input carries the owned amount in data-money.
      const ownedFromInput = parseIntegerField(quantityInput?.getAttribute("data-money"));
      const quantity = ownedFromInput || parseQuantity(text);
      const maxFromInput = parseIntegerField(quantityInput?.getAttribute("max"));
      // Host for the overlay: the row's controls/info container, never the
      // money-input group itself (a flex group that would squeeze or clip it).
      const controlHost = sellFormControlHost(card, priceInput);
      byCard.set(card, {
        itemId,
        name: elementItemName(card, node),
        price: parseIntegerField(priceInput.value) || 0,
        quantity,
        maxAvailable: Math.max(1, Math.min(quantity, maxFromInput || quantity)),
        card,
        priceInput,
        quantityInput,
        quantityCheckbox,
        bazaarAdd: true,
        sellForm: true,
        // On #/viewListing the fields belong to an existing listing: fill
        // the price only, never the quantity.
        priceOnly: /viewlisting|view-listing/i.test(String(location.hash || "")),
        bazaarControls: controlHost,
        inlineAnchor: controlHost,
        inlineMode: "bazaar-below-controls",
        domTextLength: Math.min(text.length, 1200)
      });
    }
    return Array.from(byCard.values()).sort((a, b) => viewportPriority(b) - viewportPriority(a)).slice(0, limit);
  }

  function sellFormControlHost(card, priceInput) {
    if (!card) return null;
    let node = priceInput?.parentElement || null;
    for (let depth = 0; node && node !== card && depth < 6; depth += 1, node = node.parentElement) {
      const className = String(node.className || "");
      if (/(^|\s)(info___|amount___|controls___|controls|amount-main-wrap|fields___|actions___)/.test(className) || /info___|amount___|controls___|amount-main-wrap/.test(className)) return node;
    }
    // No named container: use the price input's grandparent when it is not
    // the money group, else the card.
    const group = priceInput?.closest(".input-money-group");
    const above = group?.parentElement && group.parentElement !== card ? group.parentElement.parentElement || card : null;
    return above && card.contains(above) ? above : card;
  }

  function spacedText(element) {
    if (!element) return "";
    const parts = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (!node.parentElement?.closest?.(".me-inline-analysis")) {
        const value = String(node.textContent || "").trim();
        if (value) parts.push(value);
      }
      node = walker.nextNode();
    }
    return parts.join(" ");
  }

  function collectManagedBazaarItems() {
    // Managed listings never appear on the add route, and add rows are
    // recognisable by their amount/price control wrapper. Both guards stop a
    // filled add row from being mistaken for an existing listing.
    if (bazaarAddRouteActive()) return [];
    const candidates = new Set();
    const selector = itemIdentitySelector();
    document.querySelectorAll(selector).forEach((node) => {
      if (!node.closest("#market-edge-root") && !node.closest(".me-inline-analysis")) candidates.add(node);
    });

    const byId = new Map();
    for (const node of candidates) {
      const itemId = itemIdFromElement(node);
      if (!itemId) continue;
      const card = findOwnBazaarCard(node);
      if (!card || card.closest("#market-edge-root")) continue;
      if (card.querySelector("div.amount-main-wrap, div[class*='amount___']") || card.closest("ul.items-cont li.clearfix")?.querySelector("div.amount-main-wrap, div[class*='amount___']")) continue;
      const rect = card.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const priceContext = findOwnBazaarPriceContext(card);
      if (!priceContext.price) continue;
      const text = card.innerText || "";
      const quantity = parseQuantity(text);
      const name = elementItemName(card, node);
      const current = byId.get(itemId);
      const score = Math.min(text.length, 2000);
      if (!current || score < current.domTextLength) {
        byId.set(itemId, {
          itemId,
          name,
          price: priceContext.price,
          quantity,
          card,
          priceInput: priceContext.input,
          inlineAnchor: findItemTextHost(card, name),
          inlineMode: "inline",
          domTextLength: score
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => viewportPriority(b) - viewportPriority(a)).slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  const BAZAAR_ADD_ROW_SELECTOR = "ul.items-cont li.clearfix, div[class*='itemsContainner___'] div[class*='item___'], div[class*='rowItems___'] div[class*='item___']";

  function collectOwnBazaarItems() {
    // Add-form rows take precedence: once a price has been filled into an
    // add row, the managed-listing heuristics would otherwise mistake it for
    // an existing Bazaar listing.
    const addItems = collectBazaarAddItems();
    const addCards = addItems.map((item) => item.card);
    const managed = collectManagedBazaarItems().filter((item) => (
      !addCards.some((card) => card === item.card || card.contains(item.card) || item.card.contains(card))
    ));
    const combined = [...addItems, ...managed];
    const seenCards = new Set();
    return combined
      .filter((visible) => {
        if (!visible?.card || seenCards.has(visible.card)) return false;
        seenCards.add(visible.card);
        return true;
      })
      .sort((a, b) => viewportPriority(b) - viewportPriority(a))
      .slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  function collectAuctionItems() {
    const rows = [];
    document.querySelectorAll("div.items-list-wrap > ul.items-list > li").forEach((li) => {
      if (!(li instanceof HTMLElement) || li.classList.contains("clear") || li.classList.contains("last")) return;
      const hover = li.querySelector("span.item-hover[item]");
      const itemId = asInt(hover?.getAttribute("item"), 0);
      if (!itemId) return;
      const name = (li.querySelector("span.title .item-name")?.textContent || hover?.querySelector("button.view-info")?.getAttribute("aria-label") || `Item ${itemId}`).trim();
      const bidText = (li.querySelector("div.c-bid-wrap")?.textContent || li.querySelector("div.mob-wrap .top-bid-mob-wrap")?.textContent || "").trim();
      const price = /^none$|bid:\s*none/i.test(bidText) ? 0 : asInt(String(bidText).replace(/[^0-9]/g, ""), 0);
      const text = li.innerText || "";
      rows.push({ itemId, name, price, quantity: 1, card: li, domTextLength: text.length });
    });
    return rows.sort((a, b) => viewportPriority(b) - viewportPriority(a)).slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  // Editable price field in a row on Torn's "manage listings" style views
  // (own Item Market listings). Prefers price-labelled inputs and rejects
  // quantity/remove fields; a numeric value is required.
  function findGenericPriceInput(card) {
    if (!card) return null;
    let best = null;
    card.querySelectorAll("input").forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      if (input.closest("#market-edge-root,.me-inline-analysis")) return;
      if (/^(checkbox|radio|hidden|submit|button)$/i.test(input.type || "")) return;
      const metadata = `${input.name || ""} ${input.id || ""} ${input.className || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""}`;
      if (/amount|qty|quantity|remove|search/i.test(metadata)) return;
      let score = /price|cost|money/i.test(metadata) ? 100 : 0;
      const value = parseIntegerField(input.value);
      if (value > 0) score += 20;
      if (!score) return;
      if (!best || score > best.score) best = { input, score, value };
    });
    return best?.input || null;
  }

  // Rows of the player's own Item Market listings as Torn renders them, each
  // with its price input when one exists. Used by the repricing workbench to
  // fill (never submit) Torn's fields.
  function collectOwnListingRows() {
    const rows = [];
    const seen = new Set();
    document.querySelectorAll(itemIdentitySelector()).forEach((node) => {
      if (node.closest("#market-edge-root,.me-inline-analysis")) return;
      const itemId = itemIdFromElement(node);
      if (!itemId) return;
      let card = node.closest("li,tr,[role='row'],[class*='itemRow'],[class*='row'],[class*='item___'],[class*='listing']") || findCompactCard(node, false);
      for (let depth = 0; card && depth < 4 && !card.querySelector("input"); depth += 1) card = card.parentElement;
      if (!card || seen.has(card) || card === document.body) return;
      const priceInput = findGenericPriceInput(card);
      if (!priceInput) return;
      seen.add(card);
      rows.push({ itemId, card, priceInput, price: parseIntegerField(priceInput.value) || 0 });
    });
    return rows;
  }

  function parseLiveItemMarketListings() {
    const rawRows = [];
    const selectors = [
      "ul[class^='sellerList___'] > li",
      "ul[class*=' sellerList___'] > li",
      "[class^='sellerList___'] > li",
      "[class*=' sellerList___'] > li",
      "[class*='listing']",
      "[class*='seller']",
      "[class*='market'] li",
      "[class*='market'] [class*='row']"
    ];
    const seen = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        if (seen.has(node)) return;
        seen.add(node);
        const text = (node.innerText || "").trim();
        if (text.length < 3 || text.length > 500) return;
        const price = parseMoney(text);
        if (!price) return;
        const quantity = parseQuantity(text);
        rawRows.push({ price, quantity, node });
      });
    }
    rawRows.sort((a, b) => a.price - b.price);

    // Deduplicate nested DOM nodes representing the same rendered listing.
    const rows = [];
    for (const row of rawRows) {
      if (rows.some((existing) => existing.price === row.price && (existing.node.contains(row.node) || row.node.contains(existing.node)))) continue;
      rows.push(row);
    }
    return rows.slice(0, 100);
  }

  function currentBazaarOwnerId() {
    // Torn uses both query-string and hash-based Bazaar routes. A shared Bazaar
    // contains an explicit userId/userID; the plain bazaar.php#/ route opens
    // the current player's own Bazaar.
    const match = location.href.match(/[?&#](?:userId|userID)=(\d+)/i);
    return match ? asInt(match[1], 0) || null : null;
  }

  async function isOwnBazaar() {
    const ownerId = currentBazaarOwnerId();
    if (!ownerId) return true;

    let playerId = asInt(Store.get(STORAGE_KEYS.playerId, 0), 0);
    if (!playerId && Store.apiKey()) {
      try {
        const tested = await api.testKey();
        playerId = tested.playerId || 0;
      } catch {
        // Pricing analysis can continue without identity detection.
      }
    }
    return Boolean(playerId && ownerId === playerId);
  }

  // ---------------------------------------------------------------------------
  // UI rendering
  // ---------------------------------------------------------------------------

  const ui = {
    root: null,
    body: null,
    title: null,
    status: null,
    currentSurface: null,
    renderedBadges: new Set(),
    pinned: false,
    currentPanel: null
  };

  const CSS = `
    #market-edge-root { position: fixed; right: 12px; bottom: 12px; z-index: 999998; width: min(370px, calc(100vw - 24px)); font-family: Arial, sans-serif; color: #e9e9e9; }
    #market-edge-root * { box-sizing: border-box; }
    .me-shell { background: rgba(28, 28, 30, .97); border: 1px solid rgba(255,255,255,.13); border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.4); overflow: hidden; }
    .me-header { display:flex; align-items:center; gap:8px; min-height:38px; padding:7px 9px; background:#242426; border-bottom:1px solid rgba(255,255,255,.08); }
    .me-title { font-size:12px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; flex:1; }
    .me-status { font-size:10px; color:#a7a7a7; white-space:nowrap; }
    .me-icon-btn, .me-btn { border:1px solid rgba(255,255,255,.15); background:#343436; color:#eee; border-radius:5px; cursor:pointer; font-size:11px; padding:5px 8px; }
    .me-icon-btn { width:27px; padding:4px 0; text-align:center; }
    .me-icon-btn:hover, .me-btn:hover { background:#414143; }
    .me-body { padding:10px; max-height:min(72vh, 620px); overflow:auto; }
    .me-body[hidden] { display:none; }
    .me-kicker { color:#aaa; text-transform:uppercase; letter-spacing:.08em; font-size:9px; margin-bottom:3px; }
    .me-item-name { font-size:16px; font-weight:700; margin-bottom:9px; }
    .me-grid { display:grid; grid-template-columns:1fr auto; gap:4px 12px; font-size:11px; }
    .me-grid .label { color:#aaa; }
    .me-grid .value { font-variant-numeric:tabular-nums; text-align:right; }
    .me-rule { height:1px; background:rgba(255,255,255,.08); margin:9px 0; }
    .me-callout { border-left:3px solid #777; background:rgba(255,255,255,.04); padding:8px; border-radius:4px; }
    .me-callout.GREEN { border-color:#4aa564; }
    .me-callout.YELLOW { border-color:#d3aa42; }
    .me-callout.GREY { border-color:#808080; }
    .me-callout.RED { border-color:#bd5151; }
    .me-decision { display:flex; align-items:center; gap:6px; font-weight:700; font-size:12px; }
    .me-decision.GREEN { color:#7fd193; }
    .me-decision.YELLOW { color:#f0ca66; }
    .me-decision.GREY { color:#bbb; }
    .me-decision.RED { color:#e27a7a; }
    .me-note { font-size:10px; color:#aaa; line-height:1.35; margin-top:6px; }
    .me-good { color:#7fd193; }
    .me-warn { color:#f0ca66; }
    .me-bad { color:#e27a7a; }
    .me-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
    .me-progress { height:4px; background:#3b3b3e; border-radius:3px; overflow:hidden; margin:8px 0; }
    .me-progress > div { height:100%; background:#888; transition:width .15s linear; }
    .me-result { padding:7px 0; border-top:1px solid rgba(255,255,255,.07); font-size:11px; }
    .me-result:first-child { border-top:0; }
    .me-result-head { display:flex; align-items:center; gap:6px; }
    .me-result-name { font-weight:700; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .me-result-metrics { display:flex; gap:8px; margin-top:3px; color:#bbb; font-variant-numeric:tabular-nums; }
    .me-diag { margin:8px 0 0; padding:7px; background:rgba(0,0,0,.18); border-radius:4px; }
    .me-diag-row { font-size:10px; line-height:1.5; }
    .me-diag-row.pass { color:#b9d9c0; }
    .me-diag-row.fail { color:#dfb1b1; }
    .me-badge { display:inline-flex !important; align-items:center; gap:3px; padding:2px 5px !important; margin-left:5px !important; border-radius:4px !important; font:700 10px/1.25 Arial,sans-serif !important; white-space:nowrap !important; vertical-align:middle !important; pointer-events:none !important; }
    .me-badge.GREEN { background:rgba(54,137,76,.18) !important; color:#4fa968 !important; border:1px solid rgba(79,169,104,.45) !important; }
    .me-badge.YELLOW { background:rgba(183,135,35,.17) !important; color:#c99c3e !important; border:1px solid rgba(201,156,62,.45) !important; }
    .me-badge.GREY { background:rgba(100,100,100,.14) !important; color:#999 !important; border:1px solid rgba(130,130,130,.35) !important; }
    .me-badge.RED { background:rgba(165,58,58,.15) !important; color:#c76262 !important; border:1px solid rgba(199,98,98,.4) !important; }
    .me-inline-analysis { position:static !important; display:inline-flex !important; align-items:center !important; flex-wrap:nowrap !important; gap:4px !important; width:auto !important; max-width:100% !important; min-width:0 !important; margin:0 0 0 8px !important; padding:1px 5px !important; border:1px solid rgba(255,255,255,.12) !important; border-radius:4px !important; background:rgba(15,15,17,.52) !important; color:#bbb !important; font:700 10px/1.25 Arial,sans-serif !important; box-sizing:border-box !important; vertical-align:middle !important; white-space:nowrap !important; pointer-events:none !important; }
    .me-inline-brand { color:#ddd !important; letter-spacing:.04em !important; }
    .me-inline-primary { color:#eee !important; }
    .me-inline-secondary { color:#999 !important; font-weight:600 !important; }
    .me-inline-sep { color:#666 !important; font-weight:400 !important; }
    .me-inline-stale { color:#d3aa42 !important; font-weight:700 !important; }
    .me-inline-analysis.GREEN { border-color:rgba(74,165,100,.58) !important; }
    .me-inline-analysis.YELLOW { border-color:rgba(211,170,66,.62) !important; }
    .me-inline-analysis.GREY { border-color:rgba(128,128,128,.42) !important; }
    .me-inline-analysis.RED { border-color:rgba(189,81,81,.58) !important; }
    .me-inline-brand { font-weight:800 !important; color:#eee !important; letter-spacing:.04em !important; }
    .me-inline-status { font-weight:800 !important; white-space:nowrap !important; }
    .me-inline-analysis.GREEN .me-inline-status { color:#7fd193 !important; }
    .me-inline-analysis.YELLOW .me-inline-status { color:#f0ca66 !important; }
    .me-inline-analysis.RED .me-inline-status { color:#e27a7a !important; }
    .me-inline-metric { white-space:nowrap !important; font-variant-numeric:tabular-nums !important; }
    .me-inline-analysis.me-loading { opacity:.65 !important; font-weight:400 !important; }
    .me-inline-analysis.me-hidden { display:none !important; }
    .me-bazaar-add-row { height:auto !important; min-height:72px !important; overflow:visible !important; }
    .me-bazaar-add-controls { flex-wrap:wrap !important; overflow:visible !important; }
    .me-bazaar-add-controls > .me-inline-analysis { display:flex !important; flex:0 0 100% !important; width:100% !important; max-width:none !important; grid-column:1 / -1 !important; justify-content:flex-end !important; margin:4px 0 1px !important; z-index:10 !important; }
    .me-inline-analysis.me-bazaar-add { pointer-events:auto !important; padding-right:3px !important; }
    .me-row-host { height:auto !important; max-height:none !important; overflow:visible !important; }
    .me-row-host > .title-wrap, .me-row-host .title-wrap { height:auto !important; max-height:none !important; overflow:visible !important; flex-wrap:wrap !important; }
    .me-inline-analysis.me-row-line { display:flex !important; flex:0 0 100% !important; width:100% !important; max-width:none !important; clear:both !important; margin:2px 0 0 !important; justify-content:flex-start !important; white-space:normal !important; flex-wrap:wrap !important; position:relative !important; z-index:5 !important; }
    .me-bazaar-fill-btn { display:inline-flex !important; align-items:center !important; justify-content:center !important; min-width:25px !important; height:22px !important; margin:0 0 0 2px !important; padding:0 7px !important; border:1px solid rgba(255,255,255,.24) !important; border-radius:4px !important; background:rgba(255,255,255,.08) !important; color:#eee !important; font:800 13px/1 Arial,sans-serif !important; cursor:pointer !important; pointer-events:auto !important; touch-action:manipulation !important; }
    .me-bazaar-fill-btn:hover, .me-bazaar-fill-btn:focus { background:rgba(255,255,255,.16) !important; border-color:rgba(255,255,255,.4) !important; outline:none !important; }
    .me-inline-analysis.me-bazaar-add.me-applied { border-color:rgba(74,165,100,.65) !important; }
    .me-modal-backdrop { position:fixed; inset:0; z-index:999999; background:rgba(0,0,0,.64); display:flex; align-items:center; justify-content:center; padding:18px; }
    .me-modal { width:min(620px, 100%); max-height:90vh; overflow:auto; background:#242426; color:#eee; border:1px solid #555; border-radius:8px; box-shadow:0 14px 46px rgba(0,0,0,.55); padding:14px; }
    .me-modal h2 { margin:0 0 12px; font-size:17px; }
    .me-section-title { margin:13px 0 7px; font-size:11px; color:#bbb; text-transform:uppercase; letter-spacing:.06em; }
    .me-form-grid { display:grid; grid-template-columns:minmax(170px, 1fr) minmax(120px, .7fr); gap:7px 12px; align-items:center; font-size:11px; }
    .me-form-grid input, .me-form-grid select { width:100%; padding:6px; border:1px solid #555; border-radius:4px; background:#171719; color:#eee; }
    .me-form-grid input[type='checkbox'] { width:auto; justify-self:start; }
    .me-form-help { color:#999; font-size:10px; margin-top:8px; line-height:1.4; }
    .me-modal-actions { display:flex; gap:7px; justify-content:flex-end; margin-top:14px; }
    .me-error { color:#e27a7a; font-size:11px; line-height:1.4; }
    .me-learning { color:#f0ca66; }
    .me-table { width:100%; border-collapse:collapse; font-size:10px; margin-top:6px; }
    .me-table th, .me-table td { padding:3px 4px; text-align:right; border-bottom:1px solid rgba(255,255,255,.06); white-space:nowrap; font-variant-numeric:tabular-nums; }
    .me-table th { color:#aaa; font-weight:600; text-transform:uppercase; letter-spacing:.04em; font-size:9px; }
    .me-table td:first-child, .me-table th:first-child { text-align:left; max-width:150px; overflow:hidden; text-overflow:ellipsis; }
    .me-table tr.GREEN td { color:#b9e2c3; }
    .me-table tr.YELLOW td { color:#f0d79a; }
    .me-table tr.RED td { color:#e5a3a3; }
    .me-pill { display:inline-block; padding:1px 5px; border-radius:3px; font-size:9px; font-weight:700; border:1px solid rgba(255,255,255,.2); }
    .me-pill.GREEN { color:#7fd193; border-color:rgba(79,169,104,.5); }
    .me-pill.YELLOW { color:#f0ca66; border-color:rgba(201,156,62,.5); }
    .me-pill.GREY { color:#aaa; }
    .me-pill.RED { color:#e27a7a; border-color:rgba(199,98,98,.5); }
    .me-inline-input { width:110px; padding:4px 6px; border:1px solid #555; border-radius:4px; background:#171719; color:#eee; font-size:11px; }
    .me-launcher { position:fixed; left:10px; bottom:10px; z-index:999997; padding:6px 9px; border-radius:16px; border:1px solid rgba(255,255,255,.25); background:rgba(28,28,30,.94); color:#eee; font:800 11px/1 Arial,sans-serif; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.4); }
    .me-toast-host { position:fixed; left:10px; bottom:48px; z-index:999999; display:flex; flex-direction:column; gap:6px; max-width:min(360px, calc(100vw - 20px)); }
    .me-toast { background:rgba(28,28,30,.97); border:1px solid rgba(74,165,100,.6); border-radius:6px; padding:8px 10px; color:#eee; font:12px/1.35 Arial,sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.45); }
    .me-toast a { color:#7fd193; font-weight:700; }
    .me-toast .me-toast-close { float:right; margin-left:8px; cursor:pointer; color:#aaa; font-weight:700; }
    .me-workbench-cell { white-space:nowrap; }
    .me-workbench-cell .me-inline-input { width:78px; font-size:10px; padding:2px 3px; margin-left:3px; }
    .me-workbench-cell .me-rule-mode { width:96px; }
    .me-workbench-cell .me-listing-fill { padding:2px 6px; margin-left:3px; }
    .me-inline-analysis .me-manage-fill { margin-left:4px; }
    .me-watch-row { display:flex; align-items:center; gap:6px; font-size:11px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,.06); }
    .me-watch-row .me-watch-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .me-watch-row .me-watch-remove { cursor:pointer; color:#e27a7a; font-weight:700; padding:0 4px; }
    @media (max-width: 600px) { #market-edge-root { right:6px; bottom:6px; width:calc(100vw - 12px); } .me-body { max-height:58vh; } }
  `;

  function injectStyles(css) {
    if (ENV.hasGmStyle) {
      try {
        GM_addStyle(css);
        return;
      } catch {
        // fall through to a plain style element
      }
    }
    try {
      const style = document.createElement("style");
      style.id = "market-edge-style";
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch {
      // no-op
    }
  }

  injectStyles(CSS);

  function ensureUi() {
    if (ui.root?.isConnected) return ui.root;
    const root = document.createElement("div");
    root.id = "market-edge-root";
    root.innerHTML = `
      <div class="me-shell">
        <div class="me-header">
          <div class="me-title">Market Edge</div>
          <div class="me-status"></div>
          <button class="me-icon-btn me-settings" type="button" title="Settings">S</button>
          <button class="me-icon-btn me-collapse" type="button" title="Collapse">-</button>
          <button class="me-icon-btn me-close" type="button" title="Close panel">X</button>
        </div>
        <div class="me-body"></div>
      </div>`;
    document.body.appendChild(root);
    ui.root = root;
    ui.body = root.querySelector(".me-body");
    ui.title = root.querySelector(".me-title");
    ui.status = root.querySelector(".me-status");
    root.querySelector(".me-settings").addEventListener("click", showSettings);
    root.querySelector(".me-collapse").addEventListener("click", togglePanelState);
    root.querySelector(".me-close").addEventListener("click", () => removeFloatingUi(true));
    applyPanelState();
    return root;
  }

  function applyPanelState() {
    if (!ui.root) return;
    const state = Store.get(STORAGE_KEYS.panelState, "expanded");
    const body = ui.root.querySelector(".me-body");
    const button = ui.root.querySelector(".me-collapse");
    body.hidden = state === "collapsed";
    button.textContent = state === "collapsed" ? "+" : "-";
  }

  function togglePanelState() {
    const current = Store.get(STORAGE_KEYS.panelState, "expanded");
    Store.set(STORAGE_KEYS.panelState, current === "collapsed" ? "expanded" : "collapsed");
    applyPanelState();
  }

  function setPanel(content, status = "") {
    ensureUi();
    ui.body.innerHTML = content;
    ui.status.textContent = status;
  }

  function errorPanel(message) {
    setPanel(`<div class="me-error">${escapeHtml(message)}</div><div class="me-actions"><button class="me-btn me-open-settings" type="button">Settings</button></div>`);
    ui.body.querySelector(".me-open-settings")?.addEventListener("click", showSettings);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function metricRows(rows) {
    return `<div class="me-grid">${rows.map(([label, value, cls = ""]) => `<div class="label">${escapeHtml(label)}</div><div class="value ${cls}">${value}</div>`).join("")}</div>`;
  }

  function decisionHtml(opportunity) {
    if (!opportunity) return `<div class="me-callout GREY"><div class="me-decision GREY">- PASS</div><div class="me-note">No complete, affordable profitable prefix was found.</div></div>`;
    const state = opportunity.classification.state;
    const meta = CLASS_META[state];
    return `<div class="me-callout ${state}">
      <div class="me-decision ${state}">${meta.icon} ${meta.label}</div>
      ${metricRows([
        ["Expected profit", `<span title="${formatMoney(opportunity.expectedProfit, true)}">${formatMoney(opportunity.expectedProfit)}</span>`, opportunity.expectedProfit >= 0 ? "me-good" : "me-bad"],
        ["ROI", `${(opportunity.roi * 100).toFixed(2)}%`, opportunity.roi >= settings.minimumROI ? "me-good" : ""],
        ["Confidence", escapeHtml(opportunity.confidence.label)],
        ["Score", `${opportunity.score}/100`]
      ])}
    </div>`;
  }

  function diagnosticsHtml(opportunity) {
    if (!opportunity?.classification?.reasons?.length) return "";
    return `<details class="me-diag"><summary>Why ${escapeHtml(CLASS_META[opportunity.classification.state].label)}?</summary>${opportunity.classification.reasons.map((reason) => `<div class="me-diag-row ${reason.pass ? "pass" : "fail"}">${reason.pass ? "OK" : "X"} ${escapeHtml(reason.text)}</div>`).join("")}</details>`;
  }

  function showSettings() {
    if (document.querySelector(".me-modal-backdrop")) return;
    const current = Store.settings();
    const backdrop = document.createElement("div");
    backdrop.className = "me-modal-backdrop";
    backdrop.innerHTML = `
      <div class="me-modal" role="dialog" aria-modal="true" aria-label="Market Edge settings">
        <h2>Market Edge settings</h2>
        <div class="me-section-title">API</div>
        <div class="me-form-grid">
          <label for="me-api-key">API key</label><input id="me-api-key" type="password" autocomplete="off" value="${escapeHtml(Store.apiKey())}">
          <span>API status</span><span id="me-api-status">Not tested</span>
        </div>
        <div class="me-actions"><button class="me-btn" id="me-test-key" type="button">Test API key</button></div>

        <div class="me-section-title">Trading</div>
        <div class="me-form-grid">
          <label>Available trading capital ($)</label><input data-setting="availableCapital" type="number" min="0" step="1000000" value="${current.availableCapital}">
          <label>Max capital / opportunity ($)</label><input data-setting="maxCapitalOpportunity" type="number" min="1" step="1000000" value="${current.maxCapitalOpportunity}">
          <label>Max capital / item ($)</label><input data-setting="maxCapitalItem" type="number" min="1" step="1000000" value="${current.maxCapitalItem}">
          <label>Minimum ROI (%)</label><input data-setting="minimumROI" data-percent="1" type="number" min="0" max="100" step="0.1" value="${current.minimumROI * 100}">
          <label>Minimum expected profit ($)</label><input data-setting="minimumProfit" type="number" min="0" step="50000" value="${current.minimumProfit}">
          <label>Minimum discount (%)</label><input data-setting="minimumDiscount" data-percent="1" type="number" min="0" max="100" step="0.1" value="${current.minimumDiscount * 100}">
        </div>

        <div class="me-section-title">Exit assumptions and fees</div>
        <div class="me-form-grid">
          <label>Bazaar enabled</label><input data-setting="bazaarEnabled" type="checkbox" ${current.bazaarEnabled ? "checked" : ""}>
          <label>Bazaar discount (%)</label><input data-setting="bazaarDiscount" data-percent="1" type="number" min="0" max="20" step="0.1" value="${current.bazaarDiscount * 100}">
          <label>Safety haircut (%)</label><input data-setting="safetyHaircut" data-percent="1" type="number" min="0" max="10" step="0.1" value="${current.safetyHaircut * 100}">
          <label>Historical premium cap (%)</label><input data-setting="allowedHistoricalPremium" data-premium="1" type="number" min="0" max="10" step="0.1" value="${(current.allowedHistoricalPremium - 1) * 100}">
          <label>Item Market undercut ($)</label><input data-setting="itemMarketUndercut" type="number" min="0" step="1" value="${current.itemMarketUndercut}">
          <label>I list anonymously on the Item Market (+10% fee)</label><input data-setting="anonymousListing" type="checkbox" ${current.anonymousListing ? "checked" : ""}>
          <label>Anonymous fee waived by 5-star company perk</label><input data-setting="anonymousFeeWaived" type="checkbox" ${current.anonymousFeeWaived ? "checked" : ""}>
          <label>Museum set route for plushies/flowers</label><input data-setting="museumSetsEnabled" type="checkbox" ${current.museumSetsEnabled ? "checked" : ""}>
        </div>

        <div class="me-section-title">Risk & scanning</div>
        <div class="me-form-grid">
          <label>Minimum confidence for green</label><select data-setting="minimumGreenConfidence">${["VERY LOW", "LOW", "MEDIUM", "HIGH"].map((value) => `<option ${value === current.minimumGreenConfidence ? "selected" : ""}>${value}</option>`).join("")}</select>
          <label>Max MAD volatility (%)</label><input data-setting="maxVolatility" data-percent="1" type="number" min="0" max="100" step="0.1" value="${current.maxVolatility * 100}">
          <label>Max visible items / scan</label><input data-setting="scanMaxVisibleItems" type="number" min="1" max="50" step="1" value="${current.scanMaxVisibleItems}">
          <label>Travel capacity (0 = per-item only)</label><input data-setting="travelCapacity" type="number" min="0" max="1000" step="1" value="${current.travelCapacity}">
          <label>City shop run quantity (units per run)</label><input data-setting="shopRunQuantity" type="number" min="1" max="10000" step="1" value="${current.shopRunQuantity}">
          <label>Portfolio refine budget (requests per press)</label><input data-setting="portfolioRefineRequests" type="number" min="1" max="60" step="1" value="${current.portfolioRefineRequests}">
          <label>Use ended Auction House sales as evidence</label><input data-setting="auctionEvidenceEnabled" type="checkbox" ${current.auctionEvidenceEnabled !== false ? "checked" : ""}>
          <label>Item Market browse-grid overlay (vs market value)</label><input data-setting="browseOverlayEnabled" type="checkbox" ${current.browseOverlayEnabled !== false ? "checked" : ""}>
          <label>History retention (days)</label><input data-setting="historyRetentionDays" type="number" min="1" max="90" step="1" value="${current.historyRetentionDays}">
          <label>Developer diagnostics in console</label><input data-setting="developerMode" type="checkbox" ${current.developerMode ? "checked" : ""}>
        </div>

        <div class="me-section-title">Watchlist (API polling while a Torn tab is visible)</div>
        <div class="me-form-grid">
          <label>Watchlist alerts enabled</label><input data-setting="watchlistEnabled" type="checkbox" ${current.watchlistEnabled ? "checked" : ""}>
          <label>Check interval (seconds, min ${WATCHLIST_MIN_INTERVAL_SEC})</label><input data-setting="watchlistIntervalSeconds" type="number" min="${WATCHLIST_MIN_INTERVAL_SEC}" max="3600" step="5" value="${current.watchlistIntervalSeconds}">
          <label>Undercut alerts for my own listings</label><input data-setting="undercutAlerts" type="checkbox" ${current.undercutAlerts !== false ? "checked" : ""}>
        </div>
        <div id="me-watchlist-rows"></div>
        <div class="me-section-title">Diagnostics</div>
        <div class="me-actions"><button class="me-btn" id="me-build-diagnostics" type="button">Build page structure report</button><button class="me-btn" id="me-copy-diagnostics" type="button" hidden>Copy</button></div>
        <textarea id="me-diagnostics" class="me-inline-input" style="width:100%;min-height:90px;display:none;font:10px/1.3 monospace" readonly></textarea>
        <div class="me-form-help">The report describes the page's structure around item rows and expanded details (tags, classes, short text). It never includes the API key.</div>
        <div class="me-actions">
          <input id="me-watch-item" class="me-inline-input" type="number" min="1" placeholder="Item ID">
          <input id="me-watch-target" class="me-inline-input" type="number" min="1" placeholder="Alert at or below $">
          <button class="me-btn" id="me-watch-add" type="button">Add to watchlist</button>
        </div>
        <div class="me-form-help">The API key stays in userscript storage and is sent only to api.torn.com. Market Edge never includes it in diagnostics or exports. Fees modelled: Item Market 5% sales tax, optional 10% anonymous-listing fee, Auction House 3%. Bazaar and trades have no fee. Own Item Market listings need a Limited access key, the portfolio needs a Minimal access key; everything else works with a Public key.${ENV.isPda ? " Torn PDA detected: the PDA API key is used automatically when no key is entered." : ""}</div>
        <div class="me-modal-actions"><button class="me-btn" id="me-cancel-settings" type="button">Cancel</button><button class="me-btn" id="me-save-settings" type="button">Save</button></div>
      </div>`;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    backdrop.querySelector("#me-cancel-settings").addEventListener("click", close);

    const keyInfo = Store.keyInfo();
    if (keyInfo?.info?.access?.type) {
      const status = backdrop.querySelector("#me-api-status");
      status.textContent = `${keyInfo.info.access.type} key (last verified ${formatAge(Math.floor((Date.now() - asInt(keyInfo.savedAt)) / 1000))} ago)`;
    }

    const renderWatchRows = () => {
      const host = backdrop.querySelector("#me-watchlist-rows");
      const entries = Store.watchlist();
      if (!entries.length) {
        host.innerHTML = `<div class="me-form-help">No watched items. Add one here or use "Watch" on an Item Market page.</div>`;
        return;
      }
      host.innerHTML = entries.map((entry) => `
        <div class="me-watch-row" data-item-id="${entry.itemId}">
          <span class="me-watch-name" title="Item ${entry.itemId}">${escapeHtml(entry.name)}</span>
          <span>at or below ${formatMoney(entry.target)}</span>
          <span>${entry.lastFloor ? `floor ${formatMoney(entry.lastFloor)}` : ""}</span>
          <span class="me-watch-remove" role="button" title="Remove">X</span>
        </div>`).join("");
      host.querySelectorAll(".me-watch-remove").forEach((button) => {
        button.addEventListener("click", () => {
          const itemId = asInt(button.closest(".me-watch-row")?.dataset?.itemId, 0);
          Store.saveWatchlist(Store.watchlist().filter((entry) => entry.itemId !== itemId));
          renderWatchRows();
        });
      });
    };
    renderWatchRows();
    backdrop.querySelector("#me-build-diagnostics").addEventListener("click", async () => {
      const area = backdrop.querySelector("#me-diagnostics");
      const copy = backdrop.querySelector("#me-copy-diagnostics");
      area.style.display = "block";
      area.value = buildPageDiagnostics();
      copy.hidden = false;
      try {
        await navigator.clipboard?.writeText?.(area.value);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy";
      }
    });
    backdrop.querySelector("#me-copy-diagnostics").addEventListener("click", async () => {
      const area = backdrop.querySelector("#me-diagnostics");
      area.select();
      try {
        await navigator.clipboard?.writeText?.(area.value);
        backdrop.querySelector("#me-copy-diagnostics").textContent = "Copied";
      } catch {
        // Selection is left in place for a manual copy.
      }
    });
    backdrop.querySelector("#me-watch-add").addEventListener("click", async () => {
      const itemId = asInt(backdrop.querySelector("#me-watch-item").value, 0);
      const target = asInt(backdrop.querySelector("#me-watch-target").value, 0);
      if (!itemId || target <= 0) return;
      let name = `Item ${itemId}`;
      try {
        const meta = await loadItemMetadataBatch([itemId]);
        name = meta.get(itemId)?.name || name;
      } catch {
        // Name lookup is cosmetic.
      }
      addWatchItem({ itemId, name, target });
      backdrop.querySelector("#me-watch-item").value = "";
      backdrop.querySelector("#me-watch-target").value = "";
      renderWatchRows();
    });

    backdrop.querySelector("#me-test-key").addEventListener("click", async () => {
      const status = backdrop.querySelector("#me-api-status");
      Store.setApiKey(backdrop.querySelector("#me-api-key").value);
      api.memoryCache.clear();
      status.textContent = "Testing...";
      try {
        const result = await api.testKey();
        const player = result.playerId ? `player ${result.playerId}` : "player unknown";
        const limitedOk = result.accessRank >= KEY_ACCESS_RANK["Limited Access"];
        status.textContent = `OK - ${player} - ${result.accessType}${limitedOk ? "" : " (own listings panel needs Limited access)"}`;
        status.className = limitedOk ? "me-good" : "me-warn";
      } catch (error) {
        status.textContent = describeApiError(error, { feature: "Key test" });
        status.className = "me-bad";
      }
    });
    backdrop.querySelector("#me-save-settings").addEventListener("click", () => {
      const next = { ...current };
      backdrop.querySelectorAll("[data-setting]").forEach((input) => {
        const key = input.dataset.setting;
        if (input.type === "checkbox") next[key] = input.checked;
        else if (input.tagName === "SELECT") next[key] = input.value;
        else if (input.dataset.premium) next[key] = 1 + Number(input.value || 0) / 100;
        else if (input.dataset.percent) next[key] = Number(input.value || 0) / 100;
        else next[key] = Number(input.value || 0);
      });
      next.watchlistIntervalSeconds = Math.max(WATCHLIST_MIN_INTERVAL_SEC, asInt(next.watchlistIntervalSeconds, DEFAULTS.watchlistIntervalSeconds));
      Store.setApiKey(backdrop.querySelector("#me-api-key").value);
      Store.saveSettings(next);
      settings = Store.settings();
      api.memoryCache.clear();
      close();
      scheduleRefresh(true);
      restartWatchlist();
    });
  }

  function addBadge(card, text, state = "GREY", title = "") {
    if (!card?.isConnected) return;
    let badge = card.querySelector(":scope > .me-badge");
    if (!badge) {
      badge = document.createElement("span");
      card.appendChild(badge);
      ui.renderedBadges.add(badge);
    }
    badge.className = `me-badge ${state}`;
    badge.textContent = text;
    badge.title = title;
  }

  function clearBadges() {
    ui.renderedBadges.forEach((badge) => badge.remove());
    ui.renderedBadges.clear();
  }

  function clearInlineAnalysis() {
    document.querySelectorAll(".me-inline-analysis").forEach((node) => node.remove());
    document.querySelectorAll(".me-bazaar-add-controls,.me-bazaar-add-host").forEach((node) => {
      node.classList.remove("me-bazaar-add-controls", "me-bazaar-add-host");
    });
    document.querySelectorAll(".me-bazaar-add-row,.me-row-host").forEach((node) => node.classList.remove("me-bazaar-add-row", "me-row-host"));
  }

  function removeFloatingUi(force = false) {
    // Panels opened deliberately from the menu (own listings, watchlist) stay
    // until the player closes them or navigates elsewhere.
    if (ui.pinned && !force) return;
    ui.pinned = false;
    ui.currentPanel = null;
    if (ui.root?.isConnected) ui.root.remove();
    ui.root = null;
    ui.body = null;
    ui.title = null;
    ui.status = null;
  }

  function inlineHostFor(visible) {
    if (visible?.rowLine) {
      const host = visible.inlineAnchor?.isConnected ? visible.inlineAnchor : visible.card;
      if (host?.isConnected) {
        visible.card?.classList?.add("me-row-host");
        return { mode: "append", node: host };
      }
    }
    if (visible?.bazaarAdd) {
      const controls = visible?.bazaarControls || visible?.inlineAnchor;
      if (controls?.isConnected) {
        controls.classList?.add("me-bazaar-add-controls");
        visible.card?.classList?.add("me-bazaar-add-row");
        return { mode: "append", node: controls };
      }
    }
    const anchor = visible?.inlineAnchor;
    if (anchor?.isConnected) return { mode: "append", node: anchor };
    if (visible?.card?.isConnected) return { mode: "append", node: visible.card };
    return null;
  }

  function renderInlineHtml(visible, html, state = "GREY", extraClass = "") {
    const host = inlineHostFor(visible);
    if (!host) return null;
    visible.card?.querySelectorAll?.(".me-inline-analysis").forEach((node) => node.remove());
    const block = document.createElement("span");
    block.className = `me-inline-analysis ${state} ${extraClass}${visible?.rowLine ? " me-row-line" : ""}`.trim();
    block.dataset.meItemId = String(visible.itemId);
    block.dataset.meComplete = extraClass.includes("me-loading") ? "0" : "1";
    block.innerHTML = html;
    host.node.appendChild(block);
    return block;
  }

  function renderInlineLoading(visible) {
    const existing = visible.card?.querySelector?.(`.me-inline-analysis[data-me-item-id="${visible.itemId}"]`);
    if (existing?.dataset?.meComplete === "1") return existing;
    return renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">...</span>`,
      "GREY",
      "me-loading"
    );
  }

  function renderInlineError(visible, message) {
    return renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">${escapeHtml(message)}</span><span class="me-inline-status">ERROR</span>`,
      "RED"
    );
  }

  function staleMarker(result) {
    return result?.renderMeta?.stale ? `<span class="me-inline-stale" title="Showing cached data while Market Edge refreshes">*</span>` : "";
  }

  function setBazaarInputValue(input, value) {
    if (!(input instanceof HTMLInputElement)) return false;
    const target = Math.max(1, asInt(value));
    if (!target) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, String(target));
    else input.value = String(target);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    // Torn's money inputs are pairs: the visible field and a hidden twin in
    // the same .input-money-group that holds the raw number.
    const group = input.closest(".input-money-group");
    group?.querySelectorAll?.("input[type='hidden']").forEach((twin) => {
      if (twin === input) return;
      if (setter) setter.call(twin, String(target));
      else twin.value = String(target);
    });
    return parseIntegerField(input.value) === target;
  }

  function renderBazaarAddSuggestion(result) {
    const visible = result.visible;
    const source = result?.sellForm || result?.ownBazaar || {};
    const target = source.target;
    const stale = staleMarker(result);
    const venue = result?.sellForm ? "Item Market" : "Bazaar";
    if (!Number.isFinite(target) || target <= 0) {
      return renderInlineHtml(
        visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">${escapeHtml(source.reason || "price unavailable")}</span>${stale}`,
        "GREY"
      );
    }

    const targetText = formatMoney(target);
    const qty = Math.max(1, asInt(visible.maxAvailable || visible.quantity, 1));
    const totalHtml = qty > 1
      ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Total at this price for the ${qty} you own">x${qty} ${formatMoney(target * qty)}</span>`
      : "";
    const netHtml = result?.sellForm && Number.isFinite(source.net)
      ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Net per unit after the ${source.feeBps / 100}% Item Market fee">net ${formatMoney(source.net)}</span>`
      : "";
    const priceTitle = `Suggested ${venue} selling price${source.floor ? ` (Item Market floor ${formatMoney(source.floor, true)})` : ""}`;
    const block = renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(priceTitle)}">${targetText}</span><button class="me-bazaar-fill-btn" type="button" aria-label="Fill price and maximum quantity" title="Fill price with ${escapeHtml(targetText)} and quantity with max available; ${escapeHtml(venue === "Bazaar" ? "ADD TO BAZAAR" : "listing")} stays manual">^</button>${totalHtml}${netHtml}${stale}`,
      "GREY",
      "me-bazaar-add"
    );
    const button = block?.querySelector?.(".me-bazaar-fill-btn");
    if (!button || !visible.priceInput) return block;

    const apply = () => {
      if (!visible.priceInput?.isConnected) return;
      const priceFilled = setBazaarInputValue(visible.priceInput, target);
      const maxAvailable = Math.max(1, asInt(visible.maxAvailable || visible.quantity, 1));
      let quantityFilled = false;
      if (visible.priceOnly) {
        // Existing listing: the quantity is not ours to change.
      } else if (visible.quantityCheckbox?.isConnected) {
        if (!visible.quantityCheckbox.checked) visible.quantityCheckbox.click();
        quantityFilled = Boolean(visible.quantityCheckbox.checked);
      } else if (visible.quantityInput?.isConnected) {
        quantityFilled = setBazaarInputValue(visible.quantityInput, maxAvailable);
        visible.quantityInput.dispatchEvent(new Event("keyup", { bubbles: true, composed: true }));
      }
      if (!priceFilled) return;
      visible.price = target;
      block.classList.add("me-applied");
      button.title = quantityFilled
        ? `Filled ${maxAvailable} units at ${targetText}`
        : `Price filled with ${targetText}; quantity field was not detected`;
      setTimeout(() => block?.classList?.remove("me-applied"), 700);
    };
    // "Fill all" from the menu reuses the same handler without synthesising
    // a click on any element.
    button.meFill = apply;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      apply();
    });
    return block;
  }

  function renderInlineResult(surface, result, ownBazaar) {
    const visible = result.visible;
    if (!visible || !visible.card?.isConnected) return null;
    const stale = staleMarker(result);
    if (result.error) return renderInlineError(visible, result.error);
    if (result.untradable) {
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary" title="Torn marks this item as not tradable">untradable</span>`, "GREY");
    }
    if (result.noListings) {
      const mv = result.snapshot?.averagePrice ? `MV ${formatMoney(result.snapshot.averagePrice)}` : "no market value";
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary" title="No Item Market listings right now; Torn's market value is shown">${mv}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">no listings</span>${stale}`, "GREY");
    }
    if (result.unsupported) {
      // Weapons and armor are not priced: an invisible completed marker keeps
      // rescans from touching the row again.
      return renderInlineHtml(visible, "", "GREY", "me-hidden");
    }

    if ((surface === "bazaar" && ownBazaar && visible.bazaarAdd) || (surface === "imsell" && result.sellForm)) {
      return renderBazaarAddSuggestion(result);
    }

    if (result.inventory) {
      // Compact commodity line: best exit price per unit, owned quantity and
      // the total at that price. Everything else lives in the tooltip.
      const estimate = result.inventory;
      const routes = estimate.routes;
      const snapshot = result.snapshot || {};
      const qty = Math.max(1, asInt(estimate.quantity, 1));
      const routeOptions = [
        routes.bazaar ? { key: "Bazaar", label: "BZ", name: "Bazaar", unit: routes.bazaar.suggestedPrice, net: routes.bazaar.net } : null,
        { key: "Item Market", label: "IM", name: "Item Market", unit: routes.itemMarket.suggestedPrice, net: routes.itemMarket.net },
        routes.museum ? { key: "Museum set", label: "SET", name: routes.museum.label, unit: routes.museum.suggestedPrice, net: routes.museum.net } : null,
        routes.shop ? { key: "Sell to shop", label: "SHOP", name: routes.shop.label, unit: routes.shop.suggestedPrice, net: routes.shop.net } : null
      ].filter(Boolean);
      const best = routeOptions.find((option) => option.key === routes.bestRoute) || routeOptions[0];
      const total = best.unit * qty;
      const title = [
        `${best.name}: ${formatMoney(best.unit, true)} per unit, ${formatMoney(total, true)} for ${qty}`,
        ...routeOptions.filter((option) => option !== best).map((option) => `${option.name}: ${formatMoney(option.unit, true)} per unit (net ${formatMoney(Math.floor(option.net / qty), true)} after fees)`),
        snapshot.lowestPrice ? `Item Market floor ${formatMoney(snapshot.lowestPrice, true)}` : "",
        snapshot.averagePrice ? `Torn value ${formatMoney(snapshot.averagePrice, true)}` : ""
      ].filter(Boolean).join("\n");
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(title)}">${best.label} ${formatMoney(best.unit)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Owned quantity">x${qty}</span><span class="me-inline-sep">|</span><span class="me-inline-primary" title="Total for the ${qty} you own at ${formatMoney(best.unit, true)}">${formatMoney(total)}</span>${stale}`,
        "GREY"
      );
    }

    if (result.browse) {
      const data = result.browse;
      const discount = `${data.discount >= 0 ? "-" : "+"}${Math.abs(data.discount * 100).toFixed(1)}%`;
      const title = `Displayed price versus Torn's official market value ${formatMoney(data.marketPrice, true)}.${Number.isFinite(data.profitPerUnit) ? ` Estimated net per unit after fees via ${data.bestRoute}: ${formatMoney(data.profitPerUnit, true)}.` : ""} Open the item for order-book analysis.`;
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(title)}">${discount} vs MV</span><span class="me-inline-status">${data.label}</span>${stale}`,
        data.state
      );
    }

    if (surface === "auction") {
      const data = result.auction;
      const state = data?.headroom > 0 ? "YELLOW" : "GREY";
      const headroomText = data?.headroom > 0 ? `+${formatMoney(data.headroom)}` : "-";
      const sales = data?.salesSummary;
      const salesHtml = sales?.count ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Median of ${sales.count} ended Auction House sales in 30 days (range ${formatMoney(sales.low, true)} - ${formatMoney(sales.high, true)})">sold ${formatMoney(sales.median)}</span>` : "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">Max ${formatMoney(data?.maxBid)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${headroomText}</span>${salesHtml}<span class="me-inline-status">${data?.headroom > 0 ? "CONSIDER" : "PASS"}</span>${stale}`,
        state
      );
    }

    if (surface === "bazaar" && ownBazaar) {
      const data = result.ownBazaar;
      const state = data?.delta > 0 ? "YELLOW" : "GREY";
      const deltaText = Number.isFinite(data?.delta) ? `${data.delta >= 0 ? "+" : ""}${formatMoney(data.delta)}` : "-";
      const fill = data?.fill || null;
      const fillPrice = fill?.price || null;
      const ruleLabel = data?.rule ? ` (rule: ${data.rule.mode}${data.rule.minPrice ? `, min ${formatMoney(data.rule.minPrice)}` : ""})` : "";
      const fillHtml = visible.priceInput && fillPrice
        ? `<button class="me-bazaar-fill-btn me-manage-fill" type="button" title="Fill Torn's price field with ${escapeHtml(formatMoney(fillPrice, true))}${escapeHtml(ruleLabel)}. Saving stays manual.">^</button>`
        : (fill?.reason === "held by rule" ? `<span class="me-inline-secondary" title="Pricing rule: hold">hold</span>` : "");
      const floorHtml = data?.floor ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Cheapest Item Market listing">floor ${formatMoney(data.floor)}</span>` : "";
      const block = renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">Target ${formatMoney(data?.target)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${deltaText}</span>${floorHtml}${fillHtml}<span class="me-inline-status">${data?.delta > 0 ? "LOW" : "OK"}</span>${stale}`,
        state
      );
      const manageButton = block?.querySelector?.(".me-manage-fill");
      if (manageButton) {
        const applyManage = () => {
          if (!visible.priceInput?.isConnected || !fillPrice) return;
          if (setBazaarInputValue(visible.priceInput, fillPrice)) {
            visible.price = fillPrice;
            data.delta = data.target - fillPrice;
            block.classList.add("me-applied");
            setTimeout(() => block?.classList?.remove("me-applied"), 700);
          }
        };
        manageButton.meFill = applyManage;
        manageButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          applyManage();
        });
      }
      if (visible.priceInput && !visible.priceInput.dataset.mePriceListener) {
        visible.priceInput.dataset.mePriceListener = "1";
        visible.priceInput.addEventListener("input", () => {
          const currentPrice = parseIntegerField(visible.priceInput.value);
          if (!currentPrice || !Number.isFinite(data?.target)) return;
          visible.price = currentPrice;
          data.delta = data.target - currentPrice;
          renderInlineResult(surface, result, ownBazaar);
        });
      }
      return block;
    }

    const direct = result.direct;
    if (!direct) {
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">PASS</span>${stale}`, "GREY");
    }
    const state = direct.classification.state;
    const roi = `${direct.roi >= 0 ? "+" : ""}${(direct.roi * 100).toFixed(1)}%`;
    const profit = `${direct.expectedProfit >= 0 ? "+" : ""}${formatMoney(direct.expectedProfit)}`;

    if (surface === "cityshop") {
      const qty = Math.max(1, asInt(result.quantityUsed || 1, 1));
      const perUnit = Math.trunc(direct.expectedProfit / qty);
      const route = direct.routes?.bestRoute || "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Expected net profit per unit after fees via ${escapeHtml(route)}">${perUnit >= 0 ? "+" : ""}${formatMoney(perUnit)} ea</span><span class="me-inline-sep">|</span><span class="me-inline-secondary" title="For ${qty} units">${profit} / ${qty}</span><span class="me-inline-status">${CLASS_META[state].label}</span>${stale}`,
        state
      );
    }

    if (surface === "travel") {
      const qty = Math.max(1, asInt(result.quantityUsed || visible.quantity, 1));
      const perUnit = Math.trunc(direct.expectedProfit / qty);
      const trip = result.perItemOnly ? `ROI ${roi}` : `${profit} trip`;
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">${perUnit >= 0 ? "+" : ""}${formatMoney(perUnit)} ea</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${trip}</span>${stale}`,
        state
      );
    }

    if (surface === "bazaar") {
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">${roi}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${profit}</span><span class="me-inline-status">${CLASS_META[state].label}</span>${stale}`,
        state
      );
    }

    return renderInlineHtml(visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-primary">${roi}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${profit}</span><span class="me-inline-status">${CLASS_META[state].label}</span>${stale}`,
      state
    );
  }

  // ---------------------------------------------------------------------------
  // Page-specific analyses
  // ---------------------------------------------------------------------------

  function ownListingsRouteActive() {
    const hash = String(location.hash || "").toLowerCase();
    return /manage|mylist|my-list|yourlist|your-list|viewlisting|listings/.test(hash) && !/itemid=/.test(hash);
  }

  function panelToolbarHtml() {
    return `<div class="me-actions">
      <button class="me-btn me-open-listings" type="button" title="Compare your Item Market listings with the live floor (Limited key)">My listings</button>
      <button class="me-btn me-open-watchlist" type="button" title="Watched items and alert targets">Watchlist</button>
      <button class="me-btn me-open-portfolio" type="button" title="Value your whole inventory through the official API (Minimal key)">Portfolio</button>
      <button class="me-btn me-open-shops" type="button" title="City shop stock priced against the market">Shops</button>
      <button class="me-btn me-open-travel" type="button" title="Foreign shop prices ranked by profit per trip">Travel</button>
    </div>`;
  }

  function bindPanelToolbar() {
    ui.body?.querySelector(".me-open-listings")?.addEventListener("click", () => renderOwnListingsPanel());
    ui.body?.querySelector(".me-open-watchlist")?.addEventListener("click", () => renderWatchlistPanel());
    ui.body?.querySelector(".me-open-portfolio")?.addEventListener("click", () => renderPortfolioPanel());
    ui.body?.querySelector(".me-open-shops")?.addEventListener("click", () => renderShopRunsPanel());
    ui.body?.querySelector(".me-open-travel")?.addEventListener("click", () => renderTravelPlanPanel());
  }

  // Ended-auction timing section shared by the Item Market panels: when do
  // sales of this item close at the best prices (Torn City Time)?
  function auctionTimingHtml(sales, { stackableOnly = false } = {}) {
    const rows = stackableOnly ? (sales || []).filter((sale) => sale.stackable) : (sales || []);
    const timing = auctionTimingStats(rows);
    if (!timing.total) return "";
    const bucketRows = timing.buckets.map((bucket) => `<div class="me-diag-row${timing.best && bucket.key === timing.best.key ? " pass" : ""}">${escapeHtml(bucket.label)}: ${bucket.count ? `${formatMoney(bucket.median)} x${bucket.count}${Number.isFinite(bucket.ratio) ? ` (${bucket.ratio >= 1 ? "+" : ""}${((bucket.ratio - 1) * 100).toFixed(1)}%)` : ""}` : "no sales"}</div>`).join("");
    const summary = timing.best
      ? `Best window to end an auction: ${timing.best.label} (${timing.best.count} sales, ${((timing.best.ratio - 1) * 100).toFixed(1)}% above the overall median)${timing.worst && timing.worst.key !== timing.best.key ? `; cheapest wins closed ${timing.worst.label}` : ""}.`
      : `Not enough ended sales per window yet (${timing.total} in total).`;
    return `<details class="me-diag"><summary>Auction timing: ${timing.total} ended sales, median ${formatMoney(timing.overallMedian)}</summary><div class="me-diag-row">${escapeHtml(summary)}</div>${bucketRows}</details>`;
  }

  function itemMarketLink(itemId, name = "") {
    const encoded = encodeURIComponent(String(name || ""));
    return `https://www.torn.com/page.php?sid=ItemMarket#/market/view=sell&itemID=${asInt(itemId)}${name ? `&itemName=${encoded}` : ""}`;
  }

  function watchControlsHtml(snapshot, best) {
    const entry = Store.watchlist().find((row) => row.itemId === snapshot.itemId);
    if (entry) {
      return `<div class="me-actions"><span class="me-note">Watching: alert at or below ${formatMoney(entry.target)}</span><button class="me-btn me-unwatch" type="button">Stop watching</button></div>`;
    }
    const defaultTarget = best?.exit?.conservativeExitPrice
      ? Math.floor(best.exit.conservativeExitPrice * (1 - settings.minimumDiscount))
      : (snapshot.lowestPrice ? Math.floor(snapshot.lowestPrice * (1 - settings.minimumDiscount)) : 0);
    return `<div class="me-actions"><input class="me-inline-input me-watch-target" type="number" min="1" value="${defaultTarget || ""}" placeholder="Alert at or below $"><button class="me-btn me-watch" type="button">Watch</button></div>`;
  }

  function bindWatchControls(snapshot) {
    const body = ui.body;
    if (!body) return;
    body.querySelector(".me-watch")?.addEventListener("click", () => {
      const target = asInt(body.querySelector(".me-watch-target")?.value, 0);
      if (target <= 0) return;
      addWatchItem({ itemId: snapshot.itemId, name: snapshot.itemName, target });
      renderItemMarket();
    });
    body.querySelector(".me-unwatch")?.addEventListener("click", () => {
      Store.saveWatchlist(Store.watchlist().filter((row) => row.itemId !== snapshot.itemId));
      renderItemMarket();
    });
  }

  async function renderItemMarket() {
    if (ownListingsRouteActive()) {
      await renderOwnListingsPanel();
      return;
    }
    const itemId = getItemIdFromLocation();
    if (!itemId) {
      setPanel(`<div class="me-kicker">Item Market</div><div class="me-note">Open a specific item to analyze its order book.${settings.browseOverlayEnabled !== false ? " Browse cards are compared with Torn's official market value as they appear." : ""}</div>${panelToolbarHtml()}`);
      bindPanelToolbar();
      if (settings.browseOverlayEnabled !== false) scanBrowseGrid({ force: false });
      return;
    }
    if (!Store.apiKey()) {
      errorPanel("Add a Torn API key to analyze this item.");
      return;
    }

    setPanel(`<div class="me-kicker">Item Market</div><div class="me-item-name">Loading item ${itemId}...</div>`, "API");
    try {
      const { snapshot, historyStats } = await loadSnapshot(itemId, { limit: API_DEEP_LIMIT, priority: 200 });
      if (!snapshot.supportedCommodity) {
        setPanel(`<div class="me-kicker">Item Market</div><div class="me-item-name">${escapeHtml(snapshot.itemName)}</div><div class="me-callout GREY"><div class="me-decision GREY">- NOT PRICED</div><div class="me-note">Weapons and armor are not priced by Market Edge; only stackable items are.</div></div>${panelToolbarHtml()}`);
        bindPanelToolbar();
        return;
      }

      const liveRows = parseLiveItemMarketListings();
      let itemMeta = null;
      try {
        itemMeta = (await loadItemMetadataBatch([itemId], { priority: 190 })).get(itemId) || null;
      } catch (error) {
        log("Item metadata unavailable", error.message);
      }
      const museumContext = await loadMuseumContext([itemId], { priority: 190, metadata: new Map(itemMeta ? [[itemId, itemMeta]] : []) });
      const museum = museumContext.get(itemId) || null;
      const shopSell = shopSellFloor(itemMeta);
      // Ended auctions are the only official transaction evidence for
      // stackable items; one request, cached ten minutes.
      const auctionSales = settings.auctionEvidenceEnabled !== false ? await loadAuctionSales(itemId, { priority: 170 }) : [];
      const salesSummary = stackableSalesSummary(auctionSales);
      if (detectSurface() !== "itemmarket" || getItemIdFromLocation() !== itemId) return;

      // The official Torn API is the authoritative valuation source. The live
      // DOM is used only to confirm/highlight what the player currently sees.
      const evaluated = evaluatePrefixes(snapshot, historyStats, settings, Date.now(), { museum, shopSell: shopSell?.price, shopLabel: shopSell?.label });
      const best = evaluated.best;
      const compareCount = Math.max(2, best?.prefixCount || Math.min(5, snapshot.listings.length));
      const liveMatchesApi = liveRows.length >= compareCount && snapshot.listings.length >= compareCount &&
        Array.from({ length: compareCount }, (_, index) => (
          liveRows[index]?.price === snapshot.listings[index]?.price &&
          liveRows[index]?.quantity === snapshot.listings[index]?.quantity
        )).every(Boolean);
      const liveConfirmation = liveRows.length < 2
        ? "API"
        : (liveMatchesApi ? "PAGE MATCHES API" : "API - PAGE DIFFERS");
      const fresh = freshness(snapshot.cacheTimestamp);
      const reference = chooseReference(snapshot, historyStats);
      const learning = historyStats.oneDay.count < 5;
      const agreement = officialAgreement(snapshot);
      const currentDiscount = reference.value && snapshot.lowestPrice ? 1 - snapshot.lowestPrice / reference.value : null;
      const sourceWarning = liveRows.length >= 2 && !liveMatchesApi
        ? `<div class="me-note me-warn">The visible Torn listings differ from the current API cache. Market Edge is keeping the official API snapshot authoritative and will not mix the two books.</div>`
        : "";
      const feeBps = itemMarketFeeBps(settings);
      const feeLabel = `${feeBps / 100}%${feeBps > ITEM_MARKET_FEE_BPS ? " incl. anonymous" : ""}`;
      const fairValueCell = historyStats.historicalFairValue
        ? `<span title="${formatMoney(historyStats.historicalFairValue, true)}">${formatMoney(historyStats.historicalFairValue)}</span>`
        : (agreement.agrees
          ? `<span title="Torn daily average and current depth agree within ${(OFFICIAL_AGREEMENT_TOLERANCE * 100).toFixed(0)}%">${formatMoney(reference.value)} (official)</span>`
          : "Learning...");
      const coldStartNote = learning
        ? (agreement.agrees
          ? `<div class="me-note">Cold start: Torn's daily average (${formatMoney(snapshot.averagePrice)}) and the current depth anchor agree, so no warm-up penalty is applied. Local observations: ${historyStats.oneDay.count}/5.</div>`
          : `<div class="me-note me-learning">Learning market... ${historyStats.oneDay.count}/5 observations. ${agreement.available ? `Torn's daily average (${formatMoney(snapshot.averagePrice)}) differs ${(agreement.ratio * 100).toFixed(1)}% from the depth anchor, so` : "Without an official average,"} an extra 2% safety haircut applies.</div>`)
        : "";
      const museumRows = museum && museum.complete
        ? [[`${museum.label} implied value`, `<span title="${museum.points} points x ${formatMoney(museum.pointValue, true)} minus ${formatMoney(museum.othersCost, true)} for the other pieces">${formatMoney(museum.impliedValue)}</span>`, museum.impliedValue > (reference.value || 0) ? "me-good" : ""]]
        : [];
      const evidenceRows = [];
      if (salesSummary.count) {
        const agreesWithSales = reference.value ? Math.abs(salesSummary.median - reference.value) / reference.value : null;
        evidenceRows.push(["AH sold median (30d)", `<span title="${salesSummary.count} ended auctions, range ${formatMoney(salesSummary.low, true)} - ${formatMoney(salesSummary.high, true)}">${formatMoney(salesSummary.median)} x${salesSummary.count}</span>`, Number.isFinite(agreesWithSales) && agreesWithSales <= 0.10 ? "me-good" : ""]);
      }
      if (shopSell) evidenceRows.push([escapeHtml(shopSell.label), formatMoney(shopSell.price)]);

      setPanel(`
        <div class="me-kicker">Item Market - ${escapeHtml(liveConfirmation)}</div>
        <div class="me-item-name">${escapeHtml(snapshot.itemName)}</div>
        ${metricRows([
          ["Lowest", `<span title="${formatMoney(snapshot.lowestPrice, true)}">${formatMoney(snapshot.lowestPrice)}</span>`],
          ["Current anchor", `<span title="${formatMoney(snapshot.calculatedMarketAnchor, true)}">${formatMoney(snapshot.calculatedMarketAnchor)}</span>`],
          ["Torn daily average", snapshot.averagePrice ? `<span title="${formatMoney(snapshot.averagePrice, true)}">${formatMoney(snapshot.averagePrice)}</span>` : "-"],
          ["Fair value", fairValueCell, learning && !agreement.agrees ? "me-learning" : ""],
          ["Lowest discount", Number.isFinite(currentDiscount) ? `${(currentDiscount * 100).toFixed(2)}%` : "-"],
          ["24h MAD volatility", Number.isFinite(historyStats.oneDay.volatility) ? `${(historyStats.oneDay.volatility * 100).toFixed(2)}%` : "-"],
          ["API age", `${formatAge(fresh.ageSeconds)} - ${fresh.label}`],
          ["Observations (24h)", String(historyStats.oneDay.count)],
          ...museumRows,
          ...evidenceRows
        ])}
        ${sourceWarning}
        <div class="me-rule"></div>
        <div class="me-kicker">Best opportunity</div>
        ${best ? metricRows([
          ["Buy", `${best.quantityBought.toLocaleString("en-US")} units`],
          ["Average buy", `<span title="${formatMoney(best.averageBuyPrice, true)}">${formatMoney(best.averageBuyPrice)}</span>`],
          ["Capital", `<span title="${formatMoney(best.capitalRequired, true)}">${formatMoney(best.capitalRequired)}</span>`],
          ["Best exit", escapeHtml(best.routes.bestRoute)],
          ["Bazaar target", best.routes.bazaar ? formatMoney(best.routes.bazaar.suggestedPrice) : "Disabled"],
          ["Item Market target", formatMoney(best.routes.itemMarket.suggestedPrice)],
          [`IM net after ${feeLabel}`, formatMoney(Math.floor(best.routes.itemMarket.net / best.quantityBought))],
          ["Auction net after 3%", `<span title="Informational: auctions are never chosen as the best route">${formatMoney(Math.floor(best.routes.auction.net / best.quantityBought))}</span>`],
          ...(best.routes.museum ? [[`${best.routes.museum.label} target`, formatMoney(best.routes.museum.suggestedPrice)]] : []),
          ...(best.routes.shop ? [[escapeHtml(best.routes.shop.label), formatMoney(best.routes.shop.suggestedPrice)]] : [])
        ]) : `<div class="me-note">No affordable prefix with positive expected profit.</div>`}
        <div class="me-rule"></div>
        ${decisionHtml(best)}
        ${diagnosticsHtml(best)}
        ${coldStartNote}
        ${auctionTimingHtml(auctionSales, { stackableOnly: true })}
        ${watchControlsHtml(snapshot, best)}
        ${panelToolbarHtml()}
        <div class="me-note">Facts: official API asks, Torn daily average and the ${feeLabel} Item Market fee. The visible page is used only for confirmation/highlighting. Local data: observed anchors. Exit, profit and confidence are estimates - not guarantees.</div>
      `, fresh.label);
      bindWatchControls(snapshot);
      bindPanelToolbar();

      if (liveMatchesApi) highlightItemMarketRows(liveRows, best);
      else clearBadges();
    } catch (error) {
      errorPanel(describeApiError(error, { feature: "Item Market analysis" }));
    }
  }

  function highlightItemMarketRows(liveRows, best) {
    if (!liveRows.length) return;
    clearBadges();
    liveRows.forEach((row, index) => {
      const selected = best && index < best.prefixCount;
      const state = selected ? best.classification.state : "GREY";
      const text = selected ? `${CLASS_META[state].label} - ${best.roi >= 0 ? "+" : ""}${(best.roi * 100).toFixed(1)}%` : "PASS";
      addBadge(row.node, text, state, selected ? `Part of recommended ${best.quantityBought}-unit prefix; expected total profit ${formatMoney(best.expectedProfit, true)}.` : "Not part of the best current prefix.");
    });
  }

  function viewportPriority(visible, index = 0) {
    const rect = visible?.card?.getBoundingClientRect?.();
    if (!rect) return 100 - index;
    const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    const inViewport = rect.bottom >= 0 && rect.top <= viewportHeight;
    if (inViewport) return 1000 - Math.max(0, Math.round(rect.top / 10)) - index;
    if (rect.top > viewportHeight) return 500 - Math.min(300, Math.round((rect.top - viewportHeight) / 20)) - index;
    return 200 - index;
  }

  function resultForSurface(surface, visible, snapshot, historyStats, ownBazaar, renderMeta = {}, museum = null, extras = {}) {
    const shopSell = extras?.shopSell || null;
    const salesSummary = extras?.salesSummary || null;
    if (!snapshot?.supportedCommodity) return { visible, snapshot, unsupported: true, renderMeta };

    if (surface === "inventory") {
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum, shopSell });
      if (!estimate && !(snapshot?.listings || []).length) return { visible, snapshot, historyStats, noListings: true, renderMeta };
      return { visible, snapshot, historyStats, inventory: estimate, renderMeta };
    }

    if (surface === "imsell") {
      // Item Market "add listing" form: the suggested Item Market price
      // (conservative exit minus undercut, through the item's pricing rule)
      // and the net per unit after the configured fee.
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum, shopSell });
      if (!estimate) return { visible, snapshot, historyStats, sellForm: { target: null, reason: (snapshot?.listings || []).length ? "price unavailable" : "no listings" }, renderMeta };
      const floorSuggestion = snapshot.lowestPrice ? Math.max(1, snapshot.lowestPrice - Math.max(0, asInt(settings.itemMarketUndercut))) : null;
      const rule = Store.pricingRules()[visible.itemId] || null;
      const fill = applyPricingRule({ rule, floorSuggestion, anchorSuggestion: estimate.routes.itemMarket.suggestedPrice });
      const target = fill.price || estimate.routes.itemMarket.suggestedPrice;
      const feeBps = itemMarketFeeBps(settings);
      return { visible, snapshot, historyStats, sellForm: { target, net: grossToNet(target, feeBps), feeBps, floor: snapshot.lowestPrice, rule, estimate }, renderMeta };
    }

    if (surface === "auction") {
      const salesMedian = salesSummary?.median || null;
      const maxBid = maxRationalBid({ snapshot, historyStats, settings, quantity: visible.quantity, museum, shopSell, salesMedian });
      const headroom = Number.isFinite(maxBid) ? maxBid - visible.price : null;
      const direct = visible.price > 0
        ? evaluateDirectBuy({ buyPrice: visible.price, quantity: visible.quantity, snapshot, historyStats, settings, forceYellow: true, museum, shopSell })
        : null;
      return { visible, snapshot, historyStats, auction: { maxBid, headroom, direct, salesSummary }, renderMeta };
    }

    if (surface === "bazaar" && ownBazaar) {
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum, shopSell });
      const target = estimate?.routes?.bazaar?.suggestedPrice;
      const delta = Number.isFinite(target) ? target - visible.price : null;
      // Repricing workbench: the floor-based suggestion (floor minus undercut,
      // Bazaar is fee-free so no discount) and the anchor-based target go
      // through the item's pricing rule.
      const floorSuggestion = snapshot.lowestPrice ? Math.max(1, snapshot.lowestPrice - Math.max(0, asInt(settings.itemMarketUndercut))) : null;
      const rule = Store.pricingRules()[visible.itemId] || null;
      const fill = applyPricingRule({ rule, floorSuggestion, anchorSuggestion: target });
      return { visible, snapshot, historyStats, ownBazaar: { target, delta, estimate, fill, rule, floor: snapshot.lowestPrice }, renderMeta };
    }

    let quantity = visible.quantity;
    if (surface === "travel" && settings.travelCapacity > 0) quantity = Math.min(quantity, settings.travelCapacity);
    if (surface === "travel" && settings.travelCapacity === 0) quantity = 1;
    if (surface === "cityshop") quantity = Math.max(1, asInt(settings.shopRunQuantity, 100));
    const direct = evaluateDirectBuy({
      buyPrice: visible.price,
      quantity,
      snapshot,
      historyStats,
      settings,
      forceYellow: surface === "auction",
      museum,
      shopSell
    });
    return {
      visible,
      snapshot,
      historyStats,
      direct,
      quantityUsed: quantity,
      perItemOnly: surface === "travel" && settings.travelCapacity === 0,
      renderMeta
    };
  }

  let listQueueGeneration = 0;
  let activeListQueueGroup = "";

  function beginListQueueGroup(surface, { cancelObsolete = false } = {}) {
    const prefix = `list:${surface}:`;
    if (cancelObsolete || !activeListQueueGroup.startsWith(prefix)) {
      activeListQueueGroup = `${prefix}${++listQueueGeneration}`;
      api.scheduler.cancelQueued(
        (job) => String(job.meta?.queueGroup || "").startsWith("list:") && job.meta.queueGroup !== activeListQueueGroup,
        "Market Edge list request superseded by a newer Torn view."
      );
    }
    return activeListQueueGroup;
  }

  function cancelQueuedListRequests(reason = "Market Edge left the list view.") {
    activeListQueueGroup = "";
    return api.scheduler.cancelQueued(
      (job) => String(job.meta?.queueGroup || "").startsWith("list:"),
      reason
    );
  }

  function genericIntro(surface, { clear = true } = {}) {
    removeFloatingUi();
    if (clear) clearInlineAnalysis();
    // List-style surfaces use War-Overlay-style inline intelligence rather
    // than a floating results window. New rows are discovered incrementally.
    setTimeout(() => scanVisibleSurface(surface, { retryIfEmpty: true, force: false, cancelObsolete: true }), 250);
  }

  // One scan at a time per page. A scan requested while another is running
  // is coalesced into a single follow-up pass, so mutation storms cannot
  // stack overlapping scans (duplicate overlays, wasted requests).
  const scanState = { running: false, pending: null };

  async function scanVisibleSurface(surface, options = {}) {
    if (scanState.running) {
      const previous = scanState.pending || {};
      scanState.pending = { surface, options: { ...previous.options, ...options, force: Boolean(previous.options?.force || options.force) } };
      return;
    }
    scanState.running = true;
    try {
      await scanVisibleSurfaceNow(surface, options);
    } catch (error) {
      log("Scan failed", surface, error?.message || error);
    } finally {
      scanState.running = false;
      const pending = scanState.pending;
      scanState.pending = null;
      if (pending && document.visibilityState === "visible" && detectSurface() === pending.surface) {
        setTimeout(() => scanVisibleSurface(pending.surface, pending.options), 60);
      }
    }
  }

  async function scanVisibleSurfaceNow(surface, { retryIfEmpty = false, force = false, cancelObsolete = false } = {}) {
    const scanStartedAt = Date.now();
    removeFloatingUi();
    if (document.visibilityState !== "visible") return;

    const queueGroup = beginListQueueGroup(surface, { cancelObsolete });
    const ownBazaar = surface === "bazaar" ? await isOwnBazaar() : false;
    if (detectSurface() !== surface || document.visibilityState !== "visible") return;

    const requireMoney = !["inventory", "imsell"].includes(surface);
    let items = surface === "auction"
      ? collectAuctionItems()
      : (surface === "imsell" ? collectSellFormRows() : (surface === "bazaar" && ownBazaar ? collectOwnBazaarItems() : collectVisibleItems({ requireMoney })));

    if (!items.length) {
      if (retryIfEmpty) {
        setTimeout(() => {
          if (detectSurface() === surface && document.visibilityState === "visible") {
            scanVisibleSurface(surface, { retryIfEmpty: false, force, cancelObsolete: false });
          }
        }, 650);
      }
      return;
    }

    items = items.filter((visible) => {
      if (!visible?.card?.isConnected) return false;
      const existing = visible.card.querySelector?.(`.me-inline-analysis[data-me-item-id="${visible.itemId}"]`);
      const scanningGroup = visible.card.dataset?.meScanningGroup || "";
      const scanning = visible.card.dataset?.meScanning === String(visible.itemId) && scanningGroup === queueGroup;
      if (cancelObsolete && scanningGroup && scanningGroup !== queueGroup) {
        delete visible.card.dataset.meScanning;
        delete visible.card.dataset.meScanningGroup;
        if (existing?.classList.contains("me-loading")) existing.remove();
      }
      if (force && existing) existing.remove();
      return force || (!scanning && existing?.dataset?.meComplete !== "1");
    });
    if (!items.length) return;

    if (!Store.apiKey()) {
      items.forEach((visible) => renderInlineError(visible, "Add API key in Market Edge settings"));
      return;
    }

    items.sort((a, b) => viewportPriority(b) - viewportPriority(a));
    items.forEach((visible) => {
      if (visible.card?.dataset) {
        visible.card.dataset.meScanning = String(visible.itemId);
        visible.card.dataset.meScanningGroup = queueGroup;
      }
      renderInlineLoading(visible);
    });

    let metadata = new Map();
    try {
      metadata = await loadItemMetadataBatch(items.map((item) => item.itemId));
    } catch (error) {
      log("Item metadata batch failed; continuing with Item Market fallback", error.message);
    }

    // Museum context is one cheap batch shared by every plushie/flower row.
    let museumContext = new Map();
    try {
      museumContext = await loadMuseumContext(items.map((item) => item.itemId), { priority: 140, metadata });
    } catch (error) {
      log("Museum context unavailable", error.message);
    }
    if (detectSurface() !== surface || document.visibilityState !== "visible") return;

    // Own Bazaar listings feed the sell-side (undercut) watch.
    if (surface === "bazaar" && ownBazaar && !bazaarAddRouteActive()) {
      recordSellWatch(items.filter((visible) => visible.price > 0 && !visible.bazaarAdd).map((visible) => ({ itemId: visible.itemId, name: visible.name, price: visible.price, amount: visible.quantity, venue: "Bazaar" })), "Bazaar", { prune: items.length < clamp(settings.scanMaxVisibleItems, 1, 50) });
    }

    const sellSideSurface = surface === "inventory" || surface === "imsell" || (surface === "bazaar" && ownBazaar);

    const tasks = items.map(async (visible, index) => {
      const priority = viewportPriority(visible, index);
      let renderedCached = false;
      try {
        if (!visible.card?.isConnected || detectSurface() !== surface) return;
        const meta = metadata.get(visible.itemId);
        if (meta && meta.isTradable === false) {
          renderInlineResult(surface, { visible, untradable: true, renderMeta: { stale: false } }, ownBazaar);
          return;
        }
        if (meta && !metadataSupportsCommodity(meta)) {
          // Weapons and armor are never priced: no request, hidden marker.
          renderInlineResult(surface, { visible, unsupported: true, renderMeta: { stale: false } }, ownBazaar);
          return;
        }
        const museum = museumContext.get(visible.itemId) || null;
        const extras = { shopSell: shopSellFloor(meta), salesSummary: null };
        if (surface === "auction" && settings.auctionEvidenceEnabled !== false && meta && metadataSupportsCommodity(meta)) {
          try {
            extras.salesSummary = stackableSalesSummary(await loadAuctionSales(visible.itemId, { priority: priority - 5 }));
          } catch (error) {
            log("Auction sales unavailable", visible.itemId, error.message);
          }
        }

        const bundle = await loadSnapshot(visible.itemId, {
          limit: API_LIST_LIMIT,
          priority,
          queueGroup,
          onCached: (cached) => {
            if (!visible.card?.isConnected || detectSurface() !== surface) return;
            renderedCached = true;
            const result = resultForSurface(
              surface,
              visible,
              cached.snapshot,
              cached.historyStats,
              ownBazaar,
              { stale: Boolean(cached.refreshing), cacheAgeSeconds: cached.cacheState?.ageSeconds },
              museum,
              extras
            );
            renderInlineResult(surface, result, ownBazaar);
          }
        });

        if (!visible.card?.isConnected || detectSurface() !== surface) return;
        // Metadata was unavailable and the order book revealed equipment:
        // not priced, no further requests.
        if (bundle.snapshot?.equipment) {
          renderInlineResult(surface, { visible, snapshot: bundle.snapshot, unsupported: true, renderMeta: { stale: false } }, ownBazaar);
          return;
        }
        const result = resultForSurface(surface, visible, bundle.snapshot, bundle.historyStats, ownBazaar, {
          stale: false,
          cacheAgeSeconds: bundle.cacheState?.ageSeconds
        }, museum, extras);
        renderInlineResult(surface, result, ownBazaar);
      } catch (error) {
        if (error?.marketEdgeCanceled) return;
        recordRuntime("row-error", `item ${visible.itemId} on ${surface}: ${error.message}`);
        if (!renderedCached && visible.card?.isConnected) renderInlineError(visible, error.message);
        else log("Refresh failed; keeping cached row", visible.itemId, error.message);
      } finally {
        if (visible.card?.dataset?.meScanning === String(visible.itemId) && visible.card.dataset.meScanningGroup === queueGroup) {
          delete visible.card.dataset.meScanning;
          delete visible.card.dataset.meScanningGroup;
        }
      }
    });

    await Promise.allSettled(tasks);
    const annotated = items.filter((visible) => visible.card?.querySelector?.(`.me-inline-analysis[data-me-item-id="${visible.itemId}"]`)?.dataset?.meComplete === "1").length;
    recordRuntime("scan", `${surface}: ${annotated}/${items.length} rows`, { surface, rows: items.length, annotated, ms: Date.now() - scanStartedAt });
  }

  // ---------------------------------------------------------------------------
  // v0.4.0: Auction House equipment bids, browse-grid overlay, portfolio,
  // shop runs, travel plan, repricing workbench and sell-side watch
  // ---------------------------------------------------------------------------

  // Item Market browse grid: every visible card compared with Torn's official
  // market value from one batched metadata request. No order books.
  let browseScanRunning = false;

  async function scanBrowseGrid({ force = false } = {}) {
    if (browseScanRunning || document.visibilityState !== "visible" || !Store.apiKey()) return;
    if (detectSurface() !== "itemmarket" || getItemIdFromLocation()) return;
    browseScanRunning = true;
    try {
      const items = collectVisibleItems({ requireMoney: true }).filter((visible) => {
        if (!visible.card?.isConnected) return false;
        const existing = visible.card.querySelector?.(`.me-inline-analysis[data-me-item-id="${visible.itemId}"]`);
        if (force && existing) existing.remove();
        return force || existing?.dataset?.meComplete !== "1";
      });
      if (!items.length) return;
      const metadata = await loadItemMetadataBatch(items.map((item) => item.itemId), { priority: 130 });
      if (detectSurface() !== "itemmarket" || getItemIdFromLocation()) return;
      items.forEach((visible) => {
        if (!visible.card?.isConnected) return;
        const meta = metadata.get(visible.itemId);
        if (!meta || !metadataSupportsCommodity(meta)) {
          renderInlineHtml(visible, "", "GREY", "me-hidden");
          return;
        }
        const browse = evaluateBrowseCard({ price: visible.price, marketPrice: meta.marketPrice, settings });
        if (!browse) {
          renderInlineHtml(visible, "", "GREY", "me-hidden");
          return;
        }
        renderInlineResult("itemmarket", { visible, browse, renderMeta: { stale: false } }, false);
      });
    } catch (error) {
      log("Browse grid overlay failed", error.message);
    } finally {
      browseScanRunning = false;
    }
  }

  // Sell-side watch bookkeeping: remember the player's own listed prices per
  // venue so the watch loop can warn when the Item Market floor undercuts them.
  function recordSellWatch(entries, venue, { prune = true } = {}) {
    if (settings.undercutAlerts === false || !Array.isArray(entries) || !entries.length) return;
    const now = Math.floor(Date.now() / 1000);
    const current = Store.sellWatch();
    const byKey = new Map(current.map((entry) => [`${entry.venue}:${entry.itemId}`, entry]));
    const seen = new Set();
    entries.forEach((entry) => {
      const itemId = asInt(entry.itemId, 0);
      const price = asInt(entry.price, 0);
      if (!itemId || price <= 0) return;
      const key = `${venue}:${itemId}`;
      seen.add(key);
      const previous = byKey.get(key);
      byKey.set(key, {
        itemId,
        venue,
        name: entry.name || previous?.name || `Item ${itemId}`,
        price,
        amount: Math.max(1, asInt(entry.amount, 1)),
        recordedAt: now,
        // A new price resets the alert state; the same price keeps it.
        lastAlertAt: previous && previous.price === price ? previous.lastAlertAt : 0,
        lastFloor: previous && previous.price === price ? previous.lastFloor : null,
        lastCheckedAt: previous?.lastCheckedAt || 0
      });
    });
    // Listings of this venue that are no longer present were sold or removed,
    // unless the caller only saw part of the page.
    const next = Array.from(byKey.values()).filter((entry) => !prune || entry.venue !== venue || seen.has(`${entry.venue}:${entry.itemId}`));
    Store.saveSellWatch(next);
  }

  async function sellWatchTick() {
    if (settings.undercutAlerts === false) return;
    const entries = Store.sellWatch();
    if (!entries.length || !Store.apiKey()) return;
    for (const entry of entries) {
      if (document.visibilityState !== "visible") break;
      try {
        const bundle = await loadSnapshot(entry.itemId, { limit: API_LIST_LIMIT, priority: -60, queueGroup: "watch" });
        const outcome = evaluateSellWatch(entry, bundle.snapshot);
        entry.lastCheckedAt = Math.floor(Date.now() / 1000);
        if (outcome.shouldAlert) {
          entry.lastAlertAt = Math.floor(Date.now() / 1000);
          showToast(`Undercut: <strong>${escapeHtml(entry.name)}</strong> on your ${entry.venue === "IM" ? "Item Market" : "Bazaar"} at ${formatMoney(entry.price)}; the Item Market floor is now ${formatMoney(outcome.floor)} (${outcome.cheaperQuantity.toLocaleString("en-US")} units cheaper). <a href="${itemMarketLink(entry.itemId, entry.name)}">Open market</a>`);
        }
        entry.lastFloor = outcome.floor;
      } catch (error) {
        if (!error?.marketEdgeCanceled) log("Sell watch check failed", entry.itemId, error.message);
      }
    }
    Store.saveSellWatch(entries);
  }

  // Fill every visible Bazaar row (add form or manage view) that carries a
  // Market Edge suggestion. Fields only: Torn's save/add buttons stay manual.
  function fillAllVisiblePrices() {
    let filled = 0;
    document.querySelectorAll(".me-inline-analysis .me-bazaar-fill-btn").forEach((button) => {
      if (!(button instanceof HTMLElement) || !button.isConnected || typeof button.meFill !== "function") return;
      button.meFill();
      filled += 1;
    });
    if (filled) showToast(`Filled ${filled} price field${filled === 1 ? "" : "s"}. Review them, then use Torn's own button to save.`, { timeoutMs: 8000 });
    else showToast("No Market Edge price suggestions with a fill control are visible on this page.", { timeoutMs: 6000 });
    return filled;
  }

  // Portfolio: every owned item through the official API, valued without
  // reading the page. Quick pass from market values, then order-book
  // refinement for the most valuable commodities and uid-based pricing for
  // equipment copies.
  const portfolioState = { rows: [], refining: false, refinedIds: new Set(), loadedAt: 0 };

  function portfolioRowHtml(row) {
    const unit = Number.isFinite(row.unitNet) && row.unitNet > 0 ? formatMoney(row.unitNet) : "-";
    const total = Number.isFinite(row.unitNet) && row.unitNet > 0 ? formatMoney(row.unitNet * row.amount) : "-";
    const flags = [
      row.untradable ? `<span class="me-pill GREY" title="Not tradable">untradable</span>` : "",
      row.equipped ? `<span class="me-pill GREY" title="Currently equipped">equipped</span>` : "",
      row.source === "order book" ? `<span class="me-pill GREEN" title="Valued from the live order book">book</span>` : "",
      row.museum ? `<span class="me-pill YELLOW" title="${escapeHtml(row.museum)}">museum</span>` : ""
    ].filter(Boolean).join(" ");
    const name = `<a href="${itemMarketLink(row.itemId, row.name)}" style="color:inherit">${escapeHtml(row.name)}</a>`;
    return `<tr title="${escapeHtml(row.note || "")}"><td>${name} ${flags}</td><td>${row.amount.toLocaleString("en-US")}</td><td>${unit}</td><td>${escapeHtml(row.route || "-")}</td><td>${total}</td></tr>`;
  }

  function portfolioHtml(rows, { status = "" } = {}) {
    const summary = summarizePortfolio(rows);
    const sorted = rows.slice().sort((a, b) => ((b.unitNet || 0) * b.amount) - ((a.unitNet || 0) * a.amount));
    const routeRows = Object.entries(summary.byRoute).sort((a, b) => b[1] - a[1]).map(([route, value]) => [route, formatMoney(value)]);
    return `
      <div class="me-kicker">Portfolio (official inventory)</div>
      ${metricRows([
        ["Sellable value (net)", `<span title="${formatMoney(summary.total, true)}">${formatMoney(summary.total)}</span>`],
        ["Rows valued / pending", `${summary.valuedRows} / ${summary.unvaluedRows}`],
        ["Untradable / equipped", `${summary.untradable} / ${summary.equipped}`],
        ...routeRows
      ])}
      ${status ? `<div class="me-note me-learning">${escapeHtml(status)}</div>` : ""}
      <table class="me-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Unit net</th><th>Route</th><th>Total</th></tr></thead>
        <tbody>${sorted.slice(0, 80).map(portfolioRowHtml).join("")}</tbody>
      </table>
      ${sorted.length > 80 ? `<div class="me-note">Showing the 80 most valuable rows of ${sorted.length}.</div>` : ""}
      <div class="me-actions">
        <button class="me-btn me-portfolio-refine" type="button" title="Fetch order books for the most valuable stackable items">Refine (${Math.max(1, asInt(settings.portfolioRefineRequests, PORTFOLIO_REFINE_DEFAULT))} requests)</button>
        <button class="me-btn me-portfolio-reload" type="button">Reload inventory</button>
      </div>
      ${panelToolbarHtml()}
      <div class="me-note">Quick values come from Torn's official market value with a ${((clamp(settings.safetyHaircut + 0.02, 0, 0.10)) * 100).toFixed(1)}% haircut and the fee model. Refine replaces them with order-book exits. Weapons and armor are not priced. Torn caches the inventory selection for one hour. Nothing is listed or sold.</div>`;
  }

  async function buildPortfolioRows(items) {
    const ids = Array.from(new Set(items.map((item) => item.itemId)));
    let metadata = new Map();
    for (let index = 0; index < ids.length; index += 100) {
      try {
        const batch = await loadItemMetadataBatch(ids.slice(index, index + 100), { priority: 120 });
        batch.forEach((meta, id) => metadata.set(id, meta));
      } catch (error) {
        log("Portfolio metadata batch failed", error.message);
      }
    }
    let museumContext = new Map();
    try {
      museumContext = await loadMuseumContext(ids, { priority: 100, metadata });
    } catch (error) {
      log("Portfolio museum context unavailable", error.message);
    }
    const rows = [];
    const stackable = new Map();
    items.forEach((item) => {
      const meta = metadata.get(item.itemId) || null;
      const equipment = meta ? !metadataSupportsCommodity(meta) : Boolean(item.uid);
      if (equipment) {
        rows.push({
          key: `uid:${item.uid || item.itemId}:${rows.length}`,
          itemId: item.itemId,
          uid: item.uid,
          name: item.name || meta?.name || `Item ${item.itemId}`,
          amount: item.amount,
          equipped: item.equipped,
          untradable: meta ? meta.isTradable === false : false,
          equipment: true,
          unitNet: null,
          route: "not priced",
          source: "none",
          note: "Weapons and armor are not priced."
        });
        return;
      }
      const existing = stackable.get(item.itemId);
      if (existing) {
        existing.amount += item.amount;
        existing.equipped = existing.equipped || item.equipped;
        return;
      }
      const museum = museumContext.get(item.itemId) || null;
      const shopSell = shopSellFloor(meta);
      const exit = officialExit(meta?.marketPrice, settings);
      const routes = exit ? routeEconomics(exit, 1, settings, { museum, shopSell: shopSell?.price, shopLabel: shopSell?.label }) : null;
      const row = {
        key: `item:${item.itemId}`,
        itemId: item.itemId,
        name: item.name || meta?.name || `Item ${item.itemId}`,
        amount: item.amount,
        equipped: item.equipped,
        untradable: meta ? meta.isTradable === false : false,
        equipment: false,
        marketPrice: asInt(meta?.marketPrice, 0),
        museum: museum?.complete ? `${museum.label}: implied ${formatMoney(museum.impliedValue, true)}` : "",
        shopSell,
        museumValuation: museum,
        unitNet: routes ? routes.bestNetPerUnit : null,
        route: routes ? routes.bestRoute : "-",
        source: "official",
        note: routes ? `Quick value from Torn market value ${formatMoney(meta?.marketPrice, true)}` : "No official market value"
      };
      stackable.set(item.itemId, row);
      rows.push(row);
    });
    return rows;
  }

  async function refinePortfolio(render) {
    if (portfolioState.refining) return;
    portfolioState.refining = true;
    const budget = Math.max(1, asInt(settings.portfolioRefineRequests, PORTFOLIO_REFINE_DEFAULT));
    let used = 0;
    try {
      // Commodities first, most valuable rows first.
      const commodities = portfolioState.rows
        .filter((row) => !row.equipment && !row.untradable && !portfolioState.refinedIds.has(row.itemId) && (row.unitNet || 0) * row.amount > 0)
        .sort((a, b) => ((b.unitNet || 0) * b.amount) - ((a.unitNet || 0) * a.amount));
      for (const row of commodities) {
        if (used >= budget) break;
        try {
          const bundle = await loadSnapshot(row.itemId, { limit: API_LIST_LIMIT, priority: 90, queueGroup: "portfolio" });
          used += bundle.source === "api" ? 1 : 0;
          const estimate = estimateInventoryExit({ quantity: row.amount, snapshot: bundle.snapshot, historyStats: bundle.historyStats, settings, museum: row.museumValuation, shopSell: row.shopSell?.price });
          if (estimate) {
            row.unitNet = estimate.routes.bestNetPerUnit;
            row.route = estimate.routes.bestRoute;
            row.source = "order book";
            row.note = `Order book: floor ${formatMoney(bundle.snapshot.lowestPrice, true)}, anchor ${formatMoney(bundle.snapshot.calculatedMarketAnchor, true)}`;
          }
          portfolioState.refinedIds.add(row.itemId);
        } catch (error) {
          if (error?.marketEdgeCanceled) return;
          log("Portfolio refine failed", row.itemId, error.message);
        }
        render(`Refining... ${used}/${budget} requests used`);
      }
    } finally {
      portfolioState.refining = false;
      render(used >= budget ? `Refine budget reached (${budget}). Press Refine again for more.` : "");
    }
  }

  async function renderPortfolioPanel({ reload = false } = {}) {
    ui.pinned = true;
    ensureUi();
    ui.currentPanel = "portfolio";
    if (!Store.apiKey()) {
      errorPanel("Add a Torn API key to value your inventory.");
      return;
    }
    const keyInfo = Store.keyInfo()?.info || null;
    const allowed = keySupports(keyInfo, { section: "user", selection: "inventory", minimumType: "Minimal Access" });
    if (allowed === false) {
      setPanel(`<div class="me-kicker">Portfolio</div><div class="me-error">This panel needs at least a Minimal access API key (user -> inventory). The current key is ${escapeHtml(keyInfo?.access?.type || "lower access")}.</div>${panelToolbarHtml()}`);
      bindPanelToolbar();
      return;
    }
    const render = (status = "") => {
      if (!ui.root?.isConnected || ui.currentPanel !== "portfolio") return;
      setPanel(portfolioHtml(portfolioState.rows, { status }), "PORTFOLIO");
      ui.body.querySelector(".me-portfolio-refine")?.addEventListener("click", () => refinePortfolio(render));
      ui.body.querySelector(".me-portfolio-reload")?.addEventListener("click", () => renderPortfolioPanel({ reload: true }));
      bindPanelToolbar();
    };
    setPanel(`<div class="me-kicker">Portfolio</div><div class="me-note">Loading your inventory through the official API...</div>`, "API");
    try {
      const items = await loadInventory({ force: reload, priority: 150 });
      if (!items.length) {
        setPanel(`<div class="me-kicker">Portfolio</div><div class="me-note">Torn returned no inventory items for this key.</div>${panelToolbarHtml()}`);
        bindPanelToolbar();
        return;
      }
      portfolioState.rows = await buildPortfolioRows(items);
      portfolioState.refinedIds = new Set();
      portfolioState.loadedAt = Date.now();
      render("Quick values ready. Refine for order-book and per-copy pricing.");
    } catch (error) {
      errorPanel(describeApiError(error, { feature: "The portfolio panel" }).replace("Limited access", "Minimal access"));
      bindPanelToolbar();
    }
  }

  // City shop runs: official stock and prices against market exits.
  async function renderShopRunsPanel({ reload = false } = {}) {
    ui.pinned = true;
    ensureUi();
    ui.currentPanel = "shops";
    if (!Store.apiKey()) {
      errorPanel("Add a Torn API key to price city shop stock.");
      return;
    }
    setPanel(`<div class="me-kicker">City shop runs</div><div class="me-note">Loading shop stock...</div>`, "API");
    try {
      const shops = await loadCityShops({ force: reload, priority: 150 });
      const currentShop = detectSurface() === "cityshop" ? currentCityShopName() : "";
      const scoped = currentShop ? shops.filter((shop) => shop.name === currentShop) : shops;
      const shopItems = (scoped.length ? scoped : shops).flatMap((shop) => shop.items.map((item) => ({ ...item, shopName: shop.name })));
      const ids = Array.from(new Set(shopItems.map((item) => item.itemId)));
      const metadata = new Map();
      for (let index = 0; index < ids.length; index += 100) {
        try {
          (await loadItemMetadataBatch(ids.slice(index, index + 100), { priority: 140 })).forEach((meta, id) => metadata.set(id, meta));
        } catch (error) {
          log("Shop metadata batch failed", error.message);
        }
      }
      let museumContext = new Map();
      try {
        museumContext = await loadMuseumContext(ids, { priority: 120, metadata });
      } catch (error) {
        log("Shop museum context unavailable", error.message);
      }
      const evaluations = shopItems.map((shopItem) => {
        const meta = metadata.get(shopItem.itemId) || null;
        if (!meta || !metadataSupportsCommodity(meta) || meta.isTradable === false) return null;
        const { exit } = bestAvailableExit({ snapshot: Store.snapshot(shopItem.itemId), historyStats: null, marketPrice: meta.marketPrice, settings });
        const evaluation = evaluateShopRun({ shopItem, exit, settings, museum: museumContext.get(shopItem.itemId) || null, shopSell: shopSellFloor(meta) });
        return evaluation ? { ...evaluation, shopName: shopItem.shopName } : null;
      }).filter(Boolean).sort((a, b) => b.expectedProfit - a.expectedProfit);
      const profitable = evaluations.filter((row) => row.profitPerUnit > 0);
      const rows = (profitable.length ? profitable : evaluations.slice(0, 15)).slice(0, 40);
      const qty = Math.max(1, asInt(settings.shopRunQuantity, 100));
      setPanel(`
        <div class="me-kicker">City shop runs${currentShop ? ` - ${escapeHtml(currentShop)}` : ""}</div>
        ${metricRows([
          ["Shops / items scanned", `${(scoped.length ? scoped : shops).length} / ${shopItems.length}`],
          ["Profitable after fees", String(profitable.length)],
          ["Quantity per run", `${qty} (capped by stock)`]
        ])}
        <table class="me-table">
          <thead><tr><th>Item</th><th>Shop</th><th>Buy</th><th>Stock</th><th>Net/unit</th><th>Run</th></tr></thead>
          <tbody>${rows.map((row) => `<tr class="${row.state}" title="Exit via ${escapeHtml(row.routes.bestRoute)}; ROI ${(row.roi * 100).toFixed(1)}%; capital ${formatMoney(row.capitalRequired, true)}">
            <td><a href="${itemMarketLink(row.itemId, row.name)}" style="color:inherit">${escapeHtml(row.name)}</a></td>
            <td>${escapeHtml(row.shopName)}</td>
            <td>${formatMoney(row.buyPrice)}</td>
            <td class="${row.outOfStock ? "me-bad" : ""}">${row.stock.toLocaleString("en-US")}</td>
            <td class="${row.profitPerUnit > 0 ? "me-good" : "me-bad"}">${row.profitPerUnit >= 0 ? "+" : ""}${formatMoney(row.profitPerUnit)}</td>
            <td>${row.expectedProfit >= 0 ? "+" : ""}${formatMoney(row.expectedProfit)} x${row.quantity}</td>
          </tr>`).join("")}</tbody>
        </table>
        <div class="me-actions"><button class="me-btn me-shops-reload" type="button">Refresh stock</button></div>
        ${panelToolbarHtml()}
        <div class="me-note">Stock and prices come from the official city shop endpoint (cached five minutes). Exits use the live order book when Market Edge has seen the item recently, otherwise Torn's market value with an extra haircut. Museum and sell-to-shop routes are included. Buying stays manual.</div>
      `, "SHOPS");
      ui.body.querySelector(".me-shops-reload")?.addEventListener("click", () => renderShopRunsPanel({ reload: true }));
      bindPanelToolbar();
    } catch (error) {
      errorPanel(describeApiError(error, { feature: "The shop runs panel" }));
      bindPanelToolbar();
    }
  }

  // Travel plan: official foreign shop prices ranked by profit per trip.
  async function renderTravelPlanPanel({ reload = false } = {}) {
    ui.pinned = true;
    ensureUi();
    ui.currentPanel = "travel";
    if (!Store.apiKey()) {
      errorPanel("Add a Torn API key to plan a trip.");
      return;
    }
    setPanel(`<div class="me-kicker">Travel plan</div><div class="me-note">Loading foreign shop prices (one catalog request, cached six hours)...</div>`, "API");
    try {
      const catalog = await loadForeignCatalog({ force: reload, priority: 150 });
      const offers = foreignOffers(catalog).filter((offer) => offer.isTradable);
      if (!offers.length) {
        setPanel(`<div class="me-kicker">Travel plan</div><div class="me-note">No foreign shop prices were returned by the item catalog.</div>${panelToolbarHtml()}`);
        bindPanelToolbar();
        return;
      }
      const metaById = new Map(catalog.map((meta) => [meta.id, meta]));
      let museumContext = new Map();
      try {
        museumContext = await loadMuseumContext(Array.from(new Set(offers.map((offer) => offer.itemId))), { priority: 120, metadata: metaById });
      } catch (error) {
        log("Travel museum context unavailable", error.message);
      }
      const capacity = Math.max(0, asInt(settings.travelCapacity, 0));
      const evaluations = offers.map((offer) => {
        const meta = metaById.get(offer.itemId);
        if (meta && isEquipmentType(meta.type)) return null;
        const { exit } = bestAvailableExit({ snapshot: Store.snapshot(offer.itemId), historyStats: null, marketPrice: offer.marketPrice, settings });
        return evaluateForeignOffer({ offer, exit, settings, capacity, museum: museumContext.get(offer.itemId) || null, shopSell: shopSellFloor(meta) });
      }).filter(Boolean);
      const plan = rankTravelPlan(evaluations, { perCountry: 4 });
      const countryHtml = plan.map((entry) => `
        <div class="me-kicker" style="margin-top:8px">${escapeHtml(entry.country)} - best ${escapeHtml(entry.best.name)} ${entry.best.profitPerUnit >= 0 ? "+" : ""}${formatMoney(entry.best.profitPerUnit)} ea${capacity ? `, ${formatMoney(entry.best.perTrip)} per trip` : ""}</div>
        <table class="me-table"><tbody>${entry.rows.map((row) => `<tr class="${row.state}" title="Exit via ${escapeHtml(row.routes.bestRoute)}; ROI ${(row.roi * 100).toFixed(1)}%${capacity ? `; cash needed ${formatMoney(row.cashNeeded, true)}` : ""}">
          <td><a href="${itemMarketLink(row.itemId, row.name)}" style="color:inherit">${escapeHtml(row.name)}</a></td>
          <td>${escapeHtml(row.shop || "")}</td>
          <td>${formatMoney(row.buyPrice)}</td>
          <td class="${row.profitPerUnit > 0 ? "me-good" : ""}">${row.profitPerUnit >= 0 ? "+" : ""}${formatMoney(row.profitPerUnit)} ea</td>
          ${capacity ? `<td>${formatMoney(row.perTrip)}</td>` : ""}
        </tr>`).join("")}</tbody></table>`).join("");
      setPanel(`
        <div class="me-kicker">Travel plan (official prices)</div>
        ${metricRows([
          ["Countries with profitable stock", String(plan.length)],
          ["Capacity used", capacity ? `${capacity} items per trip` : "not set (per-item only)"],
          ["Offers evaluated", String(evaluations.length)]
        ])}
        ${countryHtml || `<div class="me-note">No foreign offer beats the market after fees right now.</div>`}
        <div class="me-actions"><button class="me-btn me-travel-reload" type="button">Refresh catalog</button></div>
        ${panelToolbarHtml()}
        <div class="me-note">Prices are Torn's official shop prices per country; the official API has no foreign stock, so an item may be sold out or repriced abroad (Patch #413 varies drug and contraband prices). Set your travel capacity in settings for per-trip totals. Exits use recent order books when available, otherwise Torn's market value with an extra haircut.</div>
      `, "TRAVEL");
      ui.body.querySelector(".me-travel-reload")?.addEventListener("click", () => renderTravelPlanPanel({ reload: true }));
      bindPanelToolbar();
    } catch (error) {
      errorPanel(describeApiError(error, { feature: "The travel plan" }));
      bindPanelToolbar();
    }
  }

  function describeNode(node) {
    if (!(node instanceof Element)) return String(node?.nodeName || "?");
    const id = node.id ? `#${node.id}` : "";
    const classes = String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 4).map((name) => `.${name}`).join("");
    const data = Array.from(node.attributes || []).filter((attr) => (attr.name.startsWith("data-") || /id$/i.test(attr.name)) && !attr.name.startsWith("data-me") && attr.name !== "id").slice(0, 8).map((attr) => `[${attr.name}=${String(attr.value).slice(0, 20)}]`).join("");
    const text = (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `${node.tagName.toLowerCase()}${id}${classes}${data} (${node.childElementCount} children) "${text}"`;
  }

  function ancestorChain(node, depth = 10) {
    const chain = [];
    for (let current = node, level = 0; current && current !== document.body && level < depth; level += 1, current = current.parentElement) {
      chain.push(`${"  ".repeat(level)}${describeNode(current)}`);
    }
    return chain.join("\n");
  }

  // Structure report for bug reports: what the script sees around item rows
  // and expanded details on the current page. Contains no API key.
  // Runtime self-check: the last scans (surface, rows found, rows annotated,
  // duration) and any error raised by this script, kept in memory so the
  // page structure report can show how each surface actually behaved.
  const RUNTIME_LOG_MAX = 40;
  const runtimeLog = [];
  const runtimeStats = { scans: 0, errors: 0, startedAt: Date.now() };

  function recordRuntime(kind, message, extra = null) {
    runtimeLog.push({ at: Date.now(), kind, message: String(message || "").slice(0, 300), extra });
    if (runtimeLog.length > RUNTIME_LOG_MAX) runtimeLog.splice(0, runtimeLog.length - RUNTIME_LOG_MAX);
    if (kind === "error") runtimeStats.errors += 1;
    if (kind === "scan") runtimeStats.scans += 1;
  }

  function isOwnError(source, stack) {
    return /market.?edge/i.test(`${source || ""} ${stack || ""}`);
  }

  window.addEventListener("error", (event) => {
    try {
      const stack = event?.error?.stack || "";
      if (!isOwnError(event?.filename, stack)) return;
      recordRuntime("error", `${event.message} @ ${String(event.filename || "").split("/").pop()}:${event.lineno}`);
    } catch {
      // never throw from the error handler
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event?.reason;
      if (reason?.marketEdgeCanceled) return;
      if (!isOwnError("", reason?.stack || "")) return;
      recordRuntime("error", `unhandled: ${reason?.message || reason}`);
    } catch {
      // ignore
    }
  });

  // Are the overlays actually visible? An overlay is counted as clipped when
  // an ancestor with overflow hidden/clip/auto/scroll does not contain its
  // box, and as zero-size when layout gave it no box at all.
  function overlayVisibilityLine() {
    const overlays = Array.from(document.querySelectorAll(".me-inline-analysis:not(.me-hidden)"));
    if (!overlays.length) return "overlay visibility: none rendered";
    let visible = 0;
    let zero = 0;
    let clipped = 0;
    let offscreen = 0;
    const samples = [];
    overlays.slice(0, 80).forEach((overlay) => {
      const rect = overlay.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        zero += 1;
        if (samples.length < 2) samples.push(`zero-size in ${describeNode(overlay.parentElement)}`);
        return;
      }
      let clippedBy = null;
      for (let node = overlay.parentElement, depth = 0; node && node !== document.body && depth < 12; depth += 1, node = node.parentElement) {
        let overflow = "";
        try {
          const style = window.getComputedStyle(node);
          overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
        } catch {
          overflow = "";
        }
        if (!/hidden|clip|auto|scroll/.test(overflow)) continue;
        const box = node.getBoundingClientRect();
        if (rect.left >= box.right - 1 || rect.right <= box.left + 1 || rect.top >= box.bottom - 1 || rect.bottom <= box.top + 1) {
          clippedBy = node;
          break;
        }
      }
      if (clippedBy) {
        clipped += 1;
        if (samples.length < 2) samples.push(`clipped by ${describeNode(clippedBy)}`);
        return;
      }
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      if (rect.right <= 0 || rect.left >= viewportWidth) {
        offscreen += 1;
        return;
      }
      visible += 1;
    });
    const checked = Math.min(overlays.length, 80);
    return `overlay visibility: ${visible}/${checked} visible, ${clipped} clipped, ${zero} zero-size, ${offscreen} off-screen horizontally${samples.length ? ` (${samples.join("; ")})` : ""}`;
  }

  function runtimeReportLines() {
    const surfaces = {};
    runtimeLog.filter((entry) => entry.kind === "scan" && entry.extra).forEach((entry) => {
      const key = entry.extra.surface;
      if (!surfaces[key]) surfaces[key] = { scans: 0, rows: 0, annotated: 0, ms: 0, worstMs: 0 };
      const bucket = surfaces[key];
      bucket.scans += 1;
      bucket.rows = entry.extra.rows;
      bucket.annotated = entry.extra.annotated;
      bucket.ms += entry.extra.ms;
      bucket.worstMs = Math.max(bucket.worstMs, entry.extra.ms);
    });
    const lines = [`runtime: ${runtimeStats.scans} scans, ${runtimeStats.errors} script errors since load (${formatAge(Math.floor((Date.now() - runtimeStats.startedAt) / 1000))} ago)`];
    Object.entries(surfaces).forEach(([surface, bucket]) => {
      lines.push(`  ${surface}: ${bucket.scans} scans, last pass ${bucket.annotated}/${bucket.rows} rows annotated, avg ${Math.round(bucket.ms / bucket.scans)} ms, worst ${bucket.worstMs} ms`);
    });
    lines.push(`overlays on page: ${document.querySelectorAll(".me-inline-analysis").length} (${document.querySelectorAll(".me-inline-analysis.RED").length} errors)`);
    lines.push(overlayVisibilityLine());
    lines.push(`queue: ${api.scheduler.queue.length} waiting, ${api.scheduler.active} in flight, ${api.scheduler.requestTimes.length} requests in the last minute`);
    runtimeLog.filter((entry) => entry.kind !== "scan").slice(-12).forEach((entry) => {
      lines.push(`  [${entry.kind}] ${formatAge(Math.floor((Date.now() - entry.at) / 1000))} ago: ${entry.message}`);
    });
    return lines;
  }

  function buildPageDiagnostics() {
    const surface = detectSurface();
    const lines = [`Market Edge ${APP.version} page structure`, `surface: ${surface}`, `path: ${location.pathname}${location.hash ? ` hash: ${location.hash.slice(0, 60)}` : ""}`, `pda: ${ENV.isPda}`, ""];
    try {
      lines.push(...runtimeReportLines(), "");
    } catch (error) {
      lines.push(`runtime report failed: ${error.message}`, "");
    }
    try {
      lines.push(`api key present: ${Boolean(Store.apiKey())}`);
      const rows = surface === "bazaar" ? collectBazaarAddItems() : (surface === "imsell" ? collectSellFormRows() : collectVisibleItems({ requireMoney: surface !== "inventory" }));
      lines.push("", `rows collected: ${rows.length}`);
      rows.slice(0, 3).forEach((item, index) => {
        lines.push(`--- row ${index + 1}: item ${item.itemId} "${item.name}" qty ${item.quantity}`);
        lines.push(ancestorChain(item.card, 6));
        lines.push(`row children: ${Array.from(item.card.children || []).slice(0, 8).map((child) => describeNode(child)).join(" | ")}`);
        const overlay = item.card.querySelector(".me-inline-analysis");
        if (overlay) lines.push(`row overlay parent: ${describeNode(overlay.parentElement)} text: ${(overlay.textContent || "").slice(0, 80)}`);
      });
    } catch (error) {
      lines.push(`report failed: ${error.message}`);
    }
    return lines.join("\n");
  }


  // ---------------------------------------------------------------------------
  // Own Item Market listings panel (Limited access key)
  // ---------------------------------------------------------------------------

  function ownListingRowHtml(listing, evaluation) {
    const name = escapeHtml(listing.name);
    const anonymous = listing.anonymous ? ` <span class="me-pill GREY" title="Anonymous listing: +10% fee">anon</span>` : "";
    if (!evaluation) {
      return `<tr><td>${name}${anonymous}</td><td>${listing.amount}</td><td>${formatMoney(listing.price)}</td><td colspan="3" class="me-inline-secondary">loading...</td></tr>`;
    }
    if (evaluation.equipment) {
      return `<tr><td>${name}${anonymous}</td><td>${listing.amount}</td><td>${formatMoney(listing.price)}</td><td colspan="3">equipment: see item page</td></tr>`;
    }
    const stateClass = evaluation.status === "UNDERCUT" ? "RED" : evaluation.status === "CLOSE" ? "YELLOW" : evaluation.status === "CHEAPEST" ? "GREEN" : "GREY";
    const floor = evaluation.floor ? formatMoney(evaluation.floor) : "-";
    const ahead = evaluation.status === "CHEAPEST" ? "0" : `${evaluation.cheaperQuantity.toLocaleString("en-US")}`;
    const versus = Number.isFinite(evaluation.versusAverage) ? `${evaluation.versusAverage >= 0 ? "+" : ""}${(evaluation.versusAverage * 100).toFixed(1)}%` : "-";
    const title = [
      `Net after ${evaluation.feeBps / 100}% fees: ${formatMoney(evaluation.net, true)}`,
      `Versus Torn daily average: ${versus}`,
      evaluation.note
    ].filter(Boolean).join("\n");
    // Repricing workbench: the item's rule decides which suggestion is filled.
    const rule = Store.pricingRules()[listing.itemId] || null;
    const fill = applyPricingRule({ rule, floorSuggestion: evaluation.suggestedPrice, anchorSuggestion: evaluation.anchorPrice || null });
    const fillText = fill.price ? formatMoney(fill.price) : (fill.reason === "held by rule" ? "hold" : "-");
    const fillTitle = fill.price
      ? `Fill Torn's price field for this listing with ${formatMoney(fill.price, true)} (${fill.mode}${fill.clamped ? ", raised to your minimum" : ""}). Saving stays manual.`
      : `No fill: ${fill.reason}`;
    const alreadyThere = fill.price && fill.price === listing.price;
    return `<tr class="${stateClass}" data-listing-id="${listing.listingId}" data-item-id="${listing.itemId}" title="${escapeHtml(title)}">
      <td>${name}${anonymous}</td>
      <td>${listing.amount}</td>
      <td>${formatMoney(listing.price)}</td>
      <td title="Cheapest listing on the Item Market">${floor}</td>
      <td title="Units listed cheaper than yours">${ahead}</td>
      <td><span class="me-pill ${stateClass}">${evaluation.status}</span></td>
      <td class="me-workbench-cell">
        <span class="me-inline-secondary" title="${escapeHtml(fillTitle)}">${fillText}</span>
        ${fill.price && !alreadyThere ? `<button class="me-btn me-listing-fill" type="button" data-price="${fill.price}" title="${escapeHtml(fillTitle)}">^</button>` : ""}
        <select class="me-inline-input me-rule-mode" title="Pricing rule for this item">
          <option value="undercut" ${(rule?.mode || "undercut") === "undercut" ? "selected" : ""}>undercut floor</option>
          <option value="anchor" ${rule?.mode === "anchor" ? "selected" : ""}>hold anchor</option>
          <option value="hold" ${rule?.mode === "hold" ? "selected" : ""}>never fill</option>
        </select>
        <input class="me-inline-input me-rule-min" type="number" min="0" placeholder="min $" title="Never fill below this price" value="${rule?.minPrice || ""}">
      </td>
    </tr>`;
  }

  function ownListingsHtml(listings, evaluations) {
    const evaluated = listings.map((listing) => evaluations.get(listing.listingId)).filter((row) => row && !row.equipment);
    const gross = listings.reduce((sum, listing) => sum + listing.price * Math.max(1, listing.amount), 0);
    const net = evaluated.reduce((sum, row) => sum + row.net, 0);
    const undercut = evaluated.filter((row) => row.status === "UNDERCUT").length;
    const close = evaluated.filter((row) => row.status === "CLOSE").length;
    const cheapest = evaluated.filter((row) => row.status === "CHEAPEST").length;
    return `
      <div class="me-kicker">Your Item Market listings</div>
      ${metricRows([
        ["Active listings", String(listings.length)],
        ["Listed value", formatMoney(gross)],
        ["Net if all sold at your prices", evaluated.length ? formatMoney(net) : "-"],
        ["Cheapest / close / undercut", `${cheapest} / ${close} / ${undercut}`]
      ])}
      <table class="me-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Yours</th><th>Floor</th><th>Ahead</th><th>Status</th><th>Fill / rule</th></tr></thead>
        <tbody>${listings.map((listing) => ownListingRowHtml(listing, evaluations.get(listing.listingId))).join("")}</tbody>
      </table>
      <div class="me-actions">
        <button class="me-btn me-refresh-listings" type="button">Refresh</button>
        <button class="me-btn me-fill-all-listings" type="button" title="Fill every matching price field Torn shows on this page (fields only; saving stays manual)">Fill all on page</button>
      </div>
      <div class="me-note me-workbench-status"></div>
      ${panelToolbarHtml()}
      <div class="me-note">Floor comes from the official Item Market order book. "Ahead" counts units listed below your price. Fill values are floor minus your configured undercut (or the anchor target, per the item's rule) and are written into Torn's price fields only when you press ^ or "Fill all"; Torn's save button stays manual. Rules persist per item. Anonymous listings pay 15% total in fees${settings.anonymousFeeWaived ? " (waived by your company perk)" : ""}. ${settings.undercutAlerts !== false ? "These listings are watched for undercuts while a Torn tab is visible." : ""}</div>`;
  }

  // Fill Torn's price field for one own listing when the page shows it.
  function fillOwnListingOnPage(itemId, price) {
    const rows = collectOwnListingRows().filter((row) => row.itemId === asInt(itemId));
    if (!rows.length) return { filled: 0, reason: "This listing's price field is not on the current page (open your listings in Torn's manage view)." };
    let filled = 0;
    rows.forEach((row) => { if (setBazaarInputValue(row.priceInput, price)) filled += 1; });
    return { filled, reason: filled ? "" : "Torn's price field rejected the value." };
  }

  function bindOwnListingsWorkbench(listings, evaluations, rerender) {
    const body = ui.body;
    if (!body) return;
    const status = body.querySelector(".me-workbench-status");
    const setStatus = (text) => { if (status) status.textContent = text; };
    body.querySelectorAll(".me-listing-fill").forEach((button) => {
      button.addEventListener("click", () => {
        const row = button.closest("tr");
        const outcome = fillOwnListingOnPage(row?.dataset?.itemId, asInt(button.dataset.price, 0));
        setStatus(outcome.filled ? `Filled ${outcome.filled} field(s) with ${formatMoney(asInt(button.dataset.price, 0), true)}. Save in Torn when ready.` : outcome.reason);
      });
    });
    body.querySelector(".me-fill-all-listings")?.addEventListener("click", () => {
      let filled = 0;
      let missing = 0;
      body.querySelectorAll(".me-listing-fill").forEach((button) => {
        const row = button.closest("tr");
        const outcome = fillOwnListingOnPage(row?.dataset?.itemId, asInt(button.dataset.price, 0));
        if (outcome.filled) filled += outcome.filled;
        else missing += 1;
      });
      setStatus(`Filled ${filled} field(s)${missing ? `; ${missing} listing(s) not found on this page` : ""}. Save in Torn when ready.`);
    });
    const saveRule = (row) => {
      const itemId = asInt(row?.dataset?.itemId, 0);
      if (!itemId) return;
      const mode = row.querySelector(".me-rule-mode")?.value || "undercut";
      const minPrice = asInt(row.querySelector(".me-rule-min")?.value, 0);
      Store.savePricingRule(itemId, mode === "undercut" && !minPrice ? null : { mode, minPrice });
      rerender();
    };
    body.querySelectorAll(".me-rule-mode").forEach((select) => select.addEventListener("change", () => saveRule(select.closest("tr"))));
    body.querySelectorAll(".me-rule-min").forEach((input) => input.addEventListener("change", () => saveRule(input.closest("tr"))));
  }

  async function renderOwnListingsPanel({ force = false } = {}) {
    ui.pinned = true;
    ensureUi();
    if (!Store.apiKey()) {
      errorPanel("Add a Torn API key to compare your listings.");
      return;
    }
    const keyInfo = Store.keyInfo()?.info || null;
    const allowed = keySupports(keyInfo, { section: "user", selection: "itemmarket", minimumType: "Limited Access" });
    if (allowed === false) {
      setPanel(`<div class="me-kicker">Your Item Market listings</div><div class="me-error">This panel needs a Limited access API key. The current key is ${escapeHtml(keyInfo?.access?.type || "lower access")}. Create a Limited key in Torn API settings and test it in Market Edge settings.</div>${panelToolbarHtml()}`);
      bindPanelToolbar();
      return;
    }

    setPanel(`<div class="me-kicker">Your Item Market listings</div><div class="me-note">Loading your listings...</div>`, "API");
    try {
      if (force) api.memoryCache.delete("/user/itemmarket");
      const payload = await api.ownListings({ priority: 200 });
      const listings = normalizeOwnListings(payload).slice(0, OWN_LISTINGS_MAX);
      const evaluations = new Map();
      const render = () => {
        if (!ui.root?.isConnected) return;
        setPanel(ownListingsHtml(listings, evaluations), "LISTINGS");
        ui.body.querySelector(".me-refresh-listings")?.addEventListener("click", () => renderOwnListingsPanel({ force: true }));
        bindOwnListingsWorkbench(listings, evaluations, render);
        bindPanelToolbar();
      };
      // Own Item Market prices feed the sell-side (undercut) watch.
      recordSellWatch(listings.filter((listing) => !listing.equipment).map((listing) => ({ itemId: listing.itemId, name: listing.name, price: listing.price, amount: listing.amount, venue: "IM" })), "IM", { prune: listings.length < OWN_LISTINGS_MAX });
      if (!listings.length) {
        setPanel(`<div class="me-kicker">Your Item Market listings</div><div class="me-note">No active Item Market listings were returned for this key.</div>${panelToolbarHtml()}`);
        bindPanelToolbar();
        return;
      }
      render();

      await Promise.allSettled(listings.map(async (listing, index) => {
        if (listing.equipment) {
          evaluations.set(listing.listingId, { equipment: true });
          render();
          return;
        }
        try {
          const bundle = await loadSnapshot(listing.itemId, { limit: API_LIST_LIMIT, priority: 150 - index, queueGroup: "listings" });
          const evaluation = evaluateOwnListing(listing, bundle.snapshot, settings);
          const exit = calculateExit({ snapshot: bundle.snapshot, historyStats: bundle.historyStats, settings });
          evaluation.anchorPrice = exit?.itemMarketSuggestedPrice || null;
          evaluations.set(listing.listingId, evaluation);
        } catch (error) {
          evaluations.set(listing.listingId, { status: "ERROR", floor: null, cheaperQuantity: 0, net: 0, feeBps: ITEM_MARKET_FEE_BPS, note: error.message, suggestedPrice: null, versusAverage: null });
        }
        render();
      }));
    } catch (error) {
      errorPanel(describeApiError(error, { feature: "The own listings panel" }));
      bindPanelToolbar();
    }
  }

  // ---------------------------------------------------------------------------
  // Watchlist: API-only polling while a Torn tab is visible, in-page alerts
  // ---------------------------------------------------------------------------

  let watchTimer = null;
  let watchLastPollAt = 0;
  let watchRunning = false;
  let toastHost = null;
  const originalTitle = document.title;

  function addWatchItem({ itemId, name, target }) {
    const id = asInt(itemId, 0);
    const price = asInt(target, 0);
    if (!id || price <= 0) return false;
    const entries = Store.watchlist().filter((entry) => entry.itemId !== id);
    entries.push({ itemId: id, name: String(name || `Item ${id}`), target: price, addedAt: Math.floor(Date.now() / 1000) });
    Store.saveWatchlist(entries);
    return true;
  }

  function showToast(html, { timeoutMs = 25000 } = {}) {
    if (!toastHost?.isConnected) {
      toastHost = document.createElement("div");
      toastHost.className = "me-toast-host";
      document.body.appendChild(toastHost);
    }
    const toast = document.createElement("div");
    toast.className = "me-toast";
    toast.innerHTML = `<span class="me-toast-close" role="button" aria-label="Dismiss">X</span>${html}`;
    toast.querySelector(".me-toast-close").addEventListener("click", () => toast.remove());
    toastHost.appendChild(toast);
    if (timeoutMs > 0) setTimeout(() => toast.remove(), timeoutMs);
    if (!document.title.startsWith("[ME] ")) document.title = `[ME] ${originalTitle}`;
    const resetTitle = () => {
      if (document.visibilityState === "visible") {
        document.title = originalTitle;
        document.removeEventListener("visibilitychange", resetTitle);
      }
    };
    setTimeout(() => document.addEventListener("visibilitychange", resetTitle), 0);
    return toast;
  }

  async function watchTick({ force = false } = {}) {
    if (!settings.watchlistEnabled || watchRunning) return;
    if (document.visibilityState !== "visible") return;
    const entries = Store.watchlist();
    if (!Store.apiKey()) return;
    if (!entries.length && (settings.undercutAlerts === false || !Store.sellWatch().length)) return;
    const intervalMs = Math.max(WATCHLIST_MIN_INTERVAL_SEC, asInt(settings.watchlistIntervalSeconds, DEFAULTS.watchlistIntervalSeconds)) * 1000;
    if (!force && Date.now() - watchLastPollAt < intervalMs) return;
    watchLastPollAt = Date.now();
    watchRunning = true;
    try {
      for (const entry of entries) {
        if (document.visibilityState !== "visible") break;
        try {
          const bundle = await loadSnapshot(entry.itemId, { limit: API_LIST_LIMIT, priority: -50, queueGroup: "watch" });
          const outcome = evaluateWatchItem(entry, bundle.snapshot);
          entry.lastCheckedAt = Math.floor(Date.now() / 1000);
          if (outcome.shouldAlert) {
            entry.lastAlertAt = Math.floor(Date.now() / 1000);
            showToast(`<strong>${escapeHtml(entry.name)}</strong> is ${formatMoney(outcome.floor)} on the Item Market (target ${formatMoney(entry.target)}, ${outcome.quantityAtOrBelow.toLocaleString("en-US")} units at or below). <a href="${itemMarketLink(entry.itemId, entry.name)}">Open listing</a>`);
          }
          entry.lastFloor = outcome.floor;
        } catch (error) {
          if (!error?.marketEdgeCanceled) log("Watchlist check failed", entry.itemId, error.message);
        }
      }
      Store.saveWatchlist(entries);
      if (ui.currentPanel === "watchlist" && ui.root?.isConnected) renderWatchlistPanel({ refresh: false });
      await sellWatchTick();
    } finally {
      watchRunning = false;
    }
  }

  function startWatchlist() {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = setInterval(() => { watchTick().catch((error) => log("Watchlist tick failed", error.message)); }, 15000);
    setTimeout(() => { watchTick().catch(() => {}); }, 4000);
  }

  function restartWatchlist() {
    watchLastPollAt = 0;
    startWatchlist();
  }

  function renderWatchlistPanel({ refresh = false } = {}) {
    ui.pinned = true;
    ensureUi();
    ui.currentPanel = "watchlist";
    const entries = Store.watchlist();
    const intervalSec = Math.max(WATCHLIST_MIN_INTERVAL_SEC, asInt(settings.watchlistIntervalSeconds, DEFAULTS.watchlistIntervalSeconds));
    const rows = entries.map((entry) => {
      const hit = entry.lastFloor && entry.lastFloor <= entry.target;
      return `<div class="me-watch-row" data-item-id="${entry.itemId}">
        <span class="me-watch-name"><a href="${itemMarketLink(entry.itemId, entry.name)}" style="color:inherit">${escapeHtml(entry.name)}</a></span>
        <span title="Alert target">&le; ${formatMoney(entry.target)}</span>
        <span class="${hit ? "me-good" : "me-inline-secondary"}" title="Last observed floor">${entry.lastFloor ? formatMoney(entry.lastFloor) : "-"}</span>
        <span class="me-inline-secondary" title="Last checked">${entry.lastCheckedAt ? formatAge(Math.floor(Date.now() / 1000 - entry.lastCheckedAt)) : "never"}</span>
        <span class="me-watch-remove" role="button" title="Remove">X</span>
      </div>`;
    }).join("");
    const sellEntries = Store.sellWatch();
    const sellRows = sellEntries.map((entry) => {
      const undercut = entry.lastFloor && entry.lastFloor < entry.price;
      return `<div class="me-watch-row" data-sell-key="${entry.venue}:${entry.itemId}">
        <span class="me-watch-name"><a href="${itemMarketLink(entry.itemId, entry.name)}" style="color:inherit">${escapeHtml(entry.name)}</a> <span class="me-inline-secondary">${entry.venue}</span></span>
        <span title="Your listed price">${formatMoney(entry.price)}</span>
        <span class="${undercut ? "me-bad" : "me-inline-secondary"}" title="Last observed Item Market floor">${entry.lastFloor ? formatMoney(entry.lastFloor) : "-"}</span>
        <span class="me-inline-secondary" title="Last checked">${entry.lastCheckedAt ? formatAge(Math.floor(Date.now() / 1000 - entry.lastCheckedAt)) : "never"}</span>
        <span class="me-watch-remove me-sell-remove" role="button" title="Stop watching">X</span>
      </div>`;
    }).join("");
    setPanel(`
      <div class="me-kicker">Watchlist ${settings.watchlistEnabled ? `- every ${intervalSec}s while visible` : "- disabled in settings"}</div>
      ${entries.length ? rows : `<div class="me-note">No watched items. Open an Item Market item and press Watch, or add an item ID in settings.</div>`}
      <div class="me-kicker" style="margin-top:8px">Your listings (undercut alerts${settings.undercutAlerts === false ? " - disabled in settings" : ""})</div>
      ${sellEntries.length ? sellRows : `<div class="me-note">Open "My listings" or your Bazaar to record your listed prices; you are then warned when the Item Market floor drops below them.</div>`}
      <div class="me-actions"><button class="me-btn me-watch-check" type="button">Check now</button></div>
      ${panelToolbarHtml()}
      <div class="me-note">Polling only happens while a Torn tab is visible, uses the official Item Market API, and respects Torn's cache delay. Alerts are in-page only. Market Edge never buys.</div>
    `, "WATCH");
    ui.body.querySelectorAll(".me-watch-remove").forEach((button) => {
      button.addEventListener("click", () => {
        const itemId = asInt(button.closest(".me-watch-row")?.dataset?.itemId, 0);
        Store.saveWatchlist(Store.watchlist().filter((entry) => entry.itemId !== itemId));
        renderWatchlistPanel();
      });
    });
    ui.body.querySelectorAll(".me-sell-remove").forEach((button) => {
      button.addEventListener("click", () => {
        const key = String(button.closest(".me-watch-row")?.dataset?.sellKey || "");
        Store.saveSellWatch(Store.sellWatch().filter((entry) => `${entry.venue}:${entry.itemId}` !== key));
        renderWatchlistPanel();
      });
    });
    ui.body.querySelector(".me-watch-check")?.addEventListener("click", async () => {
      await watchTick({ force: true });
      renderWatchlistPanel();
    });
    bindPanelToolbar();
    if (refresh) watchTick({ force: true }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // On-page launcher for environments without a userscript menu (Torn PDA)
  // ---------------------------------------------------------------------------

  let launcher = null;

  function ensureLauncher() {
    if (launcher?.isConnected) return launcher;
    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "me-launcher";
    launcher.textContent = "ME";
    launcher.title = "Market Edge";
    launcher.addEventListener("click", () => {
      const existing = document.querySelector(".me-launcher-menu");
      if (existing) {
        existing.remove();
        return;
      }
      const menu = document.createElement("div");
      menu.className = "me-toast me-launcher-menu";
      menu.style.position = "fixed";
      menu.style.left = "10px";
      menu.style.bottom = "44px";
      menu.style.zIndex = "999999";
      menu.innerHTML = `<div class="me-actions" style="margin:0">
        <button class="me-btn" data-action="settings" type="button">Settings</button>
        <button class="me-btn" data-action="analyze" type="button">Analyze page</button>
        <button class="me-btn" data-action="listings" type="button">My listings</button>
        <button class="me-btn" data-action="watchlist" type="button">Watchlist</button>
        <button class="me-btn" data-action="portfolio" type="button">Portfolio</button>
        <button class="me-btn" data-action="shops" type="button">Shops</button>
        <button class="me-btn" data-action="travel" type="button">Travel</button>
        <button class="me-btn" data-action="fill" type="button">Fill all prices</button>
      </div>`;
      menu.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", () => {
          menu.remove();
          const action = button.dataset.action;
          if (action === "settings") showSettings();
          else if (action === "analyze") analyzeCurrentPage();
          else if (action === "listings") renderOwnListingsPanel();
          else if (action === "watchlist") renderWatchlistPanel();
          else if (action === "portfolio") renderPortfolioPanel();
          else if (action === "shops") renderShopRunsPanel();
          else if (action === "travel") renderTravelPlanPanel();
          else if (action === "fill") fillAllVisiblePrices();
        });
      });
      document.body.appendChild(menu);
    });
    document.body.appendChild(launcher);
    return launcher;
  }

  // ---------------------------------------------------------------------------
  // Initialization, SPA navigation and compliance-safe observation
  // ---------------------------------------------------------------------------

  let refreshTimer = null;
  let signatureTimer = null;
  let lastLocationKey = "";
  let lastListSignature = "";
  const listRowIds = new WeakMap();
  let nextListRowId = 1;

  function listRowIdentity(card) {
    if (!card || (typeof card !== "object" && typeof card !== "function")) return 0;
    if (!listRowIds.has(card)) listRowIds.set(card, nextListRowId++);
    return listRowIds.get(card);
  }

  function scheduleRefresh(force = false) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(force), 160);
  }

  const LIST_SURFACES = Object.freeze(["bazaar", "auction", "travel", "inventory", "cityshop", "imsell"]);

  function listSurfaceSignature(surface) {
    if (!LIST_SURFACES.includes(surface)) return "";
    const entries = new Set();
    const marker = surface === "inventory" ? inventoryListMarker() : null;
    if (surface === "bazaar") {
      const addSection = bazaarAddSection();
      knownBazaarAddRows(addSection).forEach((card) => {
        const image = card.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']");
        const itemId = itemIdFromElement(image || card);
        if (itemId) entries.add(`${itemId}@${listRowIdentity(card)}`);
      });
    }
    // The signature only needs to notice structural change, so it works on
    // the identity nodes themselves; row/card resolution (which reads
    // innerText and forces layout) is left to the scan.
    document.querySelectorAll(itemIdentitySelector()).forEach((node) => {
      if (node.closest?.("#market-edge-root,.me-inline-analysis")) return;
      const itemId = itemIdFromElement(node);
      if (!itemId) return;
      entries.add(`${itemId}@${listRowIdentity(node)}`);
    });
    const structuralEntries = Array.from(entries).sort();
    const heading = surface === "inventory"
      ? String(marker?.textContent || "").replace(/\s+/g, " ").trim()
      : "";
    return `${surface}|${heading}|${structuralEntries.join(",")}`;
  }

  let signatureDelayMs = 200;

  function scheduleSignatureCheck(forceScan = false) {
    clearTimeout(signatureTimer);
    signatureTimer = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const surface = detectSurface();
      if (surface === "itemmarket" && !getItemIdFromLocation() && settings.browseOverlayEnabled !== false) {
        // Browse grid: new cards appear on scroll/category change.
        scanBrowseGrid({ force: false });
        return;
      }
      if (!LIST_SURFACES.includes(surface)) return;
      const startedAt = Date.now();
      let signature = "";
      try {
        signature = listSurfaceSignature(surface);
      } catch (error) {
        log("Signature check failed", error?.message || error);
        recordRuntime("error", `signature ${surface}: ${error?.message || error}`);
        return;
      }
      // Adapt the quiet period to how long the check itself took, so a slow
      // phone under a React re-render storm is not asked to do it again
      // before it has caught up.
      const took = Date.now() - startedAt;
      signatureDelayMs = clamp(Math.round(took * 5), 200, 2500);
      if (!signature) return;
      if (forceScan || signature !== lastListSignature) {
        lastListSignature = signature;
        scanVisibleSurface(surface, { retryIfEmpty: false, force: false, cancelObsolete: true });
      }
    }, signatureDelayMs);
  }

  async function refresh(force = false) {
    if (document.visibilityState !== "visible") return;
    const surface = detectSurface();
    const locationKey = `${surface}|${location.pathname}|${location.search}|${location.hash}`;
    const locationChanged = locationKey !== lastLocationKey || ui.currentSurface !== surface;
    if (!force && !locationChanged) {
      if (LIST_SURFACES.includes(surface)) scheduleSignatureCheck(false);
      return;
    }

    lastLocationKey = locationKey;
    ui.currentSurface = surface;
    ui.pinned = false;
    ui.currentPanel = null;
    clearBadges();
    lastListSignature = "";

    if (surface === "other") {
      cancelQueuedListRequests("Market Edge left a supported market/list view.");
      clearInlineAnalysis();
      removeFloatingUi(true);
      return;
    }
    if (surface === "itemmarket") {
      cancelQueuedListRequests("Market Edge opened detailed Item Market analysis.");
      clearInlineAnalysis();
      ensureUi();
      try {
        await renderItemMarket();
      } catch (error) {
        log("Item Market render failed", error?.message || error);
        recordRuntime("error", `item market render: ${error?.message || error}`);
        errorPanel(describeApiError(error, { feature: "Item Market analysis" }));
      }
    } else {
      genericIntro(surface, { clear: true });
      scheduleSignatureCheck(false);
      // City shop pages also get the shop-runs panel, scoped to that shop.
      if (surface === "cityshop" && Store.apiKey()) setTimeout(() => { if (detectSurface() === "cityshop") renderShopRunsPanel(); }, 400);
      // Your active Item Market listings (#/viewListing): inline fills on the
      // rows plus the API-backed listings panel.
      if (surface === "imsell" && ownListingsRouteActive() && Store.apiKey()) setTimeout(() => { if (detectSurface() === "imsell") renderOwnListingsPanel(); }, 400);
    }
  }

  function installNavigationHooks() {
    window.addEventListener("hashchange", () => scheduleRefresh(true));
    window.addEventListener("popstate", () => scheduleRefresh(true));
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    history.pushState = function marketEdgePushState(...args) {
      const result = originalPush.apply(this, args);
      scheduleRefresh(true);
      return result;
    };
    history.replaceState = function marketEdgeReplaceState(...args) {
      const result = originalReplace.apply(this, args);
      scheduleRefresh(true);
      return result;
    };

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      scheduleRefresh(false);
      scheduleSignatureCheck(false);
    });

    // Torn renders every page inside a stable content container. Observing it
    // instead of the whole document keeps mutation callbacks cheap on mobile.
    // A light body-level observer re-attaches if Torn ever replaces the
    // container itself.
    // Child-list changes are enough to notice rows appearing, tabs switching
    // and details panels opening. Attribute mutations (hover classes, inline
    // styles) fire constantly on Torn's React pages and are ignored.
    const observerOptions = { childList: true, subtree: true };
    let observedRoot = null;
    const contentObserver = new MutationObserver(() => {
      try {
        if (document.visibilityState !== "visible") return;
        const currentKey = `${detectSurface()}|${location.pathname}|${location.search}|${location.hash}`;
        if (currentKey !== lastLocationKey) {
          scheduleRefresh(true);
          return;
        }
        scheduleSignatureCheck(false);
      } catch (error) {
        log("Observer callback failed", error?.message || error);
        recordRuntime("error", `observer: ${error?.message || error}`);
      }
    });

    // Rows beyond the scan limit are picked up as they scroll into view.
    let scrollTimer = null;
    window.addEventListener("scroll", () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        if (document.visibilityState !== "visible") return;
        const surface = detectSurface();
        if (surface === "itemmarket") scheduleSignatureCheck(false);
        else if (LIST_SURFACES.includes(surface)) scanVisibleSurface(surface, { retryIfEmpty: false, force: false, cancelObsolete: false });
      }, 350);
    }, { passive: true });

    const attachContentObserver = () => {
      const root = document.querySelector("#mainContainer, .content-wrapper, #bazaarRoot, #react-root") || document.body;
      if (!root || root === observedRoot) return;
      contentObserver.disconnect();
      contentObserver.observe(root, observerOptions);
      observedRoot = root;
    };
    attachContentObserver();

    const rootObserver = new MutationObserver(() => {
      if (observedRoot && !observedRoot.isConnected) {
        observedRoot = null;
        attachContentObserver();
        scheduleRefresh(true);
      } else if (observedRoot === document.body) {
        // Content container may have been created after load.
        attachContentObserver();
      }
    });
    rootObserver.observe(document.body, { childList: true });
  }

  function analyzeCurrentPage() {
    const surface = detectSurface();
    if (surface === "itemmarket") renderItemMarket();
    else if (LIST_SURFACES.includes(surface)) scanVisibleSurface(surface, { force: true });
  }

  function registerMenu() {
    if (ENV.hasGmMenu) {
      try {
        GM_registerMenuCommand("Market Edge settings", showSettings);
        GM_registerMenuCommand("Market Edge analyze current page", analyzeCurrentPage);
        GM_registerMenuCommand("Market Edge my Item Market listings", () => renderOwnListingsPanel());
        GM_registerMenuCommand("Market Edge watchlist", () => renderWatchlistPanel());
        GM_registerMenuCommand("Market Edge portfolio", () => renderPortfolioPanel());
        GM_registerMenuCommand("Market Edge city shop runs", () => renderShopRunsPanel());
        GM_registerMenuCommand("Market Edge travel plan", () => renderTravelPlanPanel());
        GM_registerMenuCommand("Market Edge fill all visible prices", () => fillAllVisiblePrices());
        return;
      } catch {
        // fall through to the on-page launcher
      }
    }
    // Torn PDA and other managers without a menu get a small on-page launcher.
    ensureLauncher();
  }

  if (global.__MARKET_EDGE_EXPOSE_DOM__) {
    // DOM fixture tests (jsdom) drive the collectors directly.
    global.__MARKET_EDGE_DOM__ = Object.freeze({
      ENV,
      Store,
      api,
      detectSurface,
      getItemIdFromLocation,
      itemIdFromElement,
      collectVisibleItems,
      collectBazaarAddItems,
      collectManagedBazaarItems,
      collectAuctionItems,
      parseLiveItemMarketListings,
      findBazaarAddPriceInput,
      findBazaarAddQuantityInput,
      bazaarAddSection,
      knownBazaarAddRows,
      inventoryListMarker,
      renderInlineResult,
      resultForSurface,
      ownListingsRouteActive,
      renderItemMarket,
      renderOwnListingsPanel,
      renderWatchlistPanel,
      scanVisibleSurface,
      listSurfaceSignature,
      inventoryListMarker,
      watchTick,
      loadMuseumContext,
      showSettings,
      addWatchItem,
      ensureLauncher,
      showToast,
      renderPortfolioPanel,
      renderShopRunsPanel,
      renderTravelPlanPanel,
      scanBrowseGrid,
      recordSellWatch,
      sellWatchTick,
      fillAllVisiblePrices,
      collectOwnListingRows,
      collectSellFormRows,
      fillOwnListingOnPage,
      loadInventory,
      loadCityShops,
      loadForeignCatalog,
      currentCityShopName,
      reloadSettings: () => { settings = Store.settings(); },
      buildPageDiagnostics,
      recordRuntime,
      ui
    });
  } else {
    registerMenu();
    installNavigationHooks();
    scheduleRefresh(true);
    startWatchlist();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
