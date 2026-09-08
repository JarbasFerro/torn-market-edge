    .me-grid { display:grid; grid-template-columns:1fr auto; gap:4px 12px; font-size:11px; }
    .me-grid .label { color:#aaa; }
    .me-grid .value { font-variant-numeric:tabular-nums; text-align:right; }
    .me-rule { height:1px; background:rgba(255,255,255,.08); margin:9px 0; }
    .me-callout { border-left:3px solid #777; background:rgba(255,255,255,.04); padding:8px; border-radius:4px; }
    .me-callout.GREEN { border-color:#4aa564; }
    .me-callout.YELLOW { border-color:#d3aa42; }
    .me-callout.GREY { border-color:#808080; }
    .me-callout.RED { border-color:#bd5151; }
    .me-decision { display:flex; align-items:center; gap:6px; font-weight:700; font-size:12px; }
    .me-decision.GREEN { color:#7fd193; }
    .me-decision.YELLOW { color:#f0ca66; }
    .me-decision.GREY { color:#bbb; }
    .me-decision.RED { color:#e27a7a; }
    .me-note { font-size:10px; color:#aaa; line-height:1.35; margin-top:6px; }
    .me-good { color:#7fd193; }
    .me-warn { color:#f0ca66; }
    .me-bad { color:#e27a7a; }
    .me-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
    .me-progress { height:4px; background:#3b3b3e; border-radius:3px; overflow:hidden; margin:8px 0; }
    .me-progress > div { height:100%; background:#888; transition:width .15s linear; }
    .me-result { padding:7px 0; border-top:1px solid rgba(255,255,255,.07); font-size:11px; }
    .me-result:first-child { border-top:0; }
    .me-result-head { display:flex; align-items:center; gap:6px; }
    .me-result-name { font-weight:700; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .me-result-metrics { display:flex; gap:8px; margin-top:3px; color:#bbb; font-variant-numeric:tabular-nums; }
    .me-diag { margin:8px 0 0; padding:7px; background:rgba(0,0,0,.18); border-radius:4px; }
    .me-diag-row { font-size:10px; line-height:1.5; }
    .me-diag-row.pass { color:#b9d9c0; }
    .me-diag-row.fail { color:#dfb1b1; }
    .me-badge { display:inline-flex !important; align-items:center; gap:3px; padding:2px 5px !important; margin-left:5px !important; border-radius:4px !important; font:700 10px/1.25 Arial,sans-serif !important; white-space:nowrap !important; vertical-align:middle !important; pointer-events:none !important; }
    .me-badge.GREEN { background:rgba(54,137,76,.18) !important; color:#4fa968 !important; border:1px solid rgba(79,169,104,.45) !important; }
    .me-badge.YELLOW { background:rgba(183,135,35,.17) !important; color:#c99c3e !important; border:1px solid rgba(201,156,62,.45) !important; }
    .me-badge.GREY { background:rgba(100,100,100,.14) !important; color:#999 !important; border:1px solid rgba(130,130,130,.35) !important; }
    .me-badge.RED { background:rgba(165,58,58,.15) !important; color:#c76262 !important; border:1px solid rgba(199,98,98,.4) !important; }
    .me-inline-analysis { position:static !important; display:inline-flex !important; align-items:center !important; flex-wrap:nowrap !important; gap:4px !important; width:auto !important; max-width:100% !important; min-width:0 !important; margin:0 0 0 8px !important; padding:1px 5px !important; border:1px solid rgba(255,255,255,.12) !important; border-radius:4px !important; background:rgba(15,15,17,.52) !important; color:#bbb !important; font:700 10px/1.25 Arial,sans-serif !important; box-sizing:border-box !important; vertical-align:middle !important; white-space:nowrap !important; pointer-events:none !important; }
    .me-inline-brand { color:#ddd !important; letter-spacing:.04em !important; }
    .me-inline-primary { color:#eee !important; }
    .me-inline-secondary { color:#999 !important; font-weight:600 !important; }
    .me-inline-sep { color:#666 !important; font-weight:400 !important; }
    .me-inline-stale { color:#d3aa42 !important; font-weight:700 !important; }
    .me-inline-analysis.GREEN { border-color:rgba(74,165,100,.58) !important; }
    .me-inline-analysis.YELLOW { border-color:rgba(211,170,66,.62) !important; }
    .me-inline-analysis.GREY { border-color:rgba(128,128,128,.42) !important; }
    .me-inline-analysis.RED { border-color:rgba(189,81,81,.58) !important; }
    .me-inline-brand { font-weight:800 !important; color:#eee !important; letter-spacing:.04em !important; }
    .me-inline-status { font-weight:800 !important; white-space:nowrap !important; }
    .me-inline-analysis.GREEN .me-inline-status { color:#7fd193 !important; }
    .me-inline-analysis.YELLOW .me-inline-status { color:#f0ca66 !important; }
    .me-inline-analysis.RED .me-inline-status { color:#e27a7a !important; }
    .me-inline-metric { white-space:nowrap !important; font-variant-numeric:tabular-nums !important; }
    .me-inline-analysis.me-loading { opacity:.65 !important; font-weight:400 !important; }
    .me-inline-analysis.me-bazaar-add { pointer-events:auto !important; padding-right:3px !important; }
    .me-bazaar-fill-btn { display:inline-flex !important; align-items:center !important; justify-content:center !important; min-width:25px !important; height:22px !important; margin:0 0 0 2px !important; padding:0 7px !important; border:1px solid rgba(255,255,255,.24) !important; border-radius:4px !important; background:rgba(255,255,255,.08) !important; color:#eee !important; font:800 13px/1 Arial,sans-serif !important; cursor:pointer !important; pointer-events:auto !important; touch-action:manipulation !important; }
    .me-bazaar-fill-btn:hover, .me-bazaar-fill-btn:focus { background:rgba(255,255,255,.16) !important; border-color:rgba(255,255,255,.4) !important; outline:none !important; }
    .me-inline-analysis.me-bazaar-add.me-applied { border-color:rgba(74,165,100,.65) !important; }
    .me-modal-backdrop { position:fixed; inset:0; z-index:999999; background:rgba(0,0,0,.64); display:flex; align-items:center; justify-content:center; padding:18px; }
    .me-modal { width:min(620px, 100%); max-height:90vh; overflow:auto; background:#242426; color:#eee; border:1px solid #555; border-radius:8px; box-shadow:0 14px 46px rgba(0,0,0,.55); padding:14px; }
    .me-modal h2 { margin:0 0 12px; font-size:17px; }
    .me-section-title { margin:13px 0 7px; font-size:11px; color:#bbb; text-transform:uppercase; letter-spacing:.06em; }
    .me-form-grid { display:grid; grid-template-columns:minmax(170px, 1fr) minmax(120px, .7fr); gap:7px 12px; align-items:center; font-size:11px; }
    .me-form-grid input, .me-form-grid select { width:100%; padding:6px; border:1px solid #555; border-radius:4px; background:#171719; color:#eee; }
    .me-form-grid input[type='checkbox'] { width:auto; justify-self:start; }
    .me-form-help { color:#999; font-size:10px; margin-top:8px; line-height:1.4; }
    .me-modal-actions { display:flex; gap:7px; justify-content:flex-end; margin-top:14px; }
    .me-error { color:#e27a7a; font-size:11px; line-height:1.4; }
    .me-learning { color:#f0ca66; }
    @media (max-width: 600px) { #market-edge-root { right:6px; bottom:6px; width:calc(100vw - 12px); } .me-body { max-height:58vh; } }
  `;

  try { GM_addStyle(CSS); } catch { /* no-op */ }

  function ensureUi() {
    if (ui.root?.isConnected) return ui.root;
    const root = document.createElement("div");
    root.id = "market-edge-root";
    root.innerHTML = `
      <div class="me-shell">
        <div class="me-header">
          <div class="me-title">Market Edge</div>
          <div class="me-status"></div>
          <button class="me-icon-btn me-settings" type="button" title="Settings">S</button>
          <button class="me-icon-btn me-collapse" type="button" title="Collapse">-</button>
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
    applyPanelState();
    return root;
  }

  function applyPanelState() {
    if (!ui.root) return;
    const state = Store.get(STORAGE_KEYS.panelState, "expanded");
    const body = ui.root.querySelector(".me-body");
    const button = ui.root.querySelector(".me-collapse");
    body.hidden = state === "collapsed";
    button.textContent = state === "collapsed" ? "+" : "-";
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

  function showSettings() {
    if (document.querySelector(".me-modal-backdrop")) return;
    const current = Store.settings();
    const backdrop = document.createElement("div");
    backdrop.className = "me-modal-backdrop";
    backdrop.innerHTML = `
      <div class="me-modal" role="dialog" aria-modal="true" aria-label="Market Edge settings">
        <h2>Market Edge settings</h2>
        <div class="me-section-title">API</div>
        <div class="me-form-grid">
          <label for="me-api-key">API key</label><input id="me-api-key" type="password" autocomplete="off" value="${escapeHtml(Store.apiKey())}">
          <span>API status</span><span id="me-api-status">Not tested</span>
        </div>
        <div class="me-actions"><button class="me-btn" id="me-test-key" type="button">Test API key</button></div>

        <div class="me-section-title">Trading</div>
        <div class="me-form-grid">
          <label>Available trading capital ($)</label><input data-setting="availableCapital" type="number" min="0" step="1000000" value="${current.availableCapital}">
          <label>Max capital / opportunity ($)</label><input data-setting="maxCapitalOpportunity" type="number" min="1" step="1000000" value="${current.maxCapitalOpportunity}">
          <label>Max capital / item ($)</label><input data-setting="maxCapitalItem" type="number" min="1" step="1000000" value="${current.maxCapitalItem}">
          <label>Minimum ROI (%)</label><input data-setting="minimumROI" data-percent="1" type="number" min="0" max="100" step="0.1" value="${current.minimumROI * 100}">
          <label>Minimum expected profit ($)</label><input data-setting="minimumProfit" type="number" min="0" step="50000" value="${current.minimumProfit}">
          <label>Minimum discount (%)</label><input data-setting="minimumDiscount" data-percent="1" type="number" min="0" max="100" step="0.1" value="${current.minimumDiscount * 100}">
        </div>

        <div class="me-section-title">Exit assumptions</div>
        <div class="me-form-grid">
          <label>Bazaar enabled</label><input data-setting="bazaarEnabled" type="checkbox" ${current.bazaarEnabled ? "checked" : ""}>
          <label>Bazaar discount (%)</label><input data-setting="bazaarDiscount" data-percent="1" type="number" min="0" max="20" step="0.1" value="${current.bazaarDiscount * 100}">
          <label>Safety haircut (%)</label><input data-setting="safetyHaircut" data-percent="1" type="number" min="0" max="10" step="0.1" value="${current.safetyHaircut * 100}">
          <label>Historical premium cap (%)</label><input data-setting="allowedHistoricalPremium" data-premium="1" type="number" min="0" max="10" step="0.1" value="${(current.allowedHistoricalPremium - 1) * 100}">
          <label>Item Market undercut ($)</label><input data-setting="itemMarketUndercut" type="number" min="0" step="1" value="${current.itemMarketUndercut}">
        </div>

        <div class="me-section-title">Risk & scanning</div>
        <div class="me-form-grid">
          <label>Minimum confidence for green</label><select data-setting="minimumGreenConfidence">${["VERY LOW", "LOW", "MEDIUM", "HIGH"].map((value) => `<option ${value === current.minimumGreenConfidence ? "selected" : ""}>${value}</option>`).join("")}</select>
          <label>Max MAD volatility (%)</label><input data-setting="maxVolatility" data-percent="1" type="number" min="0" max="100" step="0.1" value="${current.maxVolatility * 100}">
          <label>Max visible items / scan</label><input data-setting="scanMaxVisibleItems" type="number" min="1" max="50" step="1" value="${current.scanMaxVisibleItems}">
          <label>Travel capacity (0 = per-item only)</label><input data-setting="travelCapacity" type="number" min="0" max="1000" step="1" value="${current.travelCapacity}">
          <label>History retention (days)</label><input data-setting="historyRetentionDays" type="number" min="1" max="90" step="1" value="${current.historyRetentionDays}">
          <label>Developer diagnostics in console</label><input data-setting="developerMode" type="checkbox" ${current.developerMode ? "checked" : ""}>
        </div>
        <div class="me-form-help">The API key stays in Tampermonkey storage and is sent only to api.torn.com. Market Edge never includes it in diagnostics or exports. Item Market sale fee is fixed at 5% in this release.</div>
        <div class="me-modal-actions"><button class="me-btn" id="me-cancel-settings" type="button">Cancel</button><button class="me-btn" id="me-save-settings" type="button">Save</button></div>
      </div>`;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    backdrop.querySelector("#me-cancel-settings").addEventListener("click", close);
    backdrop.querySelector("#me-test-key").addEventListener("click", async () => {
      const status = backdrop.querySelector("#me-api-status");
      Store.setApiKey(backdrop.querySelector("#me-api-key").value);
      api.memoryCache.clear();
      status.textContent = "Testing...";
      try {
        const result = await api.testKey();
        status.textContent = result.playerId ? `OK - player ${result.playerId}` : "OK";
        status.className = "me-good";
      } catch (error) {
        status.textContent = error.message;
        status.className = "me-bad";
      }
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
      Store.setApiKey(backdrop.querySelector("#me-api-key").value);
      Store.saveSettings(next);
      settings = Store.settings();
      api.memoryCache.clear();
      close();
      scheduleRefresh(true);
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
  }

  function removeFloatingUi() {
    if (ui.root?.isConnected) ui.root.remove();
    ui.root = null;
    ui.body = null;
    ui.title = null;
    ui.status = null;
  }

  function inlineHostFor(visible) {
    const anchor = visible?.inlineAnchor;
    if (anchor?.isConnected) return { mode: "append", node: anchor };
    if (visible?.card?.isConnected) return { mode: "append", node: visible.card };
    return null;
  }

  function renderInlineHtml(visible, html, state = "GREY", extraClass = "") {
    const host = inlineHostFor(visible);
    if (!host) return null;
    visible.card?.querySelectorAll?.(".me-inline-analysis").forEach((node) => node.remove());
    const block = document.createElement("span");
    block.className = `me-inline-analysis ${state} ${extraClass}`.trim();
    block.dataset.meItemId = String(visible.itemId);
    block.dataset.meComplete = extraClass.includes("me-loading") ? "0" : "1";
    block.innerHTML = html;
    host.node.appendChild(block);
    return block;
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
    return renderInlineHtml(
      visible,
