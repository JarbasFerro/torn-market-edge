
  function injectStyles(css) {
    if (ENV.hasGmStyle) {
      try {
        GM_addStyle(css);
        return;
      } catch {
        // fall through to a plain style element
      }
    }
    try {
      const style = document.createElement("style");
      style.id = "market-edge-style";
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    } catch {
      // no-op
    }
  }

  injectStyles(CSS);

  function ensureUi() {
    if (ui.root?.isConnected) return ui.root;
    const root = document.createElement("div");
    root.id = "market-edge-root";
    root.innerHTML = `
      <div class="me-shell">
        <div class="me-header">
          <div class="me-title">Market Edge</div>
          <div class="me-status"></div>
          <button class="me-icon-btn me-settings" type="button" aria-label="Market Edge settings">⚙</button>
          <button class="me-icon-btn me-collapse" type="button" aria-label="Collapse panel">–</button>
          <button class="me-icon-btn me-close" type="button" aria-label="Close panel">×</button>
        </div>
        <div class="me-body"></div>
      </div>`;
    document.body.appendChild(root);
    ui.root = root;
    ui.body = root.querySelector(".me-body");
    ui.title = root.querySelector(".me-title");
    ui.status = root.querySelector(".me-status");
    root.querySelector(".me-settings").addEventListener("click", showSettings);
    root.querySelector(".me-collapse").addEventListener("click", togglePanelState);
    root.querySelector(".me-close").addEventListener("click", () => removeFloatingUi(true));
    applyPanelState();
    return root;
  }

  function applyPanelState() {
    if (!ui.root) return;
    const state = Store.get(STORAGE_KEYS.panelState, "expanded");
    const body = ui.root.querySelector(".me-body");
    const button = ui.root.querySelector(".me-collapse");
    body.hidden = state === "collapsed";
    button.textContent = state === "collapsed" ? "+" : "–";
    button.setAttribute("aria-label", state === "collapsed" ? "Expand panel" : "Collapse panel");
  }

  function togglePanelState() {
    const current = Store.get(STORAGE_KEYS.panelState, "expanded");
    Store.set(STORAGE_KEYS.panelState, current === "collapsed" ? "expanded" : "collapsed");
    applyPanelState();
  }

  function setPanel(content, status = "") {
    ensureUi();
    ui.body.innerHTML = content;
    ui.status.textContent = status;
  }

  function errorPanel(message) {
    setPanel(`<div class="me-error">${escapeHtml(message)}</div><div class="me-actions"><button class="me-btn me-open-settings" type="button">Settings</button></div>`);
    ui.body.querySelector(".me-open-settings")?.addEventListener("click", showSettings);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function metricRows(rows) {
    return `<div class="me-grid">${rows.map(([label, value, cls = ""]) => `<div class="label">${escapeHtml(label)}</div><div class="value ${cls}">${value}</div>`).join("")}</div>`;
  }

  function decisionHtml(opportunity) {
    if (!opportunity) return `<div class="me-callout GREY"><div class="me-decision GREY">- PASS</div><div class="me-note">No complete, affordable profitable prefix was found.</div></div>`;
    const state = opportunity.classification.state;
    const meta = CLASS_META[state];
    return `<div class="me-callout ${state}">
      <div class="me-decision ${state}">${meta.icon} ${meta.label}</div>
      ${metricRows([
        ["Expected profit", `<span title="${formatMoney(opportunity.expectedProfit, true)}">${formatMoney(opportunity.expectedProfit)}</span>`, opportunity.expectedProfit >= 0 ? "me-good" : "me-bad"],
        ["ROI", `${(opportunity.roi * 100).toFixed(2)}%`, opportunity.roi >= settings.minimumROI ? "me-good" : ""],
        ["Confidence", escapeHtml(opportunity.confidence.label)],
        ["Score", `${opportunity.score}/100`]
      ])}
    </div>`;
  }

  function diagnosticsHtml(opportunity) {
    if (!opportunity?.classification?.reasons?.length) return "";
    return `<details class="me-diag"><summary>Why ${escapeHtml(CLASS_META[opportunity.classification.state].label)}?</summary>${opportunity.classification.reasons.map((reason) => `<div class="me-diag-row ${reason.pass ? "pass" : "fail"}">${reason.pass ? "OK" : "X"} ${escapeHtml(reason.text)}</div>`).join("")}</details>`;
  }

  // Settings: grouped, every control labelled, keyboard-complete (Escape
  // closes, Tab stays inside), with a reset. Ids used by the diagnostics and
  // watchlist flows are stable.
  function settingsFieldHtml(current, key, label, { type = "number", percent = false, premium = false, min, max, step, help = "" } = {}) {
    const id = `me-set-${key}`;
    const value = current[key];
    if (type === "checkbox") {
      return `<label for="${id}">${escapeHtml(label)}</label><input id="${id}" data-setting="${key}" type="checkbox" ${value ? "checked" : ""}${help ? ` aria-describedby="${id}-help"` : ""}>${help ? `<div class="me-form-help" id="${id}-help" style="grid-column:1 / -1;margin-top:-4px">${escapeHtml(help)}</div>` : ""}`;
    }
    const shown = premium ? ((Number(value) - 1) * 100).toFixed(1) : (percent ? (Number(value) * 100).toFixed(2).replace(/\.?0+$/, "") : value);
    const attrs = [
      Number.isFinite(min) ? `min="${min}"` : "",
      Number.isFinite(max) ? `max="${max}"` : "",
      step !== undefined ? `step="${step}"` : "",
      percent ? 'data-percent="1"' : "",
      premium ? 'data-premium="1"' : ""
    ].filter(Boolean).join(" ");
    return `<label for="${id}">${escapeHtml(label)}</label><input id="${id}" data-setting="${key}" type="number" ${attrs} value="${escapeHtml(String(shown))}"${help ? ` aria-describedby="${id}-help"` : ""}>${help ? `<div class="me-form-help" id="${id}-help" style="grid-column:1 / -1;margin-top:-4px">${escapeHtml(help)}</div>` : ""}`;
  }

  function settingsSectionHtml(title, hint, body, { open = false } = {}) {
    return `<details class="me-section" ${open ? "open" : ""}><summary>${escapeHtml(title)}<span class="me-section-hint">${escapeHtml(hint)}</span></summary><div class="me-section-body">${body}</div></details>`;
  }

  function showSettings() {
    if (document.querySelector(".me-modal-backdrop")) return;
    const current = Store.settings();
    const hasKey = Boolean(Store.apiKey());
    const backdrop = document.createElement("div");
    backdrop.className = "me-modal-backdrop";
    const f = (key, label, options) => settingsFieldHtml(current, key, label, options);
    backdrop.innerHTML = `
      <div class="me-modal" role="dialog" aria-modal="true" aria-labelledby="me-settings-title">
        <h2 id="me-settings-title">Market Edge settings</h2>
        <p class="me-modal-intro">Market Edge reads the official Torn API and annotates the pages you open. It never buys, sells, lists or submits anything; fill buttons only write Torn's fields for you to review.</p>

        ${settingsSectionHtml("API key", hasKey ? "saved" : "needed to price anything", `
          <div class="me-form-grid">
            <label for="me-api-key">Torn API key</label><input id="me-api-key" type="password" autocomplete="off" value="${escapeHtml(Store.apiKey())}" aria-describedby="me-api-key-help">
            <span>Status</span><span id="me-api-status" aria-live="polite">${hasKey ? "Saved, not tested this session" : "No key yet"}</span>
          </div>
          <div class="me-actions"><button class="me-btn" id="me-test-key" type="button">Test API key</button><a class="me-btn" href="https://www.torn.com/preferences.php#tab=api" target="_blank" rel="noopener">Create a key on Torn</a></div>
          <div class="me-form-help" id="me-api-key-help">A Public key prices every page. Minimal access adds the Portfolio panel (your inventory). Limited access adds the panel for your own Item Market listings. The key stays in userscript storage and is sent only to api.torn.com.${ENV.isPda ? " Torn PDA supplies its own key automatically when this field is empty." : ""}</div>
        `, { open: true })}

        ${settingsSectionHtml("Selling", "undercut, fees, routes", `
          <div class="me-form-grid">
            ${f("itemMarketUndercut", "Undercut the cheapest listing by ($)", { min: 0, step: 1, help: "Fill buttons write the cheapest Item Market price minus this amount." })}
            ${f("anonymousListing", "I list anonymously on the Item Market (+10% fee)", { type: "checkbox" })}
            ${f("anonymousFeeWaived", "Anonymous fee waived by a 5-star company perk", { type: "checkbox" })}
            ${f("bazaarEnabled", "Consider the Bazaar as an exit route", { type: "checkbox" })}
            ${f("bazaarDiscount", "Bazaar price below the Item Market floor (%)", { percent: true, min: 0, max: 20, step: 0.1 })}
            ${f("museumSetsEnabled", "Value plushies and flowers as museum sets", { type: "checkbox" })}
            ${f("undercutAlerts", "Warn me when my own listings are undercut", { type: "checkbox" })}
          </div>
        `, { open: true })}

        ${settingsSectionHtml("Buying", "capital and thresholds", `
          <div class="me-form-grid">
            ${f("availableCapital", "Available trading capital ($)", { min: 0, step: 1000000 })}
            ${f("maxCapitalOpportunity", "Max capital per opportunity ($)", { min: 1, step: 1000000 })}
            ${f("maxCapitalItem", "Max capital per item ($)", { min: 1, step: 1000000 })}
            ${f("minimumROI", "Minimum ROI (%)", { percent: true, min: 0, max: 100, step: 0.1 })}
            ${f("minimumProfit", "Minimum expected profit ($)", { min: 0, step: 50000 })}
            ${f("minimumDiscount", "Minimum discount versus value (%)", { percent: true, min: 0, max: 100, step: 0.1 })}
            ${f("safetyHaircut", "Safety haircut on resale (%)", { percent: true, min: 0, max: 10, step: 0.1 })}
            ${f("allowedHistoricalPremium", "Allowed premium over history (%)", { premium: true, min: 0, max: 10, step: 0.1 })}
            <label for="me-set-minimumGreenConfidence">Minimum confidence for a STRONG verdict</label><select id="me-set-minimumGreenConfidence" data-setting="minimumGreenConfidence">${["VERY LOW", "LOW", "MEDIUM", "HIGH"].map((value) => `<option ${value === current.minimumGreenConfidence ? "selected" : ""}>${value}</option>`).join("")}</select>
            ${f("maxVolatility", "Max tolerated price volatility (%)", { percent: true, min: 0, max: 100, step: 0.1 })}
          </div>
        `)}

        ${settingsSectionHtml("Watchlist", "alerts while a Torn tab is open", `
          <div class="me-form-grid">
            ${f("watchlistEnabled", "Watchlist alerts enabled", { type: "checkbox" })}
            ${f("watchlistIntervalSeconds", `Check every (seconds, min ${WATCHLIST_MIN_INTERVAL_SEC})`, { min: WATCHLIST_MIN_INTERVAL_SEC, max: 3600, step: 5 })}
          </div>
          <div id="me-watchlist-rows"></div>
          <div class="me-actions">
            <label class="me-visually-hidden" for="me-watch-item">Item id</label><input id="me-watch-item" class="me-inline-input" type="number" min="1" placeholder="Item ID">
            <label class="me-visually-hidden" for="me-watch-target">Alert at or below</label><input id="me-watch-target" class="me-inline-input" type="number" min="1" placeholder="Alert at or below $">
            <button class="me-btn" id="me-watch-add" type="button">Add to watchlist</button>
          </div>
        `)}

        ${settingsSectionHtml("Panels and travel", "portfolio, shops, travel, browse", `
          <div class="me-form-grid">
            <label for="me-set-travelType">Travel type (sets flight time for $/hour abroad)</label><select id="me-set-travelType" data-setting="travelType">${Object.entries(TRAVEL_TYPE_LABELS).map(([value, label]) => `<option value="${value}" ${value === (current.travelType || "standard") ? "selected" : ""}>${label}</option>`).join("")}</select>
            ${f("travelCapacity", "Travel capacity when the page does not show it (0 = per-item only)", { min: 0, max: 1000, step: 1 })}
            ${f("shopRunQuantity", "City shop run quantity (units)", { min: 1, max: 10000, step: 1 })}
            ${f("portfolioRefineRequests", "Portfolio refine budget (requests per press)", { min: 1, max: 60, step: 1 })}
            ${f("auctionEvidenceEnabled", "Use ended Auction House sales as evidence", { type: "checkbox" })}
            ${f("browseOverlayEnabled", "Item Market browse-grid overlay", { type: "checkbox" })}
          </div>
        `)}

        ${settingsSectionHtml("Scanning and diagnostics", "advanced", `
          <div class="me-form-grid">
            ${f("scanMaxVisibleItems", "Rows priced per scan", { min: 1, max: 50, step: 1, help: "Rows further down the page are priced as they scroll into view." })}
            ${f("historyRetentionDays", "Keep local price history (days)", { min: 1, max: 90, step: 1 })}
            ${f("developerMode", "Developer diagnostics in the console", { type: "checkbox" })}
          </div>
          <div class="me-actions"><button class="me-btn" id="me-build-diagnostics" type="button">Build page structure report</button><button class="me-btn" id="me-copy-diagnostics" type="button" hidden>Copy</button></div>
          <textarea id="me-diagnostics" class="me-inline-input" style="width:100%;min-height:90px;display:none;font:10px/1.3 monospace" readonly aria-label="Page structure report"></textarea>
          <div class="me-form-help">The report describes the page's structure around item rows and how the script behaved here. It never includes the API key. Fees modelled: Item Market 5% sales tax, optional 10% anonymous-listing fee, Auction House 3%; Bazaar and trades have no fee.</div>
        `)}

        <div class="me-modal-actions"><button class="me-btn" id="me-reset-settings" type="button">Reset to defaults</button><button class="me-btn" id="me-cancel-settings" type="button">Cancel</button><button class="me-btn" id="me-save-settings" type="button">Save</button></div>
      </div>`;
    document.body.appendChild(backdrop);

    const modal = backdrop.querySelector(".me-modal");
    const previouslyFocused = document.activeElement;
    const close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      try { previouslyFocused?.focus?.(); } catch { /* ignore */ }
    };
    const focusable = () => Array.from(modal.querySelectorAll("input, select, textarea, button, a[href], summary")).filter((node) => !node.hidden && node.offsetParent !== null || node.tagName === "SUMMARY");
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    backdrop.querySelector("#me-cancel-settings").addEventListener("click", close);
    setTimeout(() => {
      try {
        (hasKey ? backdrop.querySelector("#me-set-itemMarketUndercut") : backdrop.querySelector("#me-api-key"))?.focus();
      } catch { /* ignore */ }
    }, 0);

    const keyInfo = Store.keyInfo();
    if (keyInfo?.info?.access?.type) {
      const status = backdrop.querySelector("#me-api-status");
      status.textContent = `${keyInfo.info.access.type} key, verified ${formatAge(Math.floor((Date.now() - asInt(keyInfo.savedAt)) / 1000))} ago`;
    }

    const renderWatchRows = () => {
      const host = backdrop.querySelector("#me-watchlist-rows");
      const entries = Store.watchlist();
      if (!entries.length) {
        host.innerHTML = `<div class="me-form-help">No watched items. Add one below, or use "Watch" on an Item Market page.</div>`;
        return;
      }
      host.innerHTML = entries.map((entry) => `
        <div class="me-watch-row" data-item-id="${entry.itemId}">
          <span class="me-watch-name">${escapeHtml(entry.name)}</span>
          <span>at or below ${formatMoney(entry.target)}</span>
          <span>${entry.lastFloor ? `floor ${formatMoney(entry.lastFloor)}` : ""}</span>
          <button class="me-watch-remove" type="button" aria-label="Stop watching ${escapeHtml(entry.name)}">×</button>
        </div>`).join("");
      host.querySelectorAll(".me-watch-remove").forEach((button) => {
        button.addEventListener("click", () => {
          const itemId = asInt(button.closest(".me-watch-row")?.dataset?.itemId, 0);
          Store.saveWatchlist(Store.watchlist().filter((entry) => entry.itemId !== itemId));
          renderWatchRows();
        });
      });
    };
    renderWatchRows();
    backdrop.querySelector("#me-build-diagnostics").addEventListener("click", async () => {
      const area = backdrop.querySelector("#me-diagnostics");
      const copy = backdrop.querySelector("#me-copy-diagnostics");
      area.style.display = "block";
      area.value = buildPageDiagnostics();
      copy.hidden = false;
      try {
        await navigator.clipboard?.writeText?.(area.value);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy";
      }
    });
    backdrop.querySelector("#me-copy-diagnostics").addEventListener("click", async () => {
      const area = backdrop.querySelector("#me-diagnostics");
      area.select();
      try {
        await navigator.clipboard?.writeText?.(area.value);
        backdrop.querySelector("#me-copy-diagnostics").textContent = "Copied";
      } catch {
        // Selection is left in place for a manual copy.
      }
    });
    backdrop.querySelector("#me-watch-add").addEventListener("click", async () => {
      const itemId = asInt(backdrop.querySelector("#me-watch-item").value, 0);
      const target = asInt(backdrop.querySelector("#me-watch-target").value, 0);
      if (!itemId || target <= 0) return;
      let name = `Item ${itemId}`;
      try {
        const meta = await loadItemMetadataBatch([itemId]);
        name = meta.get(itemId)?.name || name;
      } catch {
        // Name lookup is cosmetic.
      }
      addWatchItem({ itemId, name, target });
      backdrop.querySelector("#me-watch-item").value = "";
      backdrop.querySelector("#me-watch-target").value = "";
      renderWatchRows();
    });

    backdrop.querySelector("#me-test-key").addEventListener("click", async () => {
      const status = backdrop.querySelector("#me-api-status");
      Store.setApiKey(backdrop.querySelector("#me-api-key").value);
      api.memoryCache.clear();
      status.textContent = "Testing...";
      status.className = "";
      try {
        const result = await api.testKey();
        const player = result.playerId ? `player ${result.playerId}` : "player unknown";
        const limitedOk = result.accessRank >= KEY_ACCESS_RANK["Limited Access"];
        status.textContent = `OK: ${player}, ${result.accessType}${limitedOk ? "" : " (the own-listings panel needs Limited access)"}`;
        status.className = limitedOk ? "me-good" : "me-warn";
      } catch (error) {
        status.textContent = describeApiError(error, { feature: "Key test" });
        status.className = "me-bad";
      }
    });
    backdrop.querySelector("#me-reset-settings").addEventListener("click", () => {
      let confirmed = true;
      try { confirmed = window.confirm("Reset every Market Edge setting to its default? The API key, watchlist and pricing rules are kept."); } catch { confirmed = true; }
      if (!confirmed) return;
      Store.saveSettings({});
      settings = Store.settings();
      close();
      showSettings();
    });
    backdrop.querySelector("#me-save-settings").addEventListener("click", () => {
      const next = { ...current };
      backdrop.querySelectorAll("[data-setting]").forEach((input) => {
        const key = input.dataset.setting;
        if (input.type === "checkbox") next[key] = input.checked;
        else if (input.tagName === "SELECT") next[key] = input.value;
        else if (input.dataset.premium) next[key] = 1 + Number(input.value || 0) / 100;
        else if (input.dataset.percent) next[key] = Number(input.value || 0) / 100;
        else next[key] = Number(input.value || 0);
      });
      next.watchlistIntervalSeconds = Math.max(WATCHLIST_MIN_INTERVAL_SEC, asInt(next.watchlistIntervalSeconds, DEFAULTS.watchlistIntervalSeconds));
      Store.setApiKey(backdrop.querySelector("#me-api-key").value);
      Store.saveSettings(next);
      settings = Store.settings();
      api.memoryCache.clear();
      close();
      scheduleRefresh(true);
      restartWatchlist();
    });
  }

  function addBadge(card, text, state = "GREY", title = "") {
    if (!card?.isConnected) return;
    let badge = card.querySelector(":scope > .me-badge");
    if (!badge) {
      badge = document.createElement("span");
      card.appendChild(badge);
      ui.renderedBadges.add(badge);
    }
    badge.className = `me-badge ${state}`;
    badge.textContent = text;
    badge.title = title;
  }

  function clearBadges() {
    ui.renderedBadges.forEach((badge) => badge.remove());
    ui.renderedBadges.clear();
  }

  function clearInlineAnalysis() {
    document.querySelectorAll(".me-inline-analysis").forEach((node) => node.remove());
    document.querySelectorAll(".me-bazaar-add-controls,.me-bazaar-add-host").forEach((node) => {
      node.classList.remove("me-bazaar-add-controls", "me-bazaar-add-host");
    });
    document.querySelectorAll(".me-bazaar-add-row,.me-row-host").forEach((node) => node.classList.remove("me-bazaar-add-row", "me-row-host"));
  }

  function removeFloatingUi(force = false) {
    // Panels opened deliberately from the menu (own listings, watchlist) stay
    // until the player closes them or navigates elsewhere.
    if (ui.pinned && !force) return;
    ui.pinned = false;
    ui.currentPanel = null;
    if (ui.root?.isConnected) ui.root.remove();
    ui.root = null;
    ui.body = null;
    ui.title = null;
    ui.status = null;
  }

  function inlineHostFor(visible, { hidden = false } = {}) {
    if (visible?.rowLine) {
      const host = visible.inlineAnchor?.isConnected ? visible.inlineAnchor : visible.card;
      if (host?.isConnected) {
        // Hidden markers (unpriced rows) must not change the row's layout,
        // even after a loading placeholder tagged the row.
        if (hidden) visible.card?.classList?.remove("me-row-host", "me-row-float-host");
        else visible.card?.classList?.add("me-row-host");
        return { mode: "append", node: host };
      }
    }
    if (visible?.bazaarAdd) {
      const controls = visible?.bazaarControls || visible?.inlineAnchor;
      if (controls?.isConnected) {
        controls.classList?.add("me-bazaar-add-controls");
        visible.card?.classList?.add("me-bazaar-add-row");
        return { mode: "append", node: controls };
      }
    }
    const anchor = visible?.inlineAnchor;
    if (anchor?.isConnected) return { mode: "append", node: anchor };
    if (visible?.card?.isConnected) return { mode: "append", node: visible.card };
    return null;
  }

  // "Why this price": a small toggle on the strip opens a plain-language
  // explanation underneath. Tooltips are not used anywhere on rows because
  // mobile webviews pop them up over the row on tap.
  function whyHtml(lines) {
    const clean = (lines || []).filter(Boolean);
    if (!clean.length) return "";
    return `<button class="me-why-toggle" type="button" aria-expanded="false" aria-label="Why this price">?</button><span class="me-why" role="region" aria-label="Explanation">${clean.map((line) => `<span class="me-why-line">${escapeHtml(line)}</span>`).join("")}</span>`;
  }

  function bindWhy(block) {
    const toggle = block?.querySelector?.(".me-why-toggle");
    const panel = block?.querySelector?.(".me-why");
    if (!toggle || !panel) return;
    block.classList.add("me-has-why");
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = !panel.classList.contains("me-open");
      panel.classList.toggle("me-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function renderInlineHtml(visible, html, state = "GREY", extraClass = "", { why = [] } = {}) {
    const hidden = extraClass.includes("me-hidden");
    const host = inlineHostFor(visible, { hidden });
    if (!host) return null;
    visible.card?.querySelectorAll?.(".me-inline-analysis").forEach((node) => node.remove());
    // Inventory rows get a block-level div as the row's last child; other
    // surfaces keep the inline span.
    const block = document.createElement(visible?.rowLine && !hidden ? "div" : "span");
    block.className = `me-inline-analysis ${state} ${extraClass}${visible?.rowLine && !hidden ? " me-row-line" : ""}`.trim();
    block.dataset.meItemId = String(visible.itemId);
    block.dataset.meComplete = extraClass.includes("me-loading") ? "0" : "1";
    block.innerHTML = hidden ? html : `${html}${whyHtml(why)}`;
    host.node.appendChild(block);
    if (!hidden) bindWhy(block);
    if (visible?.rowLine && !hidden) ensureRowLineVisible(block);
    return block;
  }

  // No API key yet: the row itself offers the way in.
  function renderInlineKeyPrompt(visible) {
    const block = renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><button class="me-key-cta" type="button">Add API key</button><span class="me-inline-secondary">to price this row</span>`,
      "GREY",
      "me-has-cta"
    );
    block?.querySelector?.(".me-key-cta")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showSettings();
    });
    return block;
  }

  function orderBookAgeLine(result) {
    const age = result?.renderMeta?.cacheAgeSeconds;
    if (!Number.isFinite(age)) return "";
    return `Order book from ${formatAge(age)} ago${result?.renderMeta?.stale ? " (refreshing)" : ""}.`;
  }

  // Torn's row markup differs between builds and devices; measure the line
  // after insertion and, when its box collapsed to nothing, float it over the
  // bottom edge of the row instead.
  function ensureRowLineVisible(block) {
    try {
      let rect = block.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
      block.classList.add("me-row-float");
      block.parentElement?.classList?.add("me-row-float-host");
      rect = block.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function renderInlineLoading(visible) {
    const existing = visible.card?.querySelector?.(`.me-inline-analysis[data-me-item-id="${visible.itemId}"]`);
    if (existing?.dataset?.meComplete === "1") return existing;
    return renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">...</span>`,
      "GREY",
      "me-loading"
    );
  }

  function renderInlineError(visible, message) {
    if (/api key/i.test(String(message || ""))) return renderInlineKeyPrompt(visible);
    return renderInlineHtml(
      visible,
