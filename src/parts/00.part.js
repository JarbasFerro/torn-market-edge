// ==UserScript==
// @name         Torn Market Edge
// @namespace    https://github.com/JarbasFerro/torn-market-edge
// @version      0.3.1
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
    version: "0.3.1",
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
    equipmentEnabled: true,
    watchlistEnabled: true,
    watchlistIntervalSeconds: 60,
    minimumGreenConfidence: "MEDIUM",
    maxVolatility: 0.03,
    historyRetentionDays: 14,
    scanMaxVisibleItems: 30,
    travelCapacity: 0,
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

  function bonusSignature(details) {
    const bonuses = Array.isArray(details?.bonuses) ? details.bonuses : [];
    return bonuses
      .map((bonus) => String(bonus?.title || bonus?.name || "").trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join("+");
  }

  function equipmentGroupKey(details) {
    const rarity = String(details?.rarity || "plain").toLowerCase();
    const signature = bonusSignature(details);
    return `${rarity}|${signature || "none"}`;
  }

  function summarizeEquipmentListings(listings) {
    const detailed = listings.filter((row) => row.itemDetails && typeof row.itemDetails === "object");
    if (!detailed.length) return null;
    const plain = detailed.filter((row) => !bonusSignature(row.itemDetails) && !row.itemDetails.rarity);
    const bonus = detailed.filter((row) => bonusSignature(row.itemDetails) || row.itemDetails.rarity);
    const groups = new Map();
    detailed.forEach((row) => {
      const key = equipmentGroupKey(row.itemDetails);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row.price);
    });
    return {
      listingCount: detailed.length,
      plainFloor: plain.length ? Math.min(...plain.map((row) => row.price)) : null,
      plainMedian: median(plain.map((row) => row.price)),
      bonusFloor: bonus.length ? Math.min(...bonus.map((row) => row.price)) : null,
      groups: Array.from(groups.entries()).map(([key, prices]) => ({
        key,
        count: prices.length,
        floor: Math.min(...prices),
        median: median(prices)
      }))
    };
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
      // Equipment is valued separately through comparable-group analysis.
      supportedCommodity: !equipment,
      equipment,
      equipmentSummary: equipment ? summarizeEquipmentListings(listings) : null
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
