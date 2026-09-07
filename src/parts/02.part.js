    return 1;
  }

  const TEST_EXPORTS = Object.freeze({
    APP,
    DEFAULTS,
    median,
    mad,
    weightedMedian,
    robustMarketAnchor,
    normalizeMarketResponse,
    calculateHistoryStats,
    freshness,
    confidenceForOpportunity,
    chooseReference,
    calculateExit,
    routeEconomics,
    grossToItemMarketNet,
    itemMarketNetFor,
    evaluatePrefixes,
    evaluateDirectBuy,
    maxRationalBid,
    estimateInventoryExit,
    formatMoney,
    parseMoney,
    parseQuantity
  });

  global.__MARKET_EDGE_TEST__ = TEST_EXPORTS;
  if (typeof document === "undefined" || typeof window === "undefined") return;

  // ---------------------------------------------------------------------------
  // Configuration and storage
  // ---------------------------------------------------------------------------

  class Store {
    static get(key, fallback) {
      try {
        const value = GM_getValue(key, fallback);
        return value === undefined ? fallback : value;
      } catch (error) {
        console.warn(APP.logPrefix, "Storage read failed", key, error);
        return fallback;
      }
    }

    static set(key, value) {
      try {
        GM_setValue(key, value);
      } catch (error) {
        console.warn(APP.logPrefix, "Storage write failed", key, error);
      }
    }

    static delete(key) {
      try {
        GM_deleteValue(key);
      } catch (error) {
        console.warn(APP.logPrefix, "Storage delete failed", key, error);
      }
    }

    static settings() {
      const stored = Store.get(STORAGE_KEYS.settings, {});
      const merged = { ...DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
      // v0.2.0 defaulted this to 30. Clamp legacy persisted values so an
      // upgrade cannot immediately queue a whole long inventory category.
      merged.scanMaxVisibleItems = clamp(
        asInt(merged.scanMaxVisibleItems, LIST_SCAN_BATCH_MAX),
        1,
        LIST_SCAN_BATCH_MAX
      );
      return merged;
    }

    static saveSettings(settings) {
      Store.set(STORAGE_KEYS.settings, { ...DEFAULTS, ...settings });
    }

    static apiKey() {
      return String(Store.get(STORAGE_KEYS.apiKey, "") || "").trim();
    }

    static setApiKey(key) {
      Store.set(STORAGE_KEYS.apiKey, String(key || "").trim());
    }

    static snapshot(itemId) {
      const raw = Store.get(`${STORAGE_KEYS.snapshotPrefix}${asInt(itemId)}`, null);
      if (!raw || typeof raw !== "object") return null;
      const listings = Array.isArray(raw.listings)
        ? raw.listings.map((row) => ({ price: asInt(row.price), quantity: Math.max(1, asInt(row.quantity, 1)) })).filter((row) => row.price > 0)
        : [];
      if (!asInt(raw.itemId) || !listings.length) return null;
      return {
        ...raw,
        itemId: asInt(raw.itemId),
        cacheTimestamp: asInt(raw.cacheTimestamp),
        cacheDelay: asInt(raw.cacheDelay),
        timestampObserved: asInt(raw.timestampObserved),
        listings,
        lowestPrice: asInt(raw.lowestPrice, null),
        secondPrice: asInt(raw.secondPrice, null),
        thirdPrice: asInt(raw.thirdPrice, null),
        top20Quantity: asInt(raw.top20Quantity),
        medianListingPrice: Number(raw.medianListingPrice) || null,
        calculatedMarketAnchor: asInt(raw.calculatedMarketAnchor, null),
        depthMetrics: raw.depthMetrics && typeof raw.depthMetrics === "object" ? raw.depthMetrics : {
          listingCount: listings.length,
          top5Quantity: listings.slice(0, 5).reduce((sum, row) => sum + row.quantity, 0),
          top20Quantity: listings.slice(0, 20).reduce((sum, row) => sum + row.quantity, 0)
        },
        supportedCommodity: raw.supportedCommodity !== false
      };
    }

    static saveSnapshot(snapshot) {
      if (!snapshot?.itemId || !Array.isArray(snapshot.listings) || !snapshot.listings.length) return;
      Store.set(`${STORAGE_KEYS.snapshotPrefix}${snapshot.itemId}`, {
        itemId: snapshot.itemId,
        itemName: snapshot.itemName,
        itemType: snapshot.itemType,
        averagePrice: snapshot.averagePrice,
        cacheTimestamp: snapshot.cacheTimestamp,
        cacheDelay: snapshot.cacheDelay,
        timestampObserved: snapshot.timestampObserved,
        listings: snapshot.listings.slice(0, API_LIST_LIMIT).map((row) => ({ price: row.price, quantity: row.quantity })),
        lowestPrice: snapshot.lowestPrice,
        secondPrice: snapshot.secondPrice,
        thirdPrice: snapshot.thirdPrice,
        top20Quantity: snapshot.top20Quantity,
        depthMetrics: snapshot.depthMetrics,
        medianListingPrice: snapshot.medianListingPrice,
        calculatedMarketAnchor: snapshot.calculatedMarketAnchor,
        supportedCommodity: snapshot.supportedCommodity
      });
    }

    static itemMeta(itemId) {
      const raw = Store.get(`${STORAGE_KEYS.itemMetaPrefix}${asInt(itemId)}`, null);
      if (!raw || typeof raw !== "object" || !raw.savedAt) return null;
      if (Date.now() - asInt(raw.savedAt) > ITEM_META_TTL_MS) return null;
      return raw.meta && typeof raw.meta === "object" ? raw.meta : null;
    }

    static saveItemMeta(meta) {
      if (!meta?.id) return;
      Store.set(`${STORAGE_KEYS.itemMetaPrefix}${asInt(meta.id)}`, { savedAt: Date.now(), meta });
    }

    static history(itemId) {
      const raw = Store.get(`${STORAGE_KEYS.historyPrefix}${itemId}`, []);
      return Array.isArray(raw) ? raw : [];
    }

    static appendHistory(snapshot, settings) {
      if (!snapshot?.itemId || !snapshot?.calculatedMarketAnchor) return false;
      const key = `${STORAGE_KEYS.historyPrefix}${snapshot.itemId}`;
      const points = Store.history(snapshot.itemId);
      const cacheTimestamp = snapshot.cacheTimestamp || snapshot.timestampObserved;
      const last = points[points.length - 1];
      if (last && last.cacheTimestamp === cacheTimestamp) return false;
      if (last && snapshot.timestampObserved * 1000 - last.timestamp * 1000 < HISTORY_MIN_GAP_MS) return false;

      points.push({
        timestamp: snapshot.timestampObserved,
        cacheTimestamp,
        lowestPrice: snapshot.lowestPrice,
        secondPrice: snapshot.secondPrice,
        marketAnchor: snapshot.calculatedMarketAnchor,
        totalQuantityTop20: snapshot.top20Quantity,
        medianListingPrice: snapshot.medianListingPrice
      });

      const cutoff = Date.now() - clamp(settings.historyRetentionDays, 1, 90) * ONE_DAY_MS;
      const trimmed = points
        .filter((point) => point.timestamp * 1000 >= cutoff)
        .slice(-HISTORY_MAX_POINTS);
      Store.set(key, trimmed);
      return true;
    }
  }

  let settings = Store.settings();

  function log(...args) {
    if (settings.developerMode) console.log(APP.logPrefix, ...args);
  }

  // ---------------------------------------------------------------------------
  // Torn API client
  // ---------------------------------------------------------------------------

  class MarketEdgeCancelledError extends Error {
    constructor(message = "Market Edge request cancelled.") {
      super(message);
      this.name = "MarketEdgeCancelledError";
      this.code = "ME_CANCELLED";
      this.silent = true;
    }
  }

  class TornRateLimitError extends Error {
    constructor(message = "Torn API rate limit reached.", retryAfterMs = API_RATE_LIMIT_BACKOFF_MS) {
      super(message);
      this.name = "TornRateLimitError";
      this.code = "TORN_RATE_LIMIT";
      this.retryAfterMs = Math.max(1000, asInt(retryAfterMs, API_RATE_LIMIT_BACKOFF_MS));
    }
  }

  function retryAfterMsFromHeaders(rawHeaders) {
    const match = String(rawHeaders || "").match(/^retry-after:\s*([^\r\n]+)/im);
    if (!match) return null;
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(match[1]);
    return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
  }

  function isRateLimitError(error) {
    return error?.code === "TORN_RATE_LIMIT";
  }

  function isCancelledError(error) {
    return error?.code === "ME_CANCELLED";
  }

  class RequestScheduler {
    constructor({ maxPerMinute, concurrency, minGapMs = 0 }) {
      this.maxPerMinute = maxPerMinute;
      this.concurrency = concurrency;
      this.minGapMs = Math.max(0, asInt(minGapMs));
      this.requestTimes = [];
      this.active = 0;
      this.queue = [];
      this.sequence = 0;
      this.timer = null;
      this.blockedUntil = 0;
      this.nextStartAt = 0;
    }

    schedule(task, priority = 0, { scope = "general" } = {}) {
      return new Promise((resolve, reject) => {
        this.queue.push({ task, priority, scope, resolve, reject, sequence: this.sequence++ });
        this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
        this.pump();
      });
    }

    cancelQueued(predicate = () => true, message = "Market Edge request no longer needed.") {
      const keep = [];
      for (const job of this.queue) {
        if (predicate(job)) job.reject(new MarketEdgeCancelledError(message));
        else keep.push(job);
      }
      this.queue = keep;
      this.pump();
    }

    backoff(waitMs = API_RATE_LIMIT_BACKOFF_MS) {
      const until = Date.now() + Math.max(1000, asInt(waitMs, API_RATE_LIMIT_BACKOFF_MS));
      this.blockedUntil = Math.max(this.blockedUntil, until);
      log("API scheduler cooldown", Math.ceil((this.blockedUntil - Date.now()) / 1000), "seconds");
      this.pump();
    }

    cooldownRemainingMs() {
      return Math.max(0, this.blockedUntil - Date.now());
    }

    setTimer(waitMs) {
      const delay = Math.max(25, Math.ceil(waitMs));
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, delay);
    }

    pump() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }

      const now = Date.now();
      this.requestTimes = this.requestTimes.filter((time) => now - time < ONE_MINUTE_MS);

      if (now < this.blockedUntil) {
        this.setTimer(this.blockedUntil - now + 25);
        return;
      }

      if (!this.queue.length || this.active >= this.concurrency) return;

      if (this.requestTimes.length >= this.maxPerMinute) {
        const waitMs = ONE_MINUTE_MS - (now - this.requestTimes[0]) + 50;
        this.setTimer(waitMs);
        return;
      }

      if (now < this.nextStartAt) {
        this.setTimer(this.nextStartAt - now);
        return;
      }

      // Start at most one request per pump. The gap timer staggers starts while
      // still allowing up to the configured number of requests to overlap.
      const job = this.queue.shift();
      const startedAt = Date.now();
      this.active += 1;
      this.requestTimes.push(startedAt);
      this.nextStartAt = startedAt + this.minGapMs;

      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          this.pump();
        });

      if (this.queue.length && this.active < this.concurrency) {
        this.setTimer(Math.max(25, this.nextStartAt - Date.now()));
      }
    }
  }

  class TornApi {
    constructor() {
      this.base = "https://api.torn.com/v2";
      this.scheduler = new RequestScheduler({
        maxPerMinute: API_MAX_REQUESTS_PER_MINUTE,
        concurrency: API_CONCURRENCY,
        minGapMs: API_MIN_REQUEST_GAP_MS
      });
      this.memoryCache = new Map();
      this.inFlight = new Map();
    }

    buildUrl(path) {
      const url = new URL(`${this.base}${path}`);
      if (!url.searchParams.has("comment")) url.searchParams.set("comment", API_COMMENT);
      return url.toString();
    }

    async request(path, {
      cacheMs = SNAPSHOT_FALLBACK_FRESH_MS,
      priority = 0,
      scope = "general",
      rateLimitRetries = API_RATE_LIMIT_RETRIES
    } = {}) {
      const key = Store.apiKey();
      if (!key) throw new Error("API key missing. Open Market Edge settings.");

      const cacheKey = path;
      const cached = this.memoryCache.get(cacheKey);
      if (cacheMs > 0 && cached && Date.now() - cached.at < cacheMs) return cached.data;
      if (this.inFlight.has(cacheKey)) return this.inFlight.get(cacheKey);

      const performRequest = () => new Promise((resolve, reject) => {
        log("API request", path);
        GM_xmlhttpRequest({
          method: "GET",
          url: this.buildUrl(path),
          headers: {
            Authorization: `ApiKey ${key}`,
            Accept: "application/json"
          },
          timeout: 20000,
          onload: (response) => {
            let body;
            try {
              body = JSON.parse(response.responseText || "{}");
            } catch {
              reject(new Error(`Torn API returned invalid JSON (HTTP ${response.status}).`));
              return;
            }

            const errorCode = asInt(body?.error?.code, 0);
            if (response.status === 429 || errorCode === 5) {
              const headerRetryMs = retryAfterMsFromHeaders(response.responseHeaders);
              const waitMs = Math.max(headerRetryMs || 0, API_RATE_LIMIT_BACKOFF_MS);
              const error = new TornRateLimitError(
                "Torn API shared user limit reached. Market Edge is cooling down.",
                waitMs
              );
              this.scheduler.backoff(error.retryAfterMs);
              reject(error);
              return;
            }

            if (response.status < 200 || response.status >= 300) {
              const message = body?.error?.error || body?.error?.message || `HTTP ${response.status}`;
              reject(new Error(`Torn API: ${message}`));
              return;
            }
            if (body?.error) {
              reject(new Error(`Torn API: ${body.error.error || body.error.message || "Unknown error"}`));
              return;
            }
            resolve(body);
          },
          onerror: () => reject(new Error("Unable to reach the Torn API.")),
          ontimeout: () => reject(new Error("Torn API request timed out."))
        });
      });

      const runAttempt = (attempt = 0) => this.scheduler
        .schedule(performRequest, priority, { scope })
        .catch((error) => {
          if (isRateLimitError(error) && attempt < rateLimitRetries) {
            log("Rate limited; queued retry", path, attempt + 1);
            return runAttempt(attempt + 1);
          }
          throw error;
        });

      const promise = runAttempt()
        .then((data) => {
          this.memoryCache.set(cacheKey, { at: Date.now(), data });
          return data;
        })
        .finally(() => this.inFlight.delete(cacheKey));

