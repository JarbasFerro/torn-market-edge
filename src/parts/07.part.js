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
    await scanExpandedEquipment(surface, ownBazaar);
  }

  function describeNode(node) {
    if (!(node instanceof Element)) return String(node?.nodeName || "?");
    const id = node.id ? `#${node.id}` : "";
    const classes = String(node.className || "").split(/\s+/).filter(Boolean).slice(0, 4).map((name) => `.${name}`).join("");
    const data = Array.from(node.attributes || []).filter((attr) => attr.name.startsWith("data-") && !attr.name.startsWith("data-me")).slice(0, 3).map((attr) => `[${attr.name}=${String(attr.value).slice(0, 20)}]`).join("");
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
  function buildPageDiagnostics() {
    const surface = detectSurface();
    const lines = [`Market Edge ${APP.version} page structure`, `surface: ${surface}`, `path: ${location.pathname}${location.hash ? ` hash: ${location.hash.slice(0, 60)}` : ""}`, `pda: ${ENV.isPda}`, ""];
    try {
      const panels = findStatsPanels(document.body);
      lines.push(`stats panels found: ${panels.length}`);
      panels.slice(0, 3).forEach((panel, index) => {
        lines.push(`--- panel ${index + 1} ancestors (innermost first)`);
        lines.push(ancestorChain(panel, 12));
        lines.push(`panel text: ${(panel.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300)}`);
        const previous = panel.closest("li,tr,[role='row']")?.previousElementSibling;
        if (previous) lines.push(`previous sibling of closest row-like ancestor: ${describeNode(previous)}`);
      });
      const details = collectExpandedEquipmentDetails(surface);
      lines.push("", `resolved details: ${details.length}`);
      lines.push(`pricing cards on page: ${document.querySelectorAll(".me-equip-card").length}`);
      document.querySelectorAll(".me-equip-card").forEach((card, index) => lines.push(`card ${index + 1} [complete=${card.dataset.meComplete}] parent: ${describeNode(card.parentElement)} text: ${(card.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160)}`));
      lines.push(`last details outcome: ${lastDetailsOutcome || "none yet"}`);
      lines.push(`details in flight: ${detailsInFlight.size}, retry counters: ${JSON.stringify(Array.from(detailRetries.entries()))}`);
      lines.push(`api key present: ${Boolean(Store.apiKey())}, equipment enabled: ${settings.equipmentEnabled !== false}`);
      details.slice(0, 3).forEach((detail, index) => {
        lines.push(`detail ${index + 1}: item ${detail.itemId}, copy ${JSON.stringify(detail.copy)}, row: ${detail.row ? describeNode(detail.row) : "none"}`);
      });
      const rows = surface === "bazaar" ? collectBazaarAddItems() : collectVisibleItems({ requireMoney: surface !== "inventory" });
      lines.push("", `rows collected: ${rows.length}`);
      rows.slice(0, 3).forEach((item, index) => {
        lines.push(`--- row ${index + 1}: item ${item.itemId} "${item.name}"`);
        lines.push(ancestorChain(item.card, 6));
      });
    } catch (error) {
      lines.push(`report failed: ${error.message}`);
    }
    return lines.join("\n");
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
      const anchored = previous && !previous.classList.contains("me-equip-card") && QUALITY_PATTERN.test(previous.textContent || "");
      if (!anchored) card.remove();
    });
  }

  let lastDetailsOutcome = "";
  const detailsInFlight = new Set();

  // Re-find a panel by key after an await: React may have re-rendered the
  // details block while the API request was pending.
  function relocateDetail(surface, detail) {
    if (detail.panel.isConnected) return detail;
    const candidates = collectExpandedEquipmentDetails(surface);
    // Exact key first; otherwise the same item whose panel is still open
    // (bonus/quality text may be mid-render when React swaps the block).
    return candidates.find((candidate) => candidate.key === detail.key)
      || candidates.find((candidate) => candidate.itemId === detail.itemId && candidate.copy.quality === detail.copy.quality)
      || candidates.find((candidate) => candidate.itemId === detail.itemId)
      || null;
  }

  const detailRetries = new Map();

  // Transient failures (panel swapped mid-request, surface briefly undetected)
  // get a few delayed retries; opening the details again always resets.
  function scheduleDetailRetry(surface, ownBazaar, key, reason) {
    const attempts = (detailRetries.get(key) || 0) + 1;
    detailRetries.set(key, attempts);
    lastDetailsOutcome = `${reason}; retry ${attempts}/3`;
    if (attempts > 3) return;
    setTimeout(() => {
      if (document.visibilityState !== "visible" || detectSurface() !== surface) return;
      scanExpandedEquipment(surface, ownBazaar).catch((error) => log("Details retry failed", error.message));
    }, 1200 * attempts);
  }

  async function scanExpandedEquipment(surface, ownBazaar) {
    cleanupOrphanedDetailCards();
    if (settings.equipmentEnabled === false) return;
    const sellSide = surface === "inventory" || (surface === "bazaar" && ownBazaar);
    if (!sellSide || !Store.apiKey()) return;
    let details = [];
    try {
      details = collectExpandedEquipmentDetails(surface);
    } catch (error) {
      lastDetailsOutcome = `panel scan failed: ${error.message}`;
      log("Details panel scan failed", error.message);
      return;
    }
    details = details.filter((detail) => {
      if (detailsInFlight.has(detail.key)) return false;
      const card = findDetailCard(detail.panel);
      return !(card && card.dataset.meDetailKey === detail.key && card.dataset.meComplete === "1");
    });
    if (!details.length) return;

    await Promise.allSettled(details.map(async (initial) => {
      let detail = initial;
      detailsInFlight.add(detail.key);
      try {
        renderEquipmentDetailCard(detail, null, { loading: true });
        // Details requests use their own queue group so list-scan
        // cancellations (frequent on the inventory page) cannot kill them.
        const bundle = await loadSnapshot(detail.itemId, { limit: API_DEEP_LIMIT, priority: 180, queueGroup: "details" });
        if (detectSurface() !== surface) {
          scheduleDetailRetry(surface, ownBazaar, initial.key, "surface changed during pricing");
          return;
        }
        detail = relocateDetail(surface, detail);
        if (!detail) {
          scheduleDetailRetry(surface, ownBazaar, initial.key, "details panel disappeared before pricing");
          return;
        }
        if (!bundle.snapshot.equipment) {
          renderEquipmentDetailCard(detail, null, { error: "Torn lists this item without stats; the commodity model applies." });
          lastDetailsOutcome = `item ${detail.itemId} is not equipment`;
          return;
        }
        const auctionSales = await loadAuctionSales(detail.itemId, { priority: 170 });
        if (detectSurface() !== surface) {
          scheduleDetailRetry(surface, ownBazaar, initial.key, "surface changed during pricing");
          return;
        }
        detail = relocateDetail(surface, detail);
        if (!detail) {
          scheduleDetailRetry(surface, ownBazaar, initial.key, "details panel disappeared before rendering");
          return;
        }
        const pricing = priceOwnedEquipment({ snapshot: bundle.snapshot, copy: detail.copy, auctionSales, settings });
        renderEquipmentDetailCard(detail, pricing, { canFill: surface === "bazaar" && Boolean(detail.row) });
        promoteCopyPriceToRow(surface, ownBazaar, detail, pricing, bundle.snapshot);
        detailRetries.delete(initial.key);
        lastDetailsOutcome = `priced item ${detail.itemId}: ${pricing?.bazaarSuggested ? formatMoney(pricing.bazaarSuggested, true) : "no comparables"}`;
      } catch (error) {
        const message = describeApiError(error, { feature: "Copy pricing" });
        lastDetailsOutcome = `pricing failed for item ${detail.itemId}: ${message}`;
        log("Details pricing failed", detail.itemId, message);
        const current = relocateDetail(surface, detail);
        if (current) renderEquipmentDetailCard(current, null, { error: message });
      } finally {
        detailsInFlight.delete(initial.key);
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
        collectExpandedEquipmentDetails(surface, { resolveRows: false }).forEach((detail) => entries.add(`detail:${detail.key}@${listRowIdentity(detail.panel)}`));
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
