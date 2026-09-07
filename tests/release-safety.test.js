const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "torn-market-edge.user.js"), "utf8");

test("release metadata is v0.2.1 and ASCII-safe", () => {
  assert.match(source, /\/\/ @version\s+0\.2\.1/);
  assert.ok([...source].every((ch) => ch.charCodeAt(0) <= 127));
});

test("shared Torn API quota protections are present", () => {
  assert.match(source, /const API_MAX_REQUESTS_PER_MINUTE = 20;/);
  assert.match(source, /const API_CONCURRENCY = 3;/);
  assert.match(source, /const API_MIN_REQUEST_GAP_MS = 300;/);
  assert.match(source, /response\.status === 429 \|\| errorCode === 5/);
  assert.match(source, /API_RATE_LIMIT_BACKOFF_MS = 65 \* 1000/);
  assert.match(source, /cancelQueuedListRequests\(\)/);
  assert.match(source, /isWithinListScanBand/);
});

test("network/game-action safety boundary remains intact", () => {
  assert.match(source, /@connect\s+api\.torn\.com/);
  assert.equal((source.match(/GM_xmlhttpRequest\(/g) || []).length, 1);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\.submit\s*\(/);
  assert.doesNotMatch(source, /\.click\s*\(/);
  assert.doesNotMatch(source, /location\.reload\s*\(/);
});
