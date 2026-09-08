    });
    return ids;
  }

  function findInventoryRow(start) {
    if (!start) return null;
    // Fast path: Torn's inventory rows are list items carrying data-item.
    // No text or layout reads beyond one bounding box.
    const direct = start.closest?.("li[data-item]");
    if (direct && !direct.classList.contains("show-item-info") && directItemIdsWithin(direct).size === 1) {
      const rect = direct.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return direct;
    }
    let node = start instanceof HTMLElement ? start : start.parentElement;
    let fallback = null;
    for (let depth = 0; node && depth < 9 && node !== document.body; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      // Layout-free pre-check: a row never has hundreds of characters.
      if ((node.textContent || "").length > 600) continue;
      const rect = node.getBoundingClientRect();
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
      const rect = element.getBoundingClientRect();
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

  function collectVisibleItems({ requireMoney = false } = {}) {
    const candidates = new Set();
    const selector = itemIdentitySelector();

    const inventoryMarker = inventoryListMarker();

    // Prefer Torn's actual inventory-list containers when available. This
    // prevents equipped items from ever entering the candidate set.
    if (detectSurface() === "inventory") {
      const roots = Array.from(document.querySelectorAll(
        ".items-cont, [class*='itemsCont'], [class*='items-cont'], [class*='inventoryList'], [class*='inventory-list']"
      )).filter((root) => !root.closest("#market-edge-root"));
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
    const ordered = Array.from(candidates)
      .map((node) => {
        const rect = node.getBoundingClientRect?.();
        return { node, priority: rect ? viewportPriority({ card: node }) : 0 };
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit * 2)
      .map((entry) => entry.node);
    for (const node of ordered) {
      const itemId = itemIdFromElement(node);
      if (!itemId) continue;
      const card = detectSurface() === "inventory" ? findInventoryRow(node) : findCompactCard(node, requireMoney);
      // A bare image (for example the large picture inside an expanded
      // details block) is not a row: it would hijack the item entry and
      // swallow the annotation.
      if (!card || card === node || card.tagName === "IMG" || !(card.textContent || "").trim()) continue;
      if (node.closest?.(".me-equip-card")) continue;
      // A "row" that contains an item stats block is the expanded details
      // container reached through its large picture, not an inventory row.
      const cardText = card.textContent || "";
      if (QUALITY_PATTERN.test(cardText) && STATS_PATTERN.test(cardText)) continue;
      if (!isInventoryListCandidate(card, inventoryMarker)) continue;
      const rect = card?.getBoundingClientRect?.();
      if (rect && (rect.width <= 0 || rect.height <= 0)) continue;
      const text = card?.innerText || "";
      const priceElement = card?.querySelector?.('[data-testid="price"]');
      const price = requireMoney ? priceForSurfaceCard(detectSurface(), card, priceElement) : null;
      if (requireMoney && !price) continue;
      const quantity = parseQuantity(text);
      const name = elementItemName(card, node);
      // Key by row element, not item id: equipment copies share an item id
      // but each occupies its own row and gets its own annotation. Several
      // identity nodes inside one row still collapse to a single entry.
      const existing = byId.get(card);
      const score = Math.min(text.length, 900);
      if (!existing || score < existing.domTextLength) {
        byId.set(card, {
          itemId,
          name,
          price,
          quantity,
          card,
          inlineAnchor: findItemTextHost(card, name),
          inlineMode: "inline",
          domTextLength: score
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) => viewportPriority(b) - viewportPriority(a)).slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }


  function findOwnBazaarCard(start) {
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
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
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
      const rect = row.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      // Expanded rows carry Torn's item-details panel and grow well past the
      // normal row height; they must stay recognisable.
      if (rect.height > 300 && !QUALITY_PATTERN.test(row.textContent || "")) return false;
      const image = row.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']");
      const amount = row.querySelector("div[class*='amount___'], div.amount-main-wrap") || row;
      const input = Array.from(amount.querySelectorAll("input")).find((candidate) => {
        const inputRect = candidate.getBoundingClientRect();
        return inputRect.width > 0 && inputRect.height > 0 && candidate.type !== "hidden";
      });
      return Boolean(image && input);
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
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.height > 280) continue;
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 500) continue;
      const ids = directItemIdsWithin(node);
      const hasItemImage = Boolean(node.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']"));
      if (ids.size !== 1 && !hasItemImage) continue;
      const visibleInputs = Array.from(node.querySelectorAll("input")).filter((input) => {
        const inputRect = input.getBoundingClientRect();
        return inputRect.width > 0 && inputRect.height > 0 && input.type !== "hidden";
      });
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
    return Array.from(amount.querySelectorAll("input")).filter((input) => {
      const rect = input.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !["hidden", "checkbox", "radio"].includes(input.type);
    });
  }

  function findBazaarAddPriceInput(card) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const priceWrap = amount.querySelector("div[class*='price___'], div.price");
    const explicit = priceWrap?.querySelector("input.input-money, input") || amount.querySelector("input[name*='price' i]");
    if (explicit) {
      const rect = explicit.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && explicit.type !== "hidden") return explicit;
    }

    const candidates = bazaarAddInputs(card);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const scored = candidates.map((input) => {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.className || ""}`;
      let score = 0;
      if (/price|cost|unit|money/i.test(metadata)) score += 160;
      if (/qty|quantity|amount|count|clear-all/i.test(metadata)) score -= 220;
      const rect = input.getBoundingClientRect();
      return { input, score, left: rect.left };
    });
    scored.sort((a, b) => b.score - a.score || b.left - a.left);
    return scored[0]?.input || null;
  }

  function findBazaarAddQuantityCheckbox(card) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const control = amount.querySelector("div.choice-container, [class*='choiceContainer___']");
    const checkbox = control?.querySelector?.("input[type='checkbox'], input");
    if (!(checkbox instanceof HTMLInputElement)) return null;
    const rect = control.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? checkbox : null;
  }

  function findBazaarAddQuantityInput(card, priceInput = null) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const explicitCandidates = Array.from(amount.querySelectorAll(
      "input.clear-all, input[placeholder*='qty' i], input[aria-label*='qty' i], input[name*='qty' i], input[name*='quantity' i], input[class*='quantity']"
    ));
    for (const explicit of explicitCandidates) {
      if (explicit === priceInput) continue;
      const rect = explicit.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && explicit.type !== "hidden") return explicit;
    }

    const candidates = bazaarAddInputs(card).filter((input) => input !== priceInput);
    if (!candidates.length) return null;
    const scored = candidates.map((input) => {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.className || ""}`;
      let score = 0;
      if (/qty|quantity|amount|count|clear-all/i.test(metadata)) score += 220;
      if (/price|cost|unit|money/i.test(metadata)) score -= 180;
      const rect = input.getBoundingClientRect();
      return { input, score, left: rect.left };
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
    const nearest = candidatePairs
      .filter(({ card }) => !/price per unit\s*:/i.test(card.textContent || ""))
      .map((pair) => ({ pair, priority: viewportPriority({ card: pair.card }) }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit * 2)
      .map((entry) => entry.pair);

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
          inlineAnchor: controlHost,
          inlineMode: "bazaar-below-controls",
          domTextLength: score
        });
      }
    }

    if (!byCard.size && bazaarAddRouteActive()) return collectSellFormRows();
    return Array.from(byCard.values())
      .sort((a, b) => viewportPriority(b) - viewportPriority(a))
      .slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  // Generic sell-form rows: any small container holding one item image and a
  // visible price/quantity field. Serves the Item Market "add listing" view
  // and is the fallback for the Bazaar add form when Torn's class names
  // change. Rows are shaped like Bazaar add rows so the same renderer and
  // fill controls apply.
  function collectSellFormRows({ root = document, limit = clamp(settings.scanMaxVisibleItems, 1, 50) } = {}) {
    const byCard = new Map();
    const images = Array.from(root.querySelectorAll("img[src*='/items/'], img[srcset*='/items/'], [style*='/items/']"))
      .filter((node) => !node.closest("#market-edge-root,.me-inline-analysis,.me-equip-card"));
    const nearest = images
      .map((node) => ({ node, priority: viewportPriority({ card: node }) }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit * 2);
    for (const { node } of nearest) {
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
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (!input) continue;
        if (/price per unit\s*:/i.test(probe.textContent || "")) break;
        card = probe;
        break;
      }
      if (!card || byCard.has(card)) continue;
      const rect = card.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) continue;
      const quantityCheckbox = findBazaarAddQuantityCheckbox(card);
      const quantityInput = quantityCheckbox ? null : findBazaarAddQuantityInput(card, priceInput);
      // Text nodes joined with spaces: adjacent inline spans ("Xanax" + "x12")
      // must not merge into one token.
      const text = spacedText(card);
      const quantity = parseQuantity(text);
      const maxFromInput = parseIntegerField(quantityInput?.getAttribute("max"));
      const controlHost = priceInput.closest("div[class*='amount___'], div.amount-main-wrap, div[class*='price___'], div[class*='controls'], div[class*='actions']") || priceInput.parentElement || card;
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
        bazaarControls: controlHost,
        inlineAnchor: controlHost,
        inlineMode: "bazaar-below-controls",
        domTextLength: Math.min(text.length, 1200)
      });
    }
    return Array.from(byCard.values()).sort((a, b) => viewportPriority(b) - viewportPriority(a)).slice(0, limit);
  }

  function spacedText(element) {
    if (!element) return "";
    const parts = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (!node.parentElement?.closest?.(".me-inline-analysis,.me-equip-card")) {
        const value = String(node.textContent || "").trim();
        if (value) parts.push(value);
      }
      node = walker.nextNode();
    }
    return parts.join(" ");
  }

  // Torn exposes the copy's uid on some inventory rows; when present the
  // exact copy can be priced through /torn/{uids}/itemdetails without
  // opening its details panel.
  function rowUid(card) {
    if (!card?.getAttribute) return null;
    const read = (element) => {
      for (const attr of Array.from(element.attributes || [])) {
        if (!/uid|armoury|armory/i.test(attr.name)) continue;
        const digits = String(attr.value || "").match(/\d{3,}/);
        if (digits) return asInt(digits[0], 0) || null;
      }
      return null;
    };
    const own = read(card);
    if (own) return own;
    const nodes = card.querySelectorAll("[data-uid],[data-item-uid],[data-itemuid],[data-armoury],[data-armouryid],[data-armoury-id],[uid]");
    for (const node of Array.from(nodes).slice(0, 5)) {
      const value = read(node);
      if (value) return value;
    }
    return null;
  }

  function collectManagedBazaarItems() {
    // Managed listings never appear on the add route, and add rows are
    // recognisable by their amount/price control wrapper. Both guards stop a
    // filled add row from being mistaken for an existing listing.
    if (bazaarAddRouteActive()) return [];
    const candidates = new Set();
    const selector = itemIdentitySelector();
    document.querySelectorAll(selector).forEach((node) => {
      if (!node.closest("#market-edge-root") && !node.closest(".me-inline-analysis,.me-equip-card")) candidates.add(node);
    });

    const byId = new Map();
    for (const node of candidates) {
      const itemId = itemIdFromElement(node);
      if (!itemId) continue;
      const card = findOwnBazaarCard(node);
      if (!card || card.closest("#market-edge-root")) continue;
      if (card.querySelector("div.amount-main-wrap, div[class*='amount___']") || card.closest("ul.items-cont li.clearfix")?.querySelector("div.amount-main-wrap, div[class*='amount___']")) continue;
      const rect = card.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
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
    return Array.from(byId.values()).sort((a, b) => viewportPriority(b) - viewportPriority(a)).slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  // Expanded item-details panels (Bazaar add form, inventory) show the exact
  // copy's quality, damage/accuracy and bonus icons. Each panel is matched to
  // its item id through the panel's own large image or the preceding row.
  function detailsPanelHints(container) {
    const hints = [];
    container.querySelectorAll("[title],[aria-label],img[alt],[class*='bonus'],[class*='rarity'],[class*='yellow'],[class*='orange'],[class*='red']").forEach((node) => {
      if (node.closest(".me-equip-card,#market-edge-root")) return;
      ["title", "aria-label", "alt", "class", "data-bonus", "data-title"].forEach((attr) => {
        const value = node.getAttribute?.(attr);
        if (value) hints.push(String(value));
      });
    });
    return hints;
  }

  const BAZAAR_ADD_ROW_SELECTOR = "ul.items-cont li.clearfix, div[class*='itemsContainner___'] div[class*='item___'], div[class*='rowItems___'] div[class*='item___']";

  // Pricing cards are tracked by the copy key rather than by DOM position:
  // Torn's React stats wrapper may re-render, and the card lives outside it.
  function findDetailCard(detailOrKey) {
    const key = typeof detailOrKey === "string" ? detailOrKey : detailOrKey?.key;
    if (!key) return null;
    return Array.from(document.querySelectorAll(".me-equip-card")).find((card) => card.dataset.meDetailKey === key) || null;
  }

  // Where to put the card: the nearest ancestor of the stats block that is a
  // plain block container (not grid/flex/inline), so the wrapper's layout
  // cannot hide it. Falls back to the panel's parent.
  function detailCardHost(panel) {
    let fallback = panel?.parentElement || null;
    for (let node = panel?.parentElement, depth = 0; node && node !== document.body && depth < 5; depth += 1, node = node.parentElement) {
      let display = "";
      try {
        display = String(window.getComputedStyle(node).display || "");
      } catch {
        display = "";
      }
      if (/^(block|list-item|flow-root|table-cell|table)$/.test(display)) return node;
      if (!display) fallback = node;
    }
    return fallback;
  }

  // Find Torn's item-stats blocks by walking text nodes for "Quality:" and
  // climbing to the innermost element that also holds Damage/Accuracy/Armor.
  // Linear in the number of text nodes, no layout reads except for the few
  // panels found; safe to call from the mutation signature on long lists.
  function findStatsPanels(root) {
    const panels = new Set();
    if (!root || typeof document.createTreeWalker !== "function") return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (/Quality/i.test(node.textContent || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
    });
    let textNode = walker.nextNode();
    while (textNode) {
      let element = textNode.parentElement;
      for (let depth = 0; element && element !== root && depth < 8; depth += 1, element = element.parentElement) {
        if (element.closest("#market-edge-root,.me-equip-card")) break;
        const text = element.textContent || "";
        if (text.length > 2500) break;
        if (QUALITY_PATTERN.test(text) && STATS_PATTERN.test(text)) {
          panels.add(element);
          break;
        }
      }
      textNode = walker.nextNode();
    }
    return Array.from(panels).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function collectExpandedEquipmentDetails(surface, { resolveRows = true } = {}) {
    const results = [];
    // The walker is linear and cheap, so the whole page is scanned; the row
    // association below keeps panels tied to their own item.
    const panels = findStatsPanels(document.body);
    if (!panels.length) return results;

    // Known rows: the add-form rows on the Bazaar, the inventory row cards
    // elsewhere. Torn nests the panel inside the row on the Bazaar add form
    // and places it after the row on the inventory page; both are handled by
    // checking ancestors first, then the previous siblings of the panel's
    // top-level wrapper.
    let knownRows = [];
    if (resolveRows) {
      if (surface === "bazaar") {
        const section = bazaarAddSection();
        knownRows = section ? knownBazaarAddRows(section) : [];
      } else if (surface === "inventory") {
        knownRows = collectVisibleItems({ requireMoney: false }).map((item) => item.card);
      }
    }
    const rowsWithin = (element) => knownRows.filter((known) => element === known || element.contains(known) || known.contains(element));

    panels.forEach((panel) => {
      let row = null;
      if (resolveRows && knownRows.length) {
        // 1) Nested layout: climb until an ancestor holds exactly one known
        //    row card (the expanded row). Stop as soon as several are inside.
        for (let ancestor = panel.parentElement, depth = 0; ancestor && ancestor !== document.body && depth < 12; depth += 1, ancestor = ancestor.parentElement) {
          const contained = rowsWithin(ancestor);
          if (contained.length === 1) {
            row = contained[0];
            break;
          }
          if (contained.length > 1) break;
        }
        // 2) Sibling layout: from the panel's top-level wrapper (the child of
        //    the list holding several rows), look at the rows just before it.
        if (!row) {
          let top = panel;
          while (top.parentElement && top.parentElement !== document.body && rowsWithin(top.parentElement).length <= 1) top = top.parentElement;
          let sibling = top.previousElementSibling;
          for (let depth = 0; sibling && depth < 4 && !row; depth += 1, sibling = sibling.previousElementSibling) {
            const contained = rowsWithin(sibling);
            if (contained.length === 1) row = contained[0];
            else if (contained.length > 1) break;
          }
        }
      }
      if (!row && resolveRows && surface === "inventory") {
        // No known cards nearby (row failed collection): fall back to the
        // nearest preceding element holding a single item id.
        let sibling = panel.closest("li,tr,[role='row']")?.previousElementSibling || null;
        for (let depth = 0; sibling && depth < 4 && !row; depth += 1, sibling = sibling.previousElementSibling) {
          if (directItemIdsWithin(sibling).size === 1) row = sibling;
        }
      }
      // Item id: prefer the row image (unambiguous), then the closest image
      // around the panel (Torn shows a large item image in the details).
      let itemId = null;
      if (row) {
        const rowImage = row.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']");
        itemId = itemIdFromElement(rowImage || row);
      }
      for (let scope = panel.parentElement, depth = 0; !itemId && scope && scope !== document.body && depth < 8; depth += 1, scope = scope.parentElement) {
        const images = Array.from(scope.querySelectorAll("img[src*='/items/'], img[srcset*='/items/'], [style*='/items/']")).filter((node) => !node.closest(".me-equip-card,#market-edge-root"));
        const ids = new Set(images.map((image) => itemIdFromElement(image)).filter(Boolean));
        if (ids.size === 1) itemId = Array.from(ids)[0];
        else if (ids.size > 1) break;
      }
      if (!itemId) return;
      const hintScope = row && row.contains(panel) ? row : (panel.parentElement || panel);
      const copy = parseEquipmentDetailsText(panel.innerText || panel.textContent || "", detailsPanelHints(hintScope));
      if (!copy) return;
      results.push({ itemId, panel, row, copy, key: `${itemId}|${copy.quality}|${copy.damage}|${copy.armor}|${copy.bonuses.map((bonus) => bonus.title).join("+")}|${copy.rarity || ""}` });
    });
    return results;
  }

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
    return combined
      .filter((visible) => {
        if (!visible?.card || seenCards.has(visible.card)) return false;
        seenCards.add(visible.card);
        return true;
      })
      .sort((a, b) => viewportPriority(b) - viewportPriority(a))
      .slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

  // Auction listing id from a row, when Torn exposes it (attributes, ids or
  // links). It must differ from the item id; without it equipment rows fall
  // back to the row's own text for the copy's stats.
  function auctionListingIdFrom(li, itemId) {
    if (!li) return null;
    const candidates = [];
    ["data-listing-id", "data-listingid", "data-auction-id", "data-auctionid", "data-aid", "data-id", "id"].forEach((attr) => {
      const raw = li.getAttribute?.(attr);
      if (raw) candidates.push(raw);
    });
    li.querySelectorAll("a[href*='ID='],a[href*='id='],input[type='hidden'][name*='id' i],[data-listing-id],[data-auction-id],[data-aid]").forEach((node) => {
      const href = node.getAttribute("href") || "";
      const match = href.match(/(?:auctionID|auctionId|aID|listingID|listingId|ID)=(\d+)/i);
      if (match) candidates.push(match[1]);
      ["data-listing-id", "data-auction-id", "data-aid", "value"].forEach((attr) => {
        const raw = node.getAttribute(attr);
        if (raw) candidates.push(raw);
      });
    });
    for (const raw of candidates) {
      const digits = String(raw).match(/\d{3,}/);
      if (!digits) continue;
      const value = asInt(digits[0], 0);
      if (value && value !== itemId) return value;
    }
    return null;
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
      // Torn prints the copy's quality and bonuses inside the row on the
      // Auction House; when present they price the exact copy without a
      // listing request.
      const copyHint = QUALITY_PATTERN.test(text) ? parseEquipmentDetailsText(text, detailsPanelHints(li)) : null;
      rows.push({ itemId, name, price, quantity: 1, card: li, listingId: auctionListingIdFrom(li, itemId), copyHint, domTextLength: text.length });
    });
    return rows.sort((a, b) => viewportPriority(b) - viewportPriority(a)).slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
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
      let card = node.closest("li,tr,[role='row'],[class*='row'],[class*='item___'],[class*='listing']") || findCompactCard(node, false);
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

  const CSS = `
    #market-edge-root { position: fixed; right: 12px; bottom: 12px; z-index: 999998; width: min(370px, calc(100vw - 24px)); font-family: Arial, sans-serif; color: #e9e9e9; }
    #market-edge-root * { box-sizing: border-box; }
    .me-shell { background: rgba(28, 28, 30, .97); border: 1px solid rgba(255,255,255,.13); border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.4); overflow: hidden; }
    .me-header { display:flex; align-items:center; gap:8px; min-height:38px; padding:7px 9px; background:#242426; border-bottom:1px solid rgba(255,255,255,.08); }
    .me-title { font-size:12px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; flex:1; }
    .me-status { font-size:10px; color:#a7a7a7; white-space:nowrap; }
    .me-icon-btn, .me-btn { border:1px solid rgba(255,255,255,.15); background:#343436; color:#eee; border-radius:5px; cursor:pointer; font-size:11px; padding:5px 8px; }
    .me-icon-btn { width:27px; padding:4px 0; text-align:center; }
    .me-icon-btn:hover, .me-btn:hover { background:#414143; }
    .me-body { padding:10px; max-height:min(72vh, 620px); overflow:auto; }
    .me-body[hidden] { display:none; }
    .me-kicker { color:#aaa; text-transform:uppercase; letter-spacing:.08em; font-size:9px; margin-bottom:3px; }
    .me-item-name { font-size:16px; font-weight:700; margin-bottom:9px; }
