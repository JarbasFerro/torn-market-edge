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
s = replace_once(s, "// @version      0.2.5", "// @version      0.2.6", "metadata version")
s = replace_once(s, '    version: "0.2.5",', '    version: "0.2.6",', "runtime version")
s = replace_once(
    s,
    "  // v0.2.5: Bazaar add controls use Torn's visible description/title host so\n"
    "  // mobile ellipsis clipping cannot hide them, and Qty checkbox controls are\n"
    "  // supported alongside normal quantity inputs.\n",
    "  // v0.2.6: Bazaar add intelligence occupies a dedicated second line below\n"
    "  // Torn's Qty/price controls, preserving the full item-name area. The explicit\n"
    "  // fill control uses ^ and still never submits the Bazaar form.\n",
    "version note",
)
write(p, s)


# Move Bazaar add UI host from the item-name/description area to the Qty/price controls.
p = "src/parts/04.part.js"
s = read(p)
s = replace_once(
    s,
    '      const controlHost = card.querySelector("div[class*=\'description___\'], div.title-wrap") || title || findItemTextHost(card, elementItemName(card, node));\n',
    '      const controlHost = card.querySelector("div[class*=\'amount___\'], div.amount-main-wrap") || card;\n',
    "Bazaar second-line host",
)
s = replace_once(
    s,
    '          bazaarAdd: true,\n          inlineAnchor: controlHost || findItemTextHost(card, name),\n          inlineMode: "inline",\n',
    '          bazaarAdd: true,\n          bazaarControls: controlHost,\n          inlineAnchor: controlHost,\n          inlineMode: "bazaar-below-controls",\n',
    "Bazaar host metadata",
)
# Allow the intentionally taller rows to remain detectable on subsequent SPA passes.
s = s.replace('rect.height > 220', 'rect.height > 300')
s = s.replace('rect.height > 180', 'rect.height > 280')
write(p, s)


# Layout the Market Edge block as a full-width second line beneath Torn controls.
p = "src/parts/05.part.js"
s = read(p)
s = replace_once(
    s,
    '    .me-bazaar-add-host { display:flex !important; align-items:center !important; min-width:0 !important; overflow:visible !important; }\n'
    '    .me-bazaar-add-host > .me-inline-analysis { flex:0 0 auto !important; flex-shrink:0 !important; margin-left:auto !important; z-index:10 !important; }\n',
    '    .me-bazaar-add-row { height:auto !important; min-height:72px !important; overflow:visible !important; }\n'
    '    .me-bazaar-add-controls { flex-wrap:wrap !important; overflow:visible !important; }\n'
    '    .me-bazaar-add-controls > .me-inline-analysis { display:flex !important; flex:0 0 100% !important; width:100% !important; max-width:none !important; grid-column:1 / -1 !important; justify-content:flex-end !important; margin:4px 0 1px !important; z-index:10 !important; }\n',
    "Bazaar second-line CSS",
)
s = replace_once(
    s,
    '  function clearInlineAnalysis() {\n    document.querySelectorAll(".me-inline-analysis").forEach((node) => node.remove());\n  }\n',
    '  function clearInlineAnalysis() {\n    document.querySelectorAll(".me-inline-analysis").forEach((node) => node.remove());\n    document.querySelectorAll(".me-bazaar-add-controls,.me-bazaar-add-host").forEach((node) => {\n      node.classList.remove("me-bazaar-add-controls", "me-bazaar-add-host");\n    });\n    document.querySelectorAll(".me-bazaar-add-row").forEach((node) => node.classList.remove("me-bazaar-add-row"));\n  }\n',
    "Bazaar layout cleanup",
)
s = replace_once(
    s,
    '  function inlineHostFor(visible) {\n    const anchor = visible?.inlineAnchor;\n    if (anchor?.isConnected) {\n      if (visible?.bazaarAdd) anchor.classList?.add("me-bazaar-add-host");\n      return { mode: "append", node: anchor };\n    }\n    if (visible?.card?.isConnected) return { mode: "append", node: visible.card };\n    return null;\n  }\n',
    '  function inlineHostFor(visible) {\n    if (visible?.bazaarAdd) {\n      const controls = visible?.bazaarControls || visible?.inlineAnchor;\n      if (controls?.isConnected) {\n        controls.classList?.add("me-bazaar-add-controls");\n        visible.card?.classList?.add("me-bazaar-add-row");\n        return { mode: "append", node: controls };\n      }\n    }\n    const anchor = visible?.inlineAnchor;\n    if (anchor?.isConnected) return { mode: "append", node: anchor };\n    if (visible?.card?.isConnected) return { mode: "append", node: visible.card };\n    return null;\n  }\n',
    "Bazaar second-line host routing",
)
write(p, s)


# Use ^ for the explicit fill action.
p = "src/parts/06.part.js"
s = read(p)
s = replace_once(
    s,
    'title="Fill price with ${escapeHtml(targetText)} and quantity with max available">&gt;</button>${stale}`',
    'title="Fill price with ${escapeHtml(targetText)} and quantity with max available">^</button>${stale}`',
    "Bazaar fill button character",
)
write(p, s)


# Regression guards.
p = "tests/economics.test.js"
s = read(p)
s = replace_once(s, '  assert.ok(source.includes("me-bazaar-add-host"));\n', '  assert.ok(source.includes("me-bazaar-add-controls"));\n  assert.ok(source.includes("me-bazaar-add-row"));\n  assert.ok(source.includes("bazaar-below-controls"));\n  assert.ok(source.includes("flex:0 0 100%"));\n  assert.ok(source.includes("grid-column:1 / -1"));\n  assert.ok(source.includes(">^</button>"));\n', "Bazaar second-line test guards")
write(p, s)


# Changelog.
p = "CHANGELOG.md"
s = read(p)
marker = "## [Unreleased]\n"
entry = """## [Unreleased]\n\n## [0.2.6] - 2026-09-08\n\n### Changed\n\n- Bazaar add-form intelligence now uses a dedicated second line below Torn's `Qty` and price controls, leaving the item-name cell untouched.\n- Bazaar add rows expand vertically as needed so the Market Edge suggestion does not compete with or truncate Torn's native fields.\n- The explicit fill button now uses `^` instead of `>`.\n- The `^` action still fills the suggested price and maximum available quantity only; **ADD TO BAZAAR** remains manual.\n"""
s = replace_once(s, marker, entry, "changelog")
write(p, s)

print("v0.2.6 Bazaar second-line UI patch applied")
