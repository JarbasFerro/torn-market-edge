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
      // Labels inside Buy/quantity controls ("Buy Bunch of Flowers") name the
      // item too; they sit in the narrow action column and must not host it.
      const control = element.closest("button,label,select,[role='button']");
      if (control && control !== card && card.contains(control)) return;
      if (element.querySelector("input,button,select,textarea")) return;
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 120) return;
      if (/^(?:RRP|Remove|Price per unit)\s*:/i.test(text)) return;
      const lower = text.toLowerCase();
      const nameMatch = normalizedName && (lower === normalizedName || lower.endsWith(` ${normalizedName}`) || lower.includes(normalizedName));
      const itemish = nameMatch || /^(?:x|\u00d7)?\s*[\d,]+\s+\S+/i.test(text);
      if (!itemish) return;
      const rect = rectOf(element);
      // Visually hidden screen-reader text is a 1px box: never a host.
      if (rect.width < 12 || rect.height < 6) return;
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
  // Design system (see docs/DESIGN.md). One set of tokens, one definition per
  // component. Rules on elements placed inside Torn's markup carry !important
  // so Torn's own stylesheet cannot reshape them; the panel, menus and dialog
  // live in Market Edge's own containers and do not need it.
  // ---------------------------------------------------------------------------
  const CSS = `
    body { --me-bg:#ffffff; --me-bg-2:#f3f3f4; --me-fg:#1f1f21; --me-muted:#5b5f66; --me-faint:#8a8f97; --me-border:rgba(0,0,0,.14); --me-strip:rgba(0,0,0,.045); --me-strip-border:rgba(0,0,0,.10); --me-good:#1d7a3b; --me-warn:#8a5a00; --me-bad:#a83a3a; --me-good-bg:rgba(29,122,59,.10); --me-warn-bg:rgba(184,124,0,.12); --me-bad-bg:rgba(168,58,58,.10); --me-btn:rgba(0,0,0,.06); --me-btn-hover:rgba(0,0,0,.12); --me-btn-border:rgba(0,0,0,.18); --me-on-good:#ffffff; --me-shadow:0 6px 20px rgba(0,0,0,.18);
      --me-font:Arial, "Helvetica Neue", sans-serif; --me-fs-xs:10px; --me-fs-sm:11px; --me-fs-md:12px; --me-fs-lg:13px; --me-fs-xl:15px; --me-fs:var(--me-fs-md); --me-fs-meta:var(--me-fs-sm); --me-fs-small:var(--me-fs-xs);
      --me-s1:2px; --me-s2:4px; --me-s3:6px; --me-s4:8px; --me-s5:12px; --me-ctl-sm:22px; --me-ctl:26px; --me-hit:4px; --me-r-sm:3px; --me-r:5px; --me-r-lg:7px; --me-edge:3px; }
    body.dark-mode { --me-bg:#242426; --me-bg-2:#1c1c1e; --me-fg:#e9e9e9; --me-muted:#b3b3b3; --me-faint:#8a8a8a; --me-border:rgba(255,255,255,.14); --me-strip:rgba(0,0,0,.28); --me-strip-border:rgba(255,255,255,.08); --me-good:#7fd193; --me-warn:#f0ca66; --me-bad:#e27a7a; --me-good-bg:rgba(74,165,100,.18); --me-warn-bg:rgba(211,170,66,.16); --me-bad-bg:rgba(189,81,81,.16); --me-btn:rgba(255,255,255,.10); --me-btn-hover:rgba(255,255,255,.18); --me-btn-border:rgba(255,255,255,.22); --me-on-good:#0d1a10; --me-shadow:0 6px 20px rgba(0,0,0,.45); }
    /* Controls stay visually small; on touch screens an invisible margin
       around each one keeps it easy to hit. */
    @media (pointer: coarse) { body { --me-hit:7px; } }

    /* ---- Buttons: one family, two sizes (22px in rows, 26px in panels) ---- */
    .me-btn, .me-icon-btn, .me-bazaar-fill-btn, .me-key-cta, .me-ah-remind, .me-why-toggle, .me-chip-link, .me-link-btn, .me-toast-close, .me-watch-remove { position:relative; touch-action:manipulation; cursor:pointer; }
    .me-btn::after, .me-icon-btn::after, .me-bazaar-fill-btn::after, .me-key-cta::after, .me-ah-remind::after, .me-why-toggle::after, .me-chip-link::after, .me-link-btn::after, .me-toast-close::after, .me-watch-remove::after { content:""; position:absolute; inset:calc(-1 * var(--me-hit)) calc(-0.5 * var(--me-hit)); }
    .me-btn, .me-icon-btn { display:inline-flex; align-items:center; justify-content:center; gap:var(--me-s2); height:var(--me-ctl); min-height:var(--me-ctl); padding:0 10px; border:1px solid var(--me-btn-border); border-radius:var(--me-r); background:var(--me-btn); color:var(--me-fg); font:600 var(--me-fs-md)/1 var(--me-font); white-space:nowrap; }
    .me-icon-btn { width:var(--me-ctl); padding:0; font-size:var(--me-fs-lg); }
    .me-btn:hover, .me-icon-btn:hover, .me-btn:focus-visible, .me-icon-btn:focus-visible { background:var(--me-btn-hover); outline:none; }
    .me-bazaar-fill-btn, .me-key-cta, .me-ah-remind { display:inline-flex !important; align-items:center !important; justify-content:center !important; position:relative !important; height:var(--me-ctl-sm) !important; min-height:var(--me-ctl-sm) !important; min-width:0 !important; margin:0 !important; padding:0 9px !important; border:1px solid var(--me-btn-border) !important; border-radius:var(--me-r-sm) !important; background:var(--me-btn) !important; color:var(--me-fg) !important; font:700 var(--me-fs-sm)/1 var(--me-font) !important; white-space:nowrap !important; pointer-events:auto !important; vertical-align:middle !important; }
    .me-bazaar-fill-btn:hover, .me-bazaar-fill-btn:focus-visible, .me-key-cta:hover, .me-key-cta:focus-visible, .me-ah-remind:hover, .me-ah-remind:focus-visible { background:var(--me-btn-hover) !important; outline:none !important; }
    .me-bazaar-fill-btn.me-fill-main, .me-fill-bar .me-fill-bar-fill { border-color:var(--me-good) !important; }
    .me-bazaar-fill-btn.me-fill-clear, .me-fill-bar .me-fill-bar-undo { background:transparent !important; font-weight:600 !important; }
    .me-ah-remind { margin:var(--me-s2) 0 0 var(--me-s3) !important; }
    .me-ah-remind.me-on { border-color:var(--me-good) !important; color:var(--me-good) !important; background:var(--me-good-bg) !important; }
    .me-link-btn { border:0; background:transparent; padding:0; color:var(--me-muted); font:inherit; text-decoration:underline; }

    /* ---- Text roles ---- */
    .me-kicker { color:var(--me-muted); text-transform:uppercase; letter-spacing:.08em; font:700 var(--me-fs-xs)/1.3 var(--me-font); margin-bottom:var(--me-s1); }
    .me-note { font-size:var(--me-fs-xs); color:var(--me-muted); line-height:1.4; margin-top:var(--me-s3); }
    .me-error { color:var(--me-bad); font-size:var(--me-fs-sm); line-height:1.4; }
    .me-good { color:var(--me-good); } .me-warn, .me-learning { color:var(--me-warn); } .me-bad { color:var(--me-bad); }
    .me-visually-hidden { position:absolute !important; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }

    /* ---- Tags and chips ---- */
    .me-tag { display:inline-flex !important; align-items:center !important; height:15px !important; padding:0 4px !important; border-radius:var(--me-r-sm) !important; background:var(--me-good) !important; color:var(--me-on-good) !important; font:800 9px/1 var(--me-font) !important; letter-spacing:.06em !important; white-space:nowrap !important; }
    .me-pill { display:inline-block; padding:1px 5px; border-radius:var(--me-r-sm); font:700 9px/1.3 var(--me-font); border:1px solid var(--me-border); color:var(--me-muted); }
    .me-pill.GREEN { color:var(--me-good); border-color:var(--me-good); } .me-pill.YELLOW { color:var(--me-warn); border-color:var(--me-warn); } .me-pill.RED { color:var(--me-bad); border-color:var(--me-bad); }
    .me-chips { display:flex !important; flex-wrap:wrap !important; gap:var(--me-s2) !important; margin-top:var(--me-s3) !important; }
    .me-chip { display:inline-flex !important; align-items:center !important; height:18px !important; padding:0 7px !important; border:1px solid var(--me-border) !important; border-radius:999px !important; background:transparent !important; color:var(--me-muted) !important; font:500 var(--me-fs-xs)/1 var(--me-font) !important; white-space:nowrap !important; }
    .me-chip-link { border-style:dashed !important; text-decoration:underline !important; pointer-events:auto !important; }
    .me-badge { display:inline-flex !important; align-items:center; padding:1px 5px !important; margin-left:var(--me-s2) !important; border-radius:var(--me-r-sm) !important; font:700 var(--me-fs-xs)/1.25 var(--me-font) !important; white-space:nowrap !important; vertical-align:middle !important; pointer-events:none !important; border:1px solid var(--me-border) !important; color:var(--me-muted) !important; background:var(--me-strip) !important; }
    .me-badge.GREEN { background:var(--me-good-bg) !important; color:var(--me-good) !important; } .me-badge.YELLOW { background:var(--me-warn-bg) !important; color:var(--me-warn) !important; } .me-badge.RED { background:var(--me-bad-bg) !important; color:var(--me-bad) !important; }

    /* ---- Strip: the Market Edge line on a Torn row. Identity = the coloured
       left edge (green good, amber consider, red warning, grey neutral). ---- */
    .me-inline-analysis { position:static !important; display:inline-flex !important; align-items:center !important; flex-wrap:wrap !important; gap:var(--me-s1) var(--me-s3) !important; width:auto !important; max-width:100% !important; min-width:0 !important; min-height:0 !important; margin:0 0 0 var(--me-s4) !important; padding:2px var(--me-s3) 2px 7px !important; border:0 !important; border-left:var(--me-edge) solid var(--me-strip-border) !important; border-radius:0 var(--me-r-sm) var(--me-r-sm) 0 !important; background:var(--me-strip) !important; color:var(--me-fg) !important; font:600 var(--me-fs-sm)/1.3 var(--me-font) !important; font-variant-numeric:tabular-nums !important; box-sizing:border-box !important; vertical-align:middle !important; text-align:left !important; letter-spacing:0 !important; text-transform:none !important; pointer-events:none !important; }
    .me-inline-analysis.GREEN { border-left-color:var(--me-good) !important; } .me-inline-analysis.YELLOW { border-left-color:var(--me-warn) !important; } .me-inline-analysis.RED { border-left-color:var(--me-bad) !important; }
    .me-inline-analysis.me-bazaar-add, .me-inline-analysis.me-has-cta, .me-inline-analysis.me-has-why { pointer-events:auto !important; }
    .me-inline-analysis .me-inline-brand { display:none !important; }
    .me-inline-primary { color:var(--me-fg) !important; font-weight:700 !important; font-size:var(--me-fs-md) !important; }
    .me-inline-secondary { color:var(--me-muted) !important; font-weight:500 !important; }
    .me-inline-sep { color:var(--me-faint) !important; font-weight:400 !important; }
    .me-inline-stale { color:var(--me-warn) !important; font-weight:700 !important; }
    .me-inline-status { font-weight:800 !important; font-size:var(--me-fs-xs) !important; letter-spacing:.04em !important; white-space:nowrap !important; color:var(--me-muted) !important; }
    .me-inline-analysis.GREEN .me-inline-status { color:var(--me-good) !important; } .me-inline-analysis.YELLOW .me-inline-status { color:var(--me-warn) !important; } .me-inline-analysis.RED .me-inline-status { color:var(--me-bad) !important; }
    .me-inline-warning { color:var(--me-warn) !important; font-weight:700 !important; }
    .me-inline-analysis.me-loading { opacity:.6 !important; font-weight:400 !important; }
    .me-inline-analysis.me-muted { color:var(--me-faint) !important; }
    .me-inline-analysis.me-muted .me-inline-primary { color:var(--me-muted) !important; font-size:var(--me-fs-sm) !important; }
    .me-inline-analysis.me-muted .me-inline-secondary { color:var(--me-faint) !important; }
    .me-inline-analysis.me-hidden, div.me-inline-analysis.me-row-line.me-hidden { display:none !important; visibility:hidden !important; height:0 !important; min-height:0 !important; padding:0 !important; border:0 !important; }
    div.me-inline-analysis.me-inline-block { display:flex !important; width:fit-content !important; margin:var(--me-s2) 0 0 !important; white-space:normal !important; float:none !important; clear:both !important; }

    /* Row line: a full-width strip under a Torn row (inventory, abroad, sell forms). */
    .me-row-host { height:auto !important; max-height:none !important; overflow:visible !important; flex-wrap:wrap !important; }
    .me-row-host.me-row-float-host { position:relative !important; }
    div.me-inline-analysis.me-row-line { display:flex !important; flex:0 0 100% !important; width:100% !important; max-width:none !important; height:auto !important; min-height:22px !important; clear:both !important; margin:0 !important; padding:2px var(--me-s4) 2px 7px !important; border-top:1px solid var(--me-strip-border) !important; border-radius:0 !important; justify-content:flex-start !important; white-space:normal !important; position:relative !important; z-index:5 !important; line-height:1.3 !important; visibility:visible !important; opacity:1 !important; }
    div.me-inline-analysis.me-row-line.me-row-float { position:absolute !important; left:0 !important; right:0 !important; bottom:0 !important; width:auto !important; z-index:9 !important; }
    div.me-inline-analysis.me-row-line.me-has-why { padding-right:28px !important; }
    div.me-inline-analysis.me-row-line > .me-why-toggle { position:absolute !important; top:0 !important; right:0 !important; bottom:0 !important; width:24px !important; height:auto !important; min-height:0 !important; margin:0 !important; padding:0 !important; border-radius:0 !important; }
    div.me-inline-analysis.me-row-line .me-abroad-rate { font-size:var(--me-fs-lg) !important; }
    div.me-inline-analysis.me-abroad.GREEN .me-abroad-rate { color:var(--me-good) !important; }

    /* Why: a "?" on the strip opens a plain-language explanation underneath. */
    .me-why-toggle { display:inline-flex !important; align-items:center !important; justify-content:center !important; position:relative !important; width:18px !important; height:18px !important; min-width:0 !important; min-height:0 !important; margin:0 !important; padding:0 !important; border:0 !important; border-radius:var(--me-r-sm) !important; background:transparent !important; color:var(--me-muted) !important; font:700 var(--me-fs-sm)/1 var(--me-font) !important; pointer-events:auto !important; }
    .me-why-toggle:hover, .me-why-toggle:focus-visible { background:var(--me-btn) !important; color:var(--me-fg) !important; outline:none !important; }
    .me-why-toggle[aria-expanded="true"] { color:var(--me-fg) !important; }
    .me-why { display:none !important; flex:0 0 100% !important; width:100% !important; margin:var(--me-s1) 0 0 !important; padding:var(--me-s2) 0 var(--me-s1) !important; border-top:1px solid var(--me-strip-border) !important; color:var(--me-muted) !important; font:500 var(--me-fs-xs)/1.45 var(--me-font) !important; white-space:normal !important; }
    .me-why.me-open { display:block !important; }
    .me-why-line { display:block !important; }

    /* Browse chip: an overlay on Item Market grid cards that takes no space. */
    .me-browse-host { position:relative !important; }
    .me-inline-analysis.me-browse-chip { position:absolute !important; top:2px !important; left:2px !important; right:auto !important; bottom:auto !important; z-index:3 !important; display:inline-flex !important; flex-wrap:nowrap !important; max-width:calc(100% - 4px) !important; margin:0 !important; padding:1px 4px !important; border-left-width:0 !important; border-radius:var(--me-r-sm) !important; overflow:hidden !important; white-space:nowrap !important; text-overflow:ellipsis !important; font:700 var(--me-fs-xs)/1.2 var(--me-font) !important; pointer-events:none !important; }
    .me-inline-analysis.me-browse-chip .me-inline-primary { font-size:var(--me-fs-xs) !important; }
    .me-inline-analysis.me-browse-chip.YELLOW { background:var(--me-warn-bg) !important; box-shadow:inset 0 0 0 1px var(--me-warn) !important; } .me-inline-analysis.me-browse-chip.YELLOW .me-inline-primary { color:var(--me-warn) !important; }
    .me-inline-analysis.me-browse-chip.GREEN { background:var(--me-good-bg) !important; box-shadow:inset 0 0 0 1px var(--me-good) !important; } .me-inline-analysis.me-browse-chip.GREEN .me-inline-primary { color:var(--me-good) !important; }

    /* Sell strip (Bazaar add, Item Market sell): price first, origin second, one action. */
    .me-bazaar-add-row { height:auto !important; min-height:0 !important; overflow:visible !important; }
    .me-bazaar-add-controls { flex-wrap:wrap !important; overflow:visible !important; }
    .me-bazaar-add-controls > .me-inline-analysis { display:flex !important; flex:0 0 100% !important; width:100% !important; max-width:none !important; grid-column:1 / -1 !important; margin:var(--me-s1) 0 0 !important; z-index:10 !important; }
    div.me-inline-analysis.me-fill-strip { display:flex !important; flex-wrap:wrap !important; align-items:center !important; justify-content:flex-start !important; gap:var(--me-s1) var(--me-s4) !important; min-height:0 !important; padding:3px var(--me-s3) 3px 7px !important; }
    div.me-inline-analysis.me-fill-strip.me-has-why { padding-right:var(--me-s3) !important; }
    .me-fill-strip .me-fill-text { flex:1 1 140px !important; min-width:0 !important; display:flex !important; flex-direction:column !important; gap:0 !important; }
    .me-fill-strip .me-fill-line1 { display:flex !important; flex-wrap:wrap !important; align-items:baseline !important; gap:0 var(--me-s3) !important; }
    .me-inline-analysis.me-fill-strip .me-fill-figures { font:700 var(--me-fs-lg)/1.25 var(--me-font) !important; color:var(--me-fg) !important; }
    .me-fill-strip .me-fill-line2 { color:var(--me-muted) !important; font:500 var(--me-fs-xs)/1.3 var(--me-font) !important; white-space:normal !important; }
    .me-fill-strip .me-why-link, div.me-inline-analysis.me-row-line .me-fill-line2 > .me-why-toggle { position:relative !important; display:inline !important; width:auto !important; height:auto !important; padding:0 2px !important; color:var(--me-muted) !important; text-decoration:underline !important; font:600 var(--me-fs-xs)/1.3 var(--me-font) !important; }
    .me-fill-actions { display:flex !important; align-items:center !important; gap:var(--me-s3) !important; margin-left:auto !important; flex:none !important; }
    .me-fill-done { display:inline-flex !important; align-items:center !important; padding:0 !important; border:0 !important; background:transparent !important; color:var(--me-good) !important; font:700 var(--me-fs-sm)/1.2 var(--me-font) !important; white-space:nowrap !important; }
    .me-inline-analysis .me-manage-fill { margin-left:var(--me-s2) !important; }

    /* ---- Cards: grouped Market Edge content inside Torn pages ---- */
    .me-card, .me-fill-bar { display:block !important; margin:var(--me-s3) 0 var(--me-s4) !important; padding:var(--me-s4) 10px !important; border:1px solid var(--me-strip-border) !important; border-left:var(--me-edge) solid var(--me-good) !important; border-radius:var(--me-r) !important; background:var(--me-strip) !important; color:var(--me-fg) !important; font:500 var(--me-fs-sm)/1.35 var(--me-font) !important; font-variant-numeric:tabular-nums !important; box-sizing:border-box !important; text-align:left !important; }
    .me-card-section { margin-top:var(--me-s4) !important; padding-top:var(--me-s3) !important; border-top:1px solid var(--me-strip-border) !important; }
    .me-plan { display:flex !important; align-items:flex-end !important; gap:10px !important; }
    .me-plan-what { flex:1 1 auto !important; min-width:0 !important; }
    .me-plan-buy { font:800 var(--me-fs-xl)/1.25 var(--me-font) !important; color:var(--me-fg) !important; }
    .me-plan-meta { margin-top:var(--me-s1) !important; color:var(--me-muted) !important; font-size:var(--me-fs-sm) !important; }
    .me-plan-rate, .me-trip-rate { flex:none !important; color:var(--me-good) !important; font:800 20px/1 var(--me-font) !important; font-variant-numeric:tabular-nums !important; white-space:nowrap !important; }
    .me-plan-rate small, .me-trip-rate small, .me-trip-table small { font-size:var(--me-fs-sm) !important; font-weight:600 !important; color:var(--me-muted) !important; margin-left:1px !important; }
    .me-alt-row { display:flex !important; align-items:baseline !important; gap:var(--me-s4) !important; padding:2px 0 !important; }
    .me-alt-name { flex:1 1 auto !important; min-width:0 !important; font-weight:700 !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
    .me-alt-note { color:var(--me-muted) !important; font-size:var(--me-fs-xs) !important; white-space:nowrap !important; }
    .me-alt-rate { min-width:56px !important; text-align:right !important; color:var(--me-good) !important; font-weight:800 !important; white-space:nowrap !important; }
    .me-fill-bar { display:flex !important; flex-wrap:wrap !important; align-items:center !important; gap:var(--me-s3) 10px !important; background:var(--me-good-bg) !important; border-color:var(--me-good) !important; padding:5px var(--me-s4) 5px 10px !important; }
    .me-fill-bar .me-fill-bar-text { flex:1 1 160px !important; min-width:0 !important; }

    /* ---- Panel ---- */
    #market-edge-root { position:fixed; right:12px; bottom:12px; z-index:999998; width:min(380px, calc(100vw - 24px)); font-family:var(--me-font); font-size:var(--me-fs); color:var(--me-fg); }
    #market-edge-root * { box-sizing:border-box; }
    .me-shell { background:var(--me-bg); border:1px solid var(--me-border); border-radius:var(--me-r-lg); box-shadow:var(--me-shadow); overflow:hidden; }
    .me-header { display:flex; align-items:center; gap:var(--me-s2); min-height:34px; padding:var(--me-s2) var(--me-s2) var(--me-s2) 10px; background:var(--me-bg-2); border-bottom:1px solid var(--me-border); }
    .me-title { flex:1; font:700 var(--me-fs-sm)/1 var(--me-font); letter-spacing:.08em; text-transform:uppercase; }
    .me-status { font-size:var(--me-fs-xs); color:var(--me-muted); white-space:nowrap; margin-right:var(--me-s2); }
    .me-body { display:flex; flex-direction:column; padding:var(--me-s4) 10px; max-height:min(70vh, 600px); overflow:auto; }
    .me-body[hidden] { display:none; }
    .me-actions { display:flex; flex-wrap:wrap; gap:var(--me-s3); margin-top:var(--me-s4); }
    .me-body > .me-actions.me-panel-toolbar { order:-1; margin:0 0 var(--me-s4); padding-bottom:var(--me-s4); border-bottom:1px solid var(--me-border); }
    .me-item-name { font:700 var(--me-fs-xl)/1.25 var(--me-font); margin-bottom:var(--me-s4); }
    .me-grid { display:grid; grid-template-columns:1fr auto; gap:3px var(--me-s5); font-size:var(--me-fs-sm); }
    .me-grid .label { color:var(--me-muted); }
    .me-grid .value { font-variant-numeric:tabular-nums; text-align:right; }
    .me-rule { height:1px; background:var(--me-border); margin:var(--me-s4) 0; }
    .me-callout { border-left:var(--me-edge) solid var(--me-faint); background:var(--me-strip); padding:var(--me-s3) var(--me-s4); border-radius:0 var(--me-r-sm) var(--me-r-sm) 0; }
    .me-callout.GREEN { border-color:var(--me-good); } .me-callout.YELLOW { border-color:var(--me-warn); } .me-callout.GREY { border-color:var(--me-faint); } .me-callout.RED { border-color:var(--me-bad); }
    .me-decision { display:flex; align-items:center; gap:var(--me-s3); font:800 var(--me-fs-md)/1.3 var(--me-font); letter-spacing:.03em; margin-bottom:var(--me-s2); }
    .me-decision.GREEN { color:var(--me-good); } .me-decision.YELLOW { color:var(--me-warn); } .me-decision.GREY { color:var(--me-muted); } .me-decision.RED { color:var(--me-bad); }
    .me-diag { margin:var(--me-s4) 0 0; padding:var(--me-s3) var(--me-s4); background:var(--me-strip); border-radius:var(--me-r-sm); }
    .me-diag summary { cursor:pointer; font-size:var(--me-fs-sm); }
    .me-diag-row { font-size:var(--me-fs-xs); line-height:1.5; }
    .me-diag-row.pass { color:var(--me-good); } .me-diag-row.fail { color:var(--me-bad); }
    .me-table { width:100%; border-collapse:collapse; font-size:var(--me-fs-xs); margin-top:var(--me-s3); }
    .me-table th, .me-table td { padding:3px var(--me-s2); text-align:right; border-bottom:1px solid var(--me-border); white-space:nowrap; font-variant-numeric:tabular-nums; }
    .me-table th { color:var(--me-muted); font-weight:700; text-transform:uppercase; letter-spacing:.06em; font-size:9px; }
    .me-table td:first-child, .me-table th:first-child { text-align:left; max-width:150px; overflow:hidden; text-overflow:ellipsis; }
    .me-table tr.GREEN td { color:var(--me-good); } .me-table tr.YELLOW td { color:var(--me-warn); } .me-table tr.RED td { color:var(--me-bad); }
    .me-inline-input { width:110px; height:var(--me-ctl); padding:0 var(--me-s3); border:1px solid var(--me-border); border-radius:var(--me-r-sm); background:var(--me-bg-2); color:var(--me-fg); font-size:var(--me-fs-sm); }
    .me-workbench-cell { white-space:nowrap; }
    .me-workbench-cell .me-inline-input { width:78px; height:var(--me-ctl-sm); font-size:var(--me-fs-xs); padding:0 3px; margin-left:3px; }
    .me-workbench-cell .me-rule-mode { width:104px; }
    .me-workbench-cell .me-listing-fill { height:var(--me-ctl-sm); min-height:var(--me-ctl-sm); padding:0 var(--me-s4); margin-left:3px; }
    .me-watch-row { display:flex; align-items:center; gap:var(--me-s3); font-size:var(--me-fs-sm); padding:2px 0; border-bottom:1px solid var(--me-border); }
    .me-watch-row .me-watch-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .me-watch-row .me-watch-remove { display:inline-flex; align-items:center; justify-content:center; width:var(--me-ctl-sm); height:var(--me-ctl-sm); border:0; background:transparent; color:var(--me-bad); font-weight:700; border-radius:var(--me-r-sm); }
    .me-watch-row .me-watch-remove:hover, .me-watch-row .me-watch-remove:focus-visible { background:var(--me-bad-bg); outline:none; }

    /* Travel plan cards (panel). */
    .me-trip-head { display:flex; flex-direction:column; gap:var(--me-s1); margin-bottom:var(--me-s3); }
    .me-trip-head .me-actions { margin-top:var(--me-s3); }
    .me-trip-context { color:var(--me-muted); font-size:var(--me-fs-sm); }
    .me-trip-note { margin:var(--me-s2) 0 !important; }
    .me-trip-list { list-style:none; margin:var(--me-s2) 0 var(--me-s4); padding:0; display:flex; flex-direction:column; gap:var(--me-s2); }
    .me-trip { border:1px solid var(--me-border); border-left:var(--me-edge) solid var(--me-good); border-radius:var(--me-r); background:var(--me-bg-2); overflow:hidden; }
    .me-trip details > summary { list-style:none; cursor:pointer; }
    .me-trip details > summary::-webkit-details-marker { display:none; }
    .me-trip-summary { display:flex; align-items:center; gap:var(--me-s4); padding:5px var(--me-s4); }
    .me-trip-rank { flex:none; width:14px; color:var(--me-faint); font:700 var(--me-fs-sm)/1 var(--me-font); text-align:center; }
    .me-trip-main { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:1px; }
    .me-trip-country { font:700 var(--me-fs-md)/1.25 var(--me-font); }
    .me-trip-time { color:var(--me-faint); font-weight:500; font-size:var(--me-fs-xs); margin-left:var(--me-s2); }
    .me-trip-item { font-size:var(--me-fs-sm); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .me-trip-item a { color:var(--me-fg); text-decoration:none; font-weight:600; }
    .me-trip-meta { color:var(--me-muted); font-size:var(--me-fs-xs); }
    .me-trip-more { text-decoration:underline; }
    .me-trip details[open] .me-trip-more { text-decoration:none; }
    .me-trip .me-trip-rate { font-size:var(--me-fs-xl) !important; }
    .me-trip-table { margin:0 !important; border-top:1px solid var(--me-border); }
    .me-trip-table td { padding:var(--me-s2) var(--me-s4) !important; }
    .me-trip-table td a { color:var(--me-fg); text-decoration:none; }

    /* ---- Launcher tab, menu and toasts ---- */
    .me-launcher { position:fixed; right:0; left:auto; top:55%; bottom:auto; z-index:999997; display:flex; align-items:center; justify-content:center; width:22px; min-width:22px; height:52px; min-height:52px; margin:0 env(safe-area-inset-right, 0px) 0 0; padding:0; border:1px solid var(--me-border); border-right:0; border-radius:var(--me-r-lg) 0 0 var(--me-r-lg); background:var(--me-bg); color:var(--me-muted); font:800 9px/1 var(--me-font); letter-spacing:.14em; cursor:pointer; box-shadow:var(--me-shadow); touch-action:none; opacity:.94; -webkit-user-select:none; user-select:none; }
    .me-launcher::before { content:""; position:absolute; top:-8px; bottom:-8px; left:-14px; right:0; }
    .me-launcher .me-launcher-label { writing-mode:vertical-rl; pointer-events:none; }
    .me-launcher:hover, .me-launcher:focus-visible, .me-launcher[aria-expanded="true"], .me-launcher.me-dragging { color:var(--me-fg); background:var(--me-bg-2); outline:none; opacity:1; }
    .me-launcher-badge { position:absolute; top:-6px; left:-8px; min-width:16px; height:16px; padding:0 4px; border-radius:8px; background:var(--me-good); color:var(--me-on-good); font:800 9px/16px var(--me-font); letter-spacing:0; text-align:center; pointer-events:none; box-shadow:var(--me-shadow); }
    .me-toast-host { position:fixed; left:10px; bottom:56px; z-index:999999; display:flex; flex-direction:column; gap:var(--me-s3); max-width:min(360px, calc(100vw - 20px)); }
    .me-toast { background:var(--me-bg); border:1px solid var(--me-border); border-left:var(--me-edge) solid var(--me-good); border-radius:var(--me-r); padding:var(--me-s3) var(--me-s4); color:var(--me-fg); font:var(--me-fs-md)/1.4 var(--me-font); box-shadow:var(--me-shadow); }
    .me-toast a { color:var(--me-good); font-weight:700; }
    .me-toast .me-toast-remove-sell { display:inline-block; margin-left:var(--me-s3); border:0; background:transparent; font:inherit; color:var(--me-bad); text-decoration:underline; cursor:pointer; padding:0; }
    .me-toast .me-toast-close { float:right; border:0; background:transparent; font:inherit; display:inline-flex; align-items:center; justify-content:center; width:var(--me-ctl-sm); height:var(--me-ctl-sm); margin:-3px -4px 0 var(--me-s4); color:var(--me-muted); font-weight:700; border-radius:var(--me-r-sm); }
    .me-toast .me-toast-close:hover { background:var(--me-btn); }
    .me-launcher-menu { position:fixed; right:calc(30px + env(safe-area-inset-right, 0px)); top:30%; z-index:999999; max-width:min(280px, calc(100vw - 44px)); padding:var(--me-s2); border-left-color:var(--me-border); }
    .me-launcher-menu .me-menu-list { display:flex; flex-direction:column; gap:2px; }
    .me-launcher-menu .me-menu-item { display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:1px; width:100%; height:auto; min-height:0; padding:5px var(--me-s4); text-align:left; border-color:transparent; background:transparent; }
    .me-launcher-menu .me-menu-item:hover, .me-launcher-menu .me-menu-item:focus-visible { background:var(--me-btn); }
    .me-launcher-menu .me-menu-label { font:700 var(--me-fs-md)/1.2 var(--me-font); }
    .me-launcher-menu .me-menu-hint { font:500 var(--me-fs-xs)/1.3 var(--me-font); color:var(--me-muted); white-space:normal; }

    /* ---- Settings dialog ---- */
    .me-modal-backdrop { position:fixed; inset:0; z-index:999999; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; padding:18px; }
    .me-modal { width:min(600px, 100%); max-height:90vh; overflow:auto; background:var(--me-bg); color:var(--me-fg); border:1px solid var(--me-border); border-radius:var(--me-r-lg); box-shadow:var(--me-shadow); padding:var(--me-s5); font-family:var(--me-font); font-size:var(--me-fs); }
    .me-modal * { box-sizing:border-box; }
    .me-modal h2 { margin:0 0 var(--me-s4); font-size:var(--me-fs-xl); }
    .me-modal-intro { color:var(--me-muted); font-size:var(--me-fs-sm); line-height:1.45; margin:0 0 var(--me-s4); }
    .me-section { border:1px solid var(--me-border); border-radius:var(--me-r); margin:var(--me-s3) 0; background:var(--me-bg); }
    .me-section > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:var(--me-s4); min-height:30px; padding:var(--me-s2) 10px; font-size:var(--me-fs-sm); font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--me-muted); }
    .me-section > summary::-webkit-details-marker { display:none; }
    .me-section > summary::before { content:"\\25B8"; font-size:var(--me-fs-xs); color:var(--me-faint); }
    .me-section[open] > summary::before { content:"\\25BE"; }
    .me-section > summary .me-section-hint { font-weight:500; text-transform:none; letter-spacing:0; color:var(--me-faint); flex:1; }
    .me-section-body { padding:var(--me-s2) 10px 10px; }
    .me-form-grid { display:grid; grid-template-columns:minmax(170px, 1fr) minmax(120px, .7fr); gap:var(--me-s3) var(--me-s5); align-items:center; font-size:var(--me-fs-sm); }
    .me-form-grid label { min-height:20px; display:flex; align-items:center; cursor:pointer; }
    .me-form-grid input, .me-form-grid select { width:100%; height:var(--me-ctl); padding:0 var(--me-s3); border:1px solid var(--me-border); border-radius:var(--me-r-sm); background:var(--me-bg-2); color:var(--me-fg); font-size:var(--me-fs-md); }
    .me-form-grid input[type='checkbox'] { width:18px; height:18px; justify-self:start; accent-color:var(--me-good); }
    .me-form-help { color:var(--me-muted); font-size:var(--me-fs-xs); margin-top:var(--me-s4); line-height:1.4; }
    .me-modal-actions { display:flex; gap:var(--me-s3); justify-content:flex-end; margin-top:var(--me-s5); position:sticky; bottom:calc(-1 * var(--me-s5)); padding:var(--me-s4) 0 0; background:var(--me-bg); }

    @media (max-width: 784px) {
      #market-edge-root { right:6px; bottom:6px; width:calc(100vw - 12px); }
      .me-body { max-height:56vh; }
      .me-form-grid { grid-template-columns:1fr; gap:2px 0; }
      .me-form-grid label { min-height:0; margin-top:var(--me-s3); }
      .me-modal-backdrop { padding:var(--me-s4); align-items:flex-end; }
      .me-modal { max-height:92vh; }
    }
  `;
