from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Version metadata
# ---------------------------------------------------------------------------
p = "src/parts/00.part.js"
s = read(p)
s = replace_once(s, "// @version      0.2.1", "// @version      0.2.2", "userscript metadata version")
s = replace_once(s, '    version: "0.2.1",', '    version: "0.2.2",', "runtime version")
s = replace_once(
    s,
    "  // v0.2.0: SPA-safe incremental scanning, concurrent API loading, persistent\n  // stale-while-revalidate snapshots, batched item metadata, viewport priority\n  // and compact surface-specific inline intelligence.\n",
    "  // v0.2.2: SPA/API hardening plus explicit, user-triggered Bazaar add-form\n  // price suggestions. Market Edge never submits a Bazaar form automatically.\n",
    "version comment",
)
write(p, s)


# ---------------------------------------------------------------------------
# Bazaar add-form DOM discovery.
# ---------------------------------------------------------------------------
p = "src/parts/04.part.js"
s = read(p)
marker = "  function collectOwnBazaarItems() {\n"
insert = r'''  function bazaarAddSection() {
    if (detectSurface() !== "bazaar") return null;
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
      let node = heading;
      let fallback = heading.parentElement;
      for (let depth = 0; node && depth < 9 && node !== document.body; depth += 1, node = node.parentElement) {
        if (!(node instanceof HTMLElement)) continue;
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        if (text.length > 8000) continue;
        if (node.querySelector("input")) fallback = node;
        if (/You are adding\s+\d+\s+items?\s+across\s+\d+\s+categor/i.test(text) && /ADD TO BAZAAR/i.test(text) && node.querySelector("input")) {
          return node;
        }
      }
      if (fallback?.querySelector?.("input")) return fallback;
    }
    return null;
  }

  function findBazaarAddRow(start, section) {
    if (!start || !section) return null;
    let node = start instanceof HTMLElement ? start : start.parentElement;
    let fallback = null;
    for (let depth = 0; node && depth < 9 && node !== section.parentElement; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement) || !section.contains(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.height > 140) continue;
      const text = (node.innerText || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 300) continue;
      const ids = directItemIdsWithin(node);
      if (ids.size !== 1) continue;
      const visibleInputs = Array.from(node.querySelectorAll("input")).filter((input) => {
        const inputRect = input.getBoundingClientRect();
        return inputRect.width > 0 && inputRect.height > 0 && input.type !== "hidden";
      });
      if (!visibleInputs.length) continue;
      fallback = node;
      if (/^(?:x|\u00d7)\s*[\d,]+\s+\S+/i.test(text) || /\bQty\b/i.test(text)) return node;
      if (node.matches("li,tr,[role='row'],[class*='row'],[class*='item']")) return node;
    }
    return fallback;
  }

  function findBazaarAddPriceInput(card) {
    if (!card) return null;
    const candidates = Array.from(card.querySelectorAll("input")).filter((input) => {
      const rect = input.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !["hidden", "checkbox", "radio"].includes(input.type);
    });
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const scored = candidates.map((input) => {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.className || ""}`;
      let score = 0;
      if (/price|cost|unit/i.test(metadata)) score += 120;
      if (/qty|quantity|amount|count/i.test(metadata)) score -= 180;
      const rect = input.getBoundingClientRect();
      return { input, score, left: rect.left };
    });
    scored.sort((a, b) => b.score - a.score || b.left - a.left);
    return scored[0]?.input || null;
  }

  function collectBazaarAddItems() {
    const section = bazaarAddSection();
    if (!section) return [];

    const byCard = new Map();
    section.querySelectorAll(itemIdentitySelector()).forEach((node) => {
      if (node.closest("#market-edge-root,.me-inline-analysis")) return;
      const itemId = itemIdFromElement(node);
      if (!itemId) return;
      const card = findBazaarAddRow(node, section);
      if (!card || card.closest("#market-edge-root")) return;
      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) return;
      const text = card.innerText || "";
      const quantity = parseQuantity(text);
      const name = elementItemName(card, node);
      const key = card;
      const existing = byCard.get(key);
      const score = Math.min(text.length, 1000);
      if (!existing || score < existing.domTextLength) {
        byCard.set(key, {
          itemId,
          name,
          price: parseIntegerField(priceInput.value) || 0,
          quantity,
          card,
          priceInput,
          bazaarAdd: true,
          inlineAnchor: findItemTextHost(card, name),
          inlineMode: "inline",
          domTextLength: score
        });
      }
    });

    return Array.from(byCard.values())
      .sort((a, b) => viewportPriority(b) - viewportPriority(a))
      .slice(0, clamp(settings.scanMaxVisibleItems, 1, 50));
  }

'''
s = replace_once(s, marker, insert + "  function collectManagedBazaarItems() {\n", "Bazaar managed collector rename/insertion")

auction_marker = "  function collectAuctionItems() {\n"
wrapper = r'''  function collectOwnBazaarItems() {
    const combined = [...collectManagedBazaarItems(), ...collectBazaarAddItems()];
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

'''
s = replace_once(s, auction_marker, wrapper + auction_marker, "Bazaar collector wrapper")
write(p, s)


# ---------------------------------------------------------------------------
# Compact interactive UI for the add-to-Bazaar form.
# ---------------------------------------------------------------------------
p = "src/parts/05.part.js"
s = read(p)
css_marker = "    .me-inline-analysis.me-loading { opacity:.65 !important; font-weight:400 !important; }\n"
css = r'''    .me-inline-analysis.me-bazaar-add { pointer-events:auto !important; padding-right:3px !important; }
    .me-bazaar-fill-btn { display:inline-flex !important; align-items:center !important; justify-content:center !important; min-width:25px !important; height:22px !important; margin:0 0 0 2px !important; padding:0 7px !important; border:1px solid rgba(255,255,255,.24) !important; border-radius:4px !important; background:rgba(255,255,255,.08) !important; color:#eee !important; font:800 13px/1 Arial,sans-serif !important; cursor:pointer !important; pointer-events:auto !important; touch-action:manipulation !important; }
    .me-bazaar-fill-btn:hover, .me-bazaar-fill-btn:focus { background:rgba(255,255,255,.16) !important; border-color:rgba(255,255,255,.4) !important; outline:none !important; }
    .me-inline-analysis.me-bazaar-add.me-applied { border-color:rgba(74,165,100,.65) !important; }
'''
s = replace_once(s, css_marker, css_marker + css, "Bazaar add CSS")
write(p, s)


# ---------------------------------------------------------------------------
# Render suggested price and only fill the input after an explicit arrow tap.
# ---------------------------------------------------------------------------
p = "src/parts/06.part.js"
s = read(p)
render_marker = "  function renderInlineResult(surface, result, ownBazaar) {\n"
helpers = r'''  function setBazaarPriceInput(input, value) {
    if (!(input instanceof HTMLInputElement)) return false;
    const target = Math.max(1, asInt(value));
    if (!target) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, String(target));
    else input.value = String(target);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return parseIntegerField(input.value) === target;
  }

  function renderBazaarAddSuggestion(result) {
    const visible = result.visible;
    const target = result?.ownBazaar?.target;
    const stale = staleMarker(result);
    if (!Number.isFinite(target) || target <= 0) {
      return renderInlineHtml(
        visible,
        `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">price unavailable</span>${stale}`,
        "GREY"
      );
    }

    const targetText = formatMoney(target);
    const block = renderInlineHtml(
      visible,
      `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Suggested Bazaar selling price">${targetText}</span><button class="me-bazaar-fill-btn" type="button" aria-label="Set Bazaar price to ${escapeHtml(targetText)}" title="Fill Torn price field with ${escapeHtml(targetText)}">&gt;</button>${stale}`,
      "GREY",
      "me-bazaar-add"
    );
    const button = block?.querySelector?.(".me-bazaar-fill-btn");
    if (!button || !visible.priceInput) return block;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!visible.priceInput?.isConnected) return;
      if (!setBazaarPriceInput(visible.priceInput, target)) return;
      visible.price = target;
      block.classList.add("me-applied");
      button.title = `Price filled with ${targetText}`;
      setTimeout(() => block?.classList?.remove("me-applied"), 700);
    });
    return block;
  }

'''
s = replace_once(s, render_marker, helpers + render_marker, "Bazaar add rendering helpers")
unsupported_marker = '''    if (result.unsupported) {
      return renderInlineHtml(visible, `<span class="me-inline-brand">ME</span><span class="me-inline-secondary">unsupported equipment</span>`, "GREY");
    }

'''
unsupported_new = unsupported_marker + '''    if (surface === "bazaar" && ownBazaar && visible.bazaarAdd) {
      return renderBazaarAddSuggestion(result);
    }

'''
s = replace_once(s, unsupported_marker, unsupported_new, "Bazaar add render routing")
write(p, s)


# ---------------------------------------------------------------------------
# Regression guard coverage.
# ---------------------------------------------------------------------------
p = "tests/economics.test.js"
s = read(p)
test_marker = 'test("hardening guards remain present in the assembled userscript", () => {\n'
new_test = r'''test("Bazaar add form suggestion is explicit and user-triggered", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "torn-market-edge.user.js"), "utf8");
  assert.ok(source.includes("function collectBazaarAddItems()"));
  assert.ok(source.includes("function findBazaarAddPriceInput(card)"));
  assert.ok(source.includes("function setBazaarPriceInput(input, value)"));
  assert.ok(source.includes("me-bazaar-fill-btn"));
  assert.ok(source.includes('dispatchEvent(new Event("input", { bubbles: true, composed: true }))'));
  assert.ok(source.includes('dispatchEvent(new Event("change", { bubbles: true, composed: true }))'));
  assert.ok(source.includes("Market Edge never submits a Bazaar form automatically"));
});

'''
s = replace_once(s, test_marker, new_test + test_marker, "Bazaar add regression test")
write(p, s)


# ---------------------------------------------------------------------------
# Changelog
# ---------------------------------------------------------------------------
p = "CHANGELOG.md"
s = read(p)
changelog_marker = "## [Unreleased]\n\n"
release = """## [Unreleased]\n\n## [0.2.2] - 2026-09-08\n\n### Added\n\n- Support the **Add items to your Bazaar** composer.\n- Show a compact Market Edge suggested Bazaar selling price beside each addable item.\n- Add an explicit `>` control that fills Torn's price field with the suggestion without selecting quantity or submitting the Bazaar form.\n\n### Changed\n\n- Bazaar add-form price inputs are detected defensively, preferring price-labelled or rightmost numeric fields while avoiding quantity fields.\n- React-controlled Torn price inputs are updated through the native input setter plus `input` and `change` events for reliable mobile/desktop behavior.\n\n"""
s = replace_once(s, changelog_marker, release, "v0.2.2 changelog")
write(p, s)

print("v0.2.2 Bazaar add-form patch applied")
