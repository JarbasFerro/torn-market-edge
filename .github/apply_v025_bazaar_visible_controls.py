from pathlib import Path
import re

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
s = replace_once(s, "// @version      0.2.4", "// @version      0.2.5", "metadata version")
s = replace_once(s, '    version: "0.2.4",', '    version: "0.2.5",', "runtime version")
s = re.sub(
    r"  // v0\.2\.4: Bazaar add-form detection follows Torn's current desktop/mobile\n"
    r"  // item containers directly, with the older heading heuristic retained as a\n"
    r"  // fallback\. Price/quantity filling remains explicitly user-triggered\.\n",
    "  // v0.2.5: Bazaar add controls use Torn's visible description/title host so\n"
    "  // mobile ellipsis clipping cannot hide them, and Qty checkbox controls are\n"
    "  // supported alongside normal quantity inputs.\n",
    s,
    count=1,
)
write(p, s)


# Bazaar add controls: scope price detection, support checkbox Qty, and use a visible host.
p = "src/parts/04.part.js"
s = read(p)

old_price = '''  function findBazaarAddPriceInput(card) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const explicit = amount.querySelector(
      "div[class*='price___'] input.input-money, div[class*='price___'] input, div.price input.input-money, div.price input, input.input-money, input[name*='price' i]"
    );
    if (explicit) {
      const rect = explicit.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && explicit.type !== "hidden") return explicit;
    }

    const candidates = bazaarAddInputs(card);
'''
new_price = '''  function findBazaarAddPriceInput(card) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const priceWrap = amount.querySelector("div[class*='price___'], div.price");
    const explicit = priceWrap?.querySelector("input.input-money, input") || amount.querySelector("input[name*='price' i]");
    if (explicit) {
      const rect = explicit.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && explicit.type !== "hidden") return explicit;
    }

    const candidates = bazaarAddInputs(card);
'''
s = replace_once(s, old_price, new_price, "scoped Bazaar price input")

needle = '''  function findBazaarAddQuantityInput(card, priceInput = null) {
'''
insert = '''  function findBazaarAddQuantityCheckbox(card) {
    if (!card) return null;
    const amount = card.querySelector("div[class*='amount___'], div.amount-main-wrap") || card;
    const control = amount.querySelector("div.choice-container, [class*='choiceContainer___']");
    const checkbox = control?.querySelector?.("input[type='checkbox'], input");
    if (!(checkbox instanceof HTMLInputElement)) return null;
    const rect = control.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? checkbox : null;
  }

''' + needle
s = replace_once(s, needle, insert, "quantity checkbox detector")

old_collect = '''      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) continue;
      const quantityInput = findBazaarAddQuantityInput(card, priceInput);
      const title = card.querySelector("div[class*='name___'], div.title-wrap");
      const text = `${title?.innerText || ""} ${card.innerText || ""}`.trim();
      const quantity = parseQuantity(text);
      const maxFromInput = parseIntegerField(quantityInput?.getAttribute("max"));
      const maxAvailable = Math.max(1, Math.min(quantity, maxFromInput || quantity));
      const name = elementItemName(card, node);
      const score = Math.min(text.length, 1200);
'''
new_collect = '''      const priceInput = findBazaarAddPriceInput(card);
      if (!priceInput) continue;
      const quantityCheckbox = findBazaarAddQuantityCheckbox(card);
      const quantityInput = quantityCheckbox ? null : findBazaarAddQuantityInput(card, priceInput);
      const title = card.querySelector("div[class*='name___'], div.title-wrap");
      const controlHost = card.querySelector("div[class*='description___'], div.title-wrap") || title || findItemTextHost(card, elementItemName(card, node));
      const text = `${title?.innerText || ""} ${card.innerText || ""}`.trim();
      const quantity = parseQuantity(text);
      const maxFromInput = parseIntegerField(quantityInput?.getAttribute("max"));
      const maxAvailable = Math.max(1, Math.min(quantity, maxFromInput || quantity));
      const name = elementItemName(card, node);
      const score = Math.min(text.length, 1200);
'''
s = replace_once(s, old_collect, new_collect, "Bazaar visible control host")

old_obj = '''          priceInput,
          quantityInput,
          bazaarAdd: true,
          inlineAnchor: findItemTextHost(card, name),
'''
new_obj = '''          priceInput,
          quantityInput,
          quantityCheckbox,
          bazaarAdd: true,
          inlineAnchor: controlHost || findItemTextHost(card, name),
'''
s = replace_once(s, old_obj, new_obj, "Bazaar checkbox and host fields")
write(p, s)


# Make the Bazaar title/description host flex like Torn Bazaar Quick Pricer does.
p = "src/parts/05.part.js"
s = read(p)
css_needle = '''    .me-inline-analysis.me-bazaar-add { pointer-events:auto !important; padding-right:3px !important; }
'''
css_repl = '''    .me-bazaar-add-host { display:flex !important; align-items:center !important; min-width:0 !important; overflow:visible !important; }
    .me-bazaar-add-host > .me-inline-analysis { flex:0 0 auto !important; flex-shrink:0 !important; margin-left:auto !important; z-index:10 !important; }
    .me-inline-analysis.me-bazaar-add { pointer-events:auto !important; padding-right:3px !important; }
'''
s = replace_once(s, css_needle, css_repl, "Bazaar host CSS")

host_old = '''  function inlineHostFor(visible) {
    const anchor = visible?.inlineAnchor;
    if (anchor?.isConnected) return { mode: "append", node: anchor };
'''
host_new = '''  function inlineHostFor(visible) {
    const anchor = visible?.inlineAnchor;
    if (anchor?.isConnected) {
      if (visible?.bazaarAdd) anchor.classList?.add("me-bazaar-add-host");
      return { mode: "append", node: anchor };
    }
'''
s = replace_once(s, host_old, host_new, "Bazaar host class")
write(p, s)


# Fill Torn's checkbox-style Qty control when present.
p = "src/parts/06.part.js"
s = read(p)
old_click = '''      const priceFilled = setBazaarInputValue(visible.priceInput, target);
      const maxAvailable = Math.max(1, asInt(visible.maxAvailable || visible.quantity, 1));
      const quantityFilled = visible.quantityInput?.isConnected
        ? setBazaarInputValue(visible.quantityInput, maxAvailable)
        : false;
      if (!priceFilled) return;
'''
new_click = '''      const priceFilled = setBazaarInputValue(visible.priceInput, target);
      const maxAvailable = Math.max(1, asInt(visible.maxAvailable || visible.quantity, 1));
      let quantityFilled = false;
      if (visible.quantityCheckbox?.isConnected) {
        if (!visible.quantityCheckbox.checked) visible.quantityCheckbox.click();
        quantityFilled = Boolean(visible.quantityCheckbox.checked);
      } else if (visible.quantityInput?.isConnected) {
        quantityFilled = setBazaarInputValue(visible.quantityInput, maxAvailable);
        visible.quantityInput.dispatchEvent(new Event("keyup", { bubbles: true, composed: true }));
      }
      if (!priceFilled) return;
'''
s = replace_once(s, old_click, new_click, "Bazaar Qty checkbox fill")
write(p, s)


# Make the SPA signature directly see Bazaar add rows, even if generic item identity changes.
p = "src/parts/07.part.js"
s = read(p)
old_sig = '''    const entries = new Set();
    const marker = surface === "inventory" ? inventoryListMarker() : null;
    document.querySelectorAll(itemIdentitySelector()).forEach((node) => {
'''
new_sig = '''    const entries = new Set();
    const marker = surface === "inventory" ? inventoryListMarker() : null;
    if (surface === "bazaar") {
      const addSection = bazaarAddSection();
      knownBazaarAddRows(addSection).forEach((card) => {
        const image = card.querySelector("div.image-wrap img, img[src*='/items/'], img[srcset*='/items/']");
        const itemId = itemIdFromElement(image || card);
        if (itemId) entries.add(`${itemId}@${listRowIdentity(card)}`);
      });
    }
    document.querySelectorAll(itemIdentitySelector()).forEach((node) => {
'''
s = replace_once(s, old_sig, new_sig, "Bazaar direct SPA signature")
write(p, s)


# Regression guards.
p = "tests/economics.test.js"
s = read(p)
needle = '  assert.ok(source.includes("input.clear-all"));\n'
addition = needle + (
    '  assert.ok(source.includes("function findBazaarAddQuantityCheckbox(card)"));\n'
    '  assert.ok(source.includes("choiceContainer___"));\n'
    '  assert.ok(source.includes("me-bazaar-add-host"));\n'
    '  assert.ok(source.includes("visible.quantityCheckbox.checked"));\n'
    '  assert.ok(source.includes("knownBazaarAddRows(addSection)"));\n'
)
s = replace_once(s, needle, addition, "v0.2.5 Bazaar guards")
write(p, s)


# Changelog.
p = "CHANGELOG.md"
s = read(p)
marker = "## [Unreleased]\n\n"
release = """## [Unreleased]\n\n## [0.2.5] - 2026-09-08\n\n### Fixed\n\n- Bazaar add-form Market Edge controls now render in Torn's description/title container instead of the ellipsis-clipped item-name text host, so the suggestion and `>` button stay visible on mobile.\n- The `>` action now supports Torn's checkbox-style `Qty` control (select-max behavior) as well as normal quantity inputs.\n- Bazaar add rows are included directly in the SPA signature so late-rendered/remounted rows trigger analysis even if Torn changes generic item-identity markup.\n- Price-input detection is scoped to Torn's price wrapper before falling back to heuristic input scoring.\n\n"""
s = replace_once(s, marker, release, "v0.2.5 changelog")
write(p, s)

print("v0.2.5 Bazaar visible-controls patch applied")
