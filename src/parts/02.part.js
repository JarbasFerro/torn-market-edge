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
  const ITEM_RECORD_PREFIXES = Object.freeze([
    STORAGE_KEYS.snapshotPrefix,
    STORAGE_KEYS.historyPrefix,
    STORAGE_KEYS.itemMetaPrefix,
    STORAGE_KEYS.auctionSalesPrefix
  ]);
  const DELETED = Symbol("deleted");

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

  function localFallbackKeys() {
    const keys = [];
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const name = window.localStorage.key(index) || "";
        if (name.startsWith(LOCAL_STORAGE_PREFIX)) keys.push(name.slice(LOCAL_STORAGE_PREFIX.length));
      }
    } catch {
      // ignore
    }
    return keys;
  }

  function gmRead(key, fallback) {
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

  function gmWrite(key, value) {
    try {
      GM_setValue(key, value);
    } catch (error) {
      console.warn(APP.logPrefix, "Storage write failed", key, error);
      localFallbackSet(key, value);
    }
  }

  function gmDelete(key) {
    if (!ENV.hasGmDelete) {
      localFallbackDelete(key);
      return;
    }
    try {
      GM_deleteValue(key);
    } catch (error) {
      console.warn(APP.logPrefix, "Storage delete failed", key, error);
    }
  }

  function gmKeys() {
    try {
      if (typeof GM_listValues === "function") return Array.from(GM_listValues() || []).map(String);
    } catch {
      // fall through
    }
    return localFallbackKeys();
  }

  // Torn PDA 3.15+ offers an async SQLite store (PDA_storage) with its own
  // quota, separate from the shared, evictable localStorage that backs the
  // GM_* shim. When present it is loaded once and becomes the backend.
  const pdaStorage = (() => {
    try {
      // eslint-disable-next-line no-undef
      const candidate = typeof PDA_storage !== "undefined" ? PDA_storage : null;
      return candidate && typeof candidate.loadAll === "function" && typeof candidate.setMany === "function" ? candidate : null;
    } catch {
      return null;
    }
  })();

  // Every read goes through an in-memory map; writes land in memory at once
  // and reach the backend in one batched flush shortly after (or on
  // pagehide). Per-row code can therefore call Store.pricingRules() or
  // Store.history() freely without re-parsing JSON each time.
  class Store {
    static ready() {
      if (Store.readyPromise) return Store.readyPromise;
      Store.readyPromise = (async () => {
        if (Store.backend !== "pda") return;
        try {
          const all = await pdaStorage.loadAll();
          const entries = all instanceof Map ? Array.from(all.entries()) : Object.entries(all || {});
          entries.forEach(([key, value]) => {
            if (!Store.dirty.has(key)) Store.memory.set(key, value);
          });
          // First run on PDA_storage: carry the player's settings over from
          // the localStorage-backed GM shim so nothing is lost.
          if (!Store.memory.has(STORAGE_KEYS.settings) && ENV.hasGmStorage) {
            const migrate = [STORAGE_KEYS.settings, STORAGE_KEYS.apiKey, STORAGE_KEYS.keyInfo, STORAGE_KEYS.playerId, STORAGE_KEYS.panelState,
              STORAGE_KEYS.watchlist, STORAGE_KEYS.sellWatch, STORAGE_KEYS.pricingRules];
            migrate.forEach((key) => {
              const value = gmRead(key, undefined);
              if (value !== undefined && value !== null && value !== "") Store.set(key, value);
            });
          }
        } catch (error) {
          console.warn(APP.logPrefix, "PDA storage unavailable; using the GM shim", error);
          Store.backend = ENV.hasGmStorage ? "gm" : "local";
        }
      })();
      return Store.readyPromise;
    }

    static backendGet(key, fallback) {
      if (Store.backend === "pda") return fallback;
      if (Store.backend === "gm") return gmRead(key, fallback);
      return localFallbackGet(key, fallback);
    }

    static get(key, fallback) {
      if (Store.memory.has(key)) {
        const value = Store.memory.get(key);
        return value === undefined || value === DELETED ? fallback : value;
      }
      const value = Store.backendGet(key, fallback);
      if (value !== fallback) Store.memory.set(key, value);
      return value;
    }

    static set(key, value) {
      Store.memory.set(key, value);
      Store.dirty.set(key, value);
      Store.scheduleFlush();
    }

    static delete(key) {
      Store.memory.set(key, DELETED);
      Store.dirty.set(key, DELETED);
      Store.scheduleFlush();
    }

    static scheduleFlush() {
      if (Store.flushTimer) return;
      Store.flushTimer = setTimeout(() => Store.flush(), STORE_FLUSH_DELAY_MS);
    }

    static flush() {
      if (Store.flushTimer) {
        clearTimeout(Store.flushTimer);
        Store.flushTimer = null;
      }
      if (!Store.dirty.size) return;
      const batch = Array.from(Store.dirty.entries());
      Store.dirty.clear();
      if (Store.backend === "pda") {
        const sets = {};
        let setCount = 0;
        batch.forEach(([key, value]) => {
          if (value === DELETED) {
            Promise.resolve(pdaStorage.delete(key)).catch(() => {});
            return;
          }
          sets[key] = value;
          setCount += 1;
        });
        if (setCount) {
          Promise.resolve(pdaStorage.setMany(sets)).catch((error) => {
            console.warn(APP.logPrefix, "PDA storage write failed", error?.code || error);
            // Quota pressure: drop the oldest item records and keep the
            // player's own data (settings, key, rules) in the GM shim.
            if (/quota/i.test(String(error?.code || error?.message || ""))) Store.prune({ max: Math.floor(STORE_MAX_ITEM_RECORDS / 2) });
            if (ENV.hasGmStorage) Object.entries(sets).forEach(([key, value]) => { if (!ITEM_RECORD_PREFIXES.some((prefix) => key.startsWith(prefix))) gmWrite(key, value); });
          });
        }
        return;
      }
      batch.forEach(([key, value]) => {
        if (value === DELETED) {
          if (Store.backend === "gm") gmDelete(key); else localFallbackDelete(key);
        } else if (Store.backend === "gm") gmWrite(key, value);
        else localFallbackSet(key, value);
      });
    }

    static keys() {
      const known = new Set(Array.from(Store.memory.keys()).filter((key) => Store.memory.get(key) !== DELETED));
      let stored = [];
      try {
        if (Store.backend === "pda") stored = [];
        else if (Store.backend === "gm") stored = gmKeys();
        else stored = localFallbackKeys();
      } catch {
        stored = [];
      }
      stored.forEach((key) => { if (Store.memory.get(key) !== DELETED) known.add(key); });
      return Array.from(known);
    }

    // Keep the persisted per-item records (order books, history, metadata,
    // auction sales) bounded: oldest first, once the count exceeds the cap.
    static prune({ max = STORE_MAX_ITEM_RECORDS } = {}) {
      const records = Store.keys().filter((key) => ITEM_RECORD_PREFIXES.some((prefix) => key.startsWith(prefix)));
      if (records.length <= max) return 0;
      const aged = records.map((key) => {
        const value = Store.get(key, null);
        const savedAt = asInt(value?.savedAt, 0)
          || asInt(value?.timestampObserved, 0) * 1000
          || (Array.isArray(value) && value.length ? asInt(value[value.length - 1]?.timestamp, 0) * 1000 : 0);
        return { key, savedAt };
      }).sort((a, b) => a.savedAt - b.savedAt);
      const excess = aged.slice(0, records.length - max);
      excess.forEach((entry) => Store.delete(entry.key));
      return excess.length;
    }

    // Another Torn tab may have written settings or rules while this one was
    // hidden: forget cached reads when the tab comes back.
    static invalidate() {
      Store.flush();
      Store.memory.forEach((value, key) => {
        if (Store.backend !== "pda" && !ITEM_RECORD_PREFIXES.some((prefix) => key.startsWith(prefix))) Store.memory.delete(key);
      });
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
      // Normalised once per stored object; rows ask for the rules repeatedly.
      const raw = Store.get(STORAGE_KEYS.pricingRules, {});
      if (Store.rulesCache?.raw === raw) return Store.rulesCache.rules;
      const rules = normalizePricingRules(raw);
      Store.rulesCache = { raw, rules };
      return rules;
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

  Store.memory = new Map();
  Store.dirty = new Map();
  Store.flushTimer = null;
  Store.readyPromise = null;
  Store.backend = pdaStorage ? "pda" : (ENV.hasGmStorage ? "gm" : "local");

  let settings = Store.settings();

  window.addEventListener("pagehide", () => Store.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      Store.flush();
      return;
    }
    Store.invalidate();
    settings = Store.settings();
  });

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
  const PDA_DEDUPE_WINDOW_MS = 2100;

  function normalizeTransportResponse(response) {
    if (typeof response?.text === "function" && response.responseText === undefined) {
      return Promise.resolve(response.text()).then((text) => ({ status: asInt(response.status, 200), responseText: String(text ?? "") }));
    }
    return Promise.resolve({ status: asInt(response?.status, 200), responseText: String(response?.responseText ?? "") });
  }

  function transportGet(url, headers, { attempt = 0 } = {}) {
    if (ENV.hasPdaRequest) {
      // Torn PDA returns undefined (no request made) when the same URL was
      // requested within the last two seconds. Waiting out that window and
      // retrying keeps the cache hit free; a nonce parameter would cost quota.
      return Promise.resolve(PDA_httpGet(url, headers)).then((response) => {
        if (response === undefined || response === null) {
          if (attempt >= 1) throw new Error("Torn PDA skipped a duplicate request; try again in a moment.");
          return new Promise((resolve) => setTimeout(resolve, PDA_DEDUPE_WINDOW_MS)).then(() => transportGet(url, headers, { attempt: attempt + 1 }));
        }
        return normalizeTransportResponse(response);
      });
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

    remember(cacheKey, data) {
      // Bounded, least-recently-set: expired entries go first, then the oldest.
      if (this.memoryCache.size >= API_MEMORY_CACHE_MAX) {
        const now = Date.now();
        for (const [key, entry] of this.memoryCache) {
          if (now - entry.at > 5 * ONE_MINUTE_MS) this.memoryCache.delete(key);
        }
        while (this.memoryCache.size >= API_MEMORY_CACHE_MAX) {
          const oldest = this.memoryCache.keys().next().value;
          if (oldest === undefined) break;
          this.memoryCache.delete(oldest);
        }
      }
      this.memoryCache.delete(cacheKey);
      this.memoryCache.set(cacheKey, { at: Date.now(), data });
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
          this.remember(cacheKey, data);
          return data;
        })
        .finally(() => this.inFlight.delete(cacheKey));
