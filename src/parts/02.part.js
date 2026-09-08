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

