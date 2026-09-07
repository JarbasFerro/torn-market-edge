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
          scope: "list",
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
        if (isCancelledError(error)) {
          log("Cancelled stale list request", visible.itemId);
        } else if (isRateLimitError(error)) {
          if (!renderedCached && visible.card?.isConnected) {
            renderInlineDeferred(visible, "API busy - retry later");
          } else {
            log("Rate limited; keeping cached row", visible.itemId);
          }
          scheduleRateLimitRecovery(surface, error.retryAfterMs);
        } else if (!renderedCached && visible.card?.isConnected) {
          renderInlineError(visible, error.message);
        } else {
          log("Refresh failed; keeping cached row", visible.itemId, error.message);
        }
      } finally {
        if (visible.card?.dataset?.meScanning === String(visible.itemId)) delete visible.card.dataset.meScanning;
      }
    });

    await Promise.allSettled(tasks);
  }

  // ---------------------------------------------------------------------------
  // Initialization, SPA navigation and compliance-safe observation
  // ---------------------------------------------------------------------------

  let refreshTimer = null;
  let signatureTimer = null;
  let viewportScanTimer = null;
  let rateLimitRecoveryTimer = null;
  let lastLocationKey = "";
  let lastListSignature = "";

  function scheduleRefresh(force = false) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(force), 160);
  }

  function scheduleViewportScan() {
    clearTimeout(viewportScanTimer);
    viewportScanTimer = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const surface = detectSurface();
      if (!["bazaar", "auction", "travel", "inventory"].includes(surface)) return;
      scanVisibleSurface(surface, { retryIfEmpty: false, force: false });
    }, 140);
  }

  function scheduleRateLimitRecovery(surface, waitMs = API_RATE_LIMIT_BACKOFF_MS) {
    if (rateLimitRecoveryTimer) return;
    const delay = Math.max(
      1000,
      asInt(waitMs, API_RATE_LIMIT_BACKOFF_MS),
      api.cooldownRemainingMs()
    ) + 250;
    rateLimitRecoveryTimer = setTimeout(() => {
      rateLimitRecoveryTimer = null;
      if (document.visibilityState !== "visible" || detectSurface() !== surface) return;
      scanVisibleSurface(surface, { retryIfEmpty: false, force: false });
    }, delay);
  }

  function listSurfaceSignature(surface) {
    if (!["bazaar", "auction", "travel", "inventory"].includes(surface)) return "";
    const ids = [];
    const marker = surface === "inventory" ? inventoryListMarker() : null;
    document.querySelectorAll(itemIdentitySelector()).forEach((node) => {
      if (node.closest?.("#market-edge-root,.me-inline-analysis")) return;
      const itemId = itemIdFromElement(node);
      if (!itemId) return;
      const card = surface === "inventory" ? findInventoryRow(node) : findCompactCard(node, false);
      if (surface === "inventory" && !isInventoryListCandidate(card, marker)) return;
      const rect = card?.getBoundingClientRect?.();
      if (rect && (rect.width <= 0 || rect.height <= 0)) return;
      ids.push(itemId);
    });
    const uniqueIds = Array.from(new Set(ids)).sort((a, b) => a - b);
    const heading = surface === "inventory"
      ? String(marker?.textContent || "").replace(/\s+/g, " ").trim()
      : "";
    return `${surface}|${heading}|${uniqueIds.join(",")}`;
  }

  function scheduleSignatureCheck(forceScan = false) {
    clearTimeout(signatureTimer);
    signatureTimer = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const surface = detectSurface();
      if (!["bazaar", "auction", "travel", "inventory"].includes(surface)) return;
      const signature = listSurfaceSignature(surface);
      if (!signature) return;
      const signatureChanged = signature !== lastListSignature;
      if (signatureChanged) {
        api.cancelQueuedListRequests();
        lastListSignature = signature;
      }
      if (forceScan || signatureChanged) {
        scanVisibleSurface(surface, { retryIfEmpty: false, force: false });
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

    api.cancelQueuedListRequests();
    lastLocationKey = locationKey;
    ui.currentSurface = surface;
    clearBadges();
    lastListSignature = "";

    if (surface === "other") {
      clearInlineAnalysis();
      removeFloatingUi();
      return;
    }
    if (surface === "itemmarket") {
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
      if (document.visibilityState !== "visible") {
        api.cancelQueuedListRequests();
        return;
      }
      scheduleRefresh(false);
      scheduleSignatureCheck(false);
      scheduleViewportScan();
    });

    window.addEventListener("scroll", scheduleViewportScan, { passive: true });
    window.addEventListener("resize", scheduleViewportScan, { passive: true });

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
