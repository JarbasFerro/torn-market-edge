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


# Version metadata.
p = "src/parts/00.part.js"
s = read(p)
s = replace_once(s, "// @version      0.2.2", "// @version      0.2.3", "metadata version")
s = replace_once(s, '    version: "0.2.2",', '    version: "0.2.3",', "runtime version")
s = replace_once(
    s,
    "  // v0.2.2: SPA/API hardening plus explicit, user-triggered Bazaar add-form\n  // price suggestions. Market Edge never submits a Bazaar form automatically.\n",
    "  // v0.2.3: Bazaar add-form suggestions can explicitly fill both the\n  // suggested price and the player's maximum available quantity. Market Edge\n  // never submits a Bazaar form automatically.\n",
    "version comment",
)
write(p, s)


# Detect the quantity field separately from the price field.
p = "src/parts/04.part.js"
s = read(p)
price_function = r'''  function findBazaarAddPriceInput(card) {
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

'''
replacement = price_function + r'''  function findBazaarAddQuantityInput(card, priceInput = null) {
    if (!card) return null;
    const candidates = Array.from(card.querySelectorAll("input")).filter((input) => {
      if (input === priceInput) return false;
      const rect = input.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !["hidden", "checkbox", "radio"].includes(input.type);
    });
    if (!candidates.length) return null;

    const scored = candidates.map((input) => {
      const metadata = `${input.name || ""} ${input.id || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("placeholder") || ""} ${input.className || ""}`;
      let score = 0;
      if (/qty|quantity|amount|count/i.test(metadata)) score += 180;
      if (/price|cost|unit/i.test(metadata)) score -= 140;
      const rect = input.getBoundingClientRect();
      return { input, score, left: rect.left };
    });
    scored.sort((a, b) => b.score - a.score || a.left - b.left);
    return scored[0]?.input || null;
  }

'''
s = replace_once(s, price_function, replacement, "quantity input detector")

collector_old = '''      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) return;
      const text = card.innerText || "";
      const quantity = parseQuantity(text);
      const name = elementItemName(card, node);
'''
collector_new = '''      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) return;
      const quantityInput = findBazaarAddQuantityInput(card, priceInput);
      const text = card.innerText || "";
      const quantity = parseQuantity(text);
      const maxFromInput = parseIntegerField(quantityInput?.getAttribute("max"));
      const maxAvailable = Math.max(1, Math.min(quantity, maxFromInput || quantity));
      const name = elementItemName(card, node);
'''
s = replace_once(s, collector_old, collector_new, "collector quantity detection")

object_old = '''          quantity,
          card,
          priceInput,
          bazaarAdd: true,
'''
object_new = '''          quantity,
          maxAvailable,
          card,
          priceInput,
          quantityInput,
          bazaarAdd: true,
'''
s = replace_once(s, object_old, object_new, "collector quantity fields")
write(p, s)


# Fill both price and quantity from the explicit arrow click.
p = "src/parts/06.part.js"
s = read(p)
old_setter = r'''  function setBazaarPriceInput(input, value) {
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

'''
new_setter = r'''  function setBazaarInputValue(input, value) {
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

'''
s = replace_once(s, old_setter, new_setter, "generic controlled input setter")

button_html_old = '''      `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Suggested Bazaar selling price">${targetText}</span><button class="me-bazaar-fill-btn" type="button" aria-label="Set Bazaar price to ${escapeHtml(targetText)}" title="Fill Torn price field with ${escapeHtml(targetText)}">&gt;</button>${stale}`,
'''
button_html_new = '''      `<span class="me-inline-brand">ME</span><span class="me-inline-primary" title="Suggested Bazaar selling price">${targetText}</span><button class="me-bazaar-fill-btn" type="button" aria-label="Fill Bazaar price and maximum quantity" title="Fill price with ${escapeHtml(targetText)} and quantity with max available">&gt;</button>${stale}`,
'''
s = replace_once(s, button_html_old, button_html_new, "arrow copy")

click_old = '''      if (!visible.priceInput?.isConnected) return;
      if (!setBazaarPriceInput(visible.priceInput, target)) return;
      visible.price = target;
      block.classList.add("me-applied");
      button.title = `Price filled with ${targetText}`;
      setTimeout(() => block?.classList?.remove("me-applied"), 700);
'''
click_new = '''      if (!visible.priceInput?.isConnected) return;
      const priceFilled = setBazaarInputValue(visible.priceInput, target);
      const maxAvailable = Math.max(1, asInt(visible.maxAvailable || visible.quantity, 1));
      const quantityFilled = visible.quantityInput?.isConnected
        ? setBazaarInputValue(visible.quantityInput, maxAvailable)
        : false;
      if (!priceFilled) return;
      visible.price = target;
      block.classList.add("me-applied");
      button.title = quantityFilled
        ? `Filled ${maxAvailable} units at ${targetText}`
        : `Price filled with ${targetText}; quantity field was not detected`;
      setTimeout(() => block?.classList?.remove("me-applied"), 700);
'''
s = replace_once(s, click_old, click_new, "fill price and max quantity")
write(p, s)


# Update tests.
p = "tests/economics.test.js"
s = read(p)
s = replace_once(
    s,
    '  assert.ok(source.includes("function setBazaarPriceInput(input, value)"));\n',
    '  assert.ok(source.includes("function setBazaarInputValue(input, value)"));\n  assert.ok(source.includes("function findBazaarAddQuantityInput(card, priceInput = null)"));\n  assert.ok(source.includes("visible.maxAvailable || visible.quantity"));\n',
    "Bazaar add guard tests",
)
write(p, s)


# Changelog.
p = "CHANGELOG.md"
s = read(p)
marker = "## [Unreleased]\n\n"
release = """## [Unreleased]\n\n## [0.2.3] - 2026-09-08\n\n### Changed\n\n- The `>` action in **Add items to your Bazaar** now fills both the suggested selling price and the maximum available quantity for that item.\n- Quantity input detection prefers `Qty`/quantity-labelled fields and uses the row's visible `xN` stock as the maximum, respecting a smaller native input `max` when Torn provides one.\n- The final **ADD TO BAZAAR** action remains manual; Market Edge only fills fields after the user's explicit tap.\n\n"""
s = replace_once(s, marker, release, "v0.2.3 changelog")
write(p, s)

print("v0.2.3 Bazaar max-quantity patch applied")
