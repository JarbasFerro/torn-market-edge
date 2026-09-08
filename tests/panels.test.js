"use strict";

// End-to-end panel smoke tests in jsdom with a stubbed Torn API. They make
// sure the Item Market, equipment, own-listings and watchlist code paths run
// without throwing and render the expected facts.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM = null;
try {
  ({ JSDOM } = require("jsdom"));
} catch {
  JSDOM = null;
}

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "torn-market-edge.user.js"), "utf8");
const run = JSDOM ? test : test.skip;

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

const NOW = Math.floor(Date.now() / 1000);

function xanaxBook() {
  return {
    itemmarket: {
      item: { id: 206, name: "Xanax", type: "Drug", average_price: 840000 },
      listings: [
        { price: 790000, amount: 2 },
        { price: 835000, amount: 20 },
        { price: 836000, amount: 15 },
        { price: 838000, amount: 30 },
        { price: 840000, amount: 50 },
        { price: 845000, amount: 40 },
      ],
      cache_timestamp: NOW - 5,
      cache_delay: 30,
    },
    _metadata: { total: 6, links: { next: null, prev: null } },
  };
}

function rifleBook() {
  const plain = (price, quality, uid) => ({ price, amount: 1, item_details: { uid, stats: { damage: 60, accuracy: 55, armor: null, quality }, bonuses: [], rarity: null } });
  return {
    itemmarket: {
      item: { id: 1, name: "Fixture Rifle", type: "Weapon", average_price: 1000000 },
      listings: [
        plain(800000, 50, 1), plain(1000000, 52, 2), plain(1020000, 49, 3), plain(1050000, 51, 4), plain(1100000, 53, 5),
        { price: 9000000, amount: 1, item_details: { uid: 6, stats: { damage: 70, accuracy: 60, armor: null, quality: 90 }, bonuses: [{ id: 1, title: "Bleed", description: "", value: 15 }], rarity: "orange" } },
      ],
      cache_timestamp: NOW - 5,
      cache_delay: 30,
    },
    _metadata: { total: 6 },
  };
}

function responder(url) {
  if (url.includes("/market/206/itemmarket")) return xanaxBook();
  if (url.includes("/market/1/itemmarket")) return rifleBook();
  if (url.includes("/market/1/auctionhouse")) {
    return { auctionhouse: [
      { id: 1, seller: { id: 1, name: "a" }, buyer: { id: 2, name: "b" }, timestamp: NOW - 3600, price: 950000, bids: 3, item: { id: 1, uid: 9, name: "Fixture Rifle", type: "Weapon", sub_type: "Rifle", stats: { quality: 50 }, bonuses: [], rarity: null } },
    ] };
  }
  if (url.includes("/market/pointsmarket")) return { pointsmarket: [{ id: 1, quantity: 10, cost: 45000, total_cost: 450000 }] };
  if (url.includes("/user/itemmarket")) {
    return { itemmarket: [
      { id: 11, price: 850000, average_price: 840000, amount: 5, is_anonymous: true, available: 5, item: { id: 206, name: "Xanax", type: "Drug", rarity: null, uid: null } },
    ], _metadata: { links: { next: null, prev: null } } };
  }
  if (url.includes("/key/info")) {
    return { info: { selections: { user: ["basic", "itemmarket"], market: ["itemmarket"] }, access: { type: "Limited Access", level: 3, faction: false, company: false, log: false }, user: { id: 12345, faction_id: null, company_id: null } } };
  }
  if (url.includes("/items")) {
    const ids = (url.match(/\/torn\/([\d,]+)\/items/) || [])[1] || "";
    return { items: ids.split(",").filter(Boolean).map((id) => ({ id: Number(id), name: `Item ${id}`, type: Number(id) === 206 ? "Drug" : ([1, 2].includes(Number(id)) ? "Weapon" : "Plushie"), is_tradable: true, value: { market_price: 100000, shops: [] } })) };
  }
  return {};
}

function boot(html, url, { pda = false, delayMs = 0, fail = () => false } = {}) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const window = dom.window;
  const store = new Map();
  const requests = [];
  window.Element.prototype.getBoundingClientRect = () => ({ width: 320, height: 40, top: 10, bottom: 50, left: 0, right: 320, x: 0, y: 10 });
  Object.defineProperty(window.HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent; }, set(value) { this.textContent = value; } });
  window.GM_getValue = (key, fallback) => (store.has(key) ? store.get(key) : fallback);
  window.GM_setValue = (key, value) => { store.set(key, value); };
  window.GM_deleteValue = (key) => { store.delete(key); };
  window.GM_addStyle = () => {};
  window.GM_registerMenuCommand = () => {};
  const answer = (requestUrl) => ({ status: 200, responseText: JSON.stringify(fail(requestUrl) ? { error: { code: 5, error: "Too many requests" } } : responder(requestUrl)) });
  if (pda) {
    window.PDA_httpGet = (requestUrl, headers) => { requests.push(requestUrl); return new Promise((resolve) => setTimeout(() => resolve(answer(requestUrl)), delayMs)); };
  } else {
    window.GM_xmlhttpRequest = (options) => { requests.push(options.url); setTimeout(() => options.onload(answer(options.url)), delayMs); };
  }
  window.__MARKET_EDGE_EXPOSE_DOM__ = true;
  window.eval(SOURCE);
  const ME = window.__MARKET_EDGE_DOM__;
  ME.Store.setApiKey("ABCDEFGHIJKLMNOP");
  return { window, document: window.document, ME, requests, close: () => window.close() };
}

function panelText(env) {
  return env.document.querySelector("#market-edge-root")?.textContent || "";
}

run("Item Market panel renders a cold-start verdict with official agreement and fee label", async (t) => {
  const env = boot(fixture("itemmarket.html"), "https://www.torn.com/page.php?sid=ItemMarket#/market/view=sell&itemID=206&itemName=Xanax");
  t.after(env.close);
  await env.ME.renderItemMarket();
  const text = panelText(env);
  assert.match(text, /Xanax/);
  assert.match(text, /Torn daily average/);
  assert.match(text, /\$840k/);
  assert.match(text, /agree, so no warm-up penalty/);
  assert.match(text, /IM net after 5%/);
  assert.match(text, /Auction net after 3%/);
  assert.match(text, /Best opportunity/);
  assert.match(text, /Buy2 units/);
  assert.ok(env.document.querySelector(".me-watch"), "watch control is rendered");
  assert.ok(env.requests.some((url) => url.includes("/market/206/itemmarket?limit=100")));
  assert.ok(!env.requests.some((url) => url.includes("pointsmarket")), "non-set items do not touch the points market");
});

run("Watch button adds the item and the watchlist tick alerts when the floor is at or below target", async (t) => {
  const env = boot(fixture("itemmarket.html"), "https://www.torn.com/page.php?sid=ItemMarket#/market/view=sell&itemID=206&itemName=Xanax");
  t.after(env.close);
  await env.ME.renderItemMarket();
  env.document.querySelector(".me-watch-target").value = "800000";
  env.document.querySelector(".me-watch").click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const entries = env.ME.Store.watchlist();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].target, 800000);
  await env.ME.watchTick({ force: true });
  const toast = env.document.querySelector(".me-toast");
  assert.ok(toast, "an in-page toast is shown");
  assert.match(toast.textContent, /Xanax/);
  assert.match(toast.textContent, /\$790k/);
  assert.match(env.document.title, /^\[ME\]/);
  assert.equal(env.ME.Store.watchlist()[0].lastFloor, 790000);
  env.ME.renderWatchlistPanel();
  assert.match(panelText(env), /Watchlist/);
  assert.match(panelText(env), /Xanax/);
});

run("Equipment Item Market page renders comparable groups and AH evidence", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/page.php?sid=ItemMarket#/market/view=sell&itemID=1&itemName=Fixture%20Rifle");
  t.after(env.close);
  await env.ME.renderItemMarket();
  const text = panelText(env);
  assert.match(text, /equipment comparables/);
  assert.match(text, /Plain floor\$800k/);
  assert.match(text, /Bonus\/rarity floor\$9m/);
  assert.match(text, /AH sales \(30d\)1/);
  assert.match(text, /ORANGE bleed/);
  assert.ok(env.document.querySelector(".me-table"));
  assert.ok(env.requests.some((url) => url.includes("/market/1/auctionhouse")));
});

run("Own listings panel compares each listing with the live floor", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/page.php?sid=ItemMarket#/market/view=manage");
  t.after(env.close);
  await env.ME.api.keyInfo({ cacheMs: 0 });
  await env.ME.renderItemMarket();
  const text = panelText(env);
  assert.match(text, /Your Item Market listings/);
  assert.match(text, /Active listings1/);
  assert.match(text, /Xanax/);
  assert.match(text, /anon/);
  assert.match(text, /CLOSE|UNDERCUT/);
  assert.ok(env.ME.ui.pinned, "menu panels stay pinned until closed");
  env.document.querySelector(".me-close").click();
  assert.equal(env.document.querySelector("#market-edge-root"), null);
});

run("Own listings panel explains when the key level is too low", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/page.php?sid=ItemMarket#/market/view=manage");
  t.after(env.close);
  env.ME.Store.saveKeyInfo({ selections: { user: ["basic"], market: ["itemmarket"] }, access: { type: "Public Only", level: 1 }, user: { id: 1 } });
  await env.ME.renderOwnListingsPanel();
  assert.match(panelText(env), /needs a Limited access API key/);
  assert.ok(!env.requests.some((url) => url.includes("/user/itemmarket")), "no request is wasted on a key that cannot succeed");
});

run("Inventory scan renders museum set values for plushies using one metadata batch", async (t) => {
  const env = boot(fixture("inventory.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  const context = await env.ME.loadMuseumContext([206, 258]);
  assert.equal(context.has(206), false);
  const plushie = context.get(258);
  assert.ok(plushie);
  assert.equal(plushie.complete, true);
  assert.equal(plushie.setValue, 450000);
  assert.equal(plushie.othersCost, 12 * 100000);
  assert.equal(env.requests.filter((url) => url.includes("pointsmarket")).length, 1);
  const metaRequests = env.requests.filter((url) => /\/torn\/[\d,]+\/items/.test(url));
  assert.equal(metaRequests.length, 1, "all set members are fetched in one batch");
});

run("Torn PDA transport drives the full Item Market panel", async (t) => {
  const env = boot(fixture("itemmarket.html"), "https://www.torn.com/page.php?sid=ItemMarket#/market/view=sell&itemID=206", { pda: true });
  t.after(env.close);
  await env.ME.renderItemMarket();
  assert.match(panelText(env), /Best opportunity/);
  assert.ok(env.requests.length >= 1);
});

run("Inventory scan annotates commodity, plushie and unsupported rows end to end", async (t) => {
  const env = boot(fixture("inventory.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  await env.ME.scanVisibleSurface("inventory", { force: true });
  const blocks = Array.from(env.document.querySelectorAll(".me-inline-analysis"));
  assert.equal(blocks.length, 2);
  const byItem = Object.fromEntries(blocks.map((block) => [block.dataset.meItemId, block.textContent]));
  assert.match(byItem["206"], /BZ \$/);
  assert.match(byItem["206"], /IM \$/);
  assert.equal(byItem["258"].includes("SET"), false, "set route is hidden when the implied value is negative");
  assert.ok(env.requests.some((url) => url.includes("/market/258/itemmarket")));
  assert.equal(env.requests.filter((url) => url.includes("pointsmarket")).length, 1);
});

run("Bazaar add form weapon rows carry no price until the copy is priced from its details", async (t) => {
  const env = boot(fixture("bazaar-add-weapons.html"), "https://www.torn.com/bazaar.php#/add");
  t.after(env.close);
  await env.ME.scanVisibleSurface("bazaar", { force: true });
  const blocks = Array.from(env.document.querySelectorAll(".me-inline-analysis"));
  const rifle = blocks.find((block) => block.dataset.meItemId === "1");
  const xanax = blocks.find((block) => block.dataset.meItemId === "206");
  assert.ok(rifle && xanax, "both rows are annotated");
  assert.doesNotMatch(rifle.textContent, /floor/);
  assert.match(rifle.textContent, /open details to price/);
  assert.equal(rifle.querySelector(".me-bazaar-fill-btn"), null, "no fill on the row: the copy is unknown there");
  assert.ok(xanax.querySelector(".me-bazaar-fill-btn"), "commodity rows keep their fill control");
  assert.equal(env.document.querySelector(".me-equip-card"), null, "no details panel open, no card");
  assert.ok(!env.requests.some((url) => url.includes("/market/1/")), "no market or auction request is spent on a weapon row");
});

run("Inventory weapon rows make no market request and show nothing until priced from details", async (t) => {
  const env = boot(fixture("inventory-weapon.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  await env.ME.scanVisibleSurface("inventory", { force: true });
  const rifle = Array.from(env.document.querySelectorAll(".me-inline-analysis")).find((block) => block.dataset.meItemId === "1");
  assert.ok(rifle, "row gets a completed marker so rescans skip it");
  assert.ok(rifle.classList.contains("me-hidden"), "marker is invisible");
  assert.equal(rifle.textContent.trim(), "");
  assert.ok(!env.requests.some((url) => url.includes("/market/1/")), "no market or auction request for the weapon row");
  assert.ok(env.requests.some((url) => url.includes("/market/206/itemmarket")), "commodity rows are still priced");
  await env.ME.scanVisibleSurface("inventory", { force: false });
  assert.ok(!env.requests.some((url) => url.includes("/market/1/")), "rescans stay silent for weapon rows");
});

run("Expanded weapon details panel prices the exact copy and fills the correct row", async (t) => {
  const env = boot(fixture("bazaar-add-weapon-details.html"), "https://www.torn.com/bazaar.php#/add");
  t.after(env.close);
  // The expanded row is far taller than a normal row, like on the real page.
  const expandedRow = env.document.querySelector("li.expanded");
  expandedRow.getBoundingClientRect = () => ({ width: 320, height: 1200, top: 60, bottom: 1260, left: 0, right: 320, x: 0, y: 60 });

  const details = env.ME.collectExpandedEquipmentDetails("bazaar");
  assert.equal(details.length, 1);
  assert.equal(details[0].itemId, 1);
  assert.equal(details[0].copy.quality, 51);
  assert.equal(details[0].copy.damage, 65.55);
  assert.equal(details[0].copy.bonuses.length, 0);
  assert.equal(details[0].row, expandedRow, "panel is matched to the row that contains it, not the row above");

  await env.ME.scanVisibleSurface("bazaar", { force: true });
  const card = env.document.querySelector(".me-equip-card");
  assert.ok(card, "details panel receives a pricing card");
  assert.equal(card.previousElementSibling.className, "details", "card sits right below Torn's stats block");
  assert.equal(card.dataset.meComplete, "1");
  assert.match(card.textContent, /Q 51\.0%/);
  assert.match(card.textContent, /plain \(no bonus\)/);
  assert.match(card.textContent, /\$792k/);
  assert.match(card.textContent, /5 listings within Q ±10/);
  assert.match(card.textContent, /median \$950k over 1/);
  const button = card.querySelector(".me-bazaar-fill-btn");
  assert.ok(button, "details card carries the ^ fill control");
  button.click();
  const rows = Array.from(env.document.querySelectorAll("li.clearfix"));
  assert.equal(rows[1].querySelector("input.input-money").value, "792000", "the expanded row is filled");
  assert.equal(rows[1].querySelector("input[type='checkbox']").checked, true);
  assert.equal(rows[0].querySelector("input.input-money").value, "", "the row above is untouched");
  assert.equal(rows[2].querySelector("input.input-money").value, "", "the identical item below is untouched");
  assert.ok(env.requests.some((url) => url.includes("/market/1/itemmarket?limit=100")), "deep order book is used for comparables");
  assert.ok(env.requests.some((url) => url.includes("/market/1/auctionhouse")));

  // A second scan does not duplicate the card.
  await env.ME.scanVisibleSurface("bazaar", { force: false });
  assert.equal(env.document.querySelectorAll(".me-equip-card").length, 1);

  // The priced copy is promoted onto its own row with its own fill control.
  const rowBlock = rows[1].querySelector(".me-inline-analysis");
  assert.ok(rowBlock, "expanded row is annotated after pricing");
  assert.match(rowBlock.textContent, /\$792k/);
  assert.match(rowBlock.textContent, /Q 51\.0% plain/);
  assert.match(rows[0].querySelector(".me-inline-analysis").textContent, /open details to price/, "row above keeps its hint");
  assert.match(rows[2].querySelector(".me-inline-analysis").textContent, /open details to price/, "identical item below keeps its hint");
  const rowButton = rowBlock.querySelector(".me-bazaar-fill-btn");
  assert.ok(rowButton, "row carries the ^ fill once the copy is priced");
  rows[1].querySelector("input.input-money").value = "";
  rowButton.click();
  assert.equal(rows[1].querySelector("input.input-money").value, "792000");

  // Collapsing the details (Torn removes the stats block but keeps the wrapper)
  // removes the card and leaves only the row summary.
  rows[1].querySelector("ul.details").remove();
  rows[1].querySelector(".stats-bar").remove();
  delete expandedRow.getBoundingClientRect; // the row shrinks back to normal height
  await env.ME.scanVisibleSurface("bazaar", { force: true });
  assert.equal(env.document.querySelectorAll(".me-equip-card").length, 0, "no card outlives the collapsed panel");
  const again = rows[1].querySelector(".me-inline-analysis");
  assert.match(again.textContent, /\$792k/);
  assert.ok(again.querySelector(".me-bazaar-fill-btn"));
});

run("Opening details after the rows were already annotated still prices the copy", async (t) => {
  const env = boot(fixture("bazaar-add-weapons.html"), "https://www.torn.com/bazaar.php#/add");
  t.after(env.close);
  await env.ME.scanVisibleSurface("bazaar", { force: true });
  assert.equal(env.document.querySelector(".me-equip-card"), null);
  // The player expands the rifle: Torn injects the details inside the row.
  const rifleRow = env.document.querySelector("li.clearfix");
  rifleRow.insertAdjacentHTML("beforeend", `<div class="item-info-wrap"><ul class="details">
    <li><span class="label">Damage</span>: <span class="value">65.55</span></li>
    <li><span class="label">Accuracy</span>: <span class="value">44.21</span></li>
    <li><span class="label">Bonus</span>: <span class="value">24% Proficience</span></li>
    <li><span class="label">Quality</span>: <span class="value">124.26% <span class="yellow">Yellow</span></span></li>
  </ul></div>`);
  await env.ME.scanVisibleSurface("bazaar", { force: false });
  const card = env.document.querySelector(".me-equip-card");
  assert.ok(card, "details are priced even though every row was already complete");
  assert.match(card.textContent, /Q 124\.3%/);
  assert.match(card.textContent, /Proficience 24%/);
  assert.match(card.textContent, /YELLOW/);
  assert.match(card.textContent, /No comparable YELLOW proficience/, "no bonus comparables in the stub book");
  assert.equal(card.previousElementSibling.className, "details");
});

run("Inventory details block placed after the row prices the copy and promotes it to that row", async (t) => {
  const env = boot(fixture("inventory-weapon-details.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  await env.ME.scanVisibleSurface("inventory", { force: true });
  const details = env.ME.collectExpandedEquipmentDetails("inventory");
  assert.equal(details.length, 1);
  assert.equal(details[0].itemId, 1);
  assert.ok(details[0].row, "row resolved");
  assert.ok(details[0].row.querySelector(".name").textContent.startsWith("x1 Fixture Rifle"), "the item row before the info block, not the info block itself");
  const card = env.document.querySelector(".me-equip-card");
  assert.ok(card, "inventory details get a pricing card");
  assert.match(card.textContent, /\$792k/);
  assert.equal(card.querySelector(".me-bazaar-fill-btn"), null, "no fill control on inventory");
  const rowBlock = details[0].row.querySelector(".me-inline-analysis");
  assert.ok(rowBlock);
  assert.match(rowBlock.textContent, /BZ \$792k/);
  assert.match(rowBlock.textContent, /Q 51\.0% plain/);
  assert.ok(env.requests.some((url) => url.includes("/market/1/itemmarket?limit=100")));
});

run("Inventory details nested inside a tall row resolve to that row's inner card", async (t) => {
  const env = boot(fixture("inventory-weapon-details-nested.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  const tallRow = env.document.querySelector("li.expanded");
  tallRow.getBoundingClientRect = () => ({ width: 320, height: 1200, top: 60, bottom: 1260, left: 0, right: 320, x: 0, y: 60 });
  await env.ME.scanVisibleSurface("inventory", { force: true });
  const details = env.ME.collectExpandedEquipmentDetails("inventory");
  assert.equal(details.length, 1);
  assert.equal(details[0].itemId, 1, "the rifle, not the uzi above");
  assert.ok(tallRow.contains(details[0].row), "row card lives inside the expanded list item");
  assert.ok(!details[0].row.contains(details[0].panel), "row card is the inner wrapper, not the whole item");
  const card = env.document.querySelector(".me-equip-card");
  assert.ok(card, "pricing card rendered");
  assert.match(card.textContent, /\$792k/);
  const rowBlock = tallRow.querySelector(".me-inline-analysis");
  assert.ok(rowBlock);
  assert.match(rowBlock.textContent, /BZ \$792k/);
  const uziRow = env.document.querySelector("li.item-row");
  assert.doesNotMatch(uziRow.textContent, /\$792k/, "the row above is untouched");
});

run("Settings modal builds a page structure report without the API key", (t) => {
  const env = boot(fixture("inventory-weapon-details.html"), "https://www.torn.com/item.php");
  t.after(env.close);
  env.ME.showSettings();
  env.document.querySelector("#me-build-diagnostics").click();
  const report = env.document.querySelector("#me-diagnostics").value;
  assert.match(report, /surface: inventory/);
  assert.match(report, /stats panels found: 1/);
  assert.match(report, /resolved details: 1/);
  assert.match(report, /ul\.details/);
  assert.doesNotMatch(report, /ABCDEFGHIJKLMNOP/);
});

run("Details pricing survives a list rescan and a re-rendered panel while its request is pending", async (t) => {
  const env = boot(fixture("inventory-weapon-details.html"), "https://www.torn.com/item.php", { delayMs: 30 });
  t.after(env.close);
  const scheduled = [];
  const originalSchedule = env.ME.api.scheduler.schedule.bind(env.ME.api.scheduler);
  env.ME.api.scheduler.schedule = (task, priority, meta) => { scheduled.push(meta); return originalSchedule(task, priority, meta); };

  const first = env.ME.scanVisibleSurface("inventory", { force: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  // Torn re-renders the stats list while the request is pending.
  const oldPanel = env.document.querySelector("ul.details");
  const fresh = oldPanel.cloneNode(true);
  oldPanel.replaceWith(fresh);
  // ...and the list mutates, triggering another scan that cancels stale list requests.
  const second = env.ME.scanVisibleSurface("inventory", { force: false, cancelObsolete: true });
  await Promise.all([first, second]);
  await new Promise((resolve) => setTimeout(resolve, 120));

  const detailRequests = scheduled.filter((meta) => String(meta?.path || "").includes("/market/1/itemmarket?limit=100"));
  assert.ok(detailRequests.length >= 1);
  assert.ok(detailRequests.every((meta) => meta.queueGroup === "details"), "details requests never share the cancellable list queue group");
  const cards = env.document.querySelectorAll(".me-equip-card");
  assert.equal(cards.length, 1, "exactly one card after the panel was replaced");
  assert.equal(cards[0].previousElementSibling, fresh, "card is attached to the new panel");
  assert.match(cards[0].textContent, /\$792k/);
});

run("Details pricing shows the error instead of vanishing when the API fails", async (t) => {
  const env = boot(fixture("inventory-weapon-details.html"), "https://www.torn.com/item.php", { fail: (url) => url.includes("/market/1/itemmarket") });
  t.after(env.close);
  await env.ME.scanVisibleSurface("inventory", { force: true });
  const card = env.document.querySelector(".me-equip-card");
  assert.ok(card, "an error card stays visible");
  assert.equal(card.dataset.meComplete, "1");
  assert.match(card.textContent, /rate limit/i);
  assert.match(card.textContent, /Collapse and reopen/);
  env.ME.showSettings();
  env.document.querySelector("#me-build-diagnostics").click();
  assert.match(env.document.querySelector("#me-diagnostics").value, /last details outcome: pricing failed for item 1/);
});

run("Details pricing retries when the panel is swapped with slightly different text mid-request", async (t) => {
  const env = boot(fixture("inventory-weapon-details.html"), "https://www.torn.com/item.php", { delayMs: 30 });
  t.after(env.close);
  const first = env.ME.scanVisibleSurface("inventory", { force: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  // React swaps the stats block and, for a moment, the quality reads differently.
  const oldPanel = env.document.querySelector("ul.details");
  const fresh = oldPanel.cloneNode(true);
  fresh.querySelector("li:last-child .value").textContent = " 51.00% Yellow";
  oldPanel.replaceWith(fresh);
  await first;
  await new Promise((resolve) => setTimeout(resolve, 150));
  const card = env.document.querySelector(".me-equip-card");
  assert.ok(card, "the swapped panel still receives a card");
  assert.equal(card.previousElementSibling, fresh);
  assert.match(card.textContent, /\$792k/);
});
