# Storefront script delay: analysis and plan (2026-09-24, revised)

**Status: analysis and proposal only. Nothing in this document has been implemented.**
Written for the PagePulse developers (and any AI assisting them). It re-checks a second AI's diagnosis against the code, Shopify's
documentation and measurements, records the follow-up questions asked afterwards, and proposes a plan. If this file and the code
disagree, the code wins.

**Stated priority (from the product owner):** optimise for **first-time (cold) visitors**, because PageSpeed Insights / Lighthouse score
every page as a cold load, and PagePulse is a performance app judged by those scores.

---

## 1. The problem

Console output from the storefront (dev store, theme preview, `TEMP_TIMING_LOG` enabled):

```
[PagePulse] script started executing 1583 ms after navigation start (readyState: loading, <script> tags parsed before it: 40)
[PagePulse] script file: requested at 836 ms, finished at 1581 ms (download 766 ms, 13.3 KB, from network)
[PagePulse] defer logic installed in 23.1 ms
[PagePulse] DOMContentLoaded at 1764 ms (181 ms after the script started)
[PagePulse] window load at 2787 ms; first-contentful-paint: 1644 ms (script ran BEFORE first paint)
```

Also in the console: `Uncaught SyntaxError: Identifier 'ON_CHANGE_DEBOUNCE_TIMER' has already been declared` (and the same for `pubsub.js`,
`global.js`, `details-disclosure.js`, `animations.js`, …). See section 4.

**Question:** is this fast, and how do we reduce the delay?

---

## 2. Re-check of the second AI's diagnosis

The second AI concluded: (1) 836 ms is queueing behind 40 script tags, (2) 766 ms is a Postgres round trip on every request, (3) add an
in-memory cache / CDN, (4) reorder the app embed to the top of the theme.

| Claim | Verdict | Evidence |
|---|---|---|
| Our own logic is fast (23 ms) | **Correct** | The log above. |
| 836 ms is spent parsing 40 script tags | **Not supported** | Parsing a tag costs microseconds; only *blocking external* scripts before ours cost time. The 836 ms is when the request was *sent*, so it mostly contains the **HTML document's own response time** plus reaching our tag. The current log does not separate these (Phase 0). |
| "Drag-reorder the app embed to the top" | **Will not help** | Shopify docs (*Configure theme app extensions*): app embed blocks are injected **before `</head>`**, i.e. at the **end** of head. That is why 40 tags come first. The only documented "first in head" placement is `"target": "compliance_head"`. No documentation for reordering embeds was found. |
| The 766 ms is a DB round trip | **Wrong in dev** | Measured on the local Postgres: the route's Store query **1.3 ms** (p95 2.0 ms); Session lookup **0.4 ms**. In dev the time is Shopify's app-proxy hop + the tunnel + the laptop. A remote production DB could differ, but that is not measured yet. |
| `authenticate.public.appProxy` is just a cheap HMAC check | **Wrong, and it hides a real problem** | See section 3. |
| Add an in-memory cache keyed by shop | **Low value right now** | Saves about 1 ms locally. Worth it only if a production measurement shows a slow DB. Multi-instance invalidation has a cost. |
| Put a CDN in front of the app proxy | **Does not work as described** | The browser requests `your-store.myshopify.com/apps/…`; Shopify forwards it to the origin. A CDN in front of the origin is invisible to the shopper's request. |
| Possible serverless cold start | Plausible in production | Hosting unknown; compare warm vs cold. |
| Turn `TEMP_TIMING_LOG` off before shipping | Correct | It is marked temporary. |
| 13.3 KB is the encoded size, so gzip is on | Correct | The stored script is about 32 KB raw. |
| "Aim for under 300 ms" | Arbitrary | What matters is how much the script **delays first paint** and whether it runs **before** the scripts it wants to defer. |

### What the data does show
- First contentful paint (1644 ms) came **63 ms after** our script finished (1581 ms). The tag is a blocking `<script src>`, so first paint very
  likely waited for it.
- The script sits at the end of head, after 40 tags, so it cannot hold back scripts that come before it.
- Not yet known: how the 766 ms splits into *waiting* (Shopify proxy + tunnel + our route) versus *download*, and the document's TTFB.

---

## 3. A real problem the second AI missed: token refresh on shopper requests

`app/routes/api.storefront-scripts.jsx` calls `authenticate.public.appProxy(request)` for every storefront request. Reading the library
(`@shopify/shopify-app-react-router`, `authenticate/public/appProxy/authenticate.mjs`):

1. It verifies the signature (cheap).
2. It then **loads the shop's offline session from the database** (`createOrLoadOfflineSession`).
3. `app/shopify.server.js` sets `future.expiringOfflineAccessTokens: true`, so `ensureOfflineTokenIsNotExpired` runs: when the token is within
   **5 minutes of expiry** it makes a **network call to Shopify to refresh the token and writes it back to the DB**, during a shopper's page request.

The dev store's token expires hourly (`expires 2026-09-24T11:46:57Z`). Consequences:
- Once an hour per store, one shopper request waits for a Shopify round trip.
- Several concurrent shoppers in that window can each try to refresh. Refresh tokens are single-use, so losing that race can break the app's session.
- The route never uses the session (it only needs the shop domain).

This did not cause the 766 ms in the log (the measurement was outside the refresh window), but it is a real risk and it is cheap to remove.

---

## 4. A real bug: theme scripts run twice

Reproduced locally with a Playwright test (a `defer` script placed before ours and listed on the defer list):

- The theme's scripts that come **before** our tag (Dawn's `constants.js`, `global.js`, …) load and run normally.
- Our script still marks them as gated (`document.querySelectorAll("script").forEach(B)` at start, plus the MutationObserver).
  Changing `type`/`src` after a script has been prepared has **no effect**: it is already fetched or running and cannot be stopped.
- On the first interaction the release step re-creates those scripts, so they run a **second time**. Top-level `const`/`class` declarations
  throw `Identifier … has already been declared`; scripts without such declarations silently run twice (duplicate listeners, etc.).

This is a functional risk for the store, independent of speed.

---

## 5. Follow-up questions and answers

### Q1. "What do you remove in Phase 1? Do you remove the API call?"
**No request is removed.** The browser still makes exactly one HTTP request for the script (Phase 2A is what removes it). Phase 1 removes the
*extra work the server does before it can answer* that request.

Today the route runs `authenticate.public.appProxy(request)`, which does three things:
1. checks the signature (cheap, no I/O);
2. **loads the offline session from the database**, which the route does not need (it only reads the shop domain, also available as `?shop=`);
3. **refreshes the access token over the network** when it is within 5 minutes of expiry, then writes it back to the DB.

Phase 1 replaces this with a small hand-written signature check (`verifyAppProxySignature`) that does **only step 1**. Result:
- the per-request session lookup is gone;
- the once-an-hour token refresh during a shopper's page load is gone (and the race that can break the session);
- the one DB query that is genuinely needed (`prisma.store.findUnique`: is the store active and enabled, and what is the stored script) stays.

**Be realistic about the gain:** the session lookup measured 0.4 ms locally, so Phase 1 will **not** fix the 766 ms. Its value is removing an hourly
worst case and a session-breaking race, and keeping the route minimal. The route remains the fallback delivery path even after Phase 2A.

### Q2. "Is injecting the script from a metafield slower or faster?"
**Faster on a cold load, because the second request disappears.** Today: HTML arrives, the parser reaches `<script src="/apps/performance-scripts">`,
and the browser makes a new request (Shopify proxy, your server, DB, response) before it can continue. With an app-owned metafield, Shopify's Liquid
renders the script text **inside the HTML document** (`{{ app.metafields… }}`), so there is nothing to fetch.

What it costs:
- about 19 KB (about 7 KB gzip) added to **every page's HTML**, on every visit (inline code cannot be cached separately from the document);
- the inline script still executes when the parser reaches it (about 23 ms of work).

What it does **not** remove: the time until the parser reaches the tag. In the log, the request was sent at 836 ms; that portion (document response
plus reaching our tag) remains. Expected effect on that measurement: the script would start at roughly 840 ms instead of 1583 ms, about **750 ms earlier**.
This is an estimate from one dev-store run; it must be re-measured.

### Q3. "PageSpeed Insights only ever sees first-time visitors, so is caching irrelevant?"
For the **score**, yes. Lighthouse's default mode is a cold load: it clears cache/storage before each run, and PSI uses that lab run for the Performance
score. PagePulse's own audit also uses a fresh browser context per page (`browser.newContext()`), so it measures a cold load too. A long-lived cached
script file gives no credit in that scoring.

Two limits on that argument:
- PSI also shows **field data** (Chrome UX Report, real users) for the Core Web Vitals assessment, and real users include repeat visits. So caching is not
  worthless for the merchants' actual visitors; it just does not affect the lab score.
- Shopify storefront HTML is heavily cached at Shopify's edge, so the extra 7 KB gzip on each page is cheap, but it is not zero on repeat views.

Decision: with the stated priority (first-time visitors / Lighthouse score), **Option A (inline) is the recommended direction**, and Option C (long-cache
versioned URL) is deprioritised.

### Q4. "Is `compliance_head` (Option B) just about correctness, not speed?"
Partly. It does not shorten the script's own latency. But for a **performance app**, effectiveness is the score lever: the script can only defer
scripts that load **after** it. At the end of head, everything before it (Dawn's own `defer` scripts, Shopify's inline scripts) has already been
requested. Running first in head is what makes the deferral actually apply to those scripts. So Option B is worth deciding on for score impact, not just for
the double-execution bug (which Phase 3 fixes on its own).

---

## 6. Plan

Recommended order: **Phase 0, then the Phase 2A spike, Phase 3, Phase 1, Phase 2A implementation, then decide Phase 2B.**

### Phase 0: measure (no behaviour change)
Extend the temporary log in `app/lib/script-generator.js` (`withTimingLog`) and add one header in the route:
- **Resource split:** `waiting = responseStart - requestStart`, `download = responseEnd - responseStart`, `nextHopProtocol`, `serverTiming`.
- **Navigation timing:** `responseStart` (document TTFB), `responseEnd`, `domInteractive`.
- **Position in head:** how many *blocking external* scripts (`src`, not `async`/`defer`) come before ours, versus `defer`/inline.
- `app/routes/api.storefront-scripts.jsx`: add `Server-Timing: app;dur=<ms spent in our code>`.
- Compare **embed OFF vs ON** (5 cold loads each, FCP/LCP) for the true cost. Keep these numbers as the **baseline** for judging Phase 2A.

### Phase 2A spike (small, do before committing to A): prove the metafield can be inlined
Shopify's docs show `app.metafields.<namespace>.<key>` being read in an app block schema (`available_if`), but not explicitly inside an inline `<script>`.
Verify on the dev store, with a tiny test metafield:
- an app-owned metafield (`$app` namespace) written with `metafieldsSet` is readable in an **app embed block** via `{{ app.metafields.<ns>.<key>.value }}`;
- the value is output **unescaped** inside `<script>` (no HTML escaping, no truncation), including quotes and newlines;
- a 20 to 30 KB value works (limit is 256 KB per metafield); the 100 KB Liquid limit applies to Liquid files, not to runtime values;
- how quickly a metafield change shows up on the storefront.
If any of these fail, fall back to Option C for the delivery path.

### Phase 3: fix the double execution
In the raw template inside `generateDeferredScript` (`app/lib/script-generator.js`):
- Remove the initial sweep of existing scripts and the MutationObserver **marking**. Gate only through the patched insertion calls
  (`appendChild`, `insertBefore`, `replaceChild`, `src`/`setAttribute("src")`), which run *before* a script starts, and release exactly those.
- Playwright tests: static script before ours (runs once, no error); static script after ours (runs once); a dynamic `head.appendChild` script on the
  gated list (held, then released once after the first interaction); the delay timers still work.
- Separate question: the audit puts the store's own theme assets (`global.js`, …) on the defer list. Consider excluding first-party theme assets from
  `auditDeferArray` (`app/lib/audit-script.ts`). Needs a decision.

### Phase 1: safe server fixes
1. **Stop using `authenticate.public.appProxy` in the script route.** New `app/lib/app-proxy-auth.server.ts` exporting
   `verifyAppProxySignature(url, secret)`, mirroring the library exactly: drop `signature`; sort params by key (`localeCompare`); join
   `key=value` (repeated keys joined with `,`); concatenate with no separator; HMAC-SHA256 (hex) with `SHOPIFY_API_SECRET`; compare with
   `crypto.timingSafeEqual`; reject if `|now - timestamp| > 90 s`. Take the shop from the `shop` param. Invalid signature still returns 400.
2. **Route tidy-up:** one Prisma query (drop the unneeded `orderBy`/`take` on the unique config), keep ETag/304 and cache headers, add `Server-Timing`.
3. **Tests** (scratch scripts): Shopify's documented signature vectors (secret `hush`), a tampered query, an old timestamp, repeated params,
   and parity with `@shopify/shopify-api`'s own `validateHmac` on random queries.
- No in-memory cache unless Phase 0 shows the route itself is slow in production.

### Phase 2A implementation: inline the script from an app-owned metafield (recommended)
Moves the work **off the shopper's request path** and onto the merchant-action path (where it already happens, when the script is rebuilt).
- **Write path:** after `rebuildPerformanceScript` stores the script in `PerformanceScript.deferScript`, also write it to an app-owned metafield
  (`metafieldsSet`, owner = the app installation, namespace `$app`) using an offline admin client (`unauthenticated.admin(shop)`). Writing an empty
  string (or deleting the metafield) when the app is disabled or uninstalled. Handle a failed write: keep the DB copy, log, retry on the next rebuild.
  Callers today do not have an `admin` client, so the write is done from inside the rebuild helper via `unauthenticated.admin`.
- **Read path:** `extensions/script-injector/blocks/performance-loader.liquid` renders
  `{% if app.metafields.<ns>.<key> != blank %}<script>{{ app.metafields.<ns>.<key>.value }}</script>{% else %}<script src="/apps/performance-scripts"></script>{% endif %}`
  (exact syntax confirmed by the spike). The `src` fallback keeps installs working before their first rebuild and if a metafield write fails.
- **Safety:** ensure the stored script can never contain a literal `</script>` (the obfuscated output should not; add a check that fails the rebuild).
- **Backfill:** existing stores get the metafield the next time their script is rebuilt; add a one-off backfill for stores that already have a stored script.
- **Deploy:** the Liquid change needs `shopify app deploy`.
- Requires no extra access scope for app-owned metafields (confirm in the spike).

### Phase 2B: `"target": "compliance_head"` (decide after 2A)
Runs the script first in head so it can actually defer the theme's scripts (see Q4). Shopify says to use it only when necessary (for example consent banners),
so it needs a justification for App Store review. Best combined with 2A: a blocking script placed *first* makes a slow network fetch hurt more, but an
inline script has no fetch.

### Phase 2C: versioned URL with a long immutable cache (deprioritised)
Helps repeat visitors and real-user field data only; no effect on a Lighthouse cold-load score. Revisit later if repeat-visit performance matters.

---

## 7. Files that would change
- Phase 0: `app/lib/script-generator.js`, `app/routes/api.storefront-scripts.jsx`
- Phase 3: `app/lib/script-generator.js`
- Phase 1: new `app/lib/app-proxy-auth.server.ts`, `app/routes/api.storefront-scripts.jsx`
- Phase 2A: `extensions/script-injector/blocks/performance-loader.liquid`, `app/lib/performance-script.server.ts` (metafield write), a small backfill script
- Phase 2B (if chosen): `extensions/script-injector/blocks/performance-loader.liquid` (`target`)
- No database schema changes. After any `script-generator.js` change the stored script must be rebuilt (toggle the app off and on, or save a Step 2 field).

## 8. Verification
1. Phase 1 tests pass (signature vectors, tamper, timestamp, parity with the library); a real proxied request returns 200 + JavaScript + ETag, then 304;
   a forged query returns 400; no token-refresh call on storefront requests, checked with a session whose `expires` is within 5 minutes.
2. Phase 2A spike results recorded (readable in an app embed, unescaped, size, propagation delay).
3. Phase 2A on the dev store: view-source shows the script inline in `<head>`; the Network tab shows **no** request to `/apps/performance-scripts`;
   the timing log shows the script starting near the earlier "requested at" time (about 840 ms in the baseline) instead of 1583 ms; FCP compared with the
   embed-OFF baseline; a Lighthouse cold run before and after.
4. Fallback: with the metafield empty, the page still loads the script through `<script src>`.
5. Phase 3: the Playwright cases pass, and on the store the "already been declared" errors are gone after the script is rebuilt.

## 9. Measurements and sources used
- Local Postgres, 40 runs each: route Store query median 1.3 ms / p95 2.0 ms; Session lookup median 0.4 ms / p95 0.7 ms.
- Offline session for the dev store: refresh token present, `expires 2026-09-24T11:46:57Z`.
- Library source: `@shopify/shopify-app-react-router` (`authenticate/public/appProxy/authenticate.mjs`, `helpers/ensure-offline-token-is-not-expired.mjs`,
  `helpers/create-or-load-offline-session.mjs`) and `@shopify/shopify-api` (`lib/utils/hmac-validator.mjs`).
- Shopify docs: *Configure theme app extensions* (app embeds injected before `</head>`; `compliance_head` included first; app metafields readable via the
  Liquid `app` object); *Authenticate app proxies* (signature algorithm); metafield value limit 256 KB.
- Lighthouse/PSI cold-load behaviour: from the second AI's research; consistent with Lighthouse's documented default of clearing cache and storage per run.
  Not independently re-verified in this session.
