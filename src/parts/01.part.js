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
