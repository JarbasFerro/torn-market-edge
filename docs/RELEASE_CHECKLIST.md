# Release checklist

Use this checklist for every public version sent to Greasy Fork.

## 1. Scope and code

- [ ] Release scope is clearly defined.
- [ ] Dead/debug code removed.
- [ ] No API key, token, private identifier or credential is present in source/history intended for publication.
- [ ] Userscript remains readable and non-minified.
- [ ] No unauthorized external executable code is loaded.
- [ ] `@match` entries only cover sites where the script provides functionality.

## 2. Metadata

- [ ] `@name` remains `Torn Market Edge`.
- [ ] `@namespace` remains `https://github.com/JarbasFerro/torn-market-edge`.
- [ ] `@version` is incremented before publishing changed code.
- [ ] `@description` accurately describes current behavior.
- [ ] `@homepageURL` and `@supportURL` are current.
- [ ] `@license MIT` matches the repository license.
- [ ] `@connect` remains restricted to required hosts.

Do not casually change `@name` + `@namespace` after Greasy Fork publication because userscript managers use them to identify the installed script.

## 3. Correctness

- [ ] `npm run check` passes (build, syntax check, economics, DOM fixtures and panel smoke tests).
- [ ] Own-listings panel verified with a Limited key and a Public key.
- [ ] Watchlist alert verified once and confirmed silent while the tab is hidden.
- [ ] Torn PDA smoke test (launcher, injected key, Bazaar fill).
- [ ] Inventory category switching works without refresh.
- [ ] Own-Bazaar Price per unit is read correctly.
- [ ] Inline overlays render correctly on mobile.
- [ ] Item Market detailed analysis still works.
- [ ] Unsupported equipment is not given commodity valuations.

## 4. Compliance/privacy

- [ ] No automatic buy/sell/bid/form-submit behavior exists.
- [ ] No hidden non-API Torn page requests exist.
- [ ] No CAPTCHA interaction exists.
- [ ] No tracking/ads/analytics were introduced without explicit disclosure.
- [ ] API key is never logged or exported.
- [ ] DOM processing stops when the page is not visible.

## 5. API behavior

- [ ] Request budget remains comfortably below Torn's documented global limit.
- [ ] In-flight deduplication works.
- [ ] Cache timestamps are honored.
- [ ] Repeated requests do not intentionally bypass global Item Market cache.

## 6. Documentation

- [ ] `CHANGELOG.md` updated.
- [ ] README reflects the current release.
- [ ] Greasy Fork Additional Info updated when capabilities/permissions change.
- [ ] Privacy statement updated if data handling changes.

## 7. Publish

- [ ] Commit the final `torn-market-edge.user.js` to `main`.
- [ ] Confirm the raw GitHub URL returns the final source.
- [ ] Create Git tag/release matching the userscript version, e.g. `v0.2.0`.
- [ ] Trigger/check Greasy Fork sync.
- [ ] Confirm Greasy Fork shows the expected version and metadata.
- [ ] Install the Greasy Fork copy in a clean userscript-manager profile and smoke-test it.
