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
          maxAgeMs: sellSideSurface ? SELL_SIDE_SNAPSHOT_MAX_AGE_MS : 0,
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
    if (surface === "inventory") restoreScrollAfterTabSwitch();
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
    let hiddenTab = 0;
    const samples = [];
    overlays.slice(0, 80).forEach((overlay) => {
      // Rows of other (collapsed) category tabs stay in the DOM; they are
      // expected to have no box and say nothing about the visible tab.
      const list = overlay.closest("ul.items-cont, .items-cont");
      if (list && (list.getAttribute("aria-expanded") === "false" || /display\s*:\s*none/i.test(list.getAttribute("style") || ""))) {
        hiddenTab += 1;
        return;
      }
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
    const checked = Math.min(overlays.length, 80) - hiddenTab;
    return `overlay visibility: ${visible}/${checked} visible on this tab, ${clipped} clipped, ${zero} zero-size, ${offscreen} off-screen horizontally, ${hiddenTab} in collapsed tabs${samples.length ? ` (${samples.join("; ")})` : ""}`;
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

  // Why does (or doesn't) the inventory collector see rows on this tab?
  // Lists every item list with its attributes and the collector's verdict on
  // the first rows of the lists that are on screen.
  function inventoryDetectionTrace() {
    const lines = ["--- inventory detection trace"];
    try {
      const lists = Array.from(document.querySelectorAll("ul.items-cont, .items-cont, [class*='inventoryList'], [class*='inventory-list']"));
      lines.push(`item lists: ${lists.length}`);
      lists.slice(0, 12).forEach((list, index) => {
        const box = list.getBoundingClientRect();
        const attrs = Array.from(list.attributes || []).filter((attr) => attr.name !== "class").map((attr) => `${attr.name}=${String(attr.value).slice(0, 24)}`).join(" ");
        lines.push(`  list ${index + 1}: ${list.tagName.toLowerCase()}${list.id ? `#${list.id}` : ""} class="${String(list.className).slice(0, 60)}" ${attrs} | li[data-item]: ${list.querySelectorAll("li[data-item]").length}, children: ${list.childElementCount}, box ${Math.round(box.width)}x${Math.round(box.height)} top ${Math.round(box.top)}, equipped-ancestor: ${Boolean(list.closest(".equipped-items-wrap,[class*='equipped-items'],[class*='equippedItems']"))}`);
      });
      const shown = lists.filter((list) => { const box = list.getBoundingClientRect(); return box.height > 0 && box.width > 0; });
      const sample = (shown[0] || lists[0])?.querySelectorAll("li[data-item]:not([data-action])") || [];
      Array.from(sample).slice(0, 3).forEach((li, index) => {
        const box = li.getBoundingClientRect();
        const ids = Array.from(directItemIdsWithin(li));
        const row = findInventoryRow(li);
        lines.push(`  row ${index + 1}: ${describeNode(li)} box ${Math.round(box.width)}x${Math.round(box.height)} | ids ${JSON.stringify(ids)} | findInventoryRow: ${row ? (row === li ? "self" : describeNode(row)) : "none"} | candidate: ${isInventoryListCandidate(row || li, inventoryListMarker())} | text ${(li.textContent || "").replace(/\s+/g, " ").trim().length} chars`);
      });
      const marker = inventoryListMarker();
      lines.push(`  heading marker: ${marker ? describeNode(marker) : "none"}`);
    } catch (error) {
      lines.push(`  trace failed: ${error.message}`);
    }
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
      if (surface === "inventory") lines.push(...inventoryDetectionTrace());
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

  // Torn's inventory tabs are hash routes; if the page ends up at the top
  // right after a tab switch while the player was scrolled down, put the
  // scroll position back (only within the inventory, only shortly after).
  let scrollGuard = { at: 0, y: 0 };
  window.addEventListener("hashchange", () => {
    if (detectSurface() !== "inventory") return;
    scrollGuard = { at: Date.now(), y: window.scrollY || 0 };
  }, true);

  function restoreScrollAfterTabSwitch() {
    if (!scrollGuard.at || Date.now() - scrollGuard.at > 1500 || scrollGuard.y < 150) return;
    if ((window.scrollY || 0) > 40) return;
    const maxY = Math.max(0, (document.documentElement.scrollHeight || 0) - (window.innerHeight || 0));
    if (maxY < scrollGuard.y * 0.5) return;
    try {
      window.scrollTo(0, Math.min(scrollGuard.y, maxY));
    } catch {
      // ignore
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
