    });
    return ids;
  }


  // ---------------------------------------------------------------------------
  // Layout reads: one bounding box per node per pass. Collectors used to call
  // getBoundingClientRect inside sort comparators (a forced reflow per
  // comparison on Torn's large DOM). Rects are cached for a short window and
  // priorities are computed once per row before sorting.
  // ---------------------------------------------------------------------------

  const LAYOUT_RECT_MAX_AGE_MS = 150;
  const layoutPass = { at: 0, rects: new WeakMap(), deferred: [], viewportHeight: 0 };

  function currentViewportHeight() {
    return Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0) || 800;
  }

  function refreshLayoutPass() {
    const now = Date.now();
    if (now - layoutPass.at > LAYOUT_RECT_MAX_AGE_MS) {
      layoutPass.at = now;
      layoutPass.rects = new WeakMap();
      layoutPass.viewportHeight = currentViewportHeight();
    }
  }

  // Called once per scan: clears the list of rows deferred to the
  // IntersectionObserver so the scan can hand it a fresh set.
  function beginLayoutPass() {
    layoutPass.at = 0;
    layoutPass.deferred = [];
    refreshLayoutPass();
  }

  function rectOf(node) {
    if (!node || typeof node.getBoundingClientRect !== "function") return null;
    refreshLayoutPass();
    const cached = layoutPass.rects.get(node);
    if (cached) return cached;
    const rect = node.getBoundingClientRect();
    layoutPass.rects.set(node, rect);
    return rect;
  }

  function hasBox(node) {
    const rect = rectOf(node);
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  }

  // "in": on screen; "near": within half a viewport of the fold; "far": left
  // for the IntersectionObserver.
  function viewportBand(rect) {
    if (!rect) return "in";
    const height = layoutPass.viewportHeight || currentViewportHeight();
    if (rect.bottom >= 0 && rect.top <= height) return "in";
    const margin = height * VIEWPORT_PREFETCH_FACTOR;
    if (rect.top > height && rect.top <= height + margin) return "near";
    if (rect.bottom < 0 && rect.bottom >= -margin) return "near";
    return "far";
  }

  function deferRow(node) {
    if (node && !layoutPass.deferred.includes(node)) layoutPass.deferred.push(node);
  }

  function deferredRows() {
    return layoutPass.deferred.slice();
  }

  // Rank candidate nodes by viewport position, computing each priority once.
  // Rows off screen (beyond the prefetch band) or beyond the limit are
  // deferred instead of scanned.
  function rankCandidates(nodes, limit, cardOf = (node) => node) {
    const scored = [];
    nodes.forEach((node) => {
      const card = cardOf(node);
      const rect = rectOf(card);
      // Nodes without a box (collapsed tabs, lazy placeholders) must never
      // outrank visible rows.
      if (rect && (rect.width <= 0 || rect.height <= 0)) return;
      if (viewportBand(rect) === "far") {
        deferRow(card);
        return;
      }
      scored.push({ node, priority: rect ? viewportPriority({ card }) : 0 });
    });
    scored.sort((a, b) => b.priority - a.priority);
    scored.slice(limit).forEach((entry) => deferRow(cardOf(entry.node)));
    return scored.slice(0, limit).map((entry) => entry.node);
  }

  function sortByViewport(items) {
    const scored = items.map((item, index) => ({ item, priority: viewportPriority(item, index) }));
    scored.sort((a, b) => b.priority - a.priority);
    return scored.map((entry) => entry.item);
  }

  function finishCollect(items, limit) {
    const sorted = sortByViewport(items);
    sorted.slice(limit).forEach((visible) => deferRow(visible.card));
    return sorted.slice(0, limit);
  }

  function findInventoryRow(start) {
    if (!start) return null;
    // Fast path: Torn's inventory rows are list items carrying data-item.
    // No text or layout reads beyond one bounding box.
    const direct = start.closest?.("li[data-item]:not([data-action])");
    if (direct && !direct.classList.contains("show-item-info") && directItemIdsWithin(direct).size === 1) {
      if (hasBox(direct)) return direct;
    }
    let node = start instanceof HTMLElement ? start : start.parentElement;
    let fallback = null;
    for (let depth = 0; node && depth < 9 && node !== document.body; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      // Layout-free pre-check: a row never has hundreds of characters.
      if ((node.textContent || "").length > 600) continue;
      const rect = rectOf(node);
      if (rect.width <= 0 || rect.height <= 0) continue;
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 180) continue;
      const ids = directItemIdsWithin(node);
      if (ids.size !== 1) continue;
      if (rect.height > 125) continue;
      fallback = node;
      if (node.matches("li,tr,[role='row'],[class*='row'],[class*='itemRow'],[class*='item-row']")) return node;
      if (/^(?:x|\u00d7)?\s*[\d,]*\s*[A-Za-z0-9]/i.test(text) && rect.width >= 180) return node;
    }
    return fallback || findCompactCard(start, false);
  }

  function findItemTextHost(card, name = "") {
    if (!card) return null;
    const normalizedName = String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
    const candidates = [];
    card.querySelectorAll("span,div,a,strong,p,td").forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      if (element.closest(".me-inline-analysis")) return;
      if (element.querySelector("img,[style*='/items/']")) return;
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 120) return;
      if (/^(?:RRP|Remove|Price per unit)\s*:/i.test(text)) return;
      const lower = text.toLowerCase();
      const nameMatch = normalizedName && (lower === normalizedName || lower.endsWith(` ${normalizedName}`) || lower.includes(normalizedName));
      const itemish = nameMatch || /^(?:x|\u00d7)?\s*[\d,]+\s+\S+/i.test(text);
      if (!itemish) return;
      const rect = rectOf(element);
      if (rect.width <= 0 || rect.height <= 0) return;
      candidates.push({ element, area: rect.width * rect.height, length: text.length });
    });
    candidates.sort((a, b) => a.area - b.area || a.length - b.length);
    return candidates[0]?.element || card;
  }

  function priceForSurfaceCard(surface, card, explicitElement = null) {
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
      // Text first: most elements carry no money figure and need no layout read.
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
      const rect = rectOf(element);
      if (rect.width <= 0 || rect.height <= 0) return;

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

  function collectVisibleItems({ requireMoney = false } = {}) {
    const candidates = new Set();
    const selector = itemIdentitySelector();

    const inventoryMarker = inventoryListMarker();

    // Prefer Torn's actual inventory-list containers when available. This
    // prevents equipped items from ever entering the candidate set.
    if (detectSurface() === "inventory") {
      // Torn keeps every visited category list in the DOM; only the expanded
      // one is on screen. Skipping hidden lists here saves a layout read per
      // row on long inventories.
      // Exact list classes only: Torn's page wrapper is "main-items-cont-wrap"
      // and a substring match would sweep in every tab's rows at once.
      const allRoots = Array.from(document.querySelectorAll(
        "ul.items-cont, .items-cont, [class*='inventoryList'], [class*='inventory-list']"
      )).filter((root) => !root.closest("#market-edge-root,.equipped-items-wrap,[class*='equipped-items'],[class*='equippedItems']"));
      // Prefer lists that are on screen (one rect per list); if that leaves
      // nothing, fall back to every list and let the per-row rect checks
      // decide.
      const shownRoots = allRoots.filter((root) => {
        if (/display\s*:\s*none/i.test(root.getAttribute("style") || "")) return false;
        return hasBox(root);
      });
      const roots = shownRoots.length ? shownRoots : allRoots;
      if (roots.length) {
        roots.forEach((root) => root.querySelectorAll(selector).forEach((node) => candidates.add(node)));
      } else {
        document.querySelectorAll(selector).forEach((node) => candidates.add(node));
      }
    } else {
      document.querySelectorAll(selector).forEach((node) => candidates.add(node));
    }

    const byId = new Map();
    const limit = clamp(settings.scanMaxVisibleItems, 1, 50);
    const surface = detectSurface();
    const ordered = rankCandidates(Array.from(candidates), limit * 2);
    for (const node of ordered) {
      const itemId = itemIdFromElement(node);
      if (!itemId) continue;
      const card = surface === "inventory" ? findInventoryRow(node) : findCompactCard(node, requireMoney);
      // A bare image (for example the large picture inside an expanded
      // details block) is not a row: it would hijack the item entry and
      // swallow the annotation.
      // A bare image is not a row; a row that is its own identity node
      // (li[data-item]) is fine.
      if (!card || card.tagName === "IMG" || (card === node && node.tagName === "IMG") || !(card.textContent || "").trim()) continue;
      if (!isInventoryListCandidate(card, inventoryMarker)) continue;
      if (card !== node && !hasBox(card)) continue;
      const inventoryRow = surface === "inventory";
      // innerText forces layout; inventory rows are read layout-free.
      const text = inventoryRow ? (card?.textContent || "") : (card?.innerText || "");
      const priceElement = card?.querySelector?.('[data-testid="price"]');
      const price = requireMoney ? priceForSurfaceCard(surface, card, priceElement) : null;
      if (requireMoney && !price) continue;
      // Torn's inventory rows carry the quantity as data-qty; the name comes
      // from the row's name node, then data-sort minus its sort prefix.
      const quantity = asInt(card?.dataset?.qty, 0) || parseQuantity(text);
      const nameNode = inventoryRow ? card?.querySelector?.(".name-wrap .name, .name") : null;
      const sortName = String(card?.dataset?.sort || "").replace(/^\d+\s+/, "").trim();
      const name = String(nameNode?.textContent || "").replace(/\s+/g, " ").replace(/^(?:x|\u00d7)\s*[\d,]+\s+/i, "").replace(/\s+(?:x|\u00d7)\s*[\d,]+$/i, "").trim() || sortName || elementItemName(card, node);
      const equipped = String(card?.dataset?.equipped || "") === "true";
      // Key by row element, not item id: equipment copies share an item id
      // but each occupies its own row and gets its own annotation. Several
      // identity nodes inside one row still collapse to a single entry.
      const existing = byId.get(card);
      const score = Math.min(text.length, 900);
      if (!existing || score < existing.domTextLength) {
        // Inventory rows get their own block line on the row itself.
        byId.set(card, {
          itemId,
          name,
          price,
          quantity,
          equipped,
          card,
          inlineAnchor: inventoryRow ? card : findItemTextHost(card, name),
          inlineMode: inventoryRow ? "row-line" : "inline",
          rowLine: inventoryRow,
          domTextLength: score
        });
      }
    }
    return finishCollect(Array.from(byId.values()), limit);
  }


  function findOwnBazaarCard(start) {
    // React manage view: div[data-testid="sortable-item"] / div[class*="row___"]
    // > div[class*="item___"] with the price in div[class*="price___"].
    const reactRow = start?.closest?.('[data-testid="sortable-item"], div[class*="row___"]');
    if (reactRow && reactRow.querySelector("input") && directItemIdsWithin(reactRow).size <= 1) return reactRow;
    let node = start;
    let fallback = null;
    for (let depth = 0; node && depth < 10 && node !== document.body; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (/price per unit\s*:/i.test(text) && node.querySelector("input")) {
        fallback = node;
        if (node.matches("li,[class*='item'],[class*='manage']") || /RRP\s*:/i.test(text)) return node;
      }
    }
    return fallback || findCompactCard(start, false);
  }

  function findOwnBazaarPriceContext(card) {
    if (!card) return { input: null, row: null, price: null };
    const inputs = Array.from(card.querySelectorAll("input"));
    let best = null;

    for (const input of inputs) {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""}`;
      let score = /price/i.test(metadata) && !/remove/i.test(metadata) ? 100 : 0;
      let row = null;
      let ancestor = input.parentElement;
      for (let depth = 0; ancestor && depth < 5 && ancestor !== card.parentElement; depth += 1, ancestor = ancestor.parentElement) {
        const text = (ancestor.innerText || "").replace(/\s+/g, " ").trim();
        if (/price per unit\s*:/i.test(text)) {
          score = Math.max(score, 90 - depth * 10);
          row = ancestor;
          break;
        }
      }
      if (!score) continue;
      const price = parseIntegerField(input.value);
      if (!price) continue;
      if (!best || score > best.score) best = { input, row: row || input.parentElement, price, score };
    }

    if (best) return best;

    // React manage rows: the price sits in div[class*="price___"] as an
    // input-money group (visible input plus a hidden twin).
    const reactPrice = card.querySelector("div[class*='price___'] .input-money-group input:not([type='hidden']), div[class*='price___'] input:not([type='hidden']), [class*='priceMobile___'] input:not([type='hidden'])");
    if (reactPrice instanceof HTMLInputElement) {
      const price = parseIntegerField(reactPrice.value);
      if (price) return { input: reactPrice, row: reactPrice.closest("div[class*='price___']") || reactPrice.parentElement, price, score: 80 };
    }

    // Fallback: locate the visible "Price per unit" label and then the nearest
    // input in the same small container. This avoids ever confusing Torn's RRP
    // value or the "Remove" quantity field with the actual Bazaar unit price.
    const textNodes = Array.from(card.querySelectorAll("label,span,div,p"));
    for (const label of textNodes) {
      const text = (label.textContent || "").replace(/\s+/g, " ").trim();
      if (!/^price per unit\s*:/i.test(text)) continue;
      let container = label.parentElement;
      for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
        const input = container.querySelector("input");
        const price = parseIntegerField(input?.value);
        if (price) return { input, row: container, price, score: 50 };
      }
    }
    return { input: null, row: null, price: null };
  }

  function bazaarAddRouteActive() {
    if (detectSurface() !== "bazaar") return false;
    const hash = String(location.hash || "").toLowerCase();
    return hash === "#/add" || hash.startsWith("#/add/") || hash.startsWith("#/add?") ||
      hash.includes("#/p=add") || hash.includes("/p=add");
  }

  let bazaarSectionCache = { at: 0, node: null, href: "" };

  function bazaarAddSection() {
    const now = Date.now();
    if (bazaarSectionCache.href === location.href && now - bazaarSectionCache.at < 250 && (bazaarSectionCache.node === null || bazaarSectionCache.node.isConnected)) {
      return bazaarSectionCache.node;
    }
    const node = bazaarAddSectionUncached();
    bazaarSectionCache = { at: now, node, href: location.href };
    return node;
  }

  function bazaarAddSectionUncached() {
    if (detectSurface() !== "bazaar") return null;

    // Torn's current Bazaar add page has a stable root/list shape even though
    // the CSS-module suffixes change between front-end builds. Prefer those
    // structural containers instead of relying on ancestor distance from the
    // visible heading; the latter is especially fragile on the mobile layout.
    const root = document.querySelector("#bazaarRoot, .bazaar-main-wrap");
    const directList = document.querySelector(
      "ul.items-cont, div[class*='itemsContainner___'], div[class*='rowItems___']"
    );
    if (bazaarAddRouteActive()) {
      if (root) return root;
      if (directList) return directList.closest("#bazaarRoot,.bazaar-main-wrap") || directList.parentElement || directList;
    }

    const candidates = [];
    document.querySelectorAll("h1,h2,h3,h4,h5,h6,div,span,strong").forEach((element) => {
      if (!(element instanceof HTMLElement) || element.closest("#market-edge-root,.me-inline-analysis")) return;
      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!/^Add items to your Bazaar$/i.test(ownText)) return;
      if (!hasBox(element)) return;
      candidates.push(element);
    });

    for (const heading of candidates) {
      const knownRoot = heading.closest("#bazaarRoot,.bazaar-main-wrap");
      if (knownRoot) return knownRoot;
      let node = heading;
      let fallback = heading.parentElement;
      for (let depth = 0; node && depth < 15 && node !== document.body; depth += 1, node = node.parentElement) {
        if (!(node instanceof HTMLElement)) continue;
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        if (text.length > 12000) continue;
        if (node.querySelector("input")) fallback = node;
        if (/You are adding\s+\d+\s+items?\s+across\s+\d+\s+categor/i.test(text) && /ADD TO BAZAAR/i.test(text) && node.querySelector("input")) {
          return node;
        }
      }
      if (fallback?.querySelector?.("input")) return fallback;
    }

    // Some PDA/mobile layouts do not preserve the heading text as a distinct
    // DOM node. A recognized item list is still sufficient to identify this
    // view because we later require each candidate row to contain an item image
    // and Bazaar amount/price controls.
    return directList?.closest?.("#bazaarRoot,.bazaar-main-wrap") || directList || null;
  }

  function knownBazaarAddRows(section) {
    if (!section?.querySelectorAll) return [];
    const selector = [
      "ul.items-cont li.clearfix:not(.disabled)",
      "div[class*='itemsContainner___'] div[class*='item___']",
      "div[class*='rowItems___'] div[class*='item___']"
    ].join(",");
    const candidates = Array.from(section.querySelectorAll(selector)).filter((row) => {
      if (!(row instanceof HTMLElement) || row.classList.contains("disabled")) return false;
      if (String(row.className || "").includes("item___UN3Mg")) return false;
      const rect = rectOf(row);
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (rect.height > 300) return false;
      const image = row.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']");
      if (!image) return false;
      const amount = row.querySelector("div[class*='amount___'], div.amount-main-wrap") || row;
      const input = Array.from(amount.querySelectorAll("input")).find((candidate) => candidate.type !== "hidden" && hasBox(candidate));
      return Boolean(input);
    });

    // CSS-module selectors can match both a wrapper and its nested item node.
    // Keep the smallest candidate that owns the controls so each item is only
    // analyzed once.
    return candidates.filter((row) => !candidates.some((other) => other !== row && row.contains(other)));
  }

  function findBazaarAddRow(start, section) {
    if (!start || !section) return null;
    const known = start.closest?.("ul.items-cont li.clearfix:not(.disabled), div[class*='itemsContainner___'] div[class*='item___'], div[class*='rowItems___'] div[class*='item___']");
    if (known && section.contains(known) && !String(known.className || "").includes("item___UN3Mg")) return known;

    let node = start instanceof HTMLElement ? start : start.parentElement;
    let fallback = null;
    for (let depth = 0; node && depth < 12 && node !== section.parentElement; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement) || !section.contains(node)) continue;
      const rect = rectOf(node);
      if (rect.width <= 0 || rect.height <= 0 || rect.height > 280) continue;
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 500) continue;
      const ids = directItemIdsWithin(node);
      const hasItemImage = Boolean(node.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']"));
      if (ids.size !== 1 && !hasItemImage) continue;
      const visibleInputs = Array.from(node.querySelectorAll("input")).filter((input) => input.type !== "hidden" && hasBox(input));
      if (!visibleInputs.length) continue;
      fallback = node;
      if (/^(?:x|\u00d7)\s*[\d,]+\s+\S+/i.test(text) || /\bQty\b/i.test(text)) return node;
      if (node.matches("li.clearfix,li,tr,[role='row'],[class*='row'],[class*='item___'],[class*='item']")) return node;
    }
    return fallback;
  }

  function bazaarAddInputs(card) {
    const amount = card?.querySelector?.("div[class*='amount___'], div.amount-main-wrap") || card;
    if (!amount) return [];
    return Array.from(amount.querySelectorAll("input")).filter((input) => !["hidden", "checkbox", "radio"].includes(input.type) && hasBox(input));
  }

  function findBazaarAddPriceInput(card) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const priceWrap = amount.querySelector("div[class*='price___'], div.price");
    const explicit = priceWrap?.querySelector("input.input-money, input") || amount.querySelector("input[name*='price' i]");
    if (explicit && explicit.type !== "hidden" && hasBox(explicit)) return explicit;

    const candidates = bazaarAddInputs(card);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const scored = candidates.map((input) => {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.className || ""}`;
      let score = 0;
      if (/price|cost|unit|money/i.test(metadata)) score += 160;
      if (/qty|quantity|amount|count|clear-all/i.test(metadata)) score -= 220;
      return { input, score, left: rectOf(input).left };
    });
    scored.sort((a, b) => b.score - a.score || b.left - a.left);
    return scored[0]?.input || null;
  }

  function findBazaarAddQuantityCheckbox(card) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const control = amount.querySelector("div.choice-container, [class*='choiceContainer___']");
    let checkbox = control?.querySelector?.("input[type='checkbox'], input");
    let box = control;
    if (!(checkbox instanceof HTMLInputElement)) {
      // Item Market sell form: single-copy rows use a select checkbox with a
      // stable id prefix. Only that id is trusted, because the anonymous
      // listing toggle is also a checkbox and must never be touched.
      checkbox = card.querySelector("input[type='checkbox'][id*='selectCheckbox' i]");
      box = checkbox?.closest("[class*='checkboxContainer___'], [class*='checkboxWrapper___']") || checkbox?.parentElement || null;
    }
    if (!(checkbox instanceof HTMLInputElement) || !box) return null;
    return hasBox(box) ? checkbox : null;
  }

  function findBazaarAddQuantityInput(card, priceInput = null) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const explicitCandidates = Array.from(amount.querySelectorAll(
      "input.clear-all, input[placeholder*='qty' i], input[aria-label*='qty' i], input[name*='qty' i], input[name*='quantity' i], input[class*='quantity']"
    ));
    for (const explicit of explicitCandidates) {
      if (explicit === priceInput) continue;
      if (explicit.type !== "hidden" && hasBox(explicit)) return explicit;
    }

    const candidates = bazaarAddInputs(card).filter((input) => input !== priceInput);
    if (!candidates.length) return null;
    const scored = candidates.map((input) => {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.className || ""}`;
      let score = 0;
      if (/qty|quantity|amount|count|clear-all/i.test(metadata)) score += 220;
      if (/price|cost|unit|money/i.test(metadata)) score -= 180;
      return { input, score, left: rectOf(input).left };
    });
    scored.sort((a, b) => b.score - a.score || a.left - b.left);
    return scored[0]?.input || null;
  }

  function collectBazaarAddItems() {
    const section = bazaarAddSection();
    if (!section) return bazaarAddRouteActive() ? collectSellFormRows() : [];

    const byCard = new Map();
    const directRows = knownBazaarAddRows(section);
    const candidatePairs = [];

    if (directRows.length) {
      directRows.forEach((card) => {
        const image = card.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']");
        candidatePairs.push({ card, node: image || card });
      });
    } else {
      section.querySelectorAll(itemIdentitySelector()).forEach((node) => {
        if (node.closest("#market-edge-root,.me-inline-analysis")) return;
        const card = findBazaarAddRow(node, section);
        if (card) candidatePairs.push({ card, node });
      });
    }

    // Only the rows nearest the viewport get the expensive text/input
    // inspection; long categories would otherwise thrash layout. Rows that
    // carry Torn's "Price per unit" label are existing listings (manage
    // view), never add rows.
    const limit = clamp(settings.scanMaxVisibleItems, 1, 50);
    const nearest = rankCandidates(
      candidatePairs.filter(({ card }) => !/price per unit\s*:/i.test(card.textContent || "")),
      limit * 2,
      (pair) => pair.card
    );

    for (const { card, node } of nearest) {
      if (!card || card.closest("#market-edge-root")) continue;
      const itemId = itemIdFromElement(node) || itemIdFromElement(card);
      if (!itemId) continue;
      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) continue;
      const quantityCheckbox = findBazaarAddQuantityCheckbox(card);
      const quantityInput = quantityCheckbox ? null : findBazaarAddQuantityInput(card, priceInput);
      const title = card.querySelector("div[class*='name___'], div.title-wrap");
      const controlHost = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
      const text = `${title?.innerText || ""} ${card.innerText || ""}`.trim();
      const quantity = parseQuantity(text);
      const maxFromInput = parseIntegerField(quantityInput?.getAttribute("max"));
      const maxAvailable = Math.max(1, Math.min(quantity, maxFromInput || quantity));
      const name = elementItemName(card, node);
      const score = Math.min(text.length, 1200);
      const existing = byCard.get(card);
      if (!existing || score < existing.domTextLength) {
        byCard.set(card, {
          itemId,
          name,
          price: parseIntegerField(priceInput.value) || 0,
          quantity,
          maxAvailable,
          card,
          priceInput,
          quantityInput,
          quantityCheckbox,
          bazaarAdd: true,
          bazaarControls: controlHost,
          inlineAnchor: card,
          inlineMode: "row-line",
          rowLine: true,
          domTextLength: score
        });
      }
    }

    if (!byCard.size && bazaarAddRouteActive()) return collectSellFormRows();
    return finishCollect(Array.from(byCard.values()), limit);
  }

  // Generic sell-form rows: any small container holding one item image and a
  // visible price/quantity field. Serves the Item Market "add listing" view
  // and is the fallback for the Bazaar add form when Torn's class names
  // change. Rows are shaped like Bazaar add rows so the same renderer and
  // fill controls apply.
  function collectSellFormRows({ root = document, limit = clamp(settings.scanMaxVisibleItems, 1, 50) } = {}) {
    const byCard = new Map();
    const images = Array.from(root.querySelectorAll("img[src*='/items/'], img[srcset*='/items/'], [style*='/items/']"))
      .filter((node) => !node.closest("#market-edge-root,.me-inline-analysis"));
    const nearest = rankCandidates(images, limit * 2);
    for (const node of nearest) {
      const itemId = itemIdFromElement(node);
      if (!itemId) continue;
      let card = null;
      let probe = node.parentElement;
      for (let depth = 0; probe && depth < 9 && probe !== document.body; depth += 1, probe = probe.parentElement) {
        if (!(probe instanceof HTMLElement)) continue;
        const textLength = (probe.textContent || "").length;
        if (textLength > 700) break;
        const ids = directItemIdsWithin(probe);
        if (ids.size > 1) break;
        const input = Array.from(probe.querySelectorAll("input")).find((candidate) => {
          if (["hidden", "checkbox", "radio", "search", "submit", "button"].includes(candidate.type)) return false;
          if (/search|filter/i.test(`${candidate.name || ""} ${candidate.placeholder || ""} ${candidate.className || ""}`)) return false;
          return hasBox(candidate);
        });
        if (!input) continue;
        if (/price per unit\s*:/i.test(probe.textContent || "")) break;
        card = probe;
        break;
      }
      if (!card || byCard.has(card)) continue;
      // Item Market rows that cannot be listed are greyed out.
      if (/grayedOut|greyedOut|disabled___/i.test(`${card.className || ""} ${card.parentElement?.className || ""}`) || card.classList.contains("disabled")) continue;
      if (!hasBox(card)) continue;
      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) continue;
      const quantityCheckbox = findBazaarAddQuantityCheckbox(card);
      const quantityInput = quantityCheckbox ? null : findBazaarAddQuantityInput(card, priceInput);
      // Text nodes joined with spaces: adjacent inline spans ("Xanax" + "x12")
      // must not merge into one token.
      const text = spacedText(card);
      // Torn's quantity input carries the owned amount in data-money.
      const ownedFromInput = parseIntegerField(quantityInput?.getAttribute("data-money"));
      const quantity = ownedFromInput || parseQuantity(text);
      const maxFromInput = parseIntegerField(quantityInput?.getAttribute("max"));
      // Host for the overlay: the row's controls/info container, never the
      // money-input group itself (a flex group that would squeeze or clip it).
      const controlHost = sellFormControlHost(card, priceInput);
      byCard.set(card, {
        itemId,
        name: elementItemName(card, node),
        price: parseIntegerField(priceInput.value) || 0,
        quantity,
        maxAvailable: Math.max(1, Math.min(quantity, maxFromInput || quantity)),
        card,
        priceInput,
        quantityInput,
        quantityCheckbox,
        bazaarAdd: true,
        sellForm: true,
        // On #/viewListing the fields belong to an existing listing: fill
        // the price only, never the quantity.
        priceOnly: /viewlisting|view-listing/i.test(String(location.hash || "")),
        bazaarControls: controlHost,
        // Full-width strip under the whole row, not inside the controls.
        inlineAnchor: card,
        inlineMode: "row-line",
        rowLine: true,
        domTextLength: Math.min(text.length, 1200)
      });
    }
    return finishCollect(Array.from(byCard.values()), limit);
  }

  function sellFormControlHost(card, priceInput) {
    if (!card) return null;
    let node = priceInput?.parentElement || null;
    for (let depth = 0; node && node !== card && depth < 6; depth += 1, node = node.parentElement) {
      const className = String(node.className || "");
      if (/(^|\s)(info___|amount___|controls___|controls|amount-main-wrap|fields___|actions___)/.test(className) || /info___|amount___|controls___|amount-main-wrap/.test(className)) return node;
    }
    // No named container: use the price input's grandparent when it is not
    // the money group, else the card.
    const group = priceInput?.closest(".input-money-group");
    const above = group?.parentElement && group.parentElement !== card ? group.parentElement.parentElement || card : null;
    return above && card.contains(above) ? above : card;
  }

  function spacedText(element) {
    if (!element) return "";
    const parts = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (!node.parentElement?.closest?.(".me-inline-analysis")) {
        const value = String(node.textContent || "").trim();
        if (value) parts.push(value);
      }
      node = walker.nextNode();
    }
    return parts.join(" ");
  }

  function collectManagedBazaarItems() {
    // Managed listings never appear on the add route, and add rows are
    // recognisable by their amount/price control wrapper. Both guards stop a
    // filled add row from being mistaken for an existing listing.
    if (bazaarAddRouteActive()) return [];
    const candidates = new Set();
    const selector = itemIdentitySelector();
    document.querySelectorAll(selector).forEach((node) => {
      if (!node.closest("#market-edge-root") && !node.closest(".me-inline-analysis")) candidates.add(node);
    });

    const byId = new Map();
    for (const node of candidates) {
      const itemId = itemIdFromElement(node);
      if (!itemId) continue;
      const card = findOwnBazaarCard(node);
      if (!card || card.closest("#market-edge-root")) continue;
      if (card.querySelector("div.amount-main-wrap, div[class*='amount___']") || card.closest("ul.items-cont li.clearfix")?.querySelector("div.amount-main-wrap, div[class*='amount___']")) continue;
      if (!hasBox(card)) continue;
      const priceContext = findOwnBazaarPriceContext(card);
      if (!priceContext.price) continue;
      const text = card.innerText || "";
      const quantity = parseQuantity(text);
      const name = elementItemName(card, node);
      const current = byId.get(itemId);
      const score = Math.min(text.length, 2000);
      if (!current || score < current.domTextLength) {
        byId.set(itemId, {
          itemId,
          name,
          price: priceContext.price,
          quantity,
          card,
          priceInput: priceContext.input,
          inlineAnchor: findItemTextHost(card, name),
          inlineMode: "inline",
          domTextLength: score
        });
      }
    }
    return finishCollect(Array.from(byId.values()), clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  const BAZAAR_ADD_ROW_SELECTOR = "ul.items-cont li.clearfix, div[class*='itemsContainner___'] div[class*='item___'], div[class*='rowItems___'] div[class*='item___']";

  function collectOwnBazaarItems() {
    // Add-form rows take precedence: once a price has been filled into an
    // add row, the managed-listing heuristics would otherwise mistake it for
    // an existing Bazaar listing.
    const addItems = collectBazaarAddItems();
    const addCards = addItems.map((item) => item.card);
    const managed = collectManagedBazaarItems().filter((item) => (
      !addCards.some((card) => card === item.card || card.contains(item.card) || item.card.contains(card))
    ));
    const combined = [...addItems, ...managed];
    const seenCards = new Set();
    return finishCollect(combined.filter((visible) => {
      if (!visible?.card || seenCards.has(visible.card)) return false;
      seenCards.add(visible.card);
      return true;
    }), clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  // ---------------------------------------------------------------------------
  // Abroad shop (page.php?sid=travel while in a foreign country). Torn renders
  // each shop as [class*='stockTableWrapper___'] > li, each li holding one
  // div[class*='row___'] CSS grid (image, name, type, cost, stock, amount,
  // buy). The strip must be a sibling of that grid, never a child: a child
  // becomes a grid cell and lands in the image column.
  // ---------------------------------------------------------------------------

  const ABROAD_TABLE_SELECTOR = "[class*='stockTableWrapper___']";

  function abroadInfoMessage() {
    return (document.querySelector(".info-msg-cont .msg, .info-msg .msg, [class*='infoMsg']")?.textContent || "").replace(/\s+/g, " ");
  }

  // The abroad page is recognised by Torn's body flag, by its stock tables
  // or by the "purchased X / Y items" message, so a renamed CSS module does
  // not silently hand the rows back to the generic path.
  function abroadPagePresent() {
    if (detectSurface() !== "travel") return false;
    if (String(document.body?.dataset?.abroad || "") === "true") return true;
    if (document.querySelector(ABROAD_TABLE_SELECTOR)) return true;
    return /purchased\s+[\d,]+\s*\/\s*[\d,]+\s+items?/i.test(abroadInfoMessage());
  }

  function abroadShopRoot() {
    if (!abroadPagePresent()) return null;
    const travelRoot = document.querySelector("#travel-root");
    if (travelRoot) return travelRoot;
    const table = document.querySelector(ABROAD_TABLE_SELECTOR);
    if (table) return table.parentElement || table;
    return document.querySelector(".content-wrapper, #mainContainer") || document.body;
  }

  function abroadCountryName() {
    const slug = String(document.body?.dataset?.country || "").toLowerCase();
    if (COUNTRY_SLUGS[slug]) return COUNTRY_SLUGS[slug];
    const heading = Array.from(document.querySelectorAll("h4, h3, h2, [class*='title'], [class*='heading'], strong")).map((node) => (node.textContent || "").trim()).find((text) => FOREIGN_FLIGHT_MINUTES[text]);
    if (heading) return heading;
    const message = (document.querySelector(".info-msg-cont .msg, .info-msg .msg, [class*='infoMsg']")?.textContent || "");
    return Object.keys(FOREIGN_FLIGHT_MINUTES).find((name) => message.includes(name)) || "";
  }

  // "You are in United Kingdom and have $2,887,289. You have purchased 0 / 28
  // items so far." gives cash, items bought and the trip capacity.
  function abroadContext() {
    const message = abroadInfoMessage();
    const capacityMatch = message.match(/purchased\s+([\d,]+)\s*\/\s*([\d,]+)/i);
    const moneyMatch = message.match(/have\s+\$([\d,]+)/i);
    const bought = capacityMatch ? asInt(capacityMatch[1].replace(/,/g, ""), 0) : 0;
    const capacity = capacityMatch ? asInt(capacityMatch[2].replace(/,/g, ""), 0) : Math.max(0, asInt(settings.travelCapacity, 0));
    const money = moneyMatch ? asInt(moneyMatch[1].replace(/,/g, ""), 0) : null;
    const country = abroadCountryName();
    return {
      country,
      capacity,
      bought,
      capacityLeft: Math.max(0, capacity - bought),
      capacityFromPage: Boolean(capacityMatch),
      money,
      travelType: TRAVEL_TYPE_FACTORS[settings.travelType] ? settings.travelType : "standard",
      oneWayMinutes: flightMinutes(country, settings.travelType)
    };
  }

  function abroadCellText(row, kind) {
    const cells = Array.from(row.children || []);
    for (const cell of cells) {
      const text = (cell.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (kind === "cost" && (text.startsWith("cost") || text.startsWith("$"))) return cell.textContent || "";
      if (kind === "stock" && text.startsWith("stock")) return cell.textContent || "";
    }
    // Desktop: no inline labels; fall back to the header order.
    const header = row.closest("[class*='stockTableWrapper___']")?.querySelector("[class*='itemsHeader___']");
    if (header) {
      const names = Array.from(header.children).map((node) => (node.textContent || "").trim().toLowerCase());
      const index = names.indexOf(kind);
      if (index >= 0 && cells[index]) return cells[index].textContent || "";
    }
    return "";
  }

  function abroadRowGrid(li) {
    return li.querySelector("div[class*='row___']")
      || Array.from(li.children).find((child) => child.querySelector?.("img[src*='/items/'], img[srcset*='/items/']"))
      || li;
  }

  function collectAbroadShopRows() {
    const root = abroadShopRoot();
    if (!root) return [];
    const limit = clamp(settings.scanMaxVisibleItems, 1, 50);
    let rows = Array.from(root.querySelectorAll(`${ABROAD_TABLE_SELECTOR} > li`)).filter((li) => li.querySelector("div[class*='row___']"));
    if (!rows.length) {
      // Unknown class names: any list row with an item image and a quantity
      // field is a shop row.
      rows = Array.from(root.querySelectorAll("li")).filter((li) => (
        !li.closest("#market-edge-root") &&
        li.querySelector("input[placeholder*='qty' i], input[name*='amount' i], input[name*='qty' i]") &&
        li.querySelector("img[src*='/items/'], img[srcset*='/items/']") &&
        !li.querySelector("li")
      ));
    }
    const ranked = rankCandidates(rows, limit * 2);
    const items = [];
    for (const li of ranked) {
      const grid = abroadRowGrid(li);
      const image = grid?.querySelector("[class*='imageCell___'] img, img[src*='/items/'], img[srcset*='/items/']");
      const itemId = itemIdFromElement(image || li);
      if (!itemId) continue;
      const priceNode = grid.querySelector("[class*='displayPrice__'], [class*='neededSpace___']");
      const price = parseMoney(priceNode?.textContent || abroadCellText(grid, "cost") || spacedText(grid));
      if (!price) continue;
      const stockText = String(abroadCellText(grid, "stock")).replace(/[^\d]/g, "");
      // Unknown stock (renamed cells) is treated as unlimited, never as zero.
      const stock = stockText ? asInt(stockText, 0) : null;
      const name = (grid.querySelector("[class*='itemName___']")?.textContent || image?.getAttribute("alt") || "").replace(/\s+/g, " ").trim() || elementItemName(li, image || li);
      items.push({
        itemId,
        name,
        price,
        quantity: 1,
        stock,
        card: li,
        abroad: true,
        inlineAnchor: li,
        inlineMode: "row-line",
        rowLine: true,
        domTextLength: Math.min((li.textContent || "").length, 600)
      });
    }
    return finishCollect(items, limit);
  }

  function collectAuctionItems() {
    const rows = [];
    document.querySelectorAll("div.items-list-wrap > ul.items-list > li").forEach((li) => {
      if (!(li instanceof HTMLElement) || li.classList.contains("clear") || li.classList.contains("last")) return;
      const hover = li.querySelector("span.item-hover[item]");
      const itemId = asInt(hover?.getAttribute("item"), 0);
      if (!itemId) return;
      const name = (li.querySelector("span.title .item-name")?.textContent || hover?.querySelector("button.view-info")?.getAttribute("aria-label") || `Item ${itemId}`).trim();
      const bidText = (li.querySelector("div.c-bid-wrap")?.textContent || li.querySelector("div.mob-wrap .top-bid-mob-wrap")?.textContent || "").trim();
      const price = /^none$|bid:\s*none/i.test(bidText) ? 0 : asInt(String(bidText).replace(/[^0-9]/g, ""), 0);
      const text = li.innerText || "";
      rows.push({ itemId, name, price, quantity: 1, card: li, domTextLength: text.length });
    });
    return finishCollect(rows, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  // Editable price field in a row on Torn's "manage listings" style views
  // (own Item Market listings). Prefers price-labelled inputs and rejects
  // quantity/remove fields; a numeric value is required.
  function findGenericPriceInput(card) {
    if (!card) return null;
    let best = null;
    card.querySelectorAll("input").forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      if (input.closest("#market-edge-root,.me-inline-analysis")) return;
      if (/^(checkbox|radio|hidden|submit|button)$/i.test(input.type || "")) return;
      const metadata = `${input.name || ""} ${input.id || ""} ${input.className || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""}`;
      if (/amount|qty|quantity|remove|search/i.test(metadata)) return;
      let score = /price|cost|money/i.test(metadata) ? 100 : 0;
      const value = parseIntegerField(input.value);
      if (value > 0) score += 20;
      if (!score) return;
      if (!best || score > best.score) best = { input, score, value };
    });
    return best?.input || null;
  }

  // Rows of the player's own Item Market listings as Torn renders them, each
  // with its price input when one exists. Used by the repricing workbench to
  // fill (never submit) Torn's fields.
  function collectOwnListingRows() {
    const rows = [];
    const seen = new Set();
    document.querySelectorAll(itemIdentitySelector()).forEach((node) => {
      if (node.closest("#market-edge-root,.me-inline-analysis")) return;
      const itemId = itemIdFromElement(node);
      if (!itemId) return;
      let card = node.closest("li,tr,[role='row'],[class*='itemRow'],[class*='row'],[class*='item___'],[class*='listing']") || findCompactCard(node, false);
      for (let depth = 0; card && depth < 4 && !card.querySelector("input"); depth += 1) card = card.parentElement;
      if (!card || seen.has(card) || card === document.body) return;
      const priceInput = findGenericPriceInput(card);
      if (!priceInput) return;
      seen.add(card);
      rows.push({ itemId, card, priceInput, price: parseIntegerField(priceInput.value) || 0 });
    });
    return rows;
  }

  function parseLiveItemMarketListings() {
    const rawRows = [];
    const selectors = [
      "ul[class^='sellerList___'] > li",
      "ul[class*=' sellerList___'] > li",
      "[class^='sellerList___'] > li",
      "[class*=' sellerList___'] > li",
      "[class*='listing']",
      "[class*='seller']",
      "[class*='market'] li",
      "[class*='market'] [class*='row']"
    ];
    const seen = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        if (seen.has(node)) return;
        seen.add(node);
        const text = (node.innerText || "").trim();
        if (text.length < 3 || text.length > 500) return;
        const price = parseMoney(text);
        if (!price) return;
        const quantity = parseQuantity(text);
        rawRows.push({ price, quantity, node });
      });
    }
    rawRows.sort((a, b) => a.price - b.price);

    // Deduplicate nested DOM nodes representing the same rendered listing.
    const rows = [];
    for (const row of rawRows) {
      if (rows.some((existing) => existing.price === row.price && (existing.node.contains(row.node) || row.node.contains(existing.node)))) continue;
      rows.push(row);
    }
    return rows.slice(0, 100);
  }

  function currentBazaarOwnerId() {
    // Torn uses both query-string and hash-based Bazaar routes. A shared Bazaar
    // contains an explicit userId/userID; the plain bazaar.php#/ route opens
    // the current player's own Bazaar.
    const match = location.href.match(/[?&#](?:userId|userID)=(\d+)/i);
    return match ? asInt(match[1], 0) || null : null;
  }

  async function isOwnBazaar() {
    const ownerId = currentBazaarOwnerId();
    if (!ownerId) return true;

    let playerId = asInt(Store.get(STORAGE_KEYS.playerId, 0), 0);
    if (!playerId && Store.apiKey()) {
      try {
        const tested = await api.testKey();
        playerId = tested.playerId || 0;
      } catch {
        // Pricing analysis can continue without identity detection.
      }
    }
    return Boolean(playerId && ownerId === playerId);
  }

  // ---------------------------------------------------------------------------
  // UI rendering
  // ---------------------------------------------------------------------------

  const ui = {
    root: null,
    body: null,
    title: null,
    status: null,
    currentSurface: null,
    renderedBadges: new Set(),
    pinned: false,
    currentPanel: null
  };

  // ---------------------------------------------------------------------------
  // One visual system. Colours come from tokens that follow Torn's own theme
  // (body.dark-mode), so strips sit naturally on light and dark rows. Type
  // scale: 12 px base, 11 px meta, tabular figures. Every control has at
  // least a 32 px hit area, 40 px on touch screens.
  // ---------------------------------------------------------------------------

  const CSS = `
    body { --me-bg:#ffffff; --me-bg-2:#f3f3f4; --me-fg:#1f1f21; --me-muted:#5b5f66; --me-faint:#8a8f97; --me-border:rgba(0,0,0,.14); --me-strip:rgba(0,0,0,.045); --me-strip-border:rgba(0,0,0,.10); --me-good:#1d7a3b; --me-warn:#8a5a00; --me-bad:#a83a3a; --me-good-bg:rgba(29,122,59,.10); --me-warn-bg:rgba(184,124,0,.12); --me-bad-bg:rgba(168,58,58,.10); --me-btn:rgba(0,0,0,.06); --me-btn-hover:rgba(0,0,0,.12); --me-btn-border:rgba(0,0,0,.18); --me-shadow:0 8px 28px rgba(0,0,0,.18); --me-fs:12px; --me-fs-meta:11px; --me-fs-small:10px; --me-tap:32px; }
    body.dark-mode { --me-bg:#242426; --me-bg-2:#1c1c1e; --me-fg:#e9e9e9; --me-muted:#b3b3b3; --me-faint:#8a8a8a; --me-border:rgba(255,255,255,.14); --me-strip:rgba(0,0,0,.28); --me-strip-border:rgba(255,255,255,.08); --me-good:#7fd193; --me-warn:#f0ca66; --me-bad:#e27a7a; --me-good-bg:rgba(74,165,100,.18); --me-warn-bg:rgba(211,170,66,.16); --me-bad-bg:rgba(189,81,81,.16); --me-btn:rgba(255,255,255,.10); --me-btn-hover:rgba(255,255,255,.18); --me-btn-border:rgba(255,255,255,.22); --me-shadow:0 8px 28px rgba(0,0,0,.45); }
    @media (pointer: coarse) { body { --me-tap:40px; } }

    #market-edge-root { position:fixed; right:12px; bottom:12px; z-index:999998; width:min(390px, calc(100vw - 24px)); font-family:Arial, sans-serif; font-size:var(--me-fs); color:var(--me-fg); }
    #market-edge-root * { box-sizing:border-box; }
    .me-shell { background:var(--me-bg); border:1px solid var(--me-border); border-radius:8px; box-shadow:var(--me-shadow); overflow:hidden; }
    .me-header { display:flex; align-items:center; gap:6px; min-height:40px; padding:5px 8px; background:var(--me-bg-2); border-bottom:1px solid var(--me-border); }
    .me-title { font-size:var(--me-fs); font-weight:700; letter-spacing:.05em; text-transform:uppercase; flex:1; }
    .me-status { font-size:var(--me-fs-small); color:var(--me-muted); white-space:nowrap; }
    .me-btn, .me-icon-btn { display:inline-flex; align-items:center; justify-content:center; min-height:var(--me-tap); border:1px solid var(--me-btn-border); background:var(--me-btn); color:var(--me-fg); border-radius:6px; cursor:pointer; font:600 var(--me-fs)/1.2 Arial, sans-serif; padding:4px 10px; touch-action:manipulation; }
    .me-icon-btn { min-width:var(--me-tap); padding:4px 0; }
    .me-btn:hover, .me-icon-btn:hover, .me-btn:focus-visible, .me-icon-btn:focus-visible { background:var(--me-btn-hover); outline:none; }
    .me-body { display:flex; flex-direction:column; padding:10px; max-height:min(72vh, 620px); overflow:auto; }
    .me-body[hidden] { display:none; }
    .me-body > .me-actions.me-panel-toolbar { order:-1; margin:0 0 8px; padding-bottom:8px; border-bottom:1px solid var(--me-border); }
    .me-kicker { color:var(--me-muted); text-transform:uppercase; letter-spacing:.08em; font-size:var(--me-fs-small); margin-bottom:3px; }
    .me-item-name { font-size:16px; font-weight:700; margin-bottom:9px; }
    .me-grid { display:grid; grid-template-columns:1fr auto; gap:4px 12px; font-size:var(--me-fs-meta); }
    .me-grid .label { color:var(--me-muted); }
    .me-grid .value { font-variant-numeric:tabular-nums; text-align:right; }
    .me-rule { height:1px; background:var(--me-border); margin:9px 0; }
    .me-callout { border-left:3px solid var(--me-faint); background:var(--me-strip); padding:8px; border-radius:4px; }
    .me-callout.GREEN { border-color:var(--me-good); }
    .me-callout.YELLOW { border-color:var(--me-warn); }
    .me-callout.GREY { border-color:var(--me-faint); }
    .me-callout.RED { border-color:var(--me-bad); }
    .me-decision { display:flex; align-items:center; gap:6px; font-weight:700; font-size:var(--me-fs); }
    .me-decision.GREEN, .me-good { color:var(--me-good); }
    .me-decision.YELLOW, .me-warn, .me-learning { color:var(--me-warn); }
    .me-decision.GREY { color:var(--me-muted); }
    .me-decision.RED, .me-bad { color:var(--me-bad); }
    .me-note { font-size:var(--me-fs-small); color:var(--me-muted); line-height:1.4; margin-top:6px; }
    .me-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
    .me-progress { height:4px; background:var(--me-border); border-radius:3px; overflow:hidden; margin:8px 0; }
    .me-progress > div { height:100%; background:var(--me-muted); transition:width .15s linear; }
    .me-result { padding:7px 0; border-top:1px solid var(--me-border); font-size:var(--me-fs-meta); }
    .me-result:first-child { border-top:0; }
    .me-result-head { display:flex; align-items:center; gap:6px; }
    .me-result-name { font-weight:700; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .me-result-metrics { display:flex; gap:8px; margin-top:3px; color:var(--me-muted); font-variant-numeric:tabular-nums; }
    .me-diag { margin:8px 0 0; padding:7px; background:var(--me-strip); border-radius:4px; }
    .me-diag summary { cursor:pointer; min-height:var(--me-tap); display:flex; align-items:center; }
    .me-diag-row { font-size:var(--me-fs-small); line-height:1.5; }
    .me-diag-row.pass { color:var(--me-good); }
    .me-diag-row.fail { color:var(--me-bad); }

    .me-badge { display:inline-flex !important; align-items:center; gap:3px; padding:2px 6px !important; margin-left:5px !important; border-radius:4px !important; font:700 var(--me-fs-small)/1.25 Arial, sans-serif !important; white-space:nowrap !important; vertical-align:middle !important; pointer-events:none !important; border:1px solid var(--me-border) !important; color:var(--me-muted) !important; background:var(--me-strip) !important; }
    .me-badge.GREEN { background:var(--me-good-bg) !important; color:var(--me-good) !important; }
    .me-badge.YELLOW { background:var(--me-warn-bg) !important; color:var(--me-warn) !important; }
    .me-badge.RED { background:var(--me-bad-bg) !important; color:var(--me-bad) !important; }

    .me-inline-analysis { position:static !important; display:inline-flex !important; align-items:center !important; flex-wrap:wrap !important; gap:4px 6px !important; width:auto !important; max-width:100% !important; min-width:0 !important; margin:0 0 0 8px !important; padding:2px 6px !important; border:1px solid var(--me-strip-border) !important; border-radius:4px !important; background:var(--me-strip) !important; color:var(--me-fg) !important; font:600 var(--me-fs-meta)/1.3 Arial, sans-serif !important; font-variant-numeric:tabular-nums !important; box-sizing:border-box !important; vertical-align:middle !important; white-space:nowrap !important; pointer-events:none !important; text-align:left !important; }
    .me-inline-analysis.GREEN { border-color:var(--me-good) !important; }
    .me-inline-analysis.YELLOW { border-color:var(--me-warn) !important; }
    .me-inline-analysis.RED { border-color:var(--me-bad) !important; }
    .me-inline-brand { font-weight:800 !important; color:var(--me-faint) !important; letter-spacing:.06em !important; font-size:var(--me-fs-small) !important; }
    .me-inline-primary { color:var(--me-fg) !important; font-weight:700 !important; }
    .me-inline-secondary { color:var(--me-muted) !important; font-weight:500 !important; }
    .me-inline-sep { color:var(--me-faint) !important; font-weight:400 !important; }
    .me-inline-stale { color:var(--me-warn) !important; font-weight:700 !important; }
    .me-inline-status { font-weight:800 !important; white-space:nowrap !important; color:var(--me-muted) !important; }
    .me-inline-analysis.GREEN .me-inline-status { color:var(--me-good) !important; }
    .me-inline-analysis.YELLOW .me-inline-status { color:var(--me-warn) !important; }
    .me-inline-analysis.RED .me-inline-status { color:var(--me-bad) !important; }
    .me-inline-warning { color:var(--me-warn) !important; font-weight:700 !important; }
    .me-inline-metric { white-space:nowrap !important; font-variant-numeric:tabular-nums !important; }
    .me-inline-analysis.me-loading { opacity:.65 !important; font-weight:400 !important; }
    .me-inline-analysis.me-hidden, div.me-inline-analysis.me-row-line.me-hidden { display:none !important; visibility:hidden !important; height:0 !important; min-height:0 !important; padding:0 !important; border:0 !important; }
    .me-inline-analysis.me-bazaar-add, .me-inline-analysis.me-has-cta { pointer-events:auto !important; }

    .me-why-toggle { display:inline-flex !important; align-items:center !important; justify-content:center !important; min-width:var(--me-tap) !important; min-height:var(--me-tap) !important; margin:-6px 0 !important; padding:0 6px !important; border:0 !important; background:transparent !important; color:var(--me-muted) !important; font:700 var(--me-fs-meta)/1 Arial, sans-serif !important; cursor:pointer !important; pointer-events:auto !important; touch-action:manipulation !important; border-radius:6px !important; }
    .me-why-toggle:hover, .me-why-toggle:focus-visible { background:var(--me-btn) !important; color:var(--me-fg) !important; outline:none !important; }
    .me-why-toggle[aria-expanded="true"] { color:var(--me-fg) !important; }
    .me-why { display:none !important; flex:0 0 100% !important; width:100% !important; margin:2px 0 0 !important; padding:4px 0 2px !important; border-top:1px solid var(--me-strip-border) !important; color:var(--me-muted) !important; font:500 var(--me-fs-small)/1.45 Arial, sans-serif !important; white-space:normal !important; }
    .me-why.me-open { display:block !important; }
    .me-why-line { display:block !important; }
    .me-key-cta { display:inline-flex !important; align-items:center !important; min-height:var(--me-tap) !important; margin:-4px 0 !important; padding:0 10px !important; border:1px solid var(--me-btn-border) !important; border-radius:6px !important; background:var(--me-btn) !important; color:var(--me-fg) !important; font:700 var(--me-fs-meta)/1 Arial, sans-serif !important; cursor:pointer !important; pointer-events:auto !important; }

    div.me-inline-analysis.me-row-line.me-abroad { justify-content:flex-start !important; }
    div.me-inline-analysis.me-row-line.me-abroad .me-abroad-rate { font-size:13px !important; }
    .me-abroad-summary { margin:6px 0 8px !important; padding:8px 10px !important; border:1px solid var(--me-strip-border) !important; border-radius:6px !important; background:var(--me-strip) !important; color:var(--me-fg) !important; font:500 var(--me-fs-meta)/1.4 Arial, sans-serif !important; font-variant-numeric:tabular-nums !important; }
    .me-abroad-summary .me-abroad-title { display:flex !important; align-items:center !important; gap:6px !important; font-weight:700 !important; font-size:var(--me-fs) !important; }
    .me-abroad-summary .me-abroad-title .me-inline-brand { margin-right:2px !important; }
    .me-abroad-summary .me-abroad-meta { color:var(--me-muted) !important; font-size:var(--me-fs-small) !important; margin-top:2px !important; }
    .me-abroad-summary ol { margin:6px 0 0 !important; padding:0 !important; list-style:none !important; }
    .me-abroad-summary li { display:flex !important; gap:8px !important; align-items:baseline !important; padding:3px 0 !important; border-top:1px solid var(--me-strip-border) !important; }
    .me-abroad-summary li .me-abroad-rank { color:var(--me-faint) !important; min-width:14px !important; }
    .me-abroad-summary li .me-abroad-name { flex:1 !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; font-weight:700 !important; }
    .me-abroad-summary li .me-abroad-rate { font-weight:800 !important; color:var(--me-good) !important; white-space:nowrap !important; }
    .me-abroad-summary li .me-abroad-detail { color:var(--me-muted) !important; white-space:nowrap !important; }
    .me-abroad-summary .me-abroad-warn { color:var(--me-warn) !important; }
    .me-abroad-summary .me-abroad-settings { display:inline-flex !important; align-items:center !important; min-height:var(--me-tap) !important; margin:-6px 0 !important; padding:0 8px !important; border:0 !important; background:transparent !important; color:var(--me-muted) !important; font:600 var(--me-fs-small)/1 Arial, sans-serif !important; cursor:pointer !important; text-decoration:underline !important; }
    .me-bazaar-add-row { height:auto !important; min-height:72px !important; overflow:visible !important; }
    .me-bazaar-add-controls { flex-wrap:wrap !important; overflow:visible !important; }
    .me-bazaar-add-controls > .me-inline-analysis { display:flex !important; flex:0 0 100% !important; width:100% !important; max-width:none !important; grid-column:1 / -1 !important; justify-content:flex-end !important; margin:4px 0 1px !important; z-index:10 !important; }
    .me-inline-analysis.me-bazaar-add { padding-right:4px !important; }
    div.me-inline-analysis.me-bazaar-add.me-row-line { gap:6px 8px !important; padding:4px 8px !important; align-items:center !important; }
    .me-bazaar-fill-btn { display:inline-flex !important; align-items:center !important; justify-content:center !important; min-width:var(--me-tap) !important; min-height:var(--me-tap) !important; margin:-4px 0 !important; padding:0 12px !important; border:1px solid var(--me-btn-border) !important; border-radius:6px !important; background:var(--me-btn) !important; color:var(--me-fg) !important; font:700 var(--me-fs)/1 Arial, sans-serif !important; cursor:pointer !important; pointer-events:auto !important; touch-action:manipulation !important; white-space:nowrap !important; }
    .me-bazaar-fill-btn:hover, .me-bazaar-fill-btn:focus-visible { background:var(--me-btn-hover) !important; outline:none !important; }
    .me-bazaar-fill-btn.me-fill-clear { min-width:var(--me-tap) !important; padding:0 8px !important; font-size:15px !important; color:var(--me-bad) !important; border-color:var(--me-bad) !important; background:var(--me-bad-bg) !important; }
    .me-fill-done { display:inline-flex !important; align-items:center !important; justify-content:center !important; min-width:28px !important; min-height:28px !important; padding:0 6px !important; border-radius:6px !important; color:var(--me-good) !important; background:var(--me-good-bg) !important; border:1px solid var(--me-good) !important; font:700 13px/1 Arial, sans-serif !important; }
    .me-inline-analysis.me-bazaar-add .me-fill-figures { font-size:var(--me-fs) !important; color:var(--me-fg) !important; }
    .me-inline-analysis.me-bazaar-add .me-inline-secondary { white-space:nowrap !important; }
    .me-inline-analysis.me-bazaar-add.me-applied { border-color:var(--me-good) !important; }
    .me-row-host { height:auto !important; max-height:none !important; overflow:visible !important; flex-wrap:wrap !important; }
    .me-row-host.me-row-float-host { position:relative !important; }
    div.me-inline-analysis.me-row-line { display:flex !important; flex:0 0 100% !important; width:100% !important; max-width:none !important; height:auto !important; min-height:20px !important; clear:both !important; margin:0 !important; padding:3px 8px !important; border:0 !important; border-top:1px solid var(--me-strip-border) !important; border-radius:0 !important; background:var(--me-strip) !important; justify-content:flex-start !important; white-space:normal !important; flex-wrap:wrap !important; position:relative !important; z-index:5 !important; line-height:1.35 !important; visibility:visible !important; opacity:1 !important; }
    div.me-inline-analysis.me-row-line.me-row-float { position:absolute !important; left:0 !important; right:0 !important; bottom:0 !important; width:auto !important; z-index:9 !important; }
    .me-inline-analysis .me-manage-fill { margin-left:4px !important; }

    .me-modal-backdrop { position:fixed; inset:0; z-index:999999; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; padding:18px; }
    .me-modal { width:min(640px, 100%); max-height:90vh; overflow:auto; background:var(--me-bg); color:var(--me-fg); border:1px solid var(--me-border); border-radius:8px; box-shadow:var(--me-shadow); padding:14px; font-family:Arial, sans-serif; font-size:var(--me-fs); }
    .me-modal * { box-sizing:border-box; }
    .me-modal h2 { margin:0 0 10px; font-size:17px; }
    .me-modal-intro { color:var(--me-muted); font-size:var(--me-fs-meta); line-height:1.45; margin:0 0 10px; }
    .me-section { border:1px solid var(--me-border); border-radius:6px; margin:8px 0; background:var(--me-bg); }
    .me-section > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:8px; min-height:var(--me-tap); padding:6px 10px; font-size:var(--me-fs-meta); font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--me-muted); }
    .me-section > summary::-webkit-details-marker { display:none; }
    .me-section > summary::before { content:"\\25B8"; font-size:10px; color:var(--me-faint); }
    .me-section[open] > summary::before { content:"\\25BE"; }
    .me-section > summary .me-section-hint { font-weight:500; text-transform:none; letter-spacing:0; color:var(--me-faint); flex:1; }
    .me-section-body { padding:4px 10px 10px; }
    .me-section-title { margin:13px 0 7px; font-size:var(--me-fs-meta); color:var(--me-muted); text-transform:uppercase; letter-spacing:.06em; }
    .me-form-grid { display:grid; grid-template-columns:minmax(170px, 1fr) minmax(120px, .7fr); gap:7px 12px; align-items:center; font-size:var(--me-fs-meta); }
    .me-form-grid label { min-height:24px; display:flex; align-items:center; cursor:pointer; }
    .me-form-grid input, .me-form-grid select { width:100%; min-height:var(--me-tap); padding:6px; border:1px solid var(--me-border); border-radius:4px; background:var(--me-bg-2); color:var(--me-fg); font-size:var(--me-fs); }
    .me-form-grid input[type='checkbox'] { width:20px; height:20px; min-height:0; justify-self:start; accent-color:var(--me-good); }
    .me-form-help { color:var(--me-muted); font-size:var(--me-fs-small); margin-top:8px; line-height:1.4; }
    .me-visually-hidden { position:absolute !important; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    .me-modal-actions { display:flex; gap:7px; justify-content:flex-end; margin-top:14px; position:sticky; bottom:-14px; padding:10px 0 0; background:var(--me-bg); }
    .me-error { color:var(--me-bad); font-size:var(--me-fs-meta); line-height:1.4; }
    .me-table { width:100%; border-collapse:collapse; font-size:var(--me-fs-small); margin-top:6px; }
    .me-table th, .me-table td { padding:4px; text-align:right; border-bottom:1px solid var(--me-border); white-space:nowrap; font-variant-numeric:tabular-nums; }
    .me-table th { color:var(--me-muted); font-weight:600; text-transform:uppercase; letter-spacing:.04em; font-size:9px; }
    .me-table td:first-child, .me-table th:first-child { text-align:left; max-width:150px; overflow:hidden; text-overflow:ellipsis; }
    .me-table tr.GREEN td { color:var(--me-good); }
    .me-table tr.YELLOW td { color:var(--me-warn); }
    .me-table tr.RED td { color:var(--me-bad); }
    .me-pill { display:inline-block; padding:1px 5px; border-radius:3px; font-size:9px; font-weight:700; border:1px solid var(--me-border); color:var(--me-muted); }
    .me-pill.GREEN { color:var(--me-good); border-color:var(--me-good); }
    .me-pill.YELLOW { color:var(--me-warn); border-color:var(--me-warn); }
    .me-pill.RED { color:var(--me-bad); border-color:var(--me-bad); }
    .me-inline-input { width:110px; min-height:var(--me-tap); padding:4px 6px; border:1px solid var(--me-border); border-radius:4px; background:var(--me-bg-2); color:var(--me-fg); font-size:var(--me-fs-meta); }
    .me-launcher { position:fixed; left:10px; bottom:10px; z-index:999997; min-height:var(--me-tap); min-width:var(--me-tap); padding:6px 12px; border-radius:20px; border:1px solid var(--me-border); background:var(--me-bg); color:var(--me-fg); font:800 var(--me-fs-meta)/1 Arial, sans-serif; cursor:pointer; box-shadow:var(--me-shadow); touch-action:manipulation; }
    .me-toast-host { position:fixed; left:10px; bottom:56px; z-index:999999; display:flex; flex-direction:column; gap:6px; max-width:min(380px, calc(100vw - 20px)); }
    .me-toast { background:var(--me-bg); border:1px solid var(--me-good); border-radius:6px; padding:8px 10px; color:var(--me-fg); font:var(--me-fs)/1.4 Arial, sans-serif; box-shadow:var(--me-shadow); }
    .me-toast a { color:var(--me-good); font-weight:700; }
    .me-toast .me-toast-close { float:right; border:0; background:transparent; font:inherit; display:inline-flex; align-items:center; justify-content:center; min-width:var(--me-tap); min-height:var(--me-tap); margin:-6px -6px 0 8px; cursor:pointer; color:var(--me-muted); font-weight:700; border-radius:6px; }
    .me-toast .me-toast-close:hover { background:var(--me-btn); }
    .me-launcher-menu { border-color:var(--me-border); }
    .me-workbench-cell { white-space:nowrap; }
    .me-workbench-cell .me-inline-input { width:78px; font-size:var(--me-fs-small); padding:2px 3px; margin-left:3px; }
    .me-workbench-cell .me-rule-mode { width:104px; }
    .me-workbench-cell .me-listing-fill { padding:2px 8px; margin-left:3px; }
    .me-watch-row { display:flex; align-items:center; gap:6px; font-size:var(--me-fs-meta); padding:2px 0; border-bottom:1px solid var(--me-border); }
    .me-watch-row .me-watch-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .me-watch-row .me-watch-remove { display:inline-flex; align-items:center; justify-content:center; min-width:var(--me-tap); min-height:var(--me-tap); border:0; background:transparent; cursor:pointer; color:var(--me-bad); font-weight:700; border-radius:6px; }
    .me-watch-row .me-watch-remove:hover, .me-watch-row .me-watch-remove:focus-visible { background:var(--me-bad-bg); outline:none; }
    @media (max-width: 784px) {
      #market-edge-root { right:6px; bottom:6px; width:calc(100vw - 12px); }
      .me-body { max-height:58vh; }
      .me-form-grid { grid-template-columns:1fr; gap:3px 0; }
      .me-form-grid label { min-height:0; margin-top:6px; }
      .me-modal-backdrop { padding:8px; align-items:flex-end; }
      .me-modal { max-height:92vh; }
    }
  `;
