from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"Could not find patch target: {label}")
    if text.count(old) != 1:
        raise RuntimeError(f"Patch target is not unique ({text.count(old)} matches): {label}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Request queue: make list requests cancellable before they consume API budget.
# ---------------------------------------------------------------------------
p = "src/parts/02.part.js"
s = read(p)
s = replace_once(
    s,
    '''    schedule(task, priority = 0) {
      return new Promise((resolve, reject) => {
        this.queue.push({ task, priority, resolve, reject, sequence: this.sequence++ });
        this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
        this.pump();
      });
    }

    pump() {''',
    '''    schedule(task, priority = 0, meta = {}) {
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

    pump() {''',
    "scheduler cancellation",
)
s = replace_once(
    s,
    '    async request(path, { cacheMs = 25000, priority = 0 } = {}) {',
    '    async request(path, { cacheMs = 25000, priority = 0, queueGroup = null } = {}) {',
    "request queue group signature",
)
s = replace_once(
    s,
    '''      }, priority)
        .then((data) => {''',
    '''      }, priority, { path, queueGroup })
        .then((data) => {''',
    "request scheduler metadata",
)
write(p, s)


# ---------------------------------------------------------------------------
# Propagate queue-group metadata through Item Market snapshot requests.
# ---------------------------------------------------------------------------
p = "src/parts/03.part.js"
s = read(p)
s = replace_once(
    s,
    '''    async itemMarket(itemId, { limit = API_LIST_LIMIT, priority = 0 } = {}) {
      const safeLimit = clamp(asInt(limit, API_LIST_LIMIT), 1, API_DEEP_LIMIT);
      return this.request(`/market/${asInt(itemId)}/itemmarket?limit=${safeLimit}&offset=0`, { priority });
    }''',
    '''    async itemMarket(itemId, { limit = API_LIST_LIMIT, priority = 0, queueGroup = null } = {}) {
      const safeLimit = clamp(asInt(limit, API_LIST_LIMIT), 1, API_DEEP_LIMIT);
      return this.request(`/market/${asInt(itemId)}/itemmarket?limit=${safeLimit}&offset=0`, { priority, queueGroup });
    }''',
    "itemMarket queue group",
)
s = replace_once(
    s,
    '  async function loadSnapshot(itemId, { limit = API_LIST_LIMIT, priority = 0, onCached = null } = {}) {',
    '  async function loadSnapshot(itemId, { limit = API_LIST_LIMIT, priority = 0, onCached = null, queueGroup = null } = {}) {',
    "loadSnapshot queue group signature",
)
s = replace_once(
    s,
    '    const payload = await api.itemMarket(itemId, { limit, priority });',
    '    const payload = await api.itemMarket(itemId, { limit, priority, queueGroup });',
    "loadSnapshot queue group propagation",
)
write(p, s)


# ---------------------------------------------------------------------------
# Surface-specific list price extraction. Prefer skipping a row to pricing the
# wrong field (especially RRP/value on Bazaar and resale values while abroad).
# ---------------------------------------------------------------------------
p = "src/parts/04.part.js"
s = read(p)
anchor = '  function collectVisibleItems({ requireMoney = false } = {}) {'
helper = r'''  function priceForSurfaceCard(surface, card, explicitElement = null) {
    if (!card) return null;
    const explicit = parseMoney(explicitElement?.textContent || "");
    if (explicit) return explicit;

    const candidates = [];
    const selector = [
      "[data-testid*='price']",
      "[class*='price']",
      "[aria-label*='price']",
      "button",
      "a",
      "span",
      "strong",
      "b",
      "div"
    ].join(",");

    card.querySelectorAll(selector).forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      if (element.closest(".me-inline-analysis,#market-edge-root")) return;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const directText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const text = directText || (element.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 140) return;
      const price = parseMoney(text);
      if (!price) return;

      const metadata = `${element.getAttribute("data-testid") || ""} ${element.className || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`;
      let score = 0;
      if (/price/i.test(element.getAttribute("data-testid") || "")) score += 100;
      if (/price|cost/i.test(metadata)) score += 45;
      if (element.matches("button,a")) score += 15;

      if (surface === "bazaar") {
        if (/\brrp\b|market\s+(?:value|price)|estimated\s+value|\bvalue\s*:/i.test(text)) score -= 250;
        if (/\bprice\b|\bbuy\b|\beach\b|\bunit\b/i.test(`${text} ${metadata}`)) score += 35;
      } else if (surface === "travel") {
        if (/market\s+(?:value|price)|resale|\bsell\b|\bvalue\s*:/i.test(text)) score -= 200;
        if (/\bcost\b|\bprice\b|\bbuy\b|\beach\b|\bunit\b/i.test(`${text} ${metadata}`)) score += 35;
      }

      candidates.push({ price, score, textLength: text.length, area: rect.width * rect.height });
    });

    candidates.sort((a, b) => b.score - a.score || a.textLength - b.textLength || a.area - b.area);
    if (candidates.length && candidates[0].score > -100) return candidates[0].price;

    // On Bazaar/travel pages a missing value is safer than falling back to an
    // arbitrary dollar amount from the card (RRP, market value, etc.).
    if (surface === "bazaar" || surface === "travel") return null;
    return parseMoney(card.innerText || "");
  }

'''
if anchor not in s:
    raise RuntimeError("Could not find collectVisibleItems anchor")
s = s.replace(anchor, helper + anchor, 1)
s = replace_once(
    s,
    '''      const text = card?.innerText || "";
      const priceElement = card?.querySelector?.('[data-testid="price"]');
      const price = requireMoney ? (parseMoney(priceElement?.textContent || "") || parseMoney(text)) : null;''',
    '''      const text = card?.innerText || "";
      const priceElement = card?.querySelector?.('[data-testid="price"]');
      const price = requireMoney ? priceForSurfaceCard(detectSurface(), card, priceElement) : null;''',
    "surface-specific price extraction",
)
write(p, s)


# ---------------------------------------------------------------------------
# Item Market: official API remains authoritative. DOM is confirmation/highlight
# only, never a replacement valuation source.
# ---------------------------------------------------------------------------
p = "src/parts/06.part.js"
s = read(p)
pattern = re.compile(
    r'''      let analysisSnapshot = snapshot;\n      let liveConfirmation = "API discovery";\n      const liveRows = parseLiveItemMarketListings\(\);\n      if \(liveRows.length >= 2\) \{.*?\n      \}\n\n      const evaluated = evaluatePrefixes\(analysisSnapshot, historyStats, settings\);''',
    re.S,
)
replacement = '''      const liveRows = parseLiveItemMarketListings();
      const compareCount = Math.min(5, liveRows.length, snapshot.listings.length);
      const liveMatchesApi = compareCount >= 2 && Array.from({ length: compareCount }, (_, index) => (
        liveRows[index]?.price === snapshot.listings[index]?.price
      )).every(Boolean);
      const liveConfirmation = liveRows.length < 2
        ? "API"
        : (liveMatchesApi ? "PAGE MATCHES API" : "API - PAGE DIFFERS");

      // The official Torn API is the authoritative valuation source. The live
      // DOM is used only to confirm/highlight what the player currently sees.
      const evaluated = evaluatePrefixes(snapshot, historyStats, settings);'''
s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise RuntimeError(f"Item Market authority patch count={count}")

s = replace_once(
    s,
    '''      const currentDiscount = reference.value && snapshot.lowestPrice ? 1 - snapshot.lowestPrice / reference.value : null;

      setPanel(`''',
    '''      const currentDiscount = reference.value && snapshot.lowestPrice ? 1 - snapshot.lowestPrice / reference.value : null;
      const sourceWarning = liveRows.length >= 2 && !liveMatchesApi
        ? `<div class="me-note me-warn">The visible Torn listings differ from the current API cache. Market Edge is keeping the official API snapshot authoritative and will not mix the two books.</div>`
        : "";

      setPanel(`''',
    "Item Market source warning",
)
s = replace_once(
    s,
    '''        ])}
        <div class="me-rule"></div>
        <div class="me-kicker">Best opportunity</div>''',
    '''        ])}
        ${sourceWarning}
        <div class="me-rule"></div>
        <div class="me-kicker">Best opportunity</div>''',
    "Item Market source warning render",
)
s = replace_once(
    s,
    '''      highlightItemMarketRows(liveRows, best);''',
    '''      if (liveMatchesApi) highlightItemMarketRows(liveRows, best);
      else clearBadges();''',
    "safe listing highlighting",
)

# Queue-group helpers before generic list scans.
anchor = '  function genericIntro(surface, { clear = true } = {}) {'
queue_helpers = '''  let listQueueGeneration = 0;
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

'''
if anchor not in s:
    raise RuntimeError("Could not find genericIntro anchor")
s = s.replace(anchor, queue_helpers + anchor, 1)
s = replace_once(
    s,
    '''    setTimeout(() => scanVisibleSurface(surface, { retryIfEmpty: true, force: false }), 250);''',
    '''    setTimeout(() => scanVisibleSurface(surface, { retryIfEmpty: true, force: false, cancelObsolete: true }), 250);''',
    "generic list scan cancellation",
)
s = replace_once(
    s,
    '''  async function scanVisibleSurface(surface, { retryIfEmpty = false, force = false } = {}) {
    removeFloatingUi();
    if (document.visibilityState !== "visible") return;

    const ownBazaar = surface === "bazaar" ? await isOwnBazaar() : false;''',
    '''  async function scanVisibleSurface(surface, { retryIfEmpty = false, force = false, cancelObsolete = false } = {}) {
    removeFloatingUi();
    if (document.visibilityState !== "visible") return;

    const queueGroup = beginListQueueGroup(surface, { cancelObsolete });
    const ownBazaar = surface === "bazaar" ? await isOwnBazaar() : false;''',
    "scan queue group",
)
# Retry must keep the same structural cancellation semantics off; the active group stays current.
s = replace_once(
    s,
    '''            scanVisibleSurface(surface, { retryIfEmpty: false, force });''',
    '''            scanVisibleSurface(surface, { retryIfEmpty: false, force, cancelObsolete: false });''',
    "scan retry group",
)
# Make in-row scanning group-aware so an obsolete task cannot clear a newer task marker.
s = replace_once(
    s,
    '''      const existing = visible.card.querySelector?.(`.me-inline-analysis[data-me-item-id="${visible.itemId}"]`);
      const scanning = visible.card.dataset?.meScanning === String(visible.itemId);
      if (force && existing) existing.remove();
      return force || (!scanning && existing?.dataset?.meComplete !== "1");''',
    '''      const existing = visible.card.querySelector?.(`.me-inline-analysis[data-me-item-id="${visible.itemId}"]`);
      const scanningGroup = visible.card.dataset?.meScanningGroup || "";
      const scanning = visible.card.dataset?.meScanning === String(visible.itemId) && scanningGroup === queueGroup;
      if (cancelObsolete && scanningGroup && scanningGroup !== queueGroup) {
        delete visible.card.dataset.meScanning;
        delete visible.card.dataset.meScanningGroup;
        if (existing?.classList.contains("me-loading")) existing.remove();
      }
      if (force && existing) existing.remove();
      return force || (!scanning && existing?.dataset?.meComplete !== "1");''',
    "group-aware row scanning filter",
)
s = replace_once(
    s,
    '''    items.forEach((visible) => {
      if (visible.card?.dataset) visible.card.dataset.meScanning = String(visible.itemId);
      renderInlineLoading(visible);
    });''',
    '''    items.forEach((visible) => {
      if (visible.card?.dataset) {
        visible.card.dataset.meScanning = String(visible.itemId);
        visible.card.dataset.meScanningGroup = queueGroup;
      }
      renderInlineLoading(visible);
    });''',
    "group-aware row scanning marker",
)
s = replace_once(
    s,
    '''          priority,
          onCached: (cached) => {''',
    '''          priority,
          queueGroup,
          onCached: (cached) => {''',
    "queue group snapshot load",
)
s = replace_once(
    s,
    '''      } catch (error) {
        if (!renderedCached && visible.card?.isConnected) renderInlineError(visible, error.message);
        else log("Refresh failed; keeping cached row", visible.itemId, error.message);
      } finally {
        if (visible.card?.dataset?.meScanning === String(visible.itemId)) delete visible.card.dataset.meScanning;
      }''',
    '''      } catch (error) {
        if (error?.marketEdgeCanceled) return;
        if (!renderedCached && visible.card?.isConnected) renderInlineError(visible, error.message);
        else log("Refresh failed; keeping cached row", visible.itemId, error.message);
      } finally {
        if (visible.card?.dataset?.meScanning === String(visible.itemId) && visible.card.dataset.meScanningGroup === queueGroup) {
          delete visible.card.dataset.meScanning;
          delete visible.card.dataset.meScanningGroup;
        }
      }''',
    "canceled request handling",
)
write(p, s)


# ---------------------------------------------------------------------------
# SPA reconciliation: structural signature includes stable per-node identities,
# so a React remount with the same item IDs is still detected.
# ---------------------------------------------------------------------------
p = "src/parts/07.part.js"
s = read(p)
s = replace_once(
    s,
    '''  let refreshTimer = null;
  let signatureTimer = null;
  let lastLocationKey = "";
  let lastListSignature = "";''',
    '''  let refreshTimer = null;
  let signatureTimer = null;
  let lastLocationKey = "";
  let lastListSignature = "";
  const listRowIds = new WeakMap();
  let nextListRowId = 1;

  function listRowIdentity(card) {
    if (!card || (typeof card !== "object" && typeof card !== "function")) return 0;
    if (!listRowIds.has(card)) listRowIds.set(card, nextListRowId++);
    return listRowIds.get(card);
  }''',
    "SPA row identity state",
)
# Rewrite signature body in targeted fragments.
s = replace_once(s, '    const ids = [];', '    const entries = new Set();', "signature entries set")
s = replace_once(
    s,
    '      ids.push(itemId);',
    '      entries.add(`${itemId}@${listRowIdentity(card)}`);',
    "signature row identity",
)
s = replace_once(
    s,
    '''    const uniqueIds = Array.from(new Set(ids)).sort((a, b) => a - b);
    const heading = surface === "inventory"
      ? String(marker?.textContent || "").replace(/\s+/g, " ").trim()
      : "";
    return `${surface}|${heading}|${uniqueIds.join(",")}`;''',
    '''    const structuralEntries = Array.from(entries).sort();
    const heading = surface === "inventory"
      ? String(marker?.textContent || "").replace(/\s+/g, " ").trim()
      : "";
    return `${surface}|${heading}|${structuralEntries.join(",")}`;''',
    "signature structural entries",
)
s = replace_once(
    s,
    '''        scanVisibleSurface(surface, { retryIfEmpty: false, force: false });''',
    '''        scanVisibleSurface(surface, { retryIfEmpty: false, force: false, cancelObsolete: true });''',
    "structural signature rescan",
)
# Cancel stale list jobs when leaving list surfaces.
s = replace_once(
    s,
    '''    if (surface === "other") {
      clearInlineAnalysis();
      removeFloatingUi();
      return;
    }
    if (surface === "itemmarket") {
      clearInlineAnalysis();''',
    '''    if (surface === "other") {
      cancelQueuedListRequests("Market Edge left a supported market/list view.");
      clearInlineAnalysis();
      removeFloatingUi();
      return;
    }
    if (surface === "itemmarket") {
      cancelQueuedListRequests("Market Edge opened detailed Item Market analysis.");
      clearInlineAnalysis();''',
    "cancel list queue when leaving surface",
)
write(p, s)


# ---------------------------------------------------------------------------
# Automated economic regression suite.
# ---------------------------------------------------------------------------
tests = r'''"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require(path.join(__dirname, "..", "torn-market-edge.user.js"));
const ME = globalThis.__MARKET_EDGE_TEST__;

assert.ok(ME, "userscript must expose pure test helpers in Node");

function settings(overrides = {}) {
  return {
    ...ME.DEFAULTS,
    availableCapital: 1_000_000,
    maxCapitalOpportunity: 100_000,
    maxCapitalItem: 100_000,
    minimumROI: 0.02,
    minimumProfit: 1,
    minimumDiscount: 0.03,
    safetyHaircut: 0,
    bazaarDiscount: 0,
    allowedHistoricalPremium: 1.01,
    itemMarketUndercut: 0,
    minimumGreenConfidence: "MEDIUM",
    maxVolatility: 0.03,
    ...overrides,
  };
}

function snapshot(listings, overrides = {}) {
  return {
    itemId: 1,
    itemName: "Fixture Item",
    averagePrice: 100,
    cacheTimestamp: Math.floor(Date.now() / 1000),
    listings,
    lowestPrice: listings[0]?.price ?? null,
    secondPrice: listings[1]?.price ?? null,
    thirdPrice: listings[2]?.price ?? null,
    calculatedMarketAnchor: 100,
    depthMetrics: {
      listingCount: listings.length,
      top5Quantity: listings.slice(0, 5).reduce((sum, row) => sum + row.quantity, 0),
      top20Quantity: listings.slice(0, 20).reduce((sum, row) => sum + row.quantity, 0),
    },
    supportedCommodity: true,
    ...overrides,
  };
}

function history(overrides = {}) {
  return {
    historicalFairValue: 100,
    oneDay: { count: 20, volatility: 0.01, medianAnchor: 100 },
    sampleConfidence: "MEDIUM",
    ...overrides,
  };
}

test("obvious arbitrage is detected against a stable cluster", () => {
  const snap = snapshot([
    { price: 80, quantity: 1 },
    { price: 100, quantity: 10 },
    { price: 101, quantity: 10 },
    { price: 102, quantity: 10 },
    { price: 103, quantity: 10 },
  ]);
  const result = ME.evaluatePrefixes(snap, history(), settings());
  assert.ok(result.best);
  assert.equal(result.best.quantityBought, 1);
  assert.ok(result.best.expectedProfit > 0);
  assert.ok(["GREEN", "YELLOW"].includes(result.best.classification.state));
});

test("a fake second-ask gap is capped by historical fair value", () => {
  const exit = ME.calculateExit({
    snapshot: snapshot([{ price: 80, quantity: 1 }, { price: 1000, quantity: 1 }]),
    historyStats: history(),
    nextAsk: 1000,
    settings: settings(),
  });
  assert.equal(exit.exitAnchor, 101);
  assert.equal(exit.conservativeExitPrice, 101);
});

test("Item Market fee can destroy a nominal spread", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 96,
    quantity: 1,
    snapshot: snapshot([{ price: 100, quantity: 10 }, { price: 101, quantity: 10 }]),
    historyStats: history(),
    settings: settings({ bazaarEnabled: false }),
  });
  assert.ok(result);
  assert.ok(result.expectedProfit < 0);
  assert.equal(result.classification.state, "RED");
  assert.equal(ME.itemMarketNetFor(100, 1), 95);
});

test("Bazaar can be profitable while Item Market is not", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 97,
    quantity: 1,
    snapshot: snapshot([{ price: 100, quantity: 10 }, { price: 101, quantity: 10 }]),
    historyStats: history(),
    settings: settings({ bazaarEnabled: true }),
  });
  assert.ok(result);
  assert.equal(result.routes.bestRoute, "Bazaar");
  assert.equal(result.routes.bazaar.net, 100);
  assert.equal(result.routes.itemMarket.net, 95);
});

test("capital constraints clamp direct-buy quantity", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 100,
    quantity: 1000,
    snapshot: snapshot([{ price: 100, quantity: 1000 }, { price: 101, quantity: 1000 }]),
    historyStats: history(),
    settings: settings({ maxCapitalOpportunity: 1000, maxCapitalItem: 1000, availableCapital: 1000 }),
  });
  assert.ok(result);
  assert.equal(result.quantityBought, 10);
  assert.equal(result.capitalRequired, 1000);
});

test("no history cannot become green at the default confidence threshold", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 80,
    quantity: 1,
    snapshot: snapshot([
      { price: 100, quantity: 100 },
      { price: 101, quantity: 100 },
      { price: 102, quantity: 100 },
      { price: 103, quantity: 100 },
      { price: 104, quantity: 100 },
    ]),
    historyStats: { historicalFairValue: null, oneDay: { count: 0, volatility: null } },
    settings: settings(),
  });
  assert.ok(result);
  assert.notEqual(result.classification.state, "GREEN");
});

test("volatile history downgrades an otherwise profitable opportunity", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 80,
    quantity: 1,
    snapshot: snapshot([
      { price: 100, quantity: 100 },
      { price: 101, quantity: 100 },
      { price: 102, quantity: 100 },
      { price: 103, quantity: 100 },
      { price: 104, quantity: 100 },
    ]),
    historyStats: history({ oneDay: { count: 20, volatility: 0.20, medianAnchor: 100 } }),
    settings: settings(),
  });
  assert.ok(result);
  assert.equal(result.classification.state, "YELLOW");
});

test("stale API data downgrades an otherwise profitable opportunity", () => {
  const stale = snapshot([
    { price: 100, quantity: 100 },
    { price: 101, quantity: 100 },
    { price: 102, quantity: 100 },
    { price: 103, quantity: 100 },
    { price: 104, quantity: 100 },
  ], { cacheTimestamp: Math.floor(Date.now() / 1000) - 600 });
  const result = ME.evaluateDirectBuy({
    buyPrice: 80,
    quantity: 1,
    snapshot: stale,
    historyStats: history(),
    settings: settings(),
  });
  assert.ok(result);
  assert.equal(result.classification.state, "YELLOW");
});

test("single listing does not invent market depth", () => {
  const result = ME.evaluatePrefixes(snapshot([{ price: 80, quantity: 1 }]), history(), settings());
  assert.equal(result.best, null);
});

test("unsupported equipment is not commodity-valued", () => {
  const result = ME.evaluateDirectBuy({
    buyPrice: 80,
    quantity: 1,
    snapshot: snapshot([{ price: 100, quantity: 1 }, { price: 101, quantity: 1 }], { supportedCommodity: false }),
    historyStats: history(),
    settings: settings(),
  });
  assert.equal(result, null);
});

test("hardening guards remain present in the assembled userscript", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "torn-market-edge.user.js"), "utf8");
  assert.match(source, /cancelQueued\(predicate/);
  assert.match(source, /queueGroup/);
  assert.match(source, /listRowIds = new WeakMap/);
  assert.match(source, /priceForSurfaceCard/);
  assert.match(source, /liveMatchesApi/);
  assert.doesNotMatch(source, /evaluatePrefixes\(analysisSnapshot/);
});
'''
write("tests/economics.test.js", tests)

# Document the hardening work as unreleased until manual Torn smoke testing passes.
p = "CHANGELOG.md"
s = read(p)
marker = "## [0.2.0] - 2026-09-07"
unreleased = '''## [Unreleased]\n\n### Fixed\n\n- Detect same-item SPA row remounts and re-annotate without requiring a refresh.\n- Cancel obsolete queued list-price requests before they consume the API budget.\n- Keep the official Torn Item Market API authoritative when visible page listings differ from the API cache.\n- Use safer surface-specific price extraction on other Bazaars and travel shops instead of falling back to arbitrary dollar values.\n- Protect newer row scans from cleanup performed by superseded async tasks.\n\n### Testing\n\n- Added executable economic regression coverage and hardening guard checks.\n\n'''
if marker not in s:
    raise RuntimeError("Could not find changelog insertion point")
s = s.replace(marker, unreleased + marker, 1)
write(p, s)

print("v0.2.1 hardening patch applied")
