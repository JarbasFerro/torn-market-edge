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
