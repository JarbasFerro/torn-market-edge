"use strict";

// Torn PDA native features: phone notifications for alerts, background
// polling with a one-tab lease, and Auction House reminders scheduled by the
// phone. The PDA bridge (flutter_inappwebview.callHandler) is mocked and
// records every call.

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
const run = JSDOM ? test : test.skip;
const SOURCE = fs.readFileSync(path.join(__dirname, "..", "torn-market-edge.user.js"), "utf8").replace("###PDA-APIKEY###", "PDAKEY1234567890");
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

// Shape of a real amarket.php row (October 2026): li[id] is the listing id;
// the end time is in the time-wrap title, in Torn time (UTC).
function auctionRow(id, endsAt, timer) {
  const d = new Date(endsAt);
  const pad = (n) => String(n).padStart(2, "0");
  const title = `Ends on ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} - ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${String(d.getUTCFullYear()).slice(2)}`;
  return `<li class="" id="${id}">
    <div class="item-cont-wrap"><span class="img-wrap"><span class="item-hover" item="486" armoury="900001"><button class="view-info wai-btn" aria-label="TMP. ${title}. "></button></span></span>
      <span class="title"><span class="bold t-blue item-name">TMP</span></span></div>
    <div class="c-bid-wrap">$27,374,758</div>
    <div class="time-wrap"><span title="${title}"><i class="timer-icon"></i><span class="time" timer="${timer}"><span class="dh-time">..</span></span></span></div>
    <div class="mob-wrap"><div class="time-mob-wrap">Time left: <span title="${title}"><span class="time" timer="${timer}"></span></span></div></div>
  </li>`;
}

function boot(html, url, { listings = [{ price: 820000, amount: 3 }] } = {}) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const window = dom.window;
  const store = new Map();
  const calls = [];
  window.Element.prototype.getBoundingClientRect = () => ({ width: 320, height: 40, top: 10, bottom: 50, left: 0, right: 320, x: 0, y: 10 });
  Object.defineProperty(window.HTMLElement.prototype, "innerText", { configurable: true, get() { return this.textContent; } });
  window.GM_getValue = (key, fallback) => (store.has(key) ? store.get(key) : fallback);
  window.GM_setValue = (key, value) => { store.set(key, value); };
  window.GM_deleteValue = (key) => { store.delete(key); };
  window.GM_addStyle = () => {};
  window.PDA_httpGet = () => Promise.resolve({ status: 200, responseText: JSON.stringify({ itemmarket: { item: { id: 206, name: "Xanax", type: "Drug", average_price: 840000 }, listings, cache_timestamp: 1, cache_delay: 30 } }) });
  window.flutter_inappwebview = {
    callHandler: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({ status: "success", message: "ok" });
    },
  };
  window.__MARKET_EDGE_EXPOSE_DOM__ = true;
  window.eval(SOURCE);
  const ME = window.__MARKET_EDGE_DOM__;
  // Test mode skips startup (and its PDA tab-state listener); hiding the
  // document drives the same pageVisible() check.
  let hidden = false;
  Object.defineProperty(window.document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  const setPdaVisible = (visible) => { hidden = !visible; };
  return { window, document: window.document, ME, calls, setPdaVisible, close: () => window.close() };
}

run("auction end time is read from Torn's 'Ends on' title in Torn time, else from the timer", (t) => {
  const endsAt = Date.UTC(2026, 9, 20, 14, 23, 11);
  const env = boot(`<div id="auction-house-tabs"><ul class="items-list">${auctionRow(579754, endsAt, 500)}</ul></div>`, "https://www.torn.com/amarket.php");
  t.after(env.close);
  const row = env.document.getElementById("579754");
  assert.equal(env.ME.parseAuctionEnd(row), endsAt);
  row.querySelectorAll("[title]").forEach((node) => node.removeAttribute("title"));
  row.querySelector("button.view-info").setAttribute("aria-label", "TMP");
  assert.equal(env.ME.parseAuctionEnd(row, 1_000_000), 1_000_000 + 500_000, "timer attribute is seconds left");
});

run("'Remind me' schedules a phone notification five minutes before the end and a second tap cancels it", async (t) => {
  const endsAt = Math.floor((Date.now() + 60 * 60000) / 1000) * 1000;
  const env = boot(`<div id="auction-house-tabs"><ul class="items-list">${auctionRow(579754, endsAt, 3600)}<li class="clear"></li></ul></div>`, "https://www.torn.com/amarket.php");
  t.after(env.close);
  assert.equal(env.ME.renderAuctionReminders(), 1, "rows without an id or end time are skipped");
  const button = env.document.querySelector('[id="579754"] .me-ah-remind');
  assert.equal(button.textContent, "Remind me");
  assert.ok(button.closest(".time-mob-wrap"), "beside the time left");
  button.click();
  await tick();
  const scheduled = env.calls.find((call) => call.name === "scheduleNotification");
  assert.ok(scheduled, "PDA scheduler called");
  assert.equal(scheduled.args.id, 7000 + (579754 % 3000));
  assert.equal(Math.round((endsAt - scheduled.args.timestamp) / 1000), 300, "five minutes before the end");
  assert.match(scheduled.args.title, /Auction ending: TMP/);
  assert.match(scheduled.args.subtitle, /bid was \$27,374,758/);
  assert.equal(scheduled.args.urlCallback, "https://www.torn.com/amarket.php");
  const on = env.document.querySelector('[id="579754"] .me-ah-remind');
  assert.equal(on.getAttribute("aria-pressed"), "true");
  assert.match(on.textContent, /\u2713 \d\d:\d\d TCT/);
  on.click();
  await tick();
  assert.ok(env.calls.some((call) => call.name === "cancelNotification" && call.args.id === scheduled.args.id));
  assert.equal(env.document.querySelector('[id="579754"] .me-ah-remind').textContent, "Remind me");
});

run("Watchlist keeps checking while PDA hides the tab, notifies the phone once, and only one tab holds the lease", async (t) => {
  const env = boot("<div id='mainContainer'></div>", "https://www.torn.com/index.php");
  t.after(env.close);
  env.ME.addWatchItem({ itemId: 206, name: "Xanax", target: 900000 });
  env.setPdaVisible(false);
  assert.equal(env.ME.watchMayRun(), true, "background polling allowed in PDA");
  await env.ME.watchTick({ force: true });
  const notes = env.calls.filter((call) => call.name === "scheduleNotification");
  assert.equal(notes.length, 1, "one phone notification");
  assert.equal(notes[0].args.id, 1000 + 206);
  assert.match(notes[0].args.title, /Xanax at \$820k/);
  assert.match(notes[0].args.urlCallback, /itemID=206/);
  // On screen, the toast is enough: no second phone notification.
  env.setPdaVisible(true);
  env.ME.addWatchItem({ itemId: 206, name: "Xanax", target: 900000 });
  env.window.localStorage.removeItem("marketEdge.notifyLog.v1");
  await env.ME.watchTick({ force: true });
  assert.equal(env.calls.filter((call) => call.name === "scheduleNotification").length, 1, "no notification while Torn is on screen");
  env.setPdaVisible(false);
  // Another tab took the lease: this hidden tab stands down.
  env.window.localStorage.setItem("marketEdge.watchLease.v1", JSON.stringify({ tab: "other-tab", until: Date.now() + 60000 }));
  assert.equal(env.ME.watchMayRun(), false, "lease held elsewhere");
  // A visible tab always takes it back.
  env.setPdaVisible(true);
  assert.equal(env.ME.watchMayRun(), true);
  // Turning background checks off stops hidden polling.
  env.setPdaVisible(false);
  env.window.localStorage.removeItem("marketEdge.watchLease.v1");
  env.ME.Store.saveSettings({ ...env.ME.Store.settings(), backgroundAlerts: false });
  env.ME.reloadSettings();
  assert.equal(env.ME.watchMayRun(), false);
});
