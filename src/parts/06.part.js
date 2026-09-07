      `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">${escapeHtml(message)}</span><span class="me-inline-status">ERROR</span>`,
      "RED"
    );
  }

  function renderInlineDeferred(visible, message = "API busy - retrying") {
    return renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">${escapeHtml(message)}</span>`,
      "YELLOW",
      "me-loading"
    );
  }

  function staleMarker(result) {
    return result?.renderMeta?.stale ? `<span class="me-inline-stale" title="Showing cached data while Market Edge refreshes">*</span>` : "";
  }

  function renderInlineResult(surface, result, ownBazaar) {
    const visible = result.visible;
    if (!visible || !visible.card?.isConnected) return null;
    const stale = staleMarker(result);
    if (result.error) return renderInlineError(visible, result.error);
    if (result.unsupported) {
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">unsupported equipment</span>`, "GREY");
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
      const { snapshot, historyStats } = await loadSnapshot(itemId, {
        limit: API_DEEP_LIMIT,
        priority: 200,
        scope: "detail"
      });
      if (!snapshot.supportedCommodity) {
        setPanel(`<div class="me-kicker">Item Market</div><div class="me-item-name">${escapeHtml(snapshot.itemName)}</div><div class="me-callout GREY"><div class="me-decision GREY">- NOT SUPPORTED</div><div class="me-note">Advanced equipment valuation is not supported yet.</div></div>`);
        return;
      }

      let analysisSnapshot = snapshot;
      let liveConfirmation = "API discovery";
      const liveRows = parseLiveItemMarketListings();
      if (liveRows.length >= 2) {
        const liveListings = liveRows.map((row) => ({ price: row.price, quantity: row.quantity }));
        analysisSnapshot = {
          ...snapshot,
          listings: liveListings,
          lowestPrice: liveListings[0]?.price ?? snapshot.lowestPrice,
          secondPrice: liveListings[1]?.price ?? snapshot.secondPrice,
          thirdPrice: liveListings[2]?.price ?? snapshot.thirdPrice,
          calculatedMarketAnchor: robustMarketAnchor(liveListings),
          depthMetrics: {
            listingCount: liveListings.length,
            top5Quantity: liveListings.slice(0, 5).reduce((sum, row) => sum + row.quantity, 0),
            top20Quantity: liveListings.slice(0, 20).reduce((sum, row) => sum + row.quantity, 0)
          }
        };
        liveConfirmation = "CONFIRMED ON PAGE";
      }

      const evaluated = evaluatePrefixes(analysisSnapshot, historyStats, settings);
      const best = evaluated.best;
      const fresh = freshness(snapshot.cacheTimestamp);
      const reference = chooseReference(snapshot, historyStats);
      const learning = historyStats.oneDay.count < 5;
      const currentDiscount = reference.value && snapshot.lowestPrice ? 1 - snapshot.lowestPrice / reference.value : null;

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
        <div class="me-note">Facts: visible/API asks and 5% Item Market fee. Local data: observed anchors. Exit, profit and confidence are estimates - not guarantees.</div>
      `, fresh.label);

      highlightItemMarketRows(liveRows, best);
    } catch (error) {
      if (isRateLimitError(error)) {
        const seconds = Math.max(
          1,
          Math.ceil((error.retryAfterMs || API_RATE_LIMIT_BACKOFF_MS) / 1000)
        );
        errorPanel(`Torn's shared API limit was reached. Market Edge paused API requests for about ${seconds}s; existing cached prices remain usable.`);
      } else if (!isCancelledError(error)) {
        errorPanel(error.message);
      }
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

  function isWithinListScanBand(visible) {
    const rect = visible?.card?.getBoundingClientRect?.();
    if (!rect) return false;
    const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
    const overscan = Math.min(
      LIST_SCAN_OVERSCAN_PX,
      Math.max(180, Math.round(viewportHeight * 0.6))
    );
    // Analyze only what the player can see plus a modest look-ahead. This
    // avoids spending API quota on an entire long category before it is used.
    return rect.bottom >= -Math.round(overscan * 0.25)
      && rect.top <= viewportHeight + overscan;
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

  function genericIntro(surface, { clear = true } = {}) {
    removeFloatingUi();
    if (clear) clearInlineAnalysis();
    // List-style surfaces use War-Overlay-style inline intelligence rather
    // than a floating results window. New rows are discovered incrementally.
    setTimeout(() => scanVisibleSurface(surface, { retryIfEmpty: true, force: false }), 250);
  }

  async function scanVisibleSurface(surface, { retryIfEmpty = false, force = false } = {}) {
    removeFloatingUi();
    if (document.visibilityState !== "visible") return;

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
            scanVisibleSurface(surface, { retryIfEmpty: false, force });
          }
        }, 650);
      }
      return;
    }

    items = items.filter((visible) => {
      if (!visible?.card?.isConnected) return false;
      const existing = visible.card.querySelector?.(`.me-inline-analysis[data-me-item-id="${visible.itemId}"]`);
      const scanning = visible.card.dataset?.meScanning === String(visible.itemId);
      if (force && existing) existing.remove();
      return force || (!scanning && existing?.dataset?.meComplete !== "1");
    });
    if (!items.length) return;

    items = items
      .filter(isWithinListScanBand)
      .sort((a, b) => viewportPriority(b) - viewportPriority(a))
      .slice(0, Math.min(
        LIST_SCAN_BATCH_MAX,
        clamp(asInt(settings.scanMaxVisibleItems, LIST_SCAN_BATCH_MAX), 1, LIST_SCAN_BATCH_MAX)
      ));
    if (!items.length) return;

    if (!Store.apiKey()) {
      items.forEach((visible) => renderInlineError(visible, "Add API key in Market Edge settings"));
      return;
    }

    items.forEach((visible) => {
      if (visible.card?.dataset) visible.card.dataset.meScanning = String(visible.itemId);
      renderInlineLoading(visible);
    });

    let metadata = new Map();
    try {
