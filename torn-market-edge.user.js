// ==UserScript==
// @name         Torn Market Edge
// @namespace    https://github.com/JarbasFerro/torn-market-edge
// @version      0.3.6
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
    version: "0.3.6",
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

  // Weapon/armor bonus names as Torn labels them. Used to recognise bonus
  // icons in an expanded item-details panel; unknown names are ignored.
  const KNOWN_BONUSES = Object.freeze([
    "Achilles", "Assassinate", "Backstab", "Berserk", "Bleed", "Blindfire", "Bloodlust", "Burn", "Comeback",
    "Conserve", "Cripple", "Crusher", "Cupid", "Deadeye", "Deadly", "Demoralize", "Disarm", "Double-edged",
    "Double Tap", "Empower", "Eviscerate", "Execute", "Expose", "Finale", "Focus", "Freeze", "Frenzy", "Fury",
    "Grace", "Hazardous", "Home Run", "Impenetrable", "Impregnable", "Insurmountable", "Invulnerable", "Irradiate",
    "Lacerate", "Motivation", "Paralyze", "Parry", "Penetrate", "Plunder", "Poison", "Powerful", "Proficience",
    "Puncture", "Quicken", "Rage", "Revitalize", "Roshambo", "Shock", "Sleep", "Slow", "Smash", "Smurf",
    "Specialist", "Spray", "Stricken", "Storm", "Stun", "Suppress", "Sure Shot", "Throttle", "Toxin", "Warlord",
    "Weaken", "Wind-up", "Wither"
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

    const candidates = [
      { route: "Bazaar", net: bazaarNet },
      { route: "Item Market", net: itemMarketNet },
      { route: "Museum set", net: museumNet }
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

  function evaluateDirectBuy({ buyPrice, quantity = 1, snapshot, historyStats, settings, nowMs = Date.now(), forceYellow = false, museum = null }) {
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
    const routes = routeEconomics(exit, qty, settings, { museum });
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

  function maxRationalBid({ snapshot, historyStats, settings, quantity = 1, museum = null }) {
    if (!snapshot?.supportedCommodity) return null;
    const qty = Math.max(1, asInt(quantity, 1));
    const exit = calculateExit({ snapshot, historyStats, settings });
    if (!exit) return null;
    const routes = routeEconomics(exit, qty, settings, { museum });
    const reference = chooseReference(snapshot, historyStats).value;
    const maxByRoi = Math.floor((routes.bestNet / qty) / (1 + settings.minimumROI));
    const maxByProfit = Math.floor((routes.bestNet - settings.minimumProfit) / qty);
    const maxByDiscount = reference ? Math.floor(reference * (1 - settings.minimumDiscount)) : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(maxByRoi, maxByProfit, maxByDiscount));
  }

  function estimateInventoryExit({ quantity, snapshot, historyStats, settings, museum = null }) {
    const qty = Math.max(1, asInt(quantity, 1));
    if (!snapshot?.supportedCommodity) return null;
    const exit = calculateExit({ snapshot, historyStats, settings });
    if (!exit) return null;
    const routes = routeEconomics(exit, qty, settings, { museum });
    return { quantity: qty, exit, routes, reference: chooseReference(snapshot, historyStats) };
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

  function equipmentQuality(details) {
    const quality = Number(details?.stats?.quality);
    return Number.isFinite(quality) ? quality : null;
  }

  function describeEquipmentGroup(key) {
    const [rarity, signature] = String(key || "plain|none").split("|");
    const bonuses = signature && signature !== "none" ? signature.split("+") : [];
    const rarityLabel = rarity && rarity !== "plain" ? rarity.toUpperCase() : "Plain";
    return bonuses.length ? `${rarityLabel} ${bonuses.join(" + ")}` : rarityLabel;
  }

  // Comparable-group valuation for weapons and armor. Listings are grouped by
  // rarity + bonus signature; quality is matched softly (+/-10) when the group
  // is deep enough. Ended Auction House sales of the same group are the only
  // official transaction evidence and are used as a cap on the comparable
  // median. Nothing here is a guarantee: rare bonus rolls trade on intangibles.
  function analyzeEquipmentListings(snapshot, { auctionSales = [], settings = {} } = {}) {
    const listings = (snapshot?.listings || []).filter((row) => row.itemDetails && typeof row.itemDetails === "object");
    if (!listings.length) return { rows: [], groups: [], best: null, summary: null };

    const minimumDiscount = Number.isFinite(settings.minimumDiscount) ? settings.minimumDiscount : DEFAULTS.minimumDiscount;
    const haircut = clamp(Number.isFinite(settings.safetyHaircut) ? settings.safetyHaircut : DEFAULTS.safetyHaircut, 0, 0.10);
    const feeBps = itemMarketFeeBps(settings);

    const groupMap = new Map();
    listings.forEach((row) => {
      const key = equipmentGroupKey(row.itemDetails);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(row);
    });

    const salesMap = new Map();
    (auctionSales || []).forEach((sale) => {
      if (!sale?.details || sale.price <= 0) return;
      if (snapshot?.itemId && sale.itemId && sale.itemId !== snapshot.itemId) return;
      const key = equipmentGroupKey(sale.details);
      if (!salesMap.has(key)) salesMap.set(key, []);
      salesMap.get(key).push(sale.price);
    });

    const rows = listings.map((row) => {
      const key = equipmentGroupKey(row.itemDetails);
      const quality = equipmentQuality(row.itemDetails);
      const group = groupMap.get(key) || [];
      const othersAll = group.filter((other) => other !== row);
      const qualityMatched = Number.isFinite(quality)
        ? othersAll.filter((other) => {
          const otherQuality = equipmentQuality(other.itemDetails);
          return Number.isFinite(otherQuality) && Math.abs(otherQuality - quality) <= 10;
        })
        : [];
      const comparables = qualityMatched.length >= 3 ? qualityMatched : othersAll;
      const compMedian = median(comparables.map((other) => other.price));
      const sales = salesMap.get(key) || [];
      const salesMedian = median(sales);

      let reference = null;
      let referenceSource = "none";
      if (Number.isFinite(compMedian) && Number.isFinite(salesMedian)) {
        reference = Math.min(compMedian, Math.round(salesMedian * 1.05));
        referenceSource = "listings + AH sales";
      } else if (Number.isFinite(compMedian)) {
        reference = compMedian;
        referenceSource = "comparable listings";
      } else if (Number.isFinite(salesMedian)) {
        reference = salesMedian;
        referenceSource = "AH sales";
      }

      const discount = reference ? 1 - row.price / reference : null;
      const resalePrice = reference ? Math.max(1, Math.floor(reference * (1 - haircut))) : null;
      const expectedNet = resalePrice ? grossToNet(resalePrice, feeBps) - row.price : null;
      const evidence = comparables.length + sales.length;

      let state = "GREY";
      if (Number.isFinite(discount) && Number.isFinite(expectedNet) && expectedNet > 0 && discount >= minimumDiscount) {
        const strong = comparables.length >= 4 && (sales.length === 0 || salesMedian >= row.price * (1 + minimumDiscount));
        state = strong ? "GREEN" : evidence >= 2 ? "YELLOW" : "GREY";
      } else if (Number.isFinite(expectedNet) && expectedNet < 0 && Number.isFinite(discount) && discount < 0) {
        state = "RED";
      }

      return {
        price: row.price,
        quantity: row.quantity,
        uid: row.itemDetails.uid ?? null,
        groupKey: key,
        groupLabel: describeEquipmentGroup(key),
        rarity: row.itemDetails.rarity ?? null,
        bonuses: Array.isArray(row.itemDetails.bonuses) ? row.itemDetails.bonuses.map((bonus) => ({
          title: String(bonus?.title || ""),
          value: asInt(bonus?.value, 0)
        })) : [],
        quality,
        qualityMatched: qualityMatched.length >= 3,
        comparableCount: comparables.length,
        comparableMedian: Number.isFinite(compMedian) ? Math.round(compMedian) : null,
        salesCount: sales.length,
        salesMedian: Number.isFinite(salesMedian) ? Math.round(salesMedian) : null,
        reference,
        referenceSource,
        discount,
        resalePrice,
        expectedNet,
        state
      };
    });

    const groups = Array.from(groupMap.entries()).map(([key, members]) => {
      const prices = members.map((member) => member.price);
      const sales = salesMap.get(key) || [];
      return {
        key,
        label: describeEquipmentGroup(key),
        count: members.length,
        floor: Math.min(...prices),
        median: Math.round(median(prices)),
        salesCount: sales.length,
        salesMedian: sales.length ? Math.round(median(sales)) : null
      };
    }).sort((a, b) => b.count - a.count || a.floor - b.floor);

    const stateRank = { GREEN: 4, YELLOW: 3, GREY: 2, RED: 1 };
    const best = rows
      .filter((row) => row.state === "GREEN" || row.state === "YELLOW")
      .sort((a, b) => (stateRank[b.state] - stateRank[a.state]) || (b.discount - a.discount))[0] || null;

    return { rows, groups, best, summary: snapshot?.equipmentSummary || summarizeEquipmentListings(listings) };
  }

  // Sell-side pricing for a weapon/armor the player owns when its individual
  // stats are unknown (Bazaar add form, inventory). Assumes a plain roll: the
  // reference is the lowest of the plain listing median, Torn's daily average
  // and ended Auction House sales of plain copies, and the sell price never
  // exceeds the current plain Item Market floor because buyers compare there.
  function equipmentSellPricing(snapshot, settings = {}, auctionSales = []) {
    const summary = snapshot?.equipmentSummary;
    if (!summary) return null;
    const plainSales = (auctionSales || [])
      .filter((sale) => sale?.details && !bonusSignature(sale.details) && !sale.details.rarity)
      .filter((sale) => !snapshot?.itemId || !sale.itemId || sale.itemId === snapshot.itemId)
      .map((sale) => sale.price)
      .filter((price) => price > 0);
    const salesMedian = median(plainSales);
    const averagePrice = asInt(snapshot?.averagePrice, 0) || null;
    const candidates = [
      summary.plainMedian,
      averagePrice ? Math.round(averagePrice * 1.05) : null,
      Number.isFinite(salesMedian) ? Math.round(salesMedian * 1.05) : null
    ].filter((value) => Number.isFinite(value) && value > 0);
    const reference = candidates.length ? Math.min(...candidates) : (summary.plainFloor || null);
    if (!reference) return null;

    const haircut = clamp(Number.isFinite(settings.safetyHaircut) ? settings.safetyHaircut : DEFAULTS.safetyHaircut, 0, 0.10);
    const bazaarDiscount = clamp(Number.isFinite(settings.bazaarDiscount) ? settings.bazaarDiscount : DEFAULTS.bazaarDiscount, 0, 0.5);
    const undercut = Math.max(0, asInt(settings.itemMarketUndercut ?? DEFAULTS.itemMarketUndercut));
    const conservative = Math.max(1, Math.floor(reference * (1 - haircut)));
    const floorCapped = summary.plainFloor ? Math.min(conservative, summary.plainFloor) : conservative;
    const bazaarSuggested = Math.max(1, Math.floor(floorCapped * (1 - bazaarDiscount)));
    const itemMarketSuggested = Math.max(1, floorCapped - undercut);
    const feeBps = itemMarketFeeBps(settings);
    const itemMarketNet = grossToNet(itemMarketSuggested, feeBps);
    const bazaarNet = settings.bazaarEnabled === false ? Number.NEGATIVE_INFINITY : bazaarSuggested;

    return {
      assumesPlain: true,
      plainFloor: summary.plainFloor || null,
      plainMedian: summary.plainMedian ? Math.round(summary.plainMedian) : null,
      plainListings: summary.listingCount || 0,
      bonusFloor: summary.bonusFloor || null,
      averagePrice,
      salesMedian: Number.isFinite(salesMedian) ? Math.round(salesMedian) : null,
      salesCount: plainSales.length,
      reference,
      conservative,
      bazaarSuggested,
      itemMarketSuggested,
      itemMarketNet,
      feeBps,
      bestRoute: bazaarNet >= itemMarketNet ? "Bazaar" : "Item Market"
    };
  }

  function normalizeBonusName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z]/g, "");
  }

  // Parse the stats of one owned copy from Torn's expanded item-details
  // panel. `text` is the panel text; `hints` are attribute values (title,
  // alt, aria-label, class names) collected from the panel's icons, which is
  // where bonus names and rarity colours live.
  function parseEquipmentDetailsText(text, hints = []) {
    const source = String(text || "").replace(/\s+/g, " ");
    const number = (pattern) => {
      const match = source.match(pattern);
      return match ? Number(match[1]) : null;
    };
    const quality = number(/Quality:\s*[^\d]*([\d.]+)\s*%/i);
    const damage = number(/Damage:\s*[^\d]*([\d.]+)/i);
    const accuracy = number(/Accuracy:\s*[^\d]*([\d.]+)/i);
    const armor = number(/Armou?r:\s*[^\d]*([\d.]+)/i);
    if (!Number.isFinite(quality) && !Number.isFinite(damage) && !Number.isFinite(armor)) return null;

    const known = new Map(KNOWN_BONUSES.map((name) => [normalizeBonusName(name), name]));
    const bonuses = [];
    const seen = new Set();
    let rarity = null;
    hints.forEach((hint) => {
      const raw = String(hint || "");
      const lowered = raw.toLowerCase();
      if (/\bred\b/.test(lowered)) rarity = "red";
      else if (/\borange\b/.test(lowered) && rarity !== "red") rarity = "orange";
      else if (/\byellow\b/.test(lowered) && !rarity) rarity = "yellow";
      const normalized = normalizeBonusName(raw);
      for (const [key, name] of known.entries()) {
        if (normalized === key || (normalized.includes(key) && key.length >= 5)) {
          const valueMatch = raw.match(/(\d+)\s*%/);
          const value = valueMatch ? Number(valueMatch[1]) : 0;
          const existing = bonuses.find((bonus) => bonus.title === name);
          if (existing) {
            if (value && !existing.value) existing.value = value;
          } else {
            bonuses.push({ title: name, value });
            seen.add(name);
          }
        }
      }
    });
    return {
      quality: Number.isFinite(quality) ? quality : null,
      damage: Number.isFinite(damage) ? damage : null,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      armor: Number.isFinite(armor) ? armor : null,
      bonuses,
      rarity: bonuses.length ? rarity : null
    };
  }

  // Price one owned weapon/armor whose stats are known (expanded details
  // panel). Comparables come from the same rarity + bonus group of the deep
  // order book, quality matched within +/-10 (then +/-20, then the whole
  // group). Ended Auction House sales of the same group are transaction
  // evidence. The sell price never exceeds the cheapest comparable listing.
  function priceOwnedEquipment({ snapshot, copy, auctionSales = [], settings = {} }) {
    if (!snapshot || !copy) return null;
    const details = { bonuses: copy.bonuses || [], rarity: copy.rarity || null };
    const groupKey = equipmentGroupKey(details);
    const plain = !bonusSignature(details) && !details.rarity;
    const listings = (snapshot.listings || []).filter((row) => row.itemDetails && equipmentGroupKey(row.itemDetails) === groupKey);
    const quality = Number.isFinite(copy.quality) ? copy.quality : null;

    let comparables = listings;
    let band = null;
    if (quality !== null) {
      for (const width of [10, 20]) {
        const matched = listings.filter((row) => {
          const rowQuality = equipmentQuality(row.itemDetails);
          return Number.isFinite(rowQuality) && Math.abs(rowQuality - quality) <= width;
        });
        if (matched.length >= 3) {
          comparables = matched;
          band = width;
          break;
        }
      }
    }

    const compPrices = comparables.map((row) => row.price);
    const compFloor = compPrices.length ? Math.min(...compPrices) : null;
    const compMedian = median(compPrices);
    const groupPrices = listings.map((row) => row.price);
    const groupFloor = groupPrices.length ? Math.min(...groupPrices) : null;
    const groupMedian = median(groupPrices);
    const sales = (auctionSales || [])
      .filter((sale) => sale?.details && sale.price > 0 && (!sale.itemId || !snapshot.itemId || sale.itemId === snapshot.itemId))
      .filter((sale) => equipmentGroupKey(sale.details) === groupKey)
      .map((sale) => sale.price);
    const salesMedian = median(sales);
    const averagePrice = asInt(snapshot.averagePrice, 0) || null;

    const candidates = [
      compMedian,
      Number.isFinite(salesMedian) ? Math.round(salesMedian * 1.05) : null,
      plain && averagePrice ? Math.round(averagePrice * 1.05) : null
    ].filter((value) => Number.isFinite(value) && value > 0);
    const reference = candidates.length ? Math.min(...candidates) : (compFloor || groupFloor || null);
    const referenceSource = !candidates.length
      ? (reference ? "cheapest listing only" : "none")
      : [Number.isFinite(compMedian) ? "listings" : null, Number.isFinite(salesMedian) ? "AH sales" : null, plain && averagePrice ? "Torn average" : null].filter(Boolean).join(" + ");

    const summary = snapshot.equipmentSummary || summarizeEquipmentListings(snapshot.listings || []);
    if (!reference) {
      return {
        groupKey, groupLabel: describeEquipmentGroup(groupKey), plain, quality, bonuses: details.bonuses, rarity: details.rarity,
        comparables: { count: 0, floor: null, median: null, band: null }, group: { count: listings.length, floor: groupFloor, median: groupMedian ? Math.round(groupMedian) : null },
        sales: { count: sales.length, median: null }, averagePrice, reference: null, referenceSource: "none",
        bazaarSuggested: null, itemMarketSuggested: null, itemMarketNet: null, feeBps: itemMarketFeeBps(settings), bestRoute: null,
        cheaperAtSuggested: null, bonusFloor: plain ? summary?.bonusFloor || null : null
      };
    }

    const haircut = clamp(Number.isFinite(settings.safetyHaircut) ? settings.safetyHaircut : DEFAULTS.safetyHaircut, 0, 0.10);
    const bazaarDiscount = clamp(Number.isFinite(settings.bazaarDiscount) ? settings.bazaarDiscount : DEFAULTS.bazaarDiscount, 0, 0.5);
    const undercut = Math.max(0, asInt(settings.itemMarketUndercut ?? DEFAULTS.itemMarketUndercut));
    const conservative = Math.max(1, Math.floor(reference * (1 - haircut)));
    const cap = compFloor ? Math.min(conservative, compFloor) : conservative;
    const bazaarSuggested = Math.max(1, Math.floor(cap * (1 - bazaarDiscount)));
    const itemMarketSuggested = Math.max(1, cap - undercut);
    const feeBps = itemMarketFeeBps(settings);
    const itemMarketNet = grossToNet(itemMarketSuggested, feeBps);
    const bazaarNet = settings.bazaarEnabled === false ? Number.NEGATIVE_INFINITY : bazaarSuggested;

    return {
      groupKey,
      groupLabel: describeEquipmentGroup(groupKey),
      plain,
      quality,
      bonuses: details.bonuses,
      rarity: details.rarity,
      comparables: { count: comparables.length, floor: compFloor, median: Number.isFinite(compMedian) ? Math.round(compMedian) : null, band },
      group: { count: listings.length, floor: groupFloor, median: Number.isFinite(groupMedian) ? Math.round(groupMedian) : null },
      sales: { count: sales.length, median: Number.isFinite(salesMedian) ? Math.round(salesMedian) : null },
      averagePrice,
      reference,
      referenceSource,
      conservative,
      bazaarSuggested,
      itemMarketSuggested,
      itemMarketNet,
      feeBps,
      bestRoute: bazaarNet >= itemMarketNet ? "Bazaar" : "Item Market",
      cheaperAtSuggested: listings.filter((row) => row.price < bazaarSuggested).length,
      bonusFloor: plain ? summary?.bonusFloor || null : null
    };
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
    summarizeEquipmentListings,
    equipmentGroupKey,
    analyzeEquipmentListings,
    equipmentSellPricing,
    parseEquipmentDetailsText,
    priceOwnedEquipment,
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
    parseQuantity
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
        equipment: raw.equipment === true,
        equipmentSummary: raw.equipmentSummary && typeof raw.equipmentSummary === "object" ? raw.equipmentSummary : null
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
        equipment: snapshot.equipment === true,
        equipmentSummary: snapshot.equipmentSummary || null
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
  async function loadMuseumContext(itemIds, { priority = 60 } = {}) {
    const result = new Map();
    if (settings.museumSetsEnabled === false) return result;
    const sets = new Map();
    itemIds.forEach((itemId) => {
      const set = museumSetFor(itemId);
      if (set) sets.set(set.key, set);
    });
    if (!sets.size) return result;

    const points = await loadPointsMarket({ priority });
    const pointValue = asInt(points?.cheapest, 0);
    if (!pointValue) return result;

    const memberIds = Array.from(sets.values()).flatMap((set) => set.items);
    let metadata = new Map();
    try {
      metadata = await loadItemMetadataBatch(memberIds, { maxAgeMs: SET_META_TTL_MS, priority });
    } catch (error) {
      log("Museum set metadata unavailable", error.message);
      return result;
    }
    const memberPrices = {};
    metadata.forEach((meta, id) => { memberPrices[id] = asInt(meta?.marketPrice, 0); });

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
    if (sid === "itemmarket" || hash.includes("itemmarket")) return "itemmarket";
    if (path.endsWith("/bazaar.php") || path.endsWith("bazaar.php")) return "bazaar";
    if (path.endsWith("/amarket.php") || path.endsWith("amarket.php") || sid.includes("auction")) return "auction";
    if (sid === "travel" || path.endsWith("travelagency.php")) return "travel";
    if (path.endsWith("/item.php") || path.endsWith("item.php")) return "inventory";
    return "other";
  }

  function getItemIdFromLocation() {
    const combined = `${location.search}&${location.hash}`;
    const patterns = [/(?:itemID|itemId|item_id|ID)=(\d+)/i, /(?:item\/|items\/)(\d+)/i];
    for (const pattern of patterns) {
      const match = combined.match(pattern);
      if (match) return asInt(match[1]);
    }
    // Torn's current Item Market also exposes the selected item ID through
    // aria-controls="wai-itemInfo-..." controls. This is deliberately a
    // visible-DOM fallback rather than an extra Torn request.
    const controls = document.querySelector('button[aria-controls^="wai-itemInfo-"]')?.getAttribute("aria-controls") || "";
    const ids = controls.match(/\d+/g);
    return ids?.length ? asInt(ids[ids.length - 1]) : null;
  }

  function itemIdFromElement(element) {
    if (!element) return null;
    const attrNames = ["data-itemid", "data-item-id", "data-id", "item"];
    let node = element;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      for (const attr of attrNames) {
        const raw = node.getAttribute?.(attr);
        if (raw && /^\d+$/.test(raw)) return asInt(raw);
      }
      for (const [key, value] of Object.entries(node.dataset || {})) {
        if (/item.*id|id.*item/i.test(key) && /^\d+$/.test(String(value))) return asInt(value);
      }
      const controls = node.getAttribute?.("aria-controls") || "";
      if (controls.startsWith("wai-itemInfo-")) {
        const ids = controls.match(/\d+/g);
        if (ids?.length) return asInt(ids[ids.length - 1]);
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

  function inventoryListMarker() {
    if (detectSurface() !== "inventory") return null;

    // On Torn's Items page, the equipped paper-doll/loadout appears before the
    // actual inventory list. Prefer the visible "Your Items - <category>"
    // heading as a structural boundary so only inventory rows below it are
    // analyzed.
    const selectors = "h1,h2,h3,h4,h5,h6,div,span";
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
      const text = ownText || (element.textContent || "").replace(/\s+/g, " ").trim();
      if (!/^Your Items(?:\s*[-:]\s*.*)?$/i.test(text)) return;
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

    // If Torn changes the heading markup, accept cards inside known inventory
    // list containers.
    if (card.closest(".items-cont, [class*='itemsCont'], [class*='items-cont'], [class*='inventoryList'], [class*='inventory-list']")) {
      return true;
    }

    // Last-resort defensive exclusions for the equipped/loadout region.
    const equippedAncestor = card.closest(
      "[class*='equipped'],[class*='loadout'],[class*='paperdoll'],[class*='paper-doll'],[class*='characterEquipment'],[class*='character-equipment']"
    );
    return !equippedAncestor;
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
    let node = start instanceof HTMLElement ? start : start.parentElement;
    let fallback = null;
    for (let depth = 0; node && depth < 9 && node !== document.body; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
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
      const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
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
      )).filter((root) => !root.closest("#market-edge-root"));
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
      .slice(0, limit * 3)
      .map((entry) => entry.node);
    for (const node of ordered) {
      const itemId = itemIdFromElement(node);
      if (!itemId) continue;
      const card = detectSurface() === "inventory" ? findInventoryRow(node) : findCompactCard(node, requireMoney);
      if (!isInventoryListCandidate(card, inventoryMarker)) continue;
      const rect = card?.getBoundingClientRect?.();
      if (rect && (rect.width <= 0 || rect.height <= 0)) continue;
      const text = card?.innerText || "";
      const priceElement = card?.querySelector?.('[data-testid="price"]');
      const price = requireMoney ? priceForSurfaceCard(detectSurface(), card, priceElement) : null;
      if (requireMoney && !price) continue;
      const quantity = parseQuantity(text);
      const name = elementItemName(card, node);
      const existing = byId.get(itemId);
      const score = Math.min(text.length, 900);
      if (!existing || score < existing.domTextLength) {
        byId.set(itemId, {
          itemId,
          name,
          price,
          quantity,
          card,
          inlineAnchor: findItemTextHost(card, name),
          inlineMode: "inline",
          domTextLength: score
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => viewportPriority(b) - viewportPriority(a)).slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }


  function findOwnBazaarCard(start) {
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
      // Expanded rows carry Torn's item-details panel and grow well past the
      // normal row height; they must stay recognisable.
      if (rect.height > 300 && !/Quality:\s*[^\d]*[\d.]+\s*%/i.test(row.textContent || "")) return false;
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
    const checkbox = control?.querySelector?.("input[type='checkbox'], input");
    if (!(checkbox instanceof HTMLInputElement)) return null;
    const rect = control.getBoundingClientRect();
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
    if (!section) return [];

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
    // inspection; long categories would otherwise thrash layout.
    const limit = clamp(settings.scanMaxVisibleItems, 1, 50);
    const nearest = candidatePairs
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

    return Array.from(byCard.values())
      .sort((a, b) => viewportPriority(b) - viewportPriority(a))
      .slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  function collectManagedBazaarItems() {
    // Managed listings never appear on the add route, and add rows are
    // recognisable by their amount/price control wrapper. Both guards stop a
    // filled add row from being mistaken for an existing listing.
    if (bazaarAddRouteActive()) return [];
    const candidates = new Set();
    const selector = itemIdentitySelector();
    document.querySelectorAll(selector).forEach((node) => {
      if (!node.closest("#market-edge-root") && !node.closest(".me-inline-analysis,.me-equip-card")) candidates.add(node);
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

  // Expanded item-details panels (Bazaar add form, inventory) show the exact
  // copy's quality, damage/accuracy and bonus icons. Each panel is matched to
  // its item id through the panel's own large image or the preceding row.
  function detailsPanelHints(container) {
    const hints = [];
    container.querySelectorAll("[title],[aria-label],img[alt],[class*='bonus'],[class*='rarity'],[class*='yellow'],[class*='orange'],[class*='red']").forEach((node) => {
      if (node.closest(".me-equip-card,#market-edge-root")) return;
      ["title", "aria-label", "alt", "class", "data-bonus", "data-title"].forEach((attr) => {
        const value = node.getAttribute?.(attr);
        if (value) hints.push(String(value));
      });
    });
    return hints;
  }

  const BAZAAR_ADD_ROW_SELECTOR = "ul.items-cont li.clearfix, div[class*='itemsContainner___'] div[class*='item___'], div[class*='rowItems___'] div[class*='item___']";

  function findDetailCard(panel) {
    const node = panel?.nextElementSibling;
    return node?.classList?.contains("me-equip-card") ? node : null;
  }

  // Find Torn's item-stats blocks by walking text nodes for "Quality:" and
  // climbing to the innermost element that also holds Damage/Accuracy/Armor.
  // Linear in the number of text nodes, no layout reads except for the few
  // panels found; safe to call from the mutation signature on long lists.
  function findStatsPanels(root) {
    const panels = new Set();
    if (!root || typeof document.createTreeWalker !== "function") return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (/Quality:/i.test(node.textContent || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
    });
    let textNode = walker.nextNode();
    while (textNode) {
      let element = textNode.parentElement;
      for (let depth = 0; element && element !== root && depth < 8; depth += 1, element = element.parentElement) {
        if (element.closest("#market-edge-root,.me-equip-card")) break;
        const text = element.textContent || "";
        if (text.length > 2500) break;
        if (/Quality:\s*[^\d]*[\d.]+\s*%/i.test(text) && /Damage:|Accuracy:|Armou?r:/i.test(text)) {
          panels.add(element);
          break;
        }
      }
      textNode = walker.nextNode();
    }
    return Array.from(panels).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function collectExpandedEquipmentDetails(surface) {
    const results = [];
    const root = (surface === "bazaar" ? bazaarAddSection() : document.querySelector(".items-cont, [class*='itemsCont'], [class*='items-cont']")) || document.body;
    const panels = findStatsPanels(root);

    panels.forEach((panel) => {
      const rowSelector = surface === "bazaar" ? BAZAAR_ADD_ROW_SELECTOR : "li, tr, [role='row'], [class*='item___'], [class*='itemRow'], [class*='item-row']";
      // The expanded row usually contains the panel. Otherwise walk up to the
      // panel's top-level wrapper and look at the rows just before it.
      let row = panel.closest(rowSelector);
      if (row && surface === "inventory" && directItemIdsWithin(row).size !== 1) row = null;
      if (!row) {
        let top = panel;
        while (top.parentElement && top.parentElement !== root && !top.parentElement.matches?.(rowSelector)) top = top.parentElement;
        let sibling = top.previousElementSibling;
        for (let depth = 0; sibling && depth < 4 && !row; depth += 1, sibling = sibling.previousElementSibling) {
          if (sibling.matches?.(rowSelector) && directItemIdsWithin(sibling).size >= 1) row = sibling;
          else {
            const inner = sibling.querySelector?.(rowSelector);
            if (inner && directItemIdsWithin(inner).size >= 1) row = inner;
          }
        }
      }
      // Item id: prefer the row image (unambiguous), then the panel's own image.
      let itemId = null;
      if (row) {
        const rowImage = row.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']");
        itemId = itemIdFromElement(rowImage || row);
      }
      if (!itemId) {
        const scope = row || panel.parentElement || panel;
        const image = scope.querySelector("img[src*='/items/'], img[srcset*='/items/'], [style*='/items/']");
        if (image) itemId = itemIdFromElement(image);
      }
      if (!itemId) return;
      const hintScope = row || panel.parentElement || panel;
      const copy = parseEquipmentDetailsText(panel.innerText || panel.textContent || "", detailsPanelHints(hintScope));
      if (!copy) return;
      results.push({ itemId, panel, row, copy, key: `${itemId}|${copy.quality}|${copy.damage}|${copy.armor}|${copy.bonuses.map((bonus) => bonus.title).join("+")}|${copy.rarity || ""}` });
    });
    return results;
  }

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
      rows.push({ itemId, name, price, quantity: 1, card: li, domTextLength: (li.innerText || "").length });
    });
    return rows.sort((a, b) => viewportPriority(b) - viewportPriority(a)).slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
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
    .me-equip-card { margin:8px 0 4px !important; padding:8px 10px !important; border:1px solid rgba(255,255,255,.16) !important; border-radius:6px !important; background:rgba(15,15,17,.72) !important; color:#ddd !important; font:11px/1.4 Arial,sans-serif !important; text-align:left !important; }
    .me-equip-card .me-equip-head { display:flex !important; align-items:center !important; gap:8px !important; flex-wrap:wrap !important; margin-bottom:5px !important; }
    .me-equip-card .me-equip-brand { font-weight:800 !important; color:#eee !important; letter-spacing:.04em !important; }
    .me-equip-card .me-equip-price { font-size:14px !important; font-weight:800 !important; color:#fff !important; }
    .me-equip-card .me-equip-alt { color:#aaa !important; }
    .me-equip-card .me-equip-facts { display:grid !important; grid-template-columns:auto 1fr !important; gap:2px 10px !important; font-size:10.5px !important; }
    .me-equip-card .me-equip-facts .label { color:#999 !important; }
    .me-equip-card .me-equip-facts .value { color:#ddd !important; font-variant-numeric:tabular-nums !important; }
    .me-equip-card .me-equip-note { margin-top:5px !important; color:#aaa !important; font-size:10px !important; }
    .me-equip-card .me-equip-warn { color:#f0ca66 !important; }
    .me-equip-card .me-bazaar-fill-btn { height:24px !important; min-width:30px !important; }
    .me-launcher { position:fixed; left:10px; bottom:10px; z-index:999997; padding:6px 9px; border-radius:16px; border:1px solid rgba(255,255,255,.25); background:rgba(28,28,30,.94); color:#eee; font:800 11px/1 Arial,sans-serif; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.4); }
    .me-toast-host { position:fixed; left:10px; bottom:48px; z-index:999999; display:flex; flex-direction:column; gap:6px; max-width:min(360px, calc(100vw - 20px)); }
    .me-toast { background:rgba(28,28,30,.97); border:1px solid rgba(74,165,100,.6); border-radius:6px; padding:8px 10px; color:#eee; font:12px/1.35 Arial,sans-serif; box-shadow:0 8px 24px rgba(0,0,0,.45); }
    .me-toast a { color:#7fd193; font-weight:700; }
    .me-toast .me-toast-close { float:right; margin-left:8px; cursor:pointer; color:#aaa; font-weight:700; }
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
          <label>Weapon/armor comparables</label><input data-setting="equipmentEnabled" type="checkbox" ${current.equipmentEnabled ? "checked" : ""}>
        </div>

        <div class="me-section-title">Risk & scanning</div>
        <div class="me-form-grid">
          <label>Minimum confidence for green</label><select data-setting="minimumGreenConfidence">${["VERY LOW", "LOW", "MEDIUM", "HIGH"].map((value) => `<option ${value === current.minimumGreenConfidence ? "selected" : ""}>${value}</option>`).join("")}</select>
          <label>Max MAD volatility (%)</label><input data-setting="maxVolatility" data-percent="1" type="number" min="0" max="100" step="0.1" value="${current.maxVolatility * 100}">
          <label>Max visible items / scan</label><input data-setting="scanMaxVisibleItems" type="number" min="1" max="50" step="1" value="${current.scanMaxVisibleItems}">
          <label>Travel capacity (0 = per-item only)</label><input data-setting="travelCapacity" type="number" min="0" max="1000" step="1" value="${current.travelCapacity}">
          <label>History retention (days)</label><input data-setting="historyRetentionDays" type="number" min="1" max="90" step="1" value="${current.historyRetentionDays}">
          <label>Developer diagnostics in console</label><input data-setting="developerMode" type="checkbox" ${current.developerMode ? "checked" : ""}>
        </div>

        <div class="me-section-title">Watchlist (API polling while a Torn tab is visible)</div>
        <div class="me-form-grid">
          <label>Watchlist alerts enabled</label><input data-setting="watchlistEnabled" type="checkbox" ${current.watchlistEnabled ? "checked" : ""}>
          <label>Check interval (seconds, min ${WATCHLIST_MIN_INTERVAL_SEC})</label><input data-setting="watchlistIntervalSeconds" type="number" min="${WATCHLIST_MIN_INTERVAL_SEC}" max="3600" step="5" value="${current.watchlistIntervalSeconds}">
        </div>
        <div id="me-watchlist-rows"></div>
        <div class="me-actions">
          <input id="me-watch-item" class="me-inline-input" type="number" min="1" placeholder="Item ID">
          <input id="me-watch-target" class="me-inline-input" type="number" min="1" placeholder="Alert at or below $">
          <button class="me-btn" id="me-watch-add" type="button">Add to watchlist</button>
        </div>
        <div class="me-form-help">The API key stays in userscript storage and is sent only to api.torn.com. Market Edge never includes it in diagnostics or exports. Fees modelled: Item Market 5% sales tax, optional 10% anonymous-listing fee, Auction House 3%. Bazaar and trades have no fee. Own Item Market listings need a Limited access key; everything else works with a Public key.${ENV.isPda ? " Torn PDA detected: the PDA API key is used automatically when no key is entered." : ""}</div>
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
    document.querySelectorAll(".me-inline-analysis,.me-equip-card").forEach((node) => node.remove());
    document.querySelectorAll(".me-bazaar-add-controls,.me-bazaar-add-host").forEach((node) => {
      node.classList.remove("me-bazaar-add-controls", "me-bazaar-add-host");
    });
    document.querySelectorAll(".me-bazaar-add-row").forEach((node) => node.classList.remove("me-bazaar-add-row"));
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
    block.className = `me-inline-analysis ${state} ${extraClass}`.trim();
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
    return parseIntegerField(input.value) === target;
  }

  function renderBazaarAddSuggestion(result) {
    const visible = result.visible;
    const target = result?.ownBazaar?.target;
    const stale = staleMarker(result);
    if (!Number.isFinite(target) || target <= 0) {
      return renderInlineHtml(
        visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">price unavailable</span>${stale}`,
        "GREY"
      );
    }

    const targetText = formatMoney(target);
    const pricing = result?.ownBazaar?.equipmentPricing || null;
    const copyLabel = result?.ownBazaar?.copyLabel || "";
    const equipmentHtml = pricing
      ? equipmentContextHtml(pricing)
      : (copyLabel ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Priced from this copy's details">${escapeHtml(copyLabel)}</span>` : "");
    const priceTitle = pricing
      ? `Suggested Bazaar price for a plain (no bonus) copy: ${formatMoney(target, true)}. ${equipmentContextTitle(pricing)}`
      : (copyLabel ? `Suggested Bazaar price for this copy (${copyLabel}): ${formatMoney(target, true)}` : "Suggested Bazaar selling price");
    const block = renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(priceTitle)}">${targetText}</span><button class="me-bazaar-fill-btn" type="button" aria-label="Fill Bazaar price and maximum quantity" title="Fill price with ${escapeHtml(targetText)} and quantity with max available">^</button>${equipmentHtml}${stale}`,
      "GREY",
      "me-bazaar-add"
    );
    const button = block?.querySelector?.(".me-bazaar-fill-btn");
    if (!button || !visible.priceInput) return block;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!visible.priceInput?.isConnected) return;
      const priceFilled = setBazaarInputValue(visible.priceInput, target);
      const maxAvailable = Math.max(1, asInt(visible.maxAvailable || visible.quantity, 1));
      let quantityFilled = false;
      if (visible.quantityCheckbox?.isConnected) {
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
    });
    return block;
  }

  function equipmentContextTitle(pricing) {
    const parts = [
      pricing.plainFloor ? `Cheapest plain Item Market listing: ${formatMoney(pricing.plainFloor, true)}` : "No plain Item Market listing found",
      pricing.plainMedian ? `Plain listing median: ${formatMoney(pricing.plainMedian, true)}` : "",
      pricing.averagePrice ? `Torn daily average: ${formatMoney(pricing.averagePrice, true)}` : "",
      pricing.salesMedian ? `Ended Auction House sales (30d, plain): median ${formatMoney(pricing.salesMedian, true)} over ${pricing.salesCount}` : "No plain Auction House sales in 30 days",
      pricing.bonusFloor ? `Bonus/rarity copies list from ${formatMoney(pricing.bonusFloor, true)}; if yours has a bonus, price it on the Item Market page instead` : "",
      `Item Market alternative: ${formatMoney(pricing.itemMarketSuggested, true)} (net ${formatMoney(pricing.itemMarketNet, true)} after ${pricing.feeBps / 100}%)`
    ].filter(Boolean);
    return parts.join("\n");
  }

  function equipmentContextHtml(pricing) {
    const bits = [];
    if (pricing.plainFloor) bits.push(`<span class="me-inline-secondary" title="Cheapest plain Item Market listing">floor ${formatMoney(pricing.plainFloor)}</span>`);
    if (pricing.salesMedian) bits.push(`<span class="me-inline-secondary" title="Median of ${pricing.salesCount} ended Auction House sales of plain copies in 30 days">AH ${formatMoney(pricing.salesMedian)}</span>`);
    else if (pricing.averagePrice) bits.push(`<span class="me-inline-secondary" title="Torn daily average">avg ${formatMoney(pricing.averagePrice)}</span>`);
    if (pricing.bonusFloor) bits.push(`<span class="me-inline-secondary" title="Cheapest listing with a bonus or rarity">bonus ${formatMoney(pricing.bonusFloor)}+</span>`);
    return bits.map((bit) => `<span class="me-inline-sep">|</span>${bit}`).join("");
  }

  function fillBazaarRowFromDetails(row, price) {
    if (!row || !Number.isFinite(price) || price <= 0) return { priceFilled: false, quantityFilled: false };
    const priceInput = findBazaarAddPriceInput(row);
    if (!priceInput) return { priceFilled: false, quantityFilled: false };
    const priceFilled = setBazaarInputValue(priceInput, price);
    let quantityFilled = false;
    const checkbox = findBazaarAddQuantityCheckbox(row);
    if (checkbox?.isConnected) {
      if (!checkbox.checked) checkbox.click();
      quantityFilled = Boolean(checkbox.checked);
    } else {
      const quantityInput = findBazaarAddQuantityInput(row, priceInput);
      if (quantityInput?.isConnected) {
        quantityFilled = setBazaarInputValue(quantityInput, 1);
        quantityInput.dispatchEvent(new Event("keyup", { bubbles: true, composed: true }));
      }
    }
    return { priceFilled, quantityFilled };
  }

  function renderEquipmentDetailCard(detail, pricing, { canFill = false, loading = false } = {}) {
    const panel = detail?.panel;
    if (!panel?.isConnected) return null;
    removeDetailCards(panel);
    const card = document.createElement("div");
    card.className = "me-equip-card";
    card.dataset.meDetailKey = detail.key;
    card.dataset.meComplete = loading ? "0" : "1";

    const copy = detail.copy;
    const copyLabel = [
      Number.isFinite(copy.quality) ? `Q ${copy.quality.toFixed(1)}%` : null,
      copy.bonuses.length ? copy.bonuses.map((bonus) => `${bonus.title}${bonus.value ? ` ${bonus.value}%` : ""}`).join(" + ") : "plain (no bonus)",
      copy.rarity ? copy.rarity.toUpperCase() : null
    ].filter(Boolean).join(" · ");

    if (loading) {
      card.innerHTML = `<div class="me-equip-head"><span class="me-equip-brand">ME</span><span class="me-equip-alt">${escapeHtml(copyLabel)}</span><span class="me-equip-alt">pricing this copy...</span></div>`;
      panel.insertAdjacentElement("afterend", card);
      return card;
    }

    if (!pricing || !pricing.bazaarSuggested) {
      const groupCount = pricing?.group?.count || 0;
      card.innerHTML = `<div class="me-equip-head"><span class="me-equip-brand">ME</span><span class="me-equip-alt">${escapeHtml(copyLabel)}</span></div>
        <div class="me-equip-note">No comparable ${escapeHtml(pricing?.groupLabel || "listings")} ${groupCount ? "" : "are on the Item Market and no recent Auction House sales were found"}. Price this copy manually or check the Item Market page for the closest rolls.</div>`;
      panel.insertAdjacentElement("afterend", card);
      return card;
    }

    const bandText = pricing.comparables.band
      ? `${pricing.comparables.count} listings within Q ±${pricing.comparables.band}`
      : `${pricing.comparables.count} listings in group (no quality match)`;
    const facts = [
      ["Comparables", `${pricing.comparables.floor ? `from ${formatMoney(pricing.comparables.floor)}, median ${formatMoney(pricing.comparables.median)}` : "-"} (${bandText})`],
      ["AH sold (30d)", pricing.sales.count ? `median ${formatMoney(pricing.sales.median)} over ${pricing.sales.count}` : "none for this group"],
      pricing.plain && pricing.averagePrice ? ["Torn average", formatMoney(pricing.averagePrice)] : null,
      ["Item Market", `${formatMoney(pricing.itemMarketSuggested)} (net ${formatMoney(pricing.itemMarketNet)} after ${pricing.feeBps / 100}%)`],
      pricing.plain && pricing.bonusFloor ? ["Bonus copies", `from ${formatMoney(pricing.bonusFloor)}`] : null
    ].filter(Boolean);

    const warn = pricing.cheaperAtSuggested > 0
      ? `<div class="me-equip-note me-equip-warn">${pricing.cheaperAtSuggested} ${escapeHtml(pricing.groupLabel)} listing(s) are cheaper than this price; they sell first.</div>`
      : "";
    const fill = canFill
      ? `<button class="me-bazaar-fill-btn" type="button" aria-label="Fill Bazaar price and select this item" title="Fill price with ${escapeHtml(formatMoney(pricing.bazaarSuggested, true))} and select this item">^</button>`
      : "";

    card.innerHTML = `
      <div class="me-equip-head">
        <span class="me-equip-brand">ME</span>
        <span class="me-equip-alt">${escapeHtml(copyLabel)}</span>
        <span class="me-equip-price" title="Suggested Bazaar price for this copy: ${escapeHtml(formatMoney(pricing.bazaarSuggested, true))}">${formatMoney(pricing.bazaarSuggested)}</span>
        ${fill}
        <span class="me-equip-alt">${escapeHtml(pricing.bestRoute)} is the better exit</span>
      </div>
      <div class="me-equip-facts">${facts.map(([label, value]) => `<span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span>`).join("")}</div>
      ${warn}
      <div class="me-equip-note">Reference ${formatMoney(pricing.reference)} from ${escapeHtml(pricing.referenceSource)}, minus safety haircut, never above the cheapest comparable. Estimates, not guarantees; ADD TO BAZAAR stays manual.</div>`;
    panel.insertAdjacentElement("afterend", card);

    const button = card.querySelector(".me-bazaar-fill-btn");
    if (button && detail.row) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const outcome = fillBazaarRowFromDetails(detail.row, pricing.bazaarSuggested);
        if (!outcome.priceFilled) return;
        card.classList.add("me-applied");
        button.title = outcome.quantityFilled ? `Filled ${formatMoney(pricing.bazaarSuggested, true)} and selected this item` : `Price filled with ${formatMoney(pricing.bazaarSuggested, true)}; select the item manually`;
        setTimeout(() => card.classList.remove("me-applied"), 700);
      });
    }
    return card;
  }

  function renderInlineResult(surface, result, ownBazaar) {
    const visible = result.visible;
    if (!visible || !visible.card?.isConnected) return null;
    const stale = staleMarker(result);
    if (result.error) return renderInlineError(visible, result.error);
    if (result.equipment) {
      // Weapons/armor on list pages. Sell-side surfaces (own Bazaar,
      // inventory) get a plain-copy sell price with context; buy-side
      // surfaces get the plain and bonus floors to compare against.
      const summary = result.equipment;
      const pricing = result.equipmentPricing || null;
      const copyPrice = asInt(visible.card?.dataset?.meCopyPrice, 0);
      const copyLabel = String(visible.card?.dataset?.meCopyLabel || "");
      if (surface === "bazaar" && ownBazaar && visible.bazaarAdd) {
        // Weapon rows carry no price until the copy has been priced from its
        // expanded details panel; then that copy's value and the fill control
        // move onto the row.
        if (copyPrice > 0) {
          return renderBazaarAddSuggestion({
            ...result,
            ownBazaar: { target: copyPrice, copyLabel }
          });
        }
        return renderInlineHtml(visible,
          `<span class="me-inline-brand">ME</span><span class="me-inline-secondary" title="Open this item's details to price this exact copy (quality and bonuses)">open details to price</span>${stale}`,
          "GREY",
          "me-bazaar-add"
        );
      }
      if (surface === "inventory" && copyPrice > 0) {
        const copyIm = asInt(visible.card?.dataset?.meCopyIm, 0);
        return renderInlineHtml(visible,
          `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Suggested Bazaar price for this copy (${escapeHtml(copyLabel)})">BZ ${formatMoney(copyPrice)}</span>${copyIm ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary">IM ${formatMoney(copyIm)}</span>` : ""}<span class="me-inline-sep">|</span><span class="me-inline-secondary">${escapeHtml(copyLabel)}</span>${stale}`,
          "GREY"
        );
      }
      if (surface === "inventory" || (surface === "bazaar" && ownBazaar)) {
        // Sell-side equipment without a priced copy: nothing to show. An
        // invisible completed marker stops rescans from re-processing the row.
        return renderInlineHtml(visible, "", "GREY", "me-hidden");
      }
      if (surface === "bazaar" && ownBazaar && pricing) {
        const delta = pricing.bazaarSuggested - visible.price;
        const state = delta > 0 ? "YELLOW" : "GREY";
        return renderInlineHtml(visible,
          `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(equipmentContextTitle(pricing))}">Target ${formatMoney(pricing.bazaarSuggested)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${delta >= 0 ? "+" : ""}${formatMoney(delta)}</span>${equipmentContextHtml(pricing)}<span class="me-inline-status">${delta > 0 ? "LOW" : "OK"}</span>${stale}`,
          state
        );
      }
      if (surface === "inventory" && pricing) {
        const bzClass = pricing.bestRoute === "Bazaar" ? "me-inline-primary" : "me-inline-secondary";
        const imClass = pricing.bestRoute === "Item Market" ? "me-inline-primary" : "me-inline-secondary";
        return renderInlineHtml(visible,
          `<span class="me-inline-brand">ME</span><span class="${bzClass}" title="${escapeHtml(equipmentContextTitle(pricing))}">BZ ${formatMoney(pricing.bazaarSuggested)}</span><span class="me-inline-sep">|</span><span class="${imClass}">IM ${formatMoney(pricing.itemMarketSuggested)}</span>${equipmentContextHtml(pricing)}${stale}`,
          "GREY"
        );
      }
      const plain = summary.plainFloor ? formatMoney(summary.plainFloor) : "-";
      const bonus = summary.bonusFloor ? formatMoney(summary.bonusFloor) : null;
      const bonusHtml = bonus ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Cheapest listing with a bonus or rarity">bonus ${bonus}</span>` : "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Cheapest plain listing on the Item Market">floor ${plain}</span>${bonusHtml}${stale}`,
        "GREY"
      );
    }
    if (result.unsupported) {
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">unsupported equipment</span>`, "GREY");
    }

    if (surface === "bazaar" && ownBazaar && visible.bazaarAdd) {
      return renderBazaarAddSuggestion(result);
    }

    if (result.inventory) {
      const estimate = result.inventory;
      const bzValue = estimate?.routes?.bazaar ? formatMoney(estimate.routes.bazaar.suggestedPrice) : "off";
      const imValue = formatMoney(estimate?.routes?.itemMarket?.suggestedPrice);
      const best = estimate?.routes?.bestRoute;
      const bzClass = best === "Bazaar" ? "me-inline-primary" : "me-inline-secondary";
      const imClass = best === "Item Market" ? "me-inline-primary" : "me-inline-secondary";
      const museum = estimate?.routes?.museum;
      const setClass = best === "Museum set" ? "me-inline-primary" : "me-inline-secondary";
      const setHtml = museum
        ? `<span class="me-inline-sep">|</span><span class="${setClass}" title="Value implied by completing the ${escapeHtml(museum.label)} and exchanging it for points">SET ${formatMoney(museum.suggestedPrice)}</span>`
        : "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="${bzClass}">BZ ${bzValue}</span><span class="me-inline-sep">|</span><span class="${imClass}">IM ${imValue}</span>${setHtml}${stale}`,
        "GREY"
      );
    }

    if (surface === "auction") {
      const data = result.auction;
      const state = data?.headroom > 0 ? "YELLOW" : "GREY";
      const headroomText = data?.headroom > 0 ? `+${formatMoney(data.headroom)}` : "-";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">Max ${formatMoney(data?.maxBid)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${headroomText}</span><span class="me-inline-status">${data?.headroom > 0 ? "CONSIDER" : "PASS"}</span>${stale}`,
        state
      );
    }

    if (surface === "bazaar" && ownBazaar) {
      const data = result.ownBazaar;
      const state = data?.delta > 0 ? "YELLOW" : "GREY";
      const deltaText = Number.isFinite(data?.delta) ? `${data.delta >= 0 ? "+" : ""}${formatMoney(data.delta)}` : "-";
      const block = renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">Target ${formatMoney(data?.target)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${deltaText}</span><span class="me-inline-status">${data?.delta > 0 ? "LOW" : "OK"}</span>${stale}`,
        state
      );
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
    </div>`;
  }

  function bindPanelToolbar() {
    ui.body?.querySelector(".me-open-listings")?.addEventListener("click", () => renderOwnListingsPanel());
    ui.body?.querySelector(".me-open-watchlist")?.addEventListener("click", () => renderWatchlistPanel());
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

  function equipmentRowsHtml(analysis) {
    const rows = analysis.rows.slice(0, 25);
    if (!rows.length) return "";
    return `<table class="me-table">
      <thead><tr><th>Group</th><th>Q</th><th>Price</th><th>Comps</th><th>AH sold</th><th>Disc.</th><th></th></tr></thead>
      <tbody>${rows.map((row) => `<tr class="${row.state}">
        <td title="${escapeHtml(row.groupLabel)}">${escapeHtml(row.groupLabel)}</td>
        <td>${Number.isFinite(row.quality) ? row.quality.toFixed(0) : "-"}</td>
        <td title="${formatMoney(row.price, true)}">${formatMoney(row.price)}</td>
        <td title="${row.comparableCount} comparable listings${row.qualityMatched ? " (quality matched)" : ""}">${row.comparableMedian ? `${formatMoney(row.comparableMedian)} x${row.comparableCount}` : "-"}</td>
        <td title="${row.salesCount} ended auctions in 30 days">${row.salesMedian ? `${formatMoney(row.salesMedian)} x${row.salesCount}` : "-"}</td>
        <td>${Number.isFinite(row.discount) ? `${(row.discount * 100).toFixed(1)}%` : "-"}</td>
        <td><span class="me-pill ${row.state}">${CLASS_META[row.state]?.label || row.state}</span></td>
      </tr>`).join("")}</tbody>
    </table>`;
  }

  async function renderEquipmentItemMarket(snapshot, historyStats) {
    const fresh = freshness(snapshot.cacheTimestamp);
    setPanel(`<div class="me-kicker">Item Market - equipment</div><div class="me-item-name">${escapeHtml(snapshot.itemName)}</div><div class="me-note">Loading ended Auction House sales for comparables...</div>`, fresh.label);
    const auctionSales = await loadAuctionSales(snapshot.itemId, { priority: 180 });
    if (detectSurface() !== "itemmarket" || getItemIdFromLocation() !== snapshot.itemId) return;
    const analysis = analyzeEquipmentListings(snapshot, { auctionSales, settings });
    const best = analysis.best;
    const summary = analysis.summary || {};
    const feeBps = itemMarketFeeBps(settings);
    const groupsHtml = analysis.groups.slice(0, 8).map((group) => `<div class="me-diag-row">${escapeHtml(group.label)}: ${group.count} listed from ${formatMoney(group.floor)} (median ${formatMoney(group.median)})${group.salesCount ? `; ${group.salesCount} AH sales, median ${formatMoney(group.salesMedian)}` : ""}</div>`).join("");

    setPanel(`
      <div class="me-kicker">Item Market - equipment comparables</div>
      <div class="me-item-name">${escapeHtml(snapshot.itemName)}</div>
      ${metricRows([
        ["Listings analyzed", `${analysis.rows.length}${snapshot.depthMetrics?.totalListings > analysis.rows.length ? ` of ${snapshot.depthMetrics.totalListings}` : ""}`],
        ["Plain floor", summary.plainFloor ? formatMoney(summary.plainFloor) : "-"],
        ["Plain median", summary.plainMedian ? formatMoney(summary.plainMedian) : "-"],
        ["Bonus/rarity floor", summary.bonusFloor ? formatMoney(summary.bonusFloor) : "-"],
        ["Torn daily average", snapshot.averagePrice ? formatMoney(snapshot.averagePrice) : "-"],
        ["AH sales (30d)", String(auctionSales.filter((sale) => sale.details).length)],
        ["API age", `${formatAge(fresh.ageSeconds)} - ${fresh.label}`]
      ])}
      <div class="me-rule"></div>
      <div class="me-kicker">Best value listing</div>
      ${best ? `<div class="me-callout ${best.state}">
        <div class="me-decision ${best.state}">${CLASS_META[best.state].icon} ${CLASS_META[best.state].label}</div>
        ${metricRows([
          ["Group", escapeHtml(best.groupLabel)],
          ["Quality", Number.isFinite(best.quality) ? best.quality.toFixed(1) : "-"],
          ["Price", formatMoney(best.price)],
          ["Reference", `${formatMoney(best.reference)} (${escapeHtml(best.referenceSource)})`],
          ["Discount", `${(best.discount * 100).toFixed(1)}%`],
          [`Net if resold (IM ${feeBps / 100}%)`, formatMoney(best.expectedNet), best.expectedNet >= 0 ? "me-good" : "me-bad"]
        ])}
      </div>` : `<div class="me-note">No listing is priced meaningfully below its comparable group.</div>`}
      ${equipmentRowsHtml(analysis)}
      ${groupsHtml ? `<details class="me-diag"><summary>Comparable groups</summary>${groupsHtml}</details>` : ""}
      ${watchControlsHtml(snapshot, null)}
      ${panelToolbarHtml()}
      <div class="me-note">Equipment is grouped by rarity and bonus set, quality matched within 10 points when enough listings exist. Ended Auction House sales are the only official transaction evidence. Rare rolls trade on intangibles; treat this as a floor check, not a valuation.</div>
    `, fresh.label);
    bindWatchControls(snapshot);
    bindPanelToolbar();
  }

  async function renderItemMarket() {
    if (ownListingsRouteActive()) {
      await renderOwnListingsPanel();
      return;
    }
    const itemId = getItemIdFromLocation();
    if (!itemId) {
      setPanel(`<div class="me-kicker">Item Market</div><div class="me-note">Open a specific item to analyze its order book.</div>${panelToolbarHtml()}`);
      bindPanelToolbar();
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
        if (settings.equipmentEnabled !== false && snapshot.equipment) {
          await renderEquipmentItemMarket(snapshot, historyStats);
          return;
        }
        setPanel(`<div class="me-kicker">Item Market</div><div class="me-item-name">${escapeHtml(snapshot.itemName)}</div><div class="me-callout GREY"><div class="me-decision GREY">- NOT SUPPORTED</div><div class="me-note">Enable weapon/armor comparables in settings to analyze equipment listings.</div></div>`);
        return;
      }

      const liveRows = parseLiveItemMarketListings();
      const museumContext = await loadMuseumContext([itemId], { priority: 190 });
      const museum = museumContext.get(itemId) || null;

      // The official Torn API is the authoritative valuation source. The live
      // DOM is used only to confirm/highlight what the player currently sees.
      const evaluated = evaluatePrefixes(snapshot, historyStats, settings, Date.now(), { museum });
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
          ...museumRows
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
          ...(best.routes.museum ? [[`${best.routes.museum.label} target`, formatMoney(best.routes.museum.suggestedPrice)]] : [])
        ]) : `<div class="me-note">No affordable prefix with positive expected profit.</div>`}
        <div class="me-rule"></div>
        ${decisionHtml(best)}
        ${diagnosticsHtml(best)}
        ${coldStartNote}
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

  function resultForSurface(surface, visible, snapshot, historyStats, ownBazaar, renderMeta = {}, museum = null) {
    if (!snapshot?.supportedCommodity) {
      if (settings.equipmentEnabled !== false && snapshot?.equipment && snapshot.equipmentSummary) {
        // Buy-side surfaces get plain/bonus floors. Sell-side rows are priced
        // only from an expanded details panel (see promoteCopyPriceToRow).
        return { visible, snapshot, equipment: snapshot.equipmentSummary, renderMeta };
      }
      return { visible, snapshot, unsupported: true, renderMeta };
    }

    if (surface === "inventory") {
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum });
      return { visible, snapshot, historyStats, inventory: estimate, renderMeta };
    }

    if (surface === "auction") {
      const maxBid = maxRationalBid({ snapshot, historyStats, settings, quantity: visible.quantity, museum });
      const headroom = Number.isFinite(maxBid) ? maxBid - visible.price : null;
      const direct = visible.price > 0
        ? evaluateDirectBuy({ buyPrice: visible.price, quantity: visible.quantity, snapshot, historyStats, settings, forceYellow: true, museum })
        : null;
      return { visible, snapshot, historyStats, auction: { maxBid, headroom, direct }, renderMeta };
    }

    if (surface === "bazaar" && ownBazaar) {
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum });
      const target = estimate?.routes?.bazaar?.suggestedPrice;
      const delta = Number.isFinite(target) ? target - visible.price : null;
      return { visible, snapshot, historyStats, ownBazaar: { target, delta, estimate }, renderMeta };
    }

    let quantity = visible.quantity;
    if (surface === "travel" && settings.travelCapacity > 0) quantity = Math.min(quantity, settings.travelCapacity);
    if (surface === "travel" && settings.travelCapacity === 0) quantity = 1;
    const direct = evaluateDirectBuy({
      buyPrice: visible.price,
      quantity,
      snapshot,
      historyStats,
      settings,
      forceYellow: surface === "auction",
      museum
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

  async function scanVisibleSurface(surface, { retryIfEmpty = false, force = false, cancelObsolete = false } = {}) {
    removeFloatingUi();
    if (document.visibilityState !== "visible") return;

    const queueGroup = beginListQueueGroup(surface, { cancelObsolete });
    const ownBazaar = surface === "bazaar" ? await isOwnBazaar() : false;
    if (detectSurface() !== surface || document.visibilityState !== "visible") return;

    const requireMoney = surface !== "inventory";
    let items = surface === "auction"
      ? collectAuctionItems()
      : (surface === "bazaar" && ownBazaar ? collectOwnBazaarItems() : collectVisibleItems({ requireMoney }));

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
      museumContext = await loadMuseumContext(items.map((item) => item.itemId), { priority: 140 });
    } catch (error) {
      log("Museum context unavailable", error.message);
    }
    if (detectSurface() !== surface || document.visibilityState !== "visible") return;

    const tasks = items.map(async (visible, index) => {
      const priority = viewportPriority(visible, index);
      let renderedCached = false;
      try {
        if (!visible.card?.isConnected || detectSurface() !== surface) return;
        const meta = metadata.get(visible.itemId);
        if (meta && !metadataSupportsCommodity(meta) && settings.equipmentEnabled === false) {
          renderInlineResult(surface, { visible, unsupported: true, renderMeta: { stale: false } }, ownBazaar);
          return;
        }
        const sellSide = surface === "inventory" || (surface === "bazaar" && ownBazaar);
        if (meta && !metadataSupportsCommodity(meta) && sellSide) {
          // Sell-side equipment is priced only from its expanded details
          // panel. No market request is spent on the row itself.
          renderInlineResult(surface, { visible, equipment: {}, equipmentRowOnly: true, renderMeta: { stale: false } }, ownBazaar);
          return;
        }
        const museum = museumContext.get(visible.itemId) || null;

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
              museum
            );
            renderInlineResult(surface, result, ownBazaar);
          }
        });

        if (!visible.card?.isConnected || detectSurface() !== surface) return;
        // Metadata was unavailable and the order book revealed equipment on a
        // sell-side surface: stop here, no further requests for this row.
        if (bundle.snapshot?.equipment && sellSide) {
          renderInlineResult(surface, { visible, equipment: {}, equipmentRowOnly: true, renderMeta: { stale: false } }, ownBazaar);
          return;
        }
        const result = resultForSurface(surface, visible, bundle.snapshot, bundle.historyStats, ownBazaar, {
          stale: false,
          cacheAgeSeconds: bundle.cacheState?.ageSeconds
        }, museum);
        renderInlineResult(surface, result, ownBazaar);
      } catch (error) {
        if (error?.marketEdgeCanceled) return;
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
    await scanExpandedEquipment(surface, ownBazaar, queueGroup);
  }

  // Once a copy has been priced from its details panel, its value (and the
  // fill control on the Bazaar add form) moves onto the row so the player can
  // keep working from the list.
  function promoteCopyPriceToRow(surface, ownBazaar, detail, pricing, snapshot) {
    if (!detail?.row?.isConnected || !pricing?.bazaarSuggested) return;
    const copy = detail.copy;
    const label = [
      Number.isFinite(copy.quality) ? `Q ${copy.quality.toFixed(1)}%` : null,
      copy.bonuses.length ? copy.bonuses.map((bonus) => bonus.title).join("+") : "plain"
    ].filter(Boolean).join(" ");
    const items = surface === "bazaar" ? collectBazaarAddItems() : collectVisibleItems({ requireMoney: false });
    const visible = items.find((item) => item.card === detail.row || item.card.contains(detail.row) || detail.row.contains(item.card));
    const card = visible?.card || detail.row;
    card.dataset.meCopyPrice = String(pricing.bazaarSuggested);
    card.dataset.meCopyIm = String(pricing.itemMarketSuggested || "");
    card.dataset.meCopyLabel = label;
    if (!visible) return;
    renderInlineResult(surface, {
      visible,
      snapshot,
      equipment: snapshot.equipmentSummary || { plainFloor: null, bonusFloor: null },
      renderMeta: { stale: false }
    }, ownBazaar);
  }

  // Expanded item-details panels on sell-side surfaces: price the exact copy
  // against the deep order book (limit 100) and ended Auction House sales.
  function removeDetailCards(panel) {
    let card = findDetailCard(panel);
    while (card) {
      card.remove();
      card = findDetailCard(panel);
    }
  }

  // Torn keeps the details container when a panel collapses; the card must
  // not outlive the stats block it was attached to.
  function cleanupOrphanedDetailCards() {
    document.querySelectorAll(".me-equip-card").forEach((card) => {
      const previous = card.previousElementSibling;
      const anchored = previous && !previous.classList.contains("me-equip-card") && /Quality:\s*[^\d]*[\d.]+\s*%/i.test(previous.textContent || "");
      if (!anchored) card.remove();
    });
  }

  async function scanExpandedEquipment(surface, ownBazaar, queueGroup) {
    cleanupOrphanedDetailCards();
    if (settings.equipmentEnabled === false) return;
    const sellSide = surface === "inventory" || (surface === "bazaar" && ownBazaar);
    if (!sellSide || !Store.apiKey()) return;
    let details = [];
    try {
      details = collectExpandedEquipmentDetails(surface);
    } catch (error) {
      log("Details panel scan failed", error.message);
      return;
    }
    details = details.filter((detail) => {
      const card = findDetailCard(detail.panel);
      return !(card && card.dataset.meDetailKey === detail.key && card.dataset.meComplete === "1");
    });
    if (!details.length) return;

    await Promise.allSettled(details.map(async (detail) => {
      try {
        renderEquipmentDetailCard(detail, null, { loading: true });
        const bundle = await loadSnapshot(detail.itemId, { limit: API_DEEP_LIMIT, priority: 180, queueGroup });
        if (!detail.panel.isConnected || detectSurface() !== surface) return;
        if (!bundle.snapshot.equipment) {
          removeDetailCards(detail.panel);
          return;
        }
        const auctionSales = await loadAuctionSales(detail.itemId, { priority: 170 });
        if (!detail.panel.isConnected || detectSurface() !== surface) return;
        const pricing = priceOwnedEquipment({ snapshot: bundle.snapshot, copy: detail.copy, auctionSales, settings });
        renderEquipmentDetailCard(detail, pricing, { canFill: surface === "bazaar" && Boolean(detail.row) });
        promoteCopyPriceToRow(surface, ownBazaar, detail, pricing, bundle.snapshot);
      } catch (error) {
        if (error?.marketEdgeCanceled) return;
        log("Details pricing failed", detail.itemId, error.message);
        removeDetailCards(detail.panel);
      }
    }));
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
    const suggestion = evaluation.suggestedPrice ? formatMoney(evaluation.suggestedPrice) : "-";
    const versus = Number.isFinite(evaluation.versusAverage) ? `${evaluation.versusAverage >= 0 ? "+" : ""}${(evaluation.versusAverage * 100).toFixed(1)}%` : "-";
    const title = [
      `Net after ${evaluation.feeBps / 100}% fees: ${formatMoney(evaluation.net, true)}`,
      `Versus Torn daily average: ${versus}`,
      evaluation.note
    ].filter(Boolean).join("\n");
    return `<tr class="${stateClass}" title="${escapeHtml(title)}">
      <td>${name}${anonymous}</td>
      <td>${listing.amount}</td>
      <td>${formatMoney(listing.price)}</td>
      <td title="Cheapest listing on the Item Market">${floor}</td>
      <td title="Units listed cheaper than yours">${ahead}</td>
      <td><span class="me-pill ${stateClass}">${evaluation.status}</span>${evaluation.suggestedPrice ? ` <span class="me-inline-secondary" title="Floor minus your configured undercut">${suggestion}</span>` : ""}</td>
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
        <thead><tr><th>Item</th><th>Qty</th><th>Yours</th><th>Floor</th><th>Ahead</th><th>Status</th></tr></thead>
        <tbody>${listings.map((listing) => ownListingRowHtml(listing, evaluations.get(listing.listingId))).join("")}</tbody>
      </table>
      <div class="me-actions"><button class="me-btn me-refresh-listings" type="button">Refresh</button></div>
      ${panelToolbarHtml()}
      <div class="me-note">Floor comes from the official Item Market order book. "Ahead" counts units listed below your price. Suggested prices are floor minus your configured undercut; they are never applied automatically. Anonymous listings pay 15% total in fees${settings.anonymousFeeWaived ? " (waived by your company perk)" : ""}.</div>`;
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
        bindPanelToolbar();
      };
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
          evaluations.set(listing.listingId, evaluateOwnListing(listing, bundle.snapshot, settings));
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
    if (!entries.length || !Store.apiKey()) return;
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
    setPanel(`
      <div class="me-kicker">Watchlist ${settings.watchlistEnabled ? `- every ${intervalSec}s while visible` : "- disabled in settings"}</div>
      ${entries.length ? rows : `<div class="me-note">No watched items. Open an Item Market item and press Watch, or add an item ID in settings.</div>`}
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
      </div>`;
      menu.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", () => {
          menu.remove();
          const action = button.dataset.action;
          if (action === "settings") showSettings();
          else if (action === "analyze") analyzeCurrentPage();
          else if (action === "listings") renderOwnListingsPanel();
          else if (action === "watchlist") renderWatchlistPanel();
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

  function listSurfaceSignature(surface) {
    if (!["bazaar", "auction", "travel", "inventory"].includes(surface)) return "";
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
    if (surface === "bazaar" || surface === "inventory") {
      try {
        collectExpandedEquipmentDetails(surface).forEach((detail) => entries.add(`detail:${detail.key}@${listRowIdentity(detail.panel)}`));
      } catch {
        // Details detection is best effort.
      }
    }
    // The signature only needs to notice structural change, so it works on
    // the identity nodes themselves; row/card resolution (which reads
    // innerText and forces layout) is left to the scan.
    document.querySelectorAll(itemIdentitySelector()).forEach((node) => {
      if (node.closest?.("#market-edge-root,.me-inline-analysis,.me-equip-card")) return;
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

  let signatureDelayMs = 120;

  function scheduleSignatureCheck(forceScan = false) {
    clearTimeout(signatureTimer);
    signatureTimer = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const surface = detectSurface();
      if (!["bazaar", "auction", "travel", "inventory"].includes(surface)) return;
      const startedAt = Date.now();
      const signature = listSurfaceSignature(surface);
      // Adapt the quiet period to how long the check itself took, so a slow
      // phone under a React re-render storm is not asked to do it again
      // before it has caught up.
      const took = Date.now() - startedAt;
      signatureDelayMs = clamp(Math.round(took * 5), 120, 2000);
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
      if (["bazaar", "auction", "travel", "inventory"].includes(surface)) scheduleSignatureCheck(false);
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
      await renderItemMarket();
    } else {
      genericIntro(surface, { clear: true });
      scheduleSignatureCheck(false);
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
    const observerOptions = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-selected", "aria-hidden"]
    };
    let observedRoot = null;
    const contentObserver = new MutationObserver(() => {
      if (document.visibilityState !== "visible") return;
      const currentKey = `${detectSurface()}|${location.pathname}|${location.search}|${location.hash}`;
      if (currentKey !== lastLocationKey) {
        scheduleRefresh(true);
        return;
      }
      scheduleSignatureCheck(false);
    });

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
    else if (["bazaar", "auction", "travel", "inventory"].includes(surface)) scanVisibleSurface(surface, { force: true });
  }

  function registerMenu() {
    if (ENV.hasGmMenu) {
      try {
        GM_registerMenuCommand("Market Edge settings", showSettings);
        GM_registerMenuCommand("Market Edge analyze current page", analyzeCurrentPage);
        GM_registerMenuCommand("Market Edge my Item Market listings", () => renderOwnListingsPanel());
        GM_registerMenuCommand("Market Edge watchlist", () => renderWatchlistPanel());
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
      scanExpandedEquipment,
      collectExpandedEquipmentDetails,
      watchTick,
      loadMuseumContext,
      showSettings,
      addWatchItem,
      ensureLauncher,
      showToast,
      ui
    });
  } else {
    registerMenu();
    installNavigationHooks();
    scheduleRefresh(true);
    startWatchlist();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
