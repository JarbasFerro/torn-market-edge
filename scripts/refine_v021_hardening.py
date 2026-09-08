from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one patch target for {label}, found {count}")
    return text.replace(old, new, 1)


# Require the full recommended prefix (price and quantity) to agree with the
# visible page before attaching listing-level badges.
p = "src/parts/06.part.js"
s = read(p)
old = '''      const liveRows = parseLiveItemMarketListings();
      const compareCount = Math.min(5, liveRows.length, snapshot.listings.length);
      const liveMatchesApi = compareCount >= 2 && Array.from({ length: compareCount }, (_, index) => (
        liveRows[index]?.price === snapshot.listings[index]?.price
      )).every(Boolean);
      const liveConfirmation = liveRows.length < 2
        ? "API"
        : (liveMatchesApi ? "PAGE MATCHES API" : "API - PAGE DIFFERS");

      // The official Torn API is the authoritative valuation source. The live
      // DOM is used only to confirm/highlight what the player currently sees.
      const evaluated = evaluatePrefixes(snapshot, historyStats, settings);
      const best = evaluated.best;'''
new = '''      const liveRows = parseLiveItemMarketListings();

      // The official Torn API is the authoritative valuation source. The live
      // DOM is used only to confirm/highlight what the player currently sees.
      const evaluated = evaluatePrefixes(snapshot, historyStats, settings);
      const best = evaluated.best;
      const compareCount = Math.max(2, best?.prefixCount || Math.min(5, snapshot.listings.length));
      const liveMatchesApi = liveRows.length >= compareCount && snapshot.listings.length >= compareCount &&
        Array.from({ length: compareCount }, (_, index) => (
          liveRows[index]?.price === snapshot.listings[index]?.price &&
          liveRows[index]?.quantity === snapshot.listings[index]?.quantity
        )).every(Boolean);
      const liveConfirmation = liveRows.length < 2
        ? "API"
        : (liveMatchesApi ? "PAGE MATCHES API" : "API - PAGE DIFFERS");'''
s = replace_once(s, old, new, "full Item Market prefix confirmation")
s = replace_once(
    s,
    '        <div class="me-note">Facts: visible/API asks and 5% Item Market fee. Local data: observed anchors. Exit, profit and confidence are estimates - not guarantees.</div>',
    '        <div class="me-note">Facts: official API asks and 5% Item Market fee. The visible page is used only for confirmation/highlighting. Local data: observed anchors. Exit, profit and confidence are estimates - not guarantees.</div>',
    "Item Market source wording",
)
write(p, s)

# Track the identity-bearing DOM element itself. This is stable across our own
# annotation changes and changes whenever Torn remounts the item structure.
p = "src/parts/07.part.js"
s = read(p)
s = replace_once(
    s,
    '      entries.add(`${itemId}@${listRowIdentity(card)}`);',
    '      entries.add(`${itemId}@${listRowIdentity(node)}`);',
    "SPA identity node",
)
write(p, s)

# Strengthen static guard coverage for these two conservative refinements.
p = "tests/economics.test.js"
s = read(p)
s = replace_once(
    s,
    '''  assert.match(source, /liveMatchesApi/);
  assert.doesNotMatch(source, /evaluatePrefixes\\(analysisSnapshot/);''',
    '''  assert.match(source, /liveMatchesApi/);
  assert.match(source, /listRowIdentity\\(node\\)/);
  assert.match(source, /liveRows\\[index\\]\\?\\.quantity === snapshot\\.listings\\[index\\]\\?\\.quantity/);
  assert.doesNotMatch(source, /evaluatePrefixes\\(analysisSnapshot/);''',
    "hardening guard assertions",
)
write(p, s)

print("v0.2.1 conservative refinements applied")
