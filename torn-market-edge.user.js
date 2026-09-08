// ==UserScript==
// @name         Torn Market Edge
// @namespace    https://github.com/JarbasFerro/torn-market-edge
// @version      0.2.2
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

/* global GM_xmlhttpRequest, GM_getValue, GM_setValue, GM_deleteValue, GM_addStyle, GM_registerMenuCommand */

(function marketEdgeBootstrap(global) {
  "use strict";

  // v0.2.2: SPA/API hardening plus explicit, user-triggered Bazaar add-form
  // price suggestions. Market Edge never submits a Bazaar form automatically.

  const APP = Object.freeze({
    name: "Market Edge",
    version: "0.2.2",
    schemaVersion: 1,
    logPrefix: "[MarketEdge]"
  });

  const ITEM_MARKET_FEE_BPS = 500;
  const BPS = 10000;
  const ONE_MINUTE_MS = 60 * 1000;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const HISTORY_MIN_GAP_MS = ONE_MINUTE_MS;
  const HISTORY_MAX_POINTS = 1000;
  const API_MAX_REQUESTS_PER_MINUTE = 45;
  const API_CONCURRENCY = 4;
  const API_LIST_LIMIT = 20;
  const API_DEEP_LIMIT = 100;
  const API_COMMENT = "market-edge";
  const SNAPSHOT_FALLBACK_FRESH_MS = 25000;
  const ITEM_META_TTL_MS = 7 * ONE_DAY_MS;

  const STORAGE_KEYS = Object.freeze({
    settings: "marketEdge.settings.v1",
    apiKey: "marketEdge.apiKey",
    playerId: "marketEdge.playerId",
    panelState: "marketEdge.panelState.v1",
    historyPrefix: "marketEdge.history.v1.",
    snapshotPrefix: "marketEdge.snapshot.v2.",
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
    minimumGreenConfidence: "MEDIUM",
    maxVolatility: 0.03,
    historyRetentionDays: 14,
    scanMaxVisibleItems: 30,
    travelCapacity: 0,
    developerMode: false
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

  function grossToItemMarketNet(gross) {
    const safeGross = Math.max(0, asInt(gross));
    // Conservative integer arithmetic: fee is treated as 5% of transaction gross,
    // then net proceeds are floored to whole Torn dollars.
    return Math.floor((safeGross * (BPS - ITEM_MARKET_FEE_BPS)) / BPS);
  }

  function itemMarketNetFor(pricePerUnit, quantity) {
    const price = Math.max(0, asInt(pricePerUnit));
    const qty = Math.max(0, asInt(quantity));
    return grossToItemMarketNet(price * qty);
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
    const unsupportedEquipment = hasDetailedListings || /weapon|armor|armour/i.test(itemType);
    const top20 = listings.slice(0, 20);
    const prices = listings.map((row) => row.price);
    const cacheTimestampSec = asInt(book?.cache_timestamp ?? payload?.cache_timestamp, 0);

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
        top5Quantity: listings.slice(0, 5).reduce((sum, row) => sum + row.quantity, 0),
        top20Quantity: top20.reduce((sum, row) => sum + row.quantity, 0)
      },
      medianListingPrice: median(prices),
      calculatedMarketAnchor: robustMarketAnchor(listings),
      supportedCommodity: !unsupportedEquipment
    };
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

    score = clamp(score, 0, 100);
    const label = score >= 78 ? "HIGH" : score >= 55 ? "MEDIUM" : score >= 32 ? "LOW" : "VERY LOW";
    return { score, label, freshness: fresh };
  }

  function chooseReference(snapshot, historyStats) {
    const historicalFairValue = historyStats?.historicalFairValue || null;
    if (historicalFairValue) return { value: historicalFairValue, source: "24h observed median" };
    const currentAnchor = snapshot?.calculatedMarketAnchor || null;
    const averagePrice = snapshot?.averagePrice || null;
    if (currentAnchor && averagePrice) {
      return { value: Math.min(currentAnchor, Math.round(averagePrice * 1.05)), source: "current depth + Torn value sanity check" };
    }
    if (currentAnchor) return { value: currentAnchor, source: "current market depth" };
    if (averagePrice) return { value: averagePrice, source: "Torn value sanity check" };
    return { value: null, source: "unavailable" };
  }

  function calculateExit({ snapshot, historyStats, nextAsk = null, settings }) {
    const currentAnchor = snapshot?.calculatedMarketAnchor || null;
    const historicalFair = historyStats?.historicalFairValue || null;
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

    if (!Number.isFinite(exitAnchor) || exitAnchor <= 0) return null;
    const warmupExtra = (historyStats?.oneDay?.count || 0) < 5 ? 0.02 : 0;
    const haircut = clamp(settings.safetyHaircut + warmupExtra, 0, 0.10);
    const conservativeExitPrice = Math.max(1, Math.floor(exitAnchor * (1 - haircut)));
    const itemMarketSuggestedPrice = Math.max(1, conservativeExitPrice - Math.max(0, asInt(settings.itemMarketUndercut)));
    const bazaarSuggestedPrice = Math.max(1, Math.floor(conservativeExitPrice * (1 - settings.bazaarDiscount)));

    return {
      exitAnchor,
      haircut,
      conservativeExitPrice,
      itemMarketSuggestedPrice,
      bazaarSuggestedPrice
    };
  }

  function routeEconomics(exit, quantity, settings) {
    const qty = Math.max(1, asInt(quantity, 1));
    const itemMarketGross = exit.itemMarketSuggestedPrice * qty;
    const itemMarketNet = itemMarketNetFor(exit.itemMarketSuggestedPrice, qty);
    const bazaarGross = exit.bazaarSuggestedPrice * qty;
    const bazaarNet = settings.bazaarEnabled ? bazaarGross : Number.NEGATIVE_INFINITY;
    const bestRoute = bazaarNet >= itemMarketNet ? "Bazaar" : "Item Market";
    return {
      itemMarket: {
        suggestedPrice: exit.itemMarketSuggestedPrice,
        gross: itemMarketGross,
        net: itemMarketNet,
        fee: itemMarketGross - itemMarketNet
      },
      bazaar: settings.bazaarEnabled ? {
        suggestedPrice: exit.bazaarSuggestedPrice,
        gross: bazaarGross,
        net: bazaarNet,
        fee: 0
      } : null,
      bestRoute,
      bestNet: bestRoute === "Bazaar" ? bazaarNet : itemMarketNet,
      bestNetPerUnit: Math.floor((bestRoute === "Bazaar" ? bazaarNet : itemMarketNet) / qty)
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

  function evaluatePrefixes(snapshot, historyStats, settings, nowMs = Date.now()) {
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
      const routes = routeEconomics(exit, quantityBought, settings);
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

  function evaluateDirectBuy({ buyPrice, quantity = 1, snapshot, historyStats, settings, nowMs = Date.now(), forceYellow = false }) {
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
    const routes = routeEconomics(exit, qty, settings);
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

  function maxRationalBid({ snapshot, historyStats, settings, quantity = 1 }) {
    if (!snapshot?.supportedCommodity) return null;
    const qty = Math.max(1, asInt(quantity, 1));
    const exit = calculateExit({ snapshot, historyStats, settings });
    if (!exit) return null;
    const routes = routeEconomics(exit, qty, settings);
    const reference = chooseReference(snapshot, historyStats).value;
    const maxByRoi = Math.floor((routes.bestNet / qty) / (1 + settings.minimumROI));
    const maxByProfit = Math.floor((routes.bestNet - settings.minimumProfit) / qty);
    const maxByDiscount = reference ? Math.floor(reference * (1 - settings.minimumDiscount)) : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(maxByRoi, maxByProfit, maxByDiscount));
  }

  function estimateInventoryExit({ quantity, snapshot, historyStats, settings }) {
    const qty = Math.max(1, asInt(quantity, 1));
    if (!snapshot?.supportedCommodity) return null;
    const exit = calculateExit({ snapshot, historyStats, settings });
    if (!exit) return null;
    const routes = routeEconomics(exit, qty, settings);
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

  const TEST_EXPORTS = Object.freeze({
    APP,
    DEFAULTS,
    median,
    mad,
    weightedMedian,
    robustMarketAnchor,
    normalizeMarketResponse,
    calculateHistoryStats,
    freshness,
    confidenceForOpportunity,
    chooseReference,
    calculateExit,
    routeEconomics,
    grossToItemMarketNet,
    itemMarketNetFor,
    evaluatePrefixes,
    evaluateDirectBuy,
    maxRationalBid,
    estimateInventoryExit,
    formatMoney,
    parseMoney,
    parseQuantity
  });

  global.__MARKET_EDGE_TEST__ = TEST_EXPORTS;
  if (typeof document === "undefined" || typeof window === "undefined") return;

  // ---------------------------------------------------------------------------
  // Configuration and storage
  // ---------------------------------------------------------------------------

  class Store {
    static get(key, fallback) {
      try {
        const value = GM_getValue(key, fallback);
        return value === undefined ? fallback : value;
      } catch (error) {
        console.warn(APP.logPrefix, "Storage read failed", key, error);
        return fallback;
      }
    }

    static set(key, value) {
      try {
        GM_setValue(key, value);
      } catch (error) {
        console.warn(APP.logPrefix, "Storage write failed", key, error);
      }
    }

    static delete(key) {
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
      return String(Store.get(STORAGE_KEYS.apiKey, "") || "").trim();
    }

    static setApiKey(key) {
      Store.set(STORAGE_KEYS.apiKey, String(key || "").trim());
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
        supportedCommodity: raw.supportedCommodity !== false
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
        supportedCommodity: snapshot.supportedCommodity
      });
    }

    static itemMeta(itemId) {
      const raw = Store.get(`${STORAGE_KEYS.itemMetaPrefix}${asInt(itemId)}`, null);
      if (!raw || typeof raw !== "object" || !raw.savedAt) return null;
      if (Date.now() - asInt(raw.savedAt) > ITEM_META_TTL_MS) return null;
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
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: "GET",
            url: this.buildUrl(path),
            headers: {
              Authorization: `ApiKey ${key}`,
              Accept: "application/json"
            },
            timeout: 20000,
            onload: (response) => {
              let body;
              try {
                body = JSON.parse(response.responseText || "{}");
              } catch {
                reject(new Error(`Torn API returned invalid JSON (HTTP ${response.status}).`));
                return;
              }
              if (response.status < 200 || response.status >= 300) {
                const message = body?.error?.error || body?.error?.message || `HTTP ${response.status}`;
                reject(new Error(`Torn API: ${message}`));
                return;
              }
              if (body?.error) {
                reject(new Error(`Torn API: ${body.error.error || body.error.message || "Unknown error"}`));
                return;
              }
              resolve(body);
            },
            onerror: () => reject(new Error("Unable to reach the Torn API.")),
            ontimeout: () => reject(new Error("Torn API request timed out."))
          });
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

    async testKey() {
      const data = await this.request("/user/basic", { cacheMs: 0, priority: 100 });
      const playerId = asInt(data?.profile?.id ?? data?.basic?.id ?? data?.player_id ?? data?.id, 0);
      if (playerId) Store.set(STORAGE_KEYS.playerId, playerId);
      return { ok: true, playerId: playerId || null, data };
    }

    async itemMarket(itemId, { limit = API_LIST_LIMIT, priority = 0, queueGroup = null } = {}) {
      const safeLimit = clamp(asInt(limit, API_LIST_LIMIT), 1, API_DEEP_LIMIT);
      return this.request(`/market/${asInt(itemId)}/itemmarket?limit=${safeLimit}&offset=0`, { priority, queueGroup });
    }

    async items(itemIds, { priority = 120 } = {}) {
      const ids = Array.from(new Set(itemIds.map((id) => asInt(id)).filter(Boolean))).slice(0, 100);
      if (!ids.length) return { items: [] };
      return this.request(`/torn/${ids.join(",")}/items`, { cacheMs: ONE_DAY_MS, priority });
    }
  }

  const api = new TornApi();

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
    return !/weapon|armor|armour/i.test(String(meta.type || ""));
  }

  async function loadItemMetadataBatch(itemIds) {
    const ids = Array.from(new Set(itemIds.map((id) => asInt(id)).filter(Boolean)));
    const result = new Map();
    const missing = [];
    ids.forEach((id) => {
      const cached = Store.itemMeta(id);
      if (cached) result.set(id, cached);
      else missing.push(id);
    });
    if (!missing.length) return result;

    const payload = await api.items(missing, { priority: 150 });
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    rows.forEach((item) => {
      const meta = normalizeItemMeta(item);
      if (!meta) return;
      Store.saveItemMeta(meta);
      result.set(meta.id, meta);
    });
    return result;
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
    for (const node of candidates) {
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

  function bazaarAddSection() {
    if (detectSurface() !== "bazaar") return null;
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
      let node = heading;
      let fallback = heading.parentElement;
      for (let depth = 0; node && depth < 9 && node !== document.body; depth += 1, node = node.parentElement) {
        if (!(node instanceof HTMLElement)) continue;
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        if (text.length > 8000) continue;
        if (node.querySelector("input")) fallback = node;
        if (/You are adding\s+\d+\s+items?\s+across\s+\d+\s+categor/i.test(text) && /ADD TO BAZAAR/i.test(text) && node.querySelector("input")) {
          return node;
        }
      }
      if (fallback?.querySelector?.("input")) return fallback;
    }
    return null;
  }

  function findBazaarAddRow(start, section) {
    if (!start || !section) return null;
    let node = start instanceof HTMLElement ? start : start.parentElement;
    let fallback = null;
    for (let depth = 0; node && depth < 9 && node !== section.parentElement; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement) || !section.contains(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.height > 140) continue;
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 300) continue;
      const ids = directItemIdsWithin(node);
      if (ids.size !== 1) continue;
      const visibleInputs = Array.from(node.querySelectorAll("input")).filter((input) => {
        const inputRect = input.getBoundingClientRect();
        return inputRect.width > 0 && inputRect.height > 0 && input.type !== "hidden";
      });
      if (!visibleInputs.length) continue;
      fallback = node;
      if (/^(?:x|\u00d7)\s*[\d,]+\s+\S+/i.test(text) || /\bQty\b/i.test(text)) return node;
      if (node.matches("li,tr,[role='row'],[class*='row'],[class*='item']")) return node;
    }
    return fallback;
  }

  function findBazaarAddPriceInput(card) {
    if (!card) return null;
    const candidates = Array.from(card.querySelectorAll("input")).filter((input) => {
      const rect = input.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !["hidden", "checkbox", "radio"].includes(input.type);
    });
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const scored = candidates.map((input) => {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.className || ""}`;
      let score = 0;
      if (/price|cost|unit/i.test(metadata)) score += 120;
      if (/qty|quantity|amount|count/i.test(metadata)) score -= 180;
      const rect = input.getBoundingClientRect();
      return { input, score, left: rect.left };
    });
    scored.sort((a, b) => b.score - a.score || b.left - a.left);
    return scored[0]?.input || null;
  }

  function collectBazaarAddItems() {
    const section = bazaarAddSection();
    if (!section) return [];

    const byCard = new Map();
    section.querySelectorAll(itemIdentitySelector()).forEach((node) => {
      if (node.closest("#market-edge-root,.me-inline-analysis")) return;
      const itemId = itemIdFromElement(node);
      if (!itemId) return;
      const card = findBazaarAddRow(node, section);
      if (!card || card.closest("#market-edge-root")) return;
      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) return;
      const text = card.innerText || "";
      const quantity = parseQuantity(text);
      const name = elementItemName(card, node);
      const key = card;
      const existing = byCard.get(key);
      const score = Math.min(text.length, 1000);
      if (!existing || score < existing.domTextLength) {
        byCard.set(key, {
          itemId,
          name,
          price: parseIntegerField(priceInput.value) || 0,
          quantity,
          card,
          priceInput,
          bazaarAdd: true,
          inlineAnchor: findItemTextHost(card, name),
          inlineMode: "inline",
          domTextLength: score
        });
      }
    });

    return Array.from(byCard.values())
      .sort((a, b) => viewportPriority(b) - viewportPriority(a))
      .slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  function collectManagedBazaarItems() {
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

  function collectOwnBazaarItems() {
    const combined = [...collectManagedBazaarItems(), ...collectBazaarAddItems()];
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
    renderedBadges: new Set()
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
    @media (max-width: 600px) { #market-edge-root { right:6px; bottom:6px; width:calc(100vw - 12px); } .me-body { max-height:58vh; } }
  `;

  try { GM_addStyle(CSS); } catch { /* no-op */ }

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

        <div class="me-section-title">Exit assumptions</div>
        <div class="me-form-grid">
          <label>Bazaar enabled</label><input data-setting="bazaarEnabled" type="checkbox" ${current.bazaarEnabled ? "checked" : ""}>
          <label>Bazaar discount (%)</label><input data-setting="bazaarDiscount" data-percent="1" type="number" min="0" max="20" step="0.1" value="${current.bazaarDiscount * 100}">
          <label>Safety haircut (%)</label><input data-setting="safetyHaircut" data-percent="1" type="number" min="0" max="10" step="0.1" value="${current.safetyHaircut * 100}">
          <label>Historical premium cap (%)</label><input data-setting="allowedHistoricalPremium" data-premium="1" type="number" min="0" max="10" step="0.1" value="${(current.allowedHistoricalPremium - 1) * 100}">
          <label>Item Market undercut ($)</label><input data-setting="itemMarketUndercut" type="number" min="0" step="1" value="${current.itemMarketUndercut}">
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
        <div class="me-form-help">The API key stays in Tampermonkey storage and is sent only to api.torn.com. Market Edge never includes it in diagnostics or exports. Item Market sale fee is fixed at 5% in this release.</div>
        <div class="me-modal-actions"><button class="me-btn" id="me-cancel-settings" type="button">Cancel</button><button class="me-btn" id="me-save-settings" type="button">Save</button></div>
      </div>`;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    backdrop.querySelector("#me-cancel-settings").addEventListener("click", close);
    backdrop.querySelector("#me-test-key").addEventListener("click", async () => {
      const status = backdrop.querySelector("#me-api-status");
      Store.setApiKey(backdrop.querySelector("#me-api-key").value);
      api.memoryCache.clear();
      status.textContent = "Testing...";
      try {
        const result = await api.testKey();
        status.textContent = result.playerId ? `OK - player ${result.playerId}` : "OK";
        status.className = "me-good";
      } catch (error) {
        status.textContent = error.message;
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
      Store.setApiKey(backdrop.querySelector("#me-api-key").value);
      Store.saveSettings(next);
      settings = Store.settings();
      api.memoryCache.clear();
      close();
      scheduleRefresh(true);
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
  }

  function removeFloatingUi() {
    if (ui.root?.isConnected) ui.root.remove();
    ui.root = null;
    ui.body = null;
    ui.title = null;
    ui.status = null;
  }

  function inlineHostFor(visible) {
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

  function setBazaarPriceInput(input, value) {
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
    const block = renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Suggested Bazaar selling price">${targetText}</span><button class="me-bazaar-fill-btn" type="button" aria-label="Set Bazaar price to ${escapeHtml(targetText)}" title="Fill Torn price field with ${escapeHtml(targetText)}">&gt;</button>${stale}`,
      "GREY",
      "me-bazaar-add"
    );
    const button = block?.querySelector?.(".me-bazaar-fill-btn");
    if (!button || !visible.priceInput) return block;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!visible.priceInput?.isConnected) return;
      if (!setBazaarPriceInput(visible.priceInput, target)) return;
      visible.price = target;
      block.classList.add("me-applied");
      button.title = `Price filled with ${targetText}`;
      setTimeout(() => block?.classList?.remove("me-applied"), 700);
    });
    return block;
  }

  function renderInlineResult(surface, result, ownBazaar) {
    const visible = result.visible;
    if (!visible || !visible.card?.isConnected) return null;
    const stale = staleMarker(result);
    if (result.error) return renderInlineError(visible, result.error);
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
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="${bzClass}">BZ ${bzValue}</span><span class="me-inline-sep">|</span><span class="${imClass}">IM ${imValue}</span>${stale}`,
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

  async function renderItemMarket() {
    const itemId = getItemIdFromLocation();
    if (!itemId) {
      setPanel(`<div class="me-kicker">Item Market</div><div class="me-note">Open a specific stackable item to analyze its order book.</div>`);
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
        setPanel(`<div class="me-kicker">Item Market</div><div class="me-item-name">${escapeHtml(snapshot.itemName)}</div><div class="me-callout GREY"><div class="me-decision GREY">- NOT SUPPORTED</div><div class="me-note">Advanced equipment valuation is not supported yet.</div></div>`);
        return;
      }

      const liveRows = parseLiveItemMarketListings();

      // The official Torn API is the authoritative valuation source. The live
      // DOM is used only to confirm/highlight what the player currently sees.
      const evaluated = evaluatePrefixes(snapshot, historyStats, settings);
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
      const currentDiscount = reference.value && snapshot.lowestPrice ? 1 - snapshot.lowestPrice / reference.value : null;
      const sourceWarning = liveRows.length >= 2 && !liveMatchesApi
        ? `<div class="me-note me-warn">The visible Torn listings differ from the current API cache. Market Edge is keeping the official API snapshot authoritative and will not mix the two books.</div>`
        : "";

      setPanel(`
        <div class="me-kicker">Item Market - ${escapeHtml(liveConfirmation)}</div>
        <div class="me-item-name">${escapeHtml(snapshot.itemName)}</div>
        ${metricRows([
          ["Lowest", `<span title="${formatMoney(snapshot.lowestPrice, true)}">${formatMoney(snapshot.lowestPrice)}</span>`],
          ["Current anchor", `<span title="${formatMoney(snapshot.calculatedMarketAnchor, true)}">${formatMoney(snapshot.calculatedMarketAnchor)}</span>`],
          ["24h fair value", historyStats.historicalFairValue ? `<span title="${formatMoney(historyStats.historicalFairValue, true)}">${formatMoney(historyStats.historicalFairValue)}</span>` : "Learning...", learning ? "me-learning" : ""],
          ["Lowest discount", Number.isFinite(currentDiscount) ? `${(currentDiscount * 100).toFixed(2)}%` : "-"],
          ["24h MAD volatility", Number.isFinite(historyStats.oneDay.volatility) ? `${(historyStats.oneDay.volatility * 100).toFixed(2)}%` : "-"],
          ["API age", `${formatAge(fresh.ageSeconds)} - ${fresh.label}`],
          ["Observations (24h)", String(historyStats.oneDay.count)]
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
          ["IM net after 5%", formatMoney(Math.floor(best.routes.itemMarket.net / best.quantityBought))]
        ]) : `<div class="me-note">No affordable prefix with positive expected profit.</div>`}
        <div class="me-rule"></div>
        ${decisionHtml(best)}
        ${diagnosticsHtml(best)}
        ${learning ? `<div class="me-note me-learning">Learning market... ${historyStats.oneDay.count} observations collected. Until 5 observations, Market Edge applies an extra 2% safety haircut and does not treat current lowest as fair value.</div>` : ""}
        <div class="me-note">Facts: official API asks and 5% Item Market fee. The visible page is used only for confirmation/highlighting. Local data: observed anchors. Exit, profit and confidence are estimates - not guarantees.</div>
      `, fresh.label);

      if (liveMatchesApi) highlightItemMarketRows(liveRows, best);
      else clearBadges();
    } catch (error) {
      errorPanel(error.message);
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

  function resultForSurface(surface, visible, snapshot, historyStats, ownBazaar, renderMeta = {}) {
    if (!snapshot?.supportedCommodity) return { visible, snapshot, unsupported: true, renderMeta };

    if (surface === "inventory") {
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings });
      return { visible, snapshot, historyStats, inventory: estimate, renderMeta };
    }

    if (surface === "auction") {
      const maxBid = maxRationalBid({ snapshot, historyStats, settings, quantity: visible.quantity });
      const headroom = Number.isFinite(maxBid) ? maxBid - visible.price : null;
      const direct = visible.price > 0
        ? evaluateDirectBuy({ buyPrice: visible.price, quantity: visible.quantity, snapshot, historyStats, settings, forceYellow: true })
        : null;
      return { visible, snapshot, historyStats, auction: { maxBid, headroom, direct }, renderMeta };
    }

    if (surface === "bazaar" && ownBazaar) {
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings });
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
      forceYellow: surface === "auction"
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

    const tasks = items.map(async (visible, index) => {
      const priority = viewportPriority(visible, index);
      let renderedCached = false;
      try {
        if (!visible.card?.isConnected || detectSurface() !== surface) return;
        const meta = metadata.get(visible.itemId);
        if (meta && !metadataSupportsCommodity(meta)) {
          renderInlineResult(surface, { visible, unsupported: true, renderMeta: { stale: false } }, ownBazaar);
          return;
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
              { stale: Boolean(cached.refreshing), cacheAgeSeconds: cached.cacheState?.ageSeconds }
            );
            renderInlineResult(surface, result, ownBazaar);
          }
        });

        if (!visible.card?.isConnected || detectSurface() !== surface) return;
        const result = resultForSurface(surface, visible, bundle.snapshot, bundle.historyStats, ownBazaar, {
          stale: false,
          cacheAgeSeconds: bundle.cacheState?.ageSeconds
        });
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
    document.querySelectorAll(itemIdentitySelector()).forEach((node) => {
      if (node.closest?.("#market-edge-root,.me-inline-analysis")) return;
      const itemId = itemIdFromElement(node);
      if (!itemId) return;
      const card = surface === "inventory" ? findInventoryRow(node) : findCompactCard(node, false);
      if (surface === "inventory" && !isInventoryListCandidate(card, marker)) return;
      const rect = card?.getBoundingClientRect?.();
      if (rect && (rect.width <= 0 || rect.height <= 0)) return;
      entries.add(`${itemId}@${listRowIdentity(node)}`);
    });
    const structuralEntries = Array.from(entries).sort();
    const heading = surface === "inventory"
      ? String(marker?.textContent || "").replace(/\s+/g, " ").trim()
      : "";
    return `${surface}|${heading}|${structuralEntries.join(",")}`;
  }

  function scheduleSignatureCheck(forceScan = false) {
    clearTimeout(signatureTimer);
    signatureTimer = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const surface = detectSurface();
      if (!["bazaar", "auction", "travel", "inventory"].includes(surface)) return;
      const signature = listSurfaceSignature(surface);
      if (!signature) return;
      if (forceScan || signature !== lastListSignature) {
        lastListSignature = signature;
        scanVisibleSurface(surface, { retryIfEmpty: false, force: false, cancelObsolete: true });
      }
    }, 120);
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
    clearBadges();
    lastListSignature = "";

    if (surface === "other") {
      cancelQueuedListRequests("Market Edge left a supported market/list view.");
      clearInlineAnalysis();
      removeFloatingUi();
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

    const observer = new MutationObserver(() => {
      if (document.visibilityState !== "visible") return;
      const currentKey = `${detectSurface()}|${location.pathname}|${location.search}|${location.hash}`;
      if (currentKey !== lastLocationKey) {
        scheduleRefresh(true);
        return;
      }
      scheduleSignatureCheck(false);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-selected", "aria-hidden"]
    });
  }

  try {
    GM_registerMenuCommand("Market Edge settings", showSettings);
    GM_registerMenuCommand("Market Edge analyze current page", () => {
      const surface = detectSurface();
      if (surface === "itemmarket") renderItemMarket();
      else if (["bazaar", "auction", "travel", "inventory"].includes(surface)) scanVisibleSurface(surface, { force: true });
    });
  } catch {
    // Menu commands are optional.
  }

  installNavigationHooks();
  scheduleRefresh(true);
})(typeof globalThis !== "undefined" ? globalThis : this);
