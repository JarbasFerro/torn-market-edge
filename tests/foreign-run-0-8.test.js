"use strict";

// v0.8.0: foreign run timer from the opt-in YATA foreign-stock export.

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
require(path.join(__dirname, "..", "torn-market-edge.user.js"));
const ME = globalThis.__MARKET_EDGE_TEST__;

const MIN = 60;
const T0 = 1793750400; // a fixed TCT midnight-ish base, seconds

// Reports every 2 minutes from `from` to `to`, with stock(t) giving the
// quantity at each report.
function feed(log, from, to, stock, threshold = 28) {
  let next = log;
  for (let t = from; t <= to; t += 2 * MIN) next = ME.recordStockObservation(next, { at: t, quantity: stock(t) }, { threshold });
  return next;
}

// Restocks at T0+60m, T0+3h, T0+5h10m, each lasting 20 minutes.
const RESTOCKS = [60, 180, 310].map((minutes) => T0 + minutes * MIN);
const stockAt = (t) => (RESTOCKS.some((r) => t >= r && t < r + 20 * MIN) ? 900 : 0);

// The South Africa Xanax pattern read from Torn PDA's chart on 2026-11-04
// (local time): restocks 04:28, 07:28, 10:08, 12:40, selling out after 58,
// 40, 22 and 18 minutes; each restock about two hours after the shop empties.
const at = (hhmm) => T0 + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * MIN;
const SA = [["04:28", "05:26"], ["07:28", "08:08"], ["10:08", "10:30"], ["12:40", "12:58"]].map(([r, e]) => [at(r), at(e)]);
const saStock = (t) => (SA.some(([r, e]) => t >= r && t < e) ? 1500 : 0);

test("normalizeYataExport keeps known countries and maps items by id", () => {
  const data = ME.normalizeYataExport({ stocks: { sou: { update: 1793794965, stocks: [{ id: 206, name: "Xanax", quantity: 0, cost: 669000 }] }, zzz: { stocks: [] } } });
  assert.deepEqual(Object.keys(data), ["sou"]);
  assert.equal(data.sou.country, "South Africa");
  assert.equal(data.sou.update, 1793794965);
  assert.deepEqual(data.sou.items[206], { name: "Xanax", quantity: 0, cost: 669000 });
  assert.deepEqual(ME.normalizeYataExport(null), {});
});

test("recordStockObservation brackets restocks and sell-outs between reports and ignores repeats", () => {
  const log = feed(null, T0, T0 + 6 * 60 * MIN, stockAt);
  assert.equal(log.restocks.length, 3);
  assert.deepEqual(log.restocks[0], { from: RESTOCKS[0] - 2 * MIN, to: RESTOCKS[0], quantity: 900 });
  assert.equal(log.sellouts.length, 3);
  assert.deepEqual(log.sellouts[0], { from: RESTOCKS[0] + 18 * MIN, to: RESTOCKS[0] + 20 * MIN });
  const repeat = ME.recordStockObservation(log, { at: log.lastAt, quantity: 5000 }, { threshold: 28 });
  assert.equal(repeat.restocks.length, 3, "the same report twice is not a restock");
  // Below one trip counts as short: 27 -> 30 is a restock for a 28-slot trip.
  let small = ME.recordStockObservation(null, { at: T0, quantity: 27 }, { threshold: 28 });
  small = ME.recordStockObservation(small, { at: T0 + MIN, quantity: 30 }, { threshold: 28 });
  assert.equal(small.restocks.length, 1);
});

test("predictForeignRun times from the sell-out: restock = empty + shortest empty spell, chained past a flight that misses it", () => {
  const log = feed(null, at("01:30"), at("13:44"), saStock);
  assert.equal(log.restocks.length, 4);
  assert.equal(log.sellouts.length, 4);
  const plan = (now) => ME.predictForeignRun({ log, nowSec: now, oneWayMinutes: 208, leadMinutes: 5, threshold: 28 });

  // 13:30: the 14:54 restock cannot be reached (3 h 28 min airstrip) and
  // sells out by ~15:30, so the plan aims at the one after: 14:54 + 16 min
  // shortest stock spell + 118 min shortest empty spell = 17:08.
  const early = plan(at("13:30"));
  assert.equal(early.status, "wait");
  assert.equal(early.cyclesAhead, 1);
  assert.equal(early.emptyShortestSec, 118 * MIN);
  assert.equal(early.lastingShortestSec, 16 * MIN);
  assert.equal(early.earliest, at("17:08"));
  assert.equal(early.leaveAt, at("13:35"), "17:08 - 3 h 28 min - 5 min");
  assert.equal(early.landsAt, at("17:03"));
  assert.equal(early.typical, at("17:32"));

  // 13:44: the ideal moment just passed, but landing at 17:12 still beats the
  // typical sell-out of that restock: go now.
  const now = plan(at("13:44"));
  assert.equal(now.status, "go-now");
  assert.equal(now.reason, "window");
  assert.equal(now.landsAt, at("17:12"));

  // 14:30: landing at 17:58 still beats its typical sell-out (17:32 + 31 min).
  assert.equal(plan(at("14:30")).status, "go-now");
  // 15:00: landing at 18:28 is too late for it: the restock after that one.
  const late = plan(at("15:00"));
  assert.equal(late.status, "wait");
  assert.equal(late.cyclesAhead, 2);
  assert.ok(late.leaveAt > at("15:00"));
});

test("predictForeignRun: right after a sell-out with a short flight, the next restock itself", () => {
  const log = feed(null, at("01:30"), at("13:00"), saStock);
  const plan = ME.predictForeignRun({ log, nowSec: at("13:00"), oneWayMinutes: 26, leadMinutes: 5, threshold: 28 });
  assert.equal(plan.status, "wait");
  assert.equal(plan.cyclesAhead, 0);
  assert.equal(plan.earliest, at("12:56") + 118 * MIN);
  assert.equal(plan.leaveAt, plan.earliest - 31 * MIN);
});

test("predictForeignRun: learning until a sell-out and the next restock are seen; rough brackets never count", () => {
  const flight = 208;
  const one = feed(null, T0, T0 + 100 * MIN, stockAt);
  assert.equal(ME.predictForeignRun({ log: one, nowSec: T0 + 100 * MIN, oneWayMinutes: flight, threshold: 28 }).status, "learning");
  assert.equal(ME.predictForeignRun({ log: null, nowSec: T0, oneWayMinutes: flight, threshold: 28 }).status, "learning");
  const log = feed(null, T0, T0 + 400 * MIN, stockAt);
  assert.equal(ME.predictForeignRun({ log, nowSec: T0, oneWayMinutes: null, threshold: 28 }).status, "no-flight");

  // Reports 3 hours apart give wide brackets that are not used.
  let gappy = null;
  [0, 180, 360, 540, 720].forEach((minutes) => { gappy = ME.recordStockObservation(gappy, { at: T0 + minutes * MIN, quantity: minutes % 360 === 180 ? 900 : 0 }, { threshold: 28 }); });
  const rough = ME.predictForeignRun({ log: gappy, nowSec: T0 + 720 * MIN, oneWayMinutes: flight, threshold: 28 });
  assert.equal(rough.restocksSeen, 2);
  assert.equal(rough.status, "learning", "rough brackets never time a departure");
});

test("predictForeignRun: in stock and lasting longer than the flight means go now", () => {
  // Restocks every 6 hours, each lasting 5 hours: a 3.5-hour flight makes it.
  const restocks = [60, 420].map((minutes) => T0 + minutes * MIN);
  const stock = (t) => (restocks.some((r) => t >= r && t < r + 300 * MIN) ? 900 : 0);
  const log = feed(null, T0, T0 + 430 * MIN, stock);
  const prediction = ME.predictForeignRun({ log, nowSec: T0 + 430 * MIN, oneWayMinutes: 208, threshold: 28 });
  assert.equal(prediction.status, "go-now");
  assert.equal(prediction.reason, "in-stock");
  assert.equal(prediction.lastingShortestSec, 298 * MIN);
});

// ---------------------------------------------------------------------------
// Runtime: YATA request without the API key, stored log, panel
// ---------------------------------------------------------------------------

function boot(url, { yata, settings = {} } = {}) {
  const dom = new JSDOM("<div id='mainContainer'></div>", { url, runScripts: "outside-only", pretendToBeVisual: true });
  const window = dom.window;
  const store = new Map();
  const requests = [];
  window.Element.prototype.getBoundingClientRect = function boundingBox() {
    return { width: 320, height: 40, top: 10, bottom: 50, left: 0, right: 320, x: 0, y: 10 };
  };
  store.set("marketEdge.settings.v1", { ...ME.DEFAULTS, ...settings });
  window.GM_getValue = (k, fallback) => (store.has(k) ? store.get(k) : fallback);
  window.GM_setValue = (k, value) => { store.set(k, value); };
  window.GM_deleteValue = (k) => { store.delete(k); };
  window.GM_listValues = () => Array.from(store.keys());
  window.GM_addStyle = () => {};
  window.GM_registerMenuCommand = () => {};
  window.GM_xmlhttpRequest = (options) => {
    requests.push({ url: options.url, headers: options.headers || {} });
    const body = options.url.startsWith("https://yata.yt/") ? yata() : {};
    options.onload({ status: 200, responseText: JSON.stringify(body) });
  };
  window.__MARKET_EDGE_EXPOSE_DOM__ = true;
  window.__MARKET_EDGE_PDA_WAIT_MS__ = 20;
  window.eval(SOURCE);
  const ME_DOM = window.__MARKET_EDGE_DOM__;
  ME_DOM.Store.setApiKey("secret-key");
  return { dom, window, document: window.document, ME: ME_DOM, store, requests, close: () => dom.window.close() };
}

const run = JSDOM ? test : test.skip;

run("Off by default: the panel explains YATA and asks first; nothing is fetched", async (t) => {
  const env = boot("https://www.torn.com/page.php?sid=travel", { yata: () => ({}) });
  t.after(env.close);
  assert.equal(await env.ME.foreignRunTick({ force: true }), null);
  env.ME.renderForeignRunPanel();
  const body = env.document.querySelector("#market-edge-root").textContent;
  assert.match(body, /yata\.yt/);
  assert.match(body, /no API key and no player data/);
  assert.ok(!env.requests.some((request) => request.url.includes("yata.yt")), "no YATA request before opting in");
});

run("Enabled: the YATA export is read without the API key, logged, and the panel shows the plan", async (t) => {
  let update = Math.floor(Date.now() / 1000) - 60;
  let quantity = 0;
  const env = boot("https://www.torn.com/page.php?sid=travel", {
    settings: { foreignRunEnabled: true, travelType: "airstrip", tripUnits: 28 },
    yata: () => ({ stocks: { sou: { update, stocks: [{ id: 206, name: "Xanax", quantity, cost: 669000 }] } } }),
  });
  t.after(env.close);
  const first = await env.ME.foreignRunTick({ force: true });
  assert.equal(first.status, "learning");
  const yataRequest = env.requests.find((request) => request.url.includes("yata.yt"));
  assert.equal(yataRequest.url, "https://yata.yt/api/v1/travel/export/");
  assert.equal(Object.keys(yataRequest.headers).length, 0, "no ApiKey header goes to YATA");
  assert.ok(!yataRequest.url.includes("secret-key"));

  update += 120;
  quantity = 1200;
  await env.ME.foreignRunTick({ force: true });
  const log = env.ME.Store.get("marketEdge.foreignStockLog.v1", {})["sou:206"];
  assert.equal(log.restocks.length, 1, "0 -> 1,200 between two reports is a restock");
  assert.equal(log.name, "Xanax");
  assert.equal(log.cost, 669000);

  env.ME.renderForeignRunPanel({ refresh: false });
  const body = env.document.querySelector("#market-edge-root").textContent;
  assert.match(body, /Foreign run · Xanax · South Africa/);
  assert.match(body, /1,200 in stock/);
  assert.match(body, /28 for \$18\.7m/i);
  assert.match(body, /Airstrip · 3 h 28 min one way/);
  assert.match(body, /Learning the restock times/);
});

run("The run is one tap away in the launcher once enabled", async (t) => {
  const env = boot("https://www.torn.com/item.php", { settings: { foreignRunEnabled: true }, yata: () => ({}) });
  t.after(env.close);
  assert.ok(env.ME.launcherActions().some((action) => action.id === "run"));
});
