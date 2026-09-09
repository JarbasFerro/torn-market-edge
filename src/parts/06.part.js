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
    // Torn's money inputs are pairs: the visible field and a hidden twin in
    // the same .input-money-group that holds the raw number.
    const group = input.closest(".input-money-group");
    group?.querySelectorAll?.("input[type='hidden']").forEach((twin) => {
      if (twin === input) return;
      if (setter) setter.call(twin, String(target));
      else twin.value = String(target);
    });
    return parseIntegerField(input.value) === target;
  }

  // Torn re-renders a sell-form row after each field change (React), so the
  // elements captured at scan time may be dead by the time the second field
  // is written. Re-resolve them from the live page by item id.
  function resolveSellFormInputs(visible) {
    const alive = (node) => node && node.isConnected;
    if (alive(visible.priceInput) && (visible.priceOnly || alive(visible.quantityCheckbox) || alive(visible.quantityInput))) return visible;
    try {
      const rows = visible.sellForm ? collectSellFormRows() : collectBazaarAddItems();
      const fresh = rows.find((row) => row.itemId === visible.itemId && (!alive(visible.card) || row.card === visible.card || visible.card.contains(row.card) || row.card.contains(visible.card)))
        || rows.find((row) => row.itemId === visible.itemId);
      if (fresh) {
        visible.card = fresh.card;
        visible.priceInput = fresh.priceInput;
        visible.quantityInput = fresh.quantityInput;
        visible.quantityCheckbox = fresh.quantityCheckbox;
        visible.maxAvailable = fresh.maxAvailable || visible.maxAvailable;
      }
    } catch (error) {
      log("Sell-form input refresh failed", visible.itemId, error.message);
    }
    return visible;
  }

  function fillSellFormRow(visible, target) {
    const qty = Math.max(1, asInt(visible.maxAvailable || visible.quantity, 1));
    let quantityFilled = visible.priceOnly === true;
    if (!visible.priceOnly) {
      resolveSellFormInputs(visible);
      if (visible.quantityCheckbox?.isConnected) {
        if (!visible.quantityCheckbox.checked) visible.quantityCheckbox.click();
        quantityFilled = Boolean(visible.quantityCheckbox.checked);
      } else if (visible.quantityInput?.isConnected) {
        quantityFilled = setBazaarInputValue(visible.quantityInput, qty);
        visible.quantityInput.dispatchEvent(new Event("keyup", { bubbles: true, composed: true }));
      }
    }
    // The quantity write may have re-rendered the row: fetch the price field
    // again before writing it.
    resolveSellFormInputs(visible);
    const priceFilled = visible.priceInput?.isConnected ? setBazaarInputValue(visible.priceInput, target) : false;
    if (priceFilled) visible.price = target;
    return { priceFilled, quantityFilled, qty };
  }

  function renderBazaarAddSuggestion(result) {
    const visible = result.visible;
    const source = result?.sellForm || result?.ownBazaar || {};
    const target = source.target;
    const stale = staleMarker(result);
    if (!Number.isFinite(target) || target <= 0) {
      return renderInlineHtml(
        visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">${escapeHtml(source.reason || "price unavailable")}</span>${stale}`,
        "GREY",
        "me-bazaar-add"
      );
    }

    const exact = formatMoney(target, true);
    const qty = Math.max(1, asInt(visible.maxAvailable || visible.quantity, 1));
    const filled = asInt(visible.price, 0) === target;
    const label = `${filled ? "Filled" : "Fill"} ${visible.priceOnly || qty === 1 ? exact : `${qty.toLocaleString("en-US")} \u00d7 ${exact}`}`;
    const totalHtml = qty > 1 && !visible.priceOnly
      ? `<span class="me-inline-secondary">total ${formatMoney(target * qty)}</span>`
      : "";
    const netHtml = result?.sellForm && Number.isFinite(source.net)
      ? `<span class="me-inline-secondary">net ${formatMoney(qty > 1 && !visible.priceOnly ? source.net * qty : source.net)}${source.feeBps ? ` after ${source.feeBps / 100}%` : ""}</span>`
      : "";
    // No title attributes: mobile webviews pop them up as bubbles over the row.
    const block = renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><button class="me-bazaar-fill-btn me-fill-main${filled ? " me-applied" : ""}" type="button" aria-label="${escapeHtml(label)}; ${escapeHtml(result?.sellForm ? "listing" : "adding to the Bazaar")} stays manual">${escapeHtml(label)}</button>${totalHtml}${netHtml}${stale}`,
      filled ? "GREEN" : "GREY",
      "me-bazaar-add"
    );
    const button = block?.querySelector?.(".me-bazaar-fill-btn");
    if (!button || !visible.priceInput) return block;

    const apply = () => {
      const outcome = fillSellFormRow(visible, target);
      if (!outcome.priceFilled) {
        button.textContent = "Price field not found";
        return;
      }
      button.textContent = `Filled ${visible.priceOnly || outcome.qty === 1 ? exact : `${outcome.qty.toLocaleString("en-US")} \u00d7 ${exact}`}${outcome.quantityFilled || visible.priceOnly ? "" : " (set quantity by hand)"}`;
      button.classList.add("me-applied");
      block.classList.add("GREEN");
      // Torn may replace the row after the write; a rescan puts the strip
      // back in its filled state.
      setTimeout(() => scheduleSignatureCheck(true), 350);
    };
    // "Fill all" from the menu reuses the same handler without synthesising
    // a click on any element.
    button.meFill = apply;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      apply();
    });
    return block;
  }

  function renderInlineResult(surface, result, ownBazaar) {
    const visible = result.visible;
    if (!visible || !visible.card?.isConnected) return null;
    const stale = staleMarker(result);
    if (result.error) return renderInlineError(visible, result.error);
    if (result.untradable) {
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary" title="Torn marks this item as not tradable">untradable</span>`, "GREY");
    }
    if (result.noListings) {
      const mv = result.snapshot?.averagePrice ? `MV ${formatMoney(result.snapshot.averagePrice)}` : "no market value";
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary" title="No Item Market listings right now; Torn's market value is shown">${mv}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">no listings</span>${stale}`, "GREY");
    }
    if (result.unsupported) {
      // Weapons and armor are not priced: an invisible completed marker keeps
      // rescans from touching the row again.
      return renderInlineHtml(visible, "", "GREY", "me-hidden");
    }

    if ((surface === "bazaar" && ownBazaar && visible.bazaarAdd) || (surface === "imsell" && result.sellForm)) {
      return renderBazaarAddSuggestion(result);
    }

    if (result.inventory) {
      // Compact commodity line: best exit price per unit, owned quantity and
      // the total at that price. Everything else lives in the tooltip.
      const estimate = result.inventory;
      const routes = estimate.routes;
      const snapshot = result.snapshot || {};
      const qty = Math.max(1, asInt(estimate.quantity, 1));
      const routeOptions = [
        routes.bazaar ? { key: "Bazaar", label: "BZ", name: "Bazaar", unit: routes.bazaar.suggestedPrice, net: routes.bazaar.net } : null,
        { key: "Item Market", label: "IM", name: "Item Market", unit: routes.itemMarket.suggestedPrice, net: routes.itemMarket.net },
        routes.museum ? { key: "Museum set", label: "SET", name: routes.museum.label, unit: routes.museum.suggestedPrice, net: routes.museum.net } : null,
        routes.shop ? { key: "Sell to shop", label: "SHOP", name: routes.shop.label, unit: routes.shop.suggestedPrice, net: routes.shop.net } : null
      ].filter(Boolean);
      const best = routeOptions.find((option) => option.key === routes.bestRoute) || routeOptions[0];
      const total = best.unit * qty;
      const title = [
        `${best.name}: ${formatMoney(best.unit, true)} per unit, ${formatMoney(total, true)} for ${qty}`,
        ...routeOptions.filter((option) => option !== best).map((option) => `${option.name}: ${formatMoney(option.unit, true)} per unit (net ${formatMoney(Math.floor(option.net / qty), true)} after fees)`),
        snapshot.lowestPrice ? `Item Market floor ${formatMoney(snapshot.lowestPrice, true)}` : "",
        snapshot.averagePrice ? `Torn value ${formatMoney(snapshot.averagePrice, true)}` : ""
      ].filter(Boolean).join("\n");
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(title)}">${best.label} ${formatMoney(best.unit)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Owned quantity">x${qty}</span><span class="me-inline-sep">|</span><span class="me-inline-primary" title="Total for the ${qty} you own at ${formatMoney(best.unit, true)}">${formatMoney(total)}</span>${stale}`,
        "GREY"
      );
    }

    if (result.browse) {
      const data = result.browse;
      const discount = `${data.discount >= 0 ? "-" : "+"}${Math.abs(data.discount * 100).toFixed(1)}%`;
      const title = `Displayed price versus Torn's official market value ${formatMoney(data.marketPrice, true)}.${Number.isFinite(data.profitPerUnit) ? ` Estimated net per unit after fees via ${data.bestRoute}: ${formatMoney(data.profitPerUnit, true)}.` : ""} Open the item for order-book analysis.`;
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="${escapeHtml(title)}">${discount} vs MV</span><span class="me-inline-status">${data.label}</span>${stale}`,
        data.state
      );
    }

    if (surface === "auction") {
      const data = result.auction;
      const state = data?.headroom > 0 ? "YELLOW" : "GREY";
      const headroomText = data?.headroom > 0 ? `+${formatMoney(data.headroom)}` : "-";
      const sales = data?.salesSummary;
      const salesHtml = sales?.count ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Median of ${sales.count} ended Auction House sales in 30 days (range ${formatMoney(sales.low, true)} - ${formatMoney(sales.high, true)})">sold ${formatMoney(sales.median)}</span>` : "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">Max ${formatMoney(data?.maxBid)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${headroomText}</span>${salesHtml}<span class="me-inline-status">${data?.headroom > 0 ? "CONSIDER" : "PASS"}</span>${stale}`,
        state
      );
    }

    if (surface === "bazaar" && ownBazaar) {
      const data = result.ownBazaar;
      const state = data?.delta > 0 ? "YELLOW" : "GREY";
      const deltaText = Number.isFinite(data?.delta) ? `${data.delta >= 0 ? "+" : ""}${formatMoney(data.delta)}` : "-";
      const fill = data?.fill || null;
      const fillPrice = fill?.price || null;
      const ruleLabel = data?.rule ? ` (rule: ${data.rule.mode}${data.rule.minPrice ? `, min ${formatMoney(data.rule.minPrice)}` : ""})` : "";
      const fillHtml = visible.priceInput && fillPrice
        ? `<button class="me-bazaar-fill-btn me-manage-fill" type="button" aria-label="Fill the price field with ${escapeHtml(formatMoney(fillPrice, true))}${escapeHtml(ruleLabel)}; saving stays manual">Fill ${escapeHtml(formatMoney(fillPrice, true))}</button>`
        : (fill?.reason === "held by rule" ? `<span class="me-inline-secondary">hold</span>` : "");
      const floorHtml = data?.floor ? `<span class="me-inline-sep">|</span><span class="me-inline-secondary" title="Cheapest Item Market listing">floor ${formatMoney(data.floor)}</span>` : "";
      const block = renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary">Target ${formatMoney(data?.target)}</span><span class="me-inline-sep">|</span><span class="me-inline-secondary">${deltaText}</span>${floorHtml}${fillHtml}<span class="me-inline-status">${data?.delta > 0 ? "LOW" : "OK"}</span>${stale}`,
        state
      );
      const manageButton = block?.querySelector?.(".me-manage-fill");
      if (manageButton) {
        const applyManage = () => {
          if (!visible.priceInput?.isConnected || !fillPrice) return;
          if (setBazaarInputValue(visible.priceInput, fillPrice)) {
            visible.price = fillPrice;
            data.delta = data.target - fillPrice;
            block.classList.add("me-applied");
            setTimeout(() => block?.classList?.remove("me-applied"), 700);
          }
        };
        manageButton.meFill = applyManage;
        manageButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          applyManage();
        });
      }
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

    if (surface === "cityshop") {
      const qty = Math.max(1, asInt(result.quantityUsed || 1, 1));
      const perUnit = Math.trunc(direct.expectedProfit / qty);
      const route = direct.routes?.bestRoute || "";
      return renderInlineHtml(visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Expected net profit per unit after fees via ${escapeHtml(route)}">${perUnit >= 0 ? "+" : ""}${formatMoney(perUnit)} ea</span><span class="me-inline-sep">|</span><span class="me-inline-secondary" title="For ${qty} units">${profit} / ${qty}</span><span class="me-inline-status">${CLASS_META[state].label}</span>${stale}`,
        state
      );
    }

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
      <button class="me-btn me-open-portfolio" type="button" title="Value your whole inventory through the official API (Minimal key)">Portfolio</button>
      <button class="me-btn me-open-shops" type="button" title="City shop stock priced against the market">Shops</button>
      <button class="me-btn me-open-travel" type="button" title="Foreign shop prices ranked by profit per trip">Travel</button>
    </div>`;
  }

  function bindPanelToolbar() {
    ui.body?.querySelector(".me-open-listings")?.addEventListener("click", () => renderOwnListingsPanel());
    ui.body?.querySelector(".me-open-watchlist")?.addEventListener("click", () => renderWatchlistPanel());
    ui.body?.querySelector(".me-open-portfolio")?.addEventListener("click", () => renderPortfolioPanel());
    ui.body?.querySelector(".me-open-shops")?.addEventListener("click", () => renderShopRunsPanel());
    ui.body?.querySelector(".me-open-travel")?.addEventListener("click", () => renderTravelPlanPanel());
  }

  // Ended-auction timing section shared by the Item Market panels: when do
  // sales of this item close at the best prices (Torn City Time)?
  function auctionTimingHtml(sales, { stackableOnly = false } = {}) {
    const rows = stackableOnly ? (sales || []).filter((sale) => sale.stackable) : (sales || []);
    const timing = auctionTimingStats(rows);
    if (!timing.total) return "";
    const bucketRows = timing.buckets.map((bucket) => `<div class="me-diag-row${timing.best && bucket.key === timing.best.key ? " pass" : ""}">${escapeHtml(bucket.label)}: ${bucket.count ? `${formatMoney(bucket.median)} x${bucket.count}${Number.isFinite(bucket.ratio) ? ` (${bucket.ratio >= 1 ? "+" : ""}${((bucket.ratio - 1) * 100).toFixed(1)}%)` : ""}` : "no sales"}</div>`).join("");
    const summary = timing.best
      ? `Best window to end an auction: ${timing.best.label} (${timing.best.count} sales, ${((timing.best.ratio - 1) * 100).toFixed(1)}% above the overall median)${timing.worst && timing.worst.key !== timing.best.key ? `; cheapest wins closed ${timing.worst.label}` : ""}.`
      : `Not enough ended sales per window yet (${timing.total} in total).`;
    return `<details class="me-diag"><summary>Auction timing: ${timing.total} ended sales, median ${formatMoney(timing.overallMedian)}</summary><div class="me-diag-row">${escapeHtml(summary)}</div>${bucketRows}</details>`;
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

  async function renderItemMarket() {
    if (ownListingsRouteActive()) {
      await renderOwnListingsPanel();
      return;
    }
    const itemId = getItemIdFromLocation();
    if (!itemId) {
      setPanel(`<div class="me-kicker">Item Market</div><div class="me-note">Open a specific item to analyze its order book.${settings.browseOverlayEnabled !== false ? " Browse cards are compared with Torn's official market value as they appear." : ""}</div>${panelToolbarHtml()}`);
      bindPanelToolbar();
      if (settings.browseOverlayEnabled !== false) scanBrowseGrid({ force: false });
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
        setPanel(`<div class="me-kicker">Item Market</div><div class="me-item-name">${escapeHtml(snapshot.itemName)}</div><div class="me-callout GREY"><div class="me-decision GREY">- NOT PRICED</div><div class="me-note">Weapons and armor are not priced by Market Edge; only stackable items are.</div></div>${panelToolbarHtml()}`);
        bindPanelToolbar();
        return;
      }

      const liveRows = parseLiveItemMarketListings();
      let itemMeta = null;
      try {
        itemMeta = (await loadItemMetadataBatch([itemId], { priority: 190 })).get(itemId) || null;
      } catch (error) {
        log("Item metadata unavailable", error.message);
      }
      const museumContext = await loadMuseumContext([itemId], { priority: 190, metadata: new Map(itemMeta ? [[itemId, itemMeta]] : []) });
      const museum = museumContext.get(itemId) || null;
      const shopSell = shopSellFloor(itemMeta);
      // Ended auctions are the only official transaction evidence for
      // stackable items; one request, cached ten minutes.
      const auctionSales = settings.auctionEvidenceEnabled !== false ? await loadAuctionSales(itemId, { priority: 170 }) : [];
      const salesSummary = stackableSalesSummary(auctionSales);
      if (detectSurface() !== "itemmarket" || getItemIdFromLocation() !== itemId) return;

      // The official Torn API is the authoritative valuation source. The live
      // DOM is used only to confirm/highlight what the player currently sees.
      const evaluated = evaluatePrefixes(snapshot, historyStats, settings, Date.now(), { museum, shopSell: shopSell?.price, shopLabel: shopSell?.label });
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
      const evidenceRows = [];
      if (salesSummary.count) {
        const agreesWithSales = reference.value ? Math.abs(salesSummary.median - reference.value) / reference.value : null;
        evidenceRows.push(["AH sold median (30d)", `<span title="${salesSummary.count} ended auctions, range ${formatMoney(salesSummary.low, true)} - ${formatMoney(salesSummary.high, true)}">${formatMoney(salesSummary.median)} x${salesSummary.count}</span>`, Number.isFinite(agreesWithSales) && agreesWithSales <= 0.10 ? "me-good" : ""]);
      }
      if (shopSell) evidenceRows.push([escapeHtml(shopSell.label), formatMoney(shopSell.price)]);

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
          ...museumRows,
          ...evidenceRows
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
          ...(best.routes.museum ? [[`${best.routes.museum.label} target`, formatMoney(best.routes.museum.suggestedPrice)]] : []),
          ...(best.routes.shop ? [[escapeHtml(best.routes.shop.label), formatMoney(best.routes.shop.suggestedPrice)]] : [])
        ]) : `<div class="me-note">No affordable prefix with positive expected profit.</div>`}
        <div class="me-rule"></div>
        ${decisionHtml(best)}
        ${diagnosticsHtml(best)}
        ${coldStartNote}
        ${auctionTimingHtml(auctionSales, { stackableOnly: true })}
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

  function resultForSurface(surface, visible, snapshot, historyStats, ownBazaar, renderMeta = {}, museum = null, extras = {}) {
    const shopSell = extras?.shopSell || null;
    const salesSummary = extras?.salesSummary || null;
    if (!snapshot?.supportedCommodity) return { visible, snapshot, unsupported: true, renderMeta };

    if (surface === "inventory") {
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum, shopSell });
      if (!estimate && !(snapshot?.listings || []).length) return { visible, snapshot, historyStats, noListings: true, renderMeta };
      return { visible, snapshot, historyStats, inventory: estimate, renderMeta };
    }

    if (surface === "imsell") {
      // Item Market "add listing" form: the suggested Item Market price
      // (conservative exit minus undercut, through the item's pricing rule)
      // and the net per unit after the configured fee.
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum, shopSell });
      if (!estimate) return { visible, snapshot, historyStats, sellForm: { target: null, reason: (snapshot?.listings || []).length ? "price unavailable" : "no listings" }, renderMeta };
      const floorSuggestion = snapshot.lowestPrice ? Math.max(1, snapshot.lowestPrice - Math.max(0, asInt(settings.itemMarketUndercut))) : null;
      const rule = Store.pricingRules()[visible.itemId] || null;
      const fill = applyPricingRule({ rule, floorSuggestion, anchorSuggestion: estimate.routes.itemMarket.suggestedPrice });
      const target = fill.price || estimate.routes.itemMarket.suggestedPrice;
      const feeBps = itemMarketFeeBps(settings);
      return { visible, snapshot, historyStats, sellForm: { target, net: grossToNet(target, feeBps), feeBps, floor: snapshot.lowestPrice, rule, estimate }, renderMeta };
    }

    if (surface === "auction") {
      const salesMedian = salesSummary?.median || null;
      const maxBid = maxRationalBid({ snapshot, historyStats, settings, quantity: visible.quantity, museum, shopSell, salesMedian });
      const headroom = Number.isFinite(maxBid) ? maxBid - visible.price : null;
      const direct = visible.price > 0
        ? evaluateDirectBuy({ buyPrice: visible.price, quantity: visible.quantity, snapshot, historyStats, settings, forceYellow: true, museum, shopSell })
        : null;
      return { visible, snapshot, historyStats, auction: { maxBid, headroom, direct, salesSummary }, renderMeta };
    }

    if (surface === "bazaar" && ownBazaar) {
      const estimate = estimateInventoryExit({ quantity: visible.quantity, snapshot, historyStats, settings, museum, shopSell });
      const target = estimate?.routes?.bazaar?.suggestedPrice;
      const delta = Number.isFinite(target) ? target - visible.price : null;
      // Repricing workbench: the floor-based suggestion (floor minus undercut,
      // Bazaar is fee-free so no discount) and the anchor-based target go
      // through the item's pricing rule.
      const floorSuggestion = snapshot.lowestPrice ? Math.max(1, snapshot.lowestPrice - Math.max(0, asInt(settings.itemMarketUndercut))) : null;
      const rule = Store.pricingRules()[visible.itemId] || null;
      const fill = applyPricingRule({ rule, floorSuggestion, anchorSuggestion: target });
      return { visible, snapshot, historyStats, ownBazaar: { target, delta, estimate, fill, rule, floor: snapshot.lowestPrice }, renderMeta };
    }

    let quantity = visible.quantity;
    if (surface === "travel" && settings.travelCapacity > 0) quantity = Math.min(quantity, settings.travelCapacity);
    if (surface === "travel" && settings.travelCapacity === 0) quantity = 1;
    if (surface === "cityshop") quantity = Math.max(1, asInt(settings.shopRunQuantity, 100));
    const direct = evaluateDirectBuy({
      buyPrice: visible.price,
      quantity,
      snapshot,
      historyStats,
      settings,
      forceYellow: surface === "auction",
      museum,
      shopSell
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

  // One scan at a time per page. A scan requested while another is running
  // is coalesced into a single follow-up pass, so mutation storms cannot
  // stack overlapping scans (duplicate overlays, wasted requests).
  const scanState = { running: false, pending: null };

  async function scanVisibleSurface(surface, options = {}) {
    if (scanState.running) {
      const previous = scanState.pending || {};
      scanState.pending = { surface, options: { ...previous.options, ...options, force: Boolean(previous.options?.force || options.force) } };
      return;
    }
    scanState.running = true;
    try {
      await scanVisibleSurfaceNow(surface, options);
    } catch (error) {
      log("Scan failed", surface, error?.message || error);
    } finally {
      scanState.running = false;
      const pending = scanState.pending;
      scanState.pending = null;
      if (pending && document.visibilityState === "visible" && detectSurface() === pending.surface) {
        setTimeout(() => scanVisibleSurface(pending.surface, pending.options), 60);
      }
    }
  }

  async function scanVisibleSurfaceNow(surface, { retryIfEmpty = false, force = false, cancelObsolete = false } = {}) {
    const scanStartedAt = Date.now();
    removeFloatingUi();
    if (document.visibilityState !== "visible") return;

    const queueGroup = beginListQueueGroup(surface, { cancelObsolete });
    const ownBazaar = surface === "bazaar" ? await isOwnBazaar() : false;
    if (detectSurface() !== surface || document.visibilityState !== "visible") return;

    const requireMoney = !["inventory", "imsell"].includes(surface);
    let items = surface === "auction"
      ? collectAuctionItems()
      : (surface === "imsell" ? collectSellFormRows() : (surface === "bazaar" && ownBazaar ? collectOwnBazaarItems() : collectVisibleItems({ requireMoney })));

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
