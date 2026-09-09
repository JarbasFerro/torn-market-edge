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
    // Structural rules only (the heading's position in the DOM proved
    // unreliable on a real device): never the equipped/loadout region, and
    // only rows inside Torn's item lists.
    const equippedAncestor = card.closest(
      ".equipped-items-wrap,[class*='equipped-items'],[class*='equippedItems'],[class*='loadout'],[class*='paperdoll'],[class*='paper-doll'],[class*='characterEquipment'],[class*='character-equipment']"
    );
    if (equippedAncestor) return false;
    // Action entries inside a row (equip, trash, send) are list items with
    // data-item too; they are never rows.
    if (card.matches("[data-action]") || card.closest("ul.actions-wrap, .actions-wrap, .actions")) return false;
    if (card.closest("ul.items-cont, .items-cont, [class*='inventoryList'], [class*='inventory-list'], .category-wrap, #category-wrap, .items-wrap")) return true;
    // Unknown container: fall back to "after the heading" when one exists.
    if (marker) {
      if (marker.contains(card)) return true;
      const relation = marker.compareDocumentPosition(card);
      return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
    }
    return false;
  }

  function itemIdentitySelector() {
    return [
      "li[data-item]:not([data-action])",
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
