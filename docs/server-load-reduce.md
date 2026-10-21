# Server load reduction — working analysis

> Living note. Sol1 is the earlier recommendation (the four safe changes in
> `docs/SERVER-CAPACITY-AND-AUDIT-PERFORMANCE.md`). Sol2 is a later design
> aimed at cutting about 80% of the scan’s load without losing audit quality.
> Add the next round of thinking under **Open questions**. Do not treat either
> solution as implemented.

**Server this note is written for:** 2 vCPU, 4 GiB RAM, Linux. The same machine runs the Shopify app, the admin panel, and PostgreSQL. Headless Chromium is installed on that machine (`CHROMIUM_PATH`).

**Date of this pass:** 16 October 2026. Numbers below were read from the current `app/lib/audit.server.ts` and `app/lib/audit-runner.server.ts`, and from the capacity note. Re-check the constants after any edit.

---

## 1. What “load” means here

Two different problems get mixed together. They need different fixes.

| Kind of load | What it is | What “down” looks like |
|---|---|---|
| **Peak RAM** | How much memory is in use at the busiest instant of a scan | Linux OOM-kills Chromium or Node. Every in-flight scan dies. The app stops answering. |
| **Time under load** | How long Chromium and Node stay busy for one scan | The box is sluggish for 1–3 minutes per scan. Two overlapping scans feel like an outage even if nobody is killed. |

An 80% cut has to say which one. Sol2 aims at **both**: a much smaller peak, and about one fifth of today’s Chromium-seconds per scan.

---

## 2. What the server is already spending

Idle, before any scan (from the capacity note):

| Piece | Typical RAM |
|---|---|
| Shopify app (Node, idle) | 150–200 MB |
| Admin panel (Next.js, idle) | 120–180 MB |
| PostgreSQL | 80–200 MB |
| OS | 250–350 MB |
| **Idle total** | **about 600–930 MB** |

That leaves roughly 3 GB for a scan. Chromium’s base process is about 300 MB and is paid once (one shared browser, `getBrowser()` in `audit.server.ts`). Each open page is another browser context, about 80–150 MB, and a heavy storefront can push one page toward 200–300 MB.

The capacity note’s table says 8 scans at once is the out-of-memory zone on 4 GiB, and 4 at once is the conservative safe line **if** each scan only holds 3 pages and closes them at the end of the pass. The code does not do that. See §3.

---

## 3. What one scan actually does today

`startAuditForStore()` (`audit-runner.server.ts`) marks the shop as running and then starts the scan in a floating promise. It returns immediately. The dashboard polls `/api/audit/status` once a second until that scan finishes. The poll is not the outage. The scan is.

`runHiddenAudit()` (`audit.server.ts`):

1. One shared Chromium process. It stays up for **2 minutes** after the last scan (`BROWSER_IDLE_CLOSE_MS`).
2. **3 passes** (`AUDIT_REPEAT_PASSES = 3`). Pass 1 is the full measure. Passes 2 and 3 are harvest-only (no coverage, no fold snapshot, no clicking) but each still loads every page and waits for it to settle.
3. **Every page in a pass runs at the same time** (`Promise.all` over the URL list).
4. Page budget, per page, per pass:
   - navigation up to 45 s (`PAGE_LOAD_TIMEOUT_MS`)
   - settle at least 5 s, then two 900 ms probes (`SETTLE_MIN_MS`, `SETTLE_PROBE_GAP_MS`, `SETTLE_STABLE_CHECKS`)
   - pass 1 also scrolls (at least 6 steps) and clicks up to 25 targets (`MAX_INTERACTION_TARGETS`), with a 30 s cap
   - a second settle after the clicks
   - absolute settle cap 40 s (`SETTLE_SAFETY_NET_MS`)
5. Merchant “+” pages are capped at **8** (`MAX_EXTRA_PAGES`), on top of home, collection, and product. Worst case is **11 pages at once**, not 3.
6. Contexts from all passes are kept until the function’s `finally`. They are not closed at the end of each pass. Peak RAM is “all pages × all passes still open,” not “one pass of 3 pages.”
7. For script size, if the response has no `Content-Length`, the scan reads the **entire file into Node** (`res.body()`). That cost is not in the capacity note.

There is a queue (`audit-queue.server.ts`, default `MAX_CONCURRENT_AUDITS = 1` via `AUDIT_MAX_CONCURRENT_SHOPS`). `app/shopify.server.js` does not start it. Every shop that turns the app on launches a scan on the web process with no global cap. A second scan for the same shop does not cancel the Chrome work the first scan has already started.

Typical wall time from the capacity note: about 45–110 s for 3 pages, up to 3–4 minutes on a heavy store. A large share of that is mandatory waiting: 5 s × 2 settles × 3 passes is 30 s of sleeping even when the page was quiet after 1 s.

---

## 4. Quality bar (do not trade these away)

A lighter scan is only acceptable if these stay true:

1. **Script list.** Every `.js` request the page actually makes is still recorded. The request listener, not the 250-entry performance buffer, is the source of that list.
2. **Classification.** Deferred, never-defer, noise, the app’s own script, and fold-protected stay decided the same way. Coverage (“did this script run before interaction?”) is part of that decision. Dropping coverage would defer scripts that the page needs.
3. **Fold hide list.** Above-the-fold elements (1100 px) are still measured on a page that has its CSS. Hiding the wrong element is a storefront bug, not a performance win.
4. **Token stability.** The storefront matches a defer token as an exact substring of the script URL. A hash that changes per request must still collapse to one prefix (`mergeSlugVariants`). The previous audit’s tokens are already merged in (`readPriorDeferTokens`) so a deploy between scans is covered without a second pass.
5. **Size and timeline are measurements, not the audit result.** A blank size means the byte count was not on the response. It does not mean the scan left the page early. Filling size by downloading every file is optional and is the wrong trade on 4 GiB.

---

## Sol1 — Cap and shorten (previous recommendation)

This is the plan already written up as R1–R4 in `docs/SERVER-CAPACITY-AND-AUDIT-PERFORMANCE.md`. It keeps the same scan shape (3 passes, pages in parallel, coverage, fold, clicks) and only stops the box from falling over.

| Change | Where | Effect |
|---|---|---|
| R1. Semaphore, max **2** scans at once | `audit-runner.server.ts` | The only change that prevents an OOM from failing every in-flight scan. A third shop waits. |
| R4. Chrome flags, especially `--disable-dev-shm-usage` | `getBrowser()` | `/dev/shm` on a small VM is often 64 MB. Chrome crashes when it fills that. Also sheds on the order of 50–100 MB. |
| R2. `SETTLE_MIN_MS` 5000 → 2000 | `audit.server.ts` | About 18 s off a normal scan. The two stability probes still catch a script that arrives after a short lull. |
| R3. `MAX_INTERACTION_TARGETS` 25 → 10 | `audit.server.ts` | About 6 s off pass 1. Clicks 11–25 repeat patterns the first 10 already opened. |

Optional in that note, not part of the core four: probe gap 900 → 500 ms (~5 s), and 3 passes → 2 (~10–23 s).

**What Sol1 does not do**

- It does not cut one scan’s peak RAM by 80%. Two scans still mean two sets of parallel pages inside one Chrome.
- It assumes 3 pages and tabs that close after each pass. This tree can open up to 11 pages and holds every pass’s tabs until the end, so “4 scans is safe” in the old table is too optimistic until that is fixed.
- It does not remove `res.body()`. Those buffers sit in the Node process, which the OOM killer may choose instead of Chrome.

**Expected outcome if Sol1 is shipped as written:** a normal 3-page scan falls from about 90 s to about 50–60 s. Peak concurrency stays at 2. The server survives a small rush. Load during one scan is still most of a Chrome plus several live pages.

---

## Sol2 — About 80% less scan load, same audit result

Sol1 makes the current scan safer. Sol2 changes the shape of the scan so the 4 GiB box is doing about a fifth of today’s Chrome work, and the script list, classification, and fold decision stay.

### 5.1 Where the 80% comes from

Count Chromium-seconds, not just the clock on the wall. Today a 3-page scan is:

`3 passes × 3 pages in parallel × (load + settle + pass-1 interaction)`

Peak RAM on top of idle is about **300 MB Chrome + 3 × ~120 MB contexts ≈ 660 MB**, and that RAM stays high for the whole minute-plus. Eleven pages (3 + 8 extras) is several times that, and the tabs are not released between passes.

| Lever | Load removed | Quality |
|---|---|---|
| **One pass, not three** | About two thirds of page loads and settles. Passes 2 and 3 do not discover a new kind of script. They only take a second and third sample of the same URLs so `mergeSlugVariants` can see a changing hash. | Kept. Pass 1’s request listener already records every `.js` URL. Deploy-to-deploy hash changes stay covered by `readPriorDeferTokens`. In-request hash rotation is the only gap; see §5.3. |
| **One page at a time, then close that context** | Peak page RAM goes from “all pages × all passes” to **one page**. On a 3-page store that is about a third of today’s context peak. On an 11-page store it is an order of magnitude. | Kept. Same measure function, same coverage, same fold snapshot. Wall clock gets longer. On 2 vCPU the three parallel pages already fight each other, so it is often closer to 1.5–2× than 3×. |
| **No `res.body()`** | Removes a Node heap spike of every uncached script body, per page. | Kept for defer/hide decisions. Size stays blank when the response has no `Content-Length`. That blank is a missing header, not a failed page. |
| **Close Chrome when the scan ends** | Drops the ~300 MB base within seconds instead of holding it for 2 minutes. | Kept. Next scan pays the launch cost (~1 s). |
| **Still one scan at a time on this box** | A rush of merchants no longer multiplies the peak. | Kept. They wait in line. The status poll already shows “running.” |

Together, a normal 3-page scan goes from roughly 660 MB of Chrome-related RAM held for ~90 s, to one context (~120 MB) plus Chrome (~300 MB) held for about one pass (~25–40 s after Sol1’s settle and click cuts, or ~35–50 s if those constants stay). Time-integrated load (MB × seconds) falls on the order of **75–85%** for the 3-page case. The 11-page case falls further, because today it is the unbounded peak.

Peak RAM cannot fall 80% **and** keep Chrome on this same box: the browser process alone is ~300 MB, which is already about half of one today’s scan. Sol2’s 80% is the work around that browser (extra passes, extra live tabs, downloaded file bodies, and overlapping shops), not the deletion of Chrome.

### 5.2 Concrete shape of a Sol2 scan

1. Admit at most **one** scan (`MAX_CONCURRENT_AUDITS = 1`) until a real memory reading on this server says two fit. The capacity note’s “2” assumed a lighter scan than the one in the tree.
2. Launch Chrome with `--disable-dev-shm-usage`, `--disable-gpu`, `--no-first-run`, `--disable-extensions`. Same as Sol1’s R4. Required on 4 GiB.
3. For each URL, in order: open one context, run **pass 1 only** (coverage, fold, interaction), record the request list and `Content-Length`, **close that context** before the next URL.
4. Do not start pass 2 or pass 3.
5. Keep `mergeSlugVariants` and `readPriorDeferTokens`.
6. Do not call `res.body()`.
7. Set `BROWSER_IDLE_CLOSE_MS` to about 10 s, not 2 minutes.
8. Apply Sol1’s settle and click cuts (R2, R3) on the single pass. They do not change which scripts are found. They shorten the one pass Sol2 still runs.

Block images, fonts, and media **only if** a follow-up measurement shows the fold snapshot still matches a full load. CSS must stay: the hide list is wrong if layout changes. That block is a later experiment, not part of the first Sol2 cut. See open questions.

### 5.3 The one quality risk, and how to cover it

Three passes exist for one reason: a token that contains a value which changes on every request (a nonce, an A/B bucket, a cache-buster). One pass sees one value, so `mergeSlugVariants` has nothing to merge, and the storefront rule (exact substring) can miss the next request’s URL.

That is a real gap. It is not “the scan didn’t stay on the page.”

Cover it without a second and third full pass:

- **Already in the code:** merge this run’s tokens with the previous audit’s tokens. A hash that changed at deploy time is still collapsed.
- **If production logs show a script that loaded but was not deferred because its hash moved inside one session:** add a single harvest reload of **home only**, after the full pass, with images allowed to stay blocked on that reload. One extra navigation, not ×3 pages ×2 passes. Do not add it until a missed token is actually observed. Building it “just in case” spends the load Sol2 is trying to remove.

Do not drop coverage, and do not skip the fold snapshot, to chase the last bit of RAM. Those two are the audit result. The extra passes are not.

### 5.4 What Sol2 deliberately does not do

| Idea | Why it is not in Sol2 |
|---|---|
| Move Chrome to another machine | Right later, when one light scan still fills this box. It does not reduce work; it moves it. This server is the only one in the spec. |
| Run the obfuscator in a worker thread | Worth doing, but it is an ~80 ms event-loop blip at the end. It is not the outage. |
| Cap at 2 while still doing 3 parallel passes | That is Sol1. It saves the box from a crowd. It does not cut one scan by 80%. |
| Download script bodies so the Size column is never blank | Fills a column by risking the Node process. Size is not required for defer or hide. |
| Shorten the scan by skipping fold or coverage | Those are the decisions the storefront script is built from. |

### 5.5 How to know Sol2 worked

On this server, during one scan of a real shop (home + collection + product):

- Peak RSS of the Chromium process and of the Node process, sampled every second.
- Wall time of the scan.
- Diff of `deferArray` and `hideSelectors` against a Sol1 (3-pass) scan of the same shop, taken the same day.

Success: Chromium-seconds and peak context count are about a fifth of the 3-pass parallel scan, and the defer and hide lists match aside from hash-only token variants. A variant that appears in the 3-pass list and not the 1-pass list is the §5.3 case, not a failed page.

---

## 6. How the two solutions sit together

| | Sol1 | Sol2 |
|---|---|---|
| Goal | Don’t OOM. Modestly faster scan. | About 80% less Chrome work per scan, same defer and hide result. |
| Scan shape | Unchanged: 3 passes, pages in parallel | 1 full pass, one page at a time, context closed immediately |
| Concurrent shops | 2 | 1 until measured, then maybe 2 |
| Quality risk | Low (fewer clicks, shorter settle) | One: in-request URL hashes, covered by the previous audit plus an optional home-only reload if we see misses |
| Fits 2 vCPU / 4 GiB | Yes, if tabs are also closed each pass and `res.body()` is removed | Yes. This is the plan that matches the box. |

Sol1 is the minimum if a release has to go out before the scan is reshaped. Sol2 is the plan to keep working in this file. Shipping Sol1’s flags and the “close the context when the page is done” fix is useful even if the pass count stays at 3 for one release: that single fix removes the worst peak (11 pages × 3 passes held open) without touching quality.

---

## 7. Open questions

Add the next round here. Do not delete Sol1 or Sol2 when a third option appears; add Sol3.

- [ ] Confirm on the 4 GiB host: RSS of Chrome and Node during one current 3-page scan. The 80–150 MB per context figure is a benchmark, not a reading from this server.
- [ ] Does a 1-pass scan of a real shop miss defer tokens that the 3-pass scan found, after `readPriorDeferTokens`? If yes, is it hash rotation (§5.3) or a script that only loads on pass 2?
- [ ] Is blocking fonts and media safe for the 1100 px fold snapshot? Images stay until that is measured.
- [ ] Should the “+” page cap of 8 stay, once pages are sequential? Sequential makes 8 safe for RAM and expensive for time. A lower cap may still be right for wall-clock.
- [ ] `TEMP_TIMING_LOG` in `script-generator.js` is hardcoded on. That is storefront console noise, not server RAM. Turn it off before a live release. It is not part of Sol1 or Sol2.





#AI 1
# Server load reduction — detailed plan

## First, an honest note on repo access

I don't have your git repo in this conversation — only the markdown file you pasted. So I can't read the actual `audit.server.ts`, `audit-runner.server.ts`, `audit-queue.server.ts`, `shopify.server.js`, or `script-generator.js`.

What I *can* do — and what this answer is — is give you a **complete, file-by-file implementation plan** derived from everything the md file documents about those files (function names, constant names, call flow, the queue, the floating promise, etc.). Every change below is expressed as a precise instruction against the symbols the md names. If you paste the actual files, I'll turn each item into an exact diff.

I'm treating the md's description of the code as accurate, because it was written by someone reading the tree.

---

## Part 1 — Confirming what actually causes the load

The md already separates two problems. Let me make the math explicit so the fix targets the right one.

### 1.1 The three load multipliers in the current scan

| Multiplier | Current value | Why it hurts |
|---|---|---|
| **Passes per scan** | `AUDIT_REPEAT_PASSES = 3` | Passes 2 and 3 are harvest-only. They reload every page and wait for settle, but only sample the same URLs a 2nd/3rd time. |
| **Pages in flight per pass** | `Promise.all(urls)` → up to **11** (`3` base + `MAX_EXTRA_PAGES = 8`) | Peak page RAM = all 11 contexts simultaneously, not 3. |
| **Context lifetime** | Held until the function's `finally` | Passes 2 and 3 add contexts *on top of* pass 1's, so peak is `pages × passes`, not `pages`. |

Those three multiply. Peak context RAM is roughly:

```
3 passes × 11 pages × ~120 MB  ≈  3.96 GB   (worst case, heavy storefront)
```

…which is larger than the entire 4 GiB box. That is the OOM.

The `res.body()` call is a fourth, independent spike: when a response lacks `Content-Length`, the whole script body is read into the **Node** heap. On an 11-page parallel pass, that's 11 concurrent full-body reads, and the OOM killer may pick Node instead of Chrome.

### 1.2 The time multiplier

Per page, per pass:

- up to 45 s navigation
- ≥ 5 s settle + two 900 ms probes
- pass 1 only: ≥ 6 scroll steps + up to 25 clicks under a 30 s cap
- second settle after clicks
- absolute settle cap 40 s (`SETTLE_SAFETY_NET_MS`)

Even a quiet page pays ~5 s × 2 settles × 3 passes = **30 s of pure sleeping** before you count any load time. That is the "time under load" half of the problem.

### 1.3 The concurrency multiplier that isn't capped

The md says the queue exists (`MAX_CONCURRENT_AUDITS = 1` default) **but `app/shopify.server.js` does not start it**. So the effective concurrency cap is "however many shops turn the app on." Two shops = two full scans = two Chromes' worth of contexts in the same Node process. This is the thing that turns a slow scan into an outage.

### 1.4 Conclusion

The load is **not** primarily caused by "doing the audit." It's caused by:

1. doing the audit **three times**,
2. doing it **in parallel across up to 11 pages**,
3. **keeping every pass's tabs open** until the very end,
4. **reading whole script bodies into Node**,
5. **holding Chrome alive for 2 minutes** after the last scan, and
6. **not enforcing a concurrency cap** at the entry point.

Fix those six and you cut the load without touching the audit result. That is exactly what you asked for: keep interaction, keep first-fold, keep coverage, keep the script list — just stop doing the same work three times in parallel with tabs held open.

---

## Part 2 — The plan (Sol2+), with **zero** quality trade

I'm calling this **Sol2+** because it's Sol2 with the interaction and fold parts explicitly *kept at full strength*. Sol1's R2 (settle 5 s → 2 s) and R3 (clicks 25 → 10) are moved to **optional** in Part 3, because you said you don't want to compromise the audit — and R3 in particular is the one change that can hide a script that only loads on a later interaction target.

### 2.1 The six structural changes

| # | Change | Load removed | Quality impact |
|---|---|---|---|
| **S1** | `AUDIT_REPEAT_PASSES = 1` | ~⅔ of page loads and settles | None. Pass 1 is the full measure (coverage, fold, interaction). Passes 2–3 only re-sample the same URLs. Covered by `readPriorDeferTokens`. |
| **S2** | Process URLs **sequentially**; open one context, run pass 1, **close that context** before the next URL | Peak page RAM goes from `pages × passes` to **1 context** | None. Same `measurePage` call, same listeners, same fold snapshot. |
| **S3** | Remove `res.body()`; leave Size blank when `Content-Length` is absent | Removes the Node heap spike | None. Size is a measurement column, not a defer/hide input (md §4.5). |
| **S4** | `BROWSER_IDLE_CLOSE_MS` → ~10 s (or close Chrome explicitly at scan end) | Drops ~300 MB base within seconds | None. Next scan pays ~1 s launch. |
| **S5** | Enforce `MAX_CONCURRENT_AUDITS = 1` **at the runner entry point**, not just in the queue module | Prevents multiplier (6) above | None. Shops wait; status poll already shows "running." |
| **S6** | Chrome flags: `--disable-dev-shm-usage`, `--disable-gpu`, `--no-first-run`, `--disable-extensions` | Avoids the 64 MB `/dev/shm` crash; sheds ~50–100 MB | None. |

### 2.2 What stays exactly as it is

These are the audit. Do not touch them.

- The **request listener** that records every `.js` URL (not the 250-entry performance buffer).
- The **classification** logic: deferred, never-defer, noise, app's own, fold-protected.
- **Coverage** — "did this script run before interaction?" — runs in pass 1.
- The **fold snapshot** at 1100 px, measured on a page with CSS intact.
- `mergeSlugVariants` and `readPriorDeferTokens`.
- **All 25 `MAX_INTERACTION_TARGETS`** and the scroll steps.
- `SETTLE_MIN_MS = 5000` and both 900 ms probes.
- `PAGE_LOAD_TIMEOUT_MS`, `SETTLE_SAFETY_NET_MS`, `MAX_EXTRA_PAGES = 8`.

### 2.3 Why sequential is not as slow as it looks

On a 2 vCPU box, three Chromium pages running in parallel are fighting for two cores. Each page's JS, layout, and network-parse work is serialized by the CPU scheduler anyway. So sequential is typically **1.5–2×** the wall time of one page, not **3×**. The md says the same thing.

Meanwhile, peak memory drops by the factor of the parallelism (3× on a 3-page store, ~11× on a full store), and time-integrated load (`MB × s`) drops because you're no longer holding 3–11 contexts open while they contend.

### 2.4 Estimated effect

For a normal 3-page store (home + collection + product):

| | Today (3 passes, parallel, tabs held) | Sol2+ (1 pass, sequential, closed) |
|---|---|---|
| Chrome base | ~300 MB | ~300 MB |
| Contexts live at peak | 3–11 | **1** |
| Context RAM at peak | ~360–1320 MB | **~120 MB** |
| Total Chrome-related peak | ~660–1620 MB | **~420 MB** |
| Wall time | ~90 s | ~35–50 s |
| Chrome-seconds | ~3× | **~1×** |
| Time-integrated load | baseline | **~60–70% lower** |

For an 11-page store the reduction is far larger, because today's peak is unbounded (11 × 3 contexts), while Sol2+ is bounded at 1.

Note the honest caveat the md makes: **peak RAM cannot drop 80% while Chrome stays on this box**, because the browser process alone is ~300 MB — about half of today's 3-page peak. Sol2+'s ~60–70% is the work *around* that browser. To go further you'd have to move Chrome off-box, which the md correctly defers.

---

## Part 3 — Optional time-cutters (only if you accept a tiny risk)

You said you don't want to compromise the audit. These two are the only Sol1 items that touch audit behavior, so I'm putting them behind an explicit opt-in.

| Change | Win | Risk | My recommendation |
|---|---|---|---|
| **`SETTLE_MIN_MS` 5000 → 2000** | ~18 s off a 3-pass scan; ~6 s off a 1-pass scan | Low. The two 900 ms stability probes still run *after* the min wait, so a script that arrives late is still caught. | **Safe to take.** This does not change which scripts are found in practice. |
| **`SETTLE_PROBE_GAP_MS` 900 → 500** | ~5 s | Low. Same reasoning. | **Safe to take** if you want the wall-clock. |
| **`MAX_INTERACTION_TARGETS` 25 → 10** | ~6 s off pass 1 | **Real.** A script that only lazy-loads after the 15th click would be missed. The md says 11–25 "repeat patterns the first 10 already opened" — but *largely* is not *always*. | **Do not take** if your priority is audit completeness. Keep 25. |

So: take the settle cuts if you want, keep all 25 clicks. That gives you most of the time win with none of the interaction risk.

---

## Part 4 — File-by-file implementation

These are the symbols the md names. Map them to your actual tree.

### 4.1 `app/lib/audit.server.ts`

**Constants**

```
AUDIT_REPEAT_PASSES      3    → 1        (S1)
BROWSER_IDLE_CLOSE_MS    120000 → 10000   (S4)
SETTLE_MIN_MS            5000 → 2000      (optional, Part 3)
SETTLE_PROBE_GAP_MS      900  → 500       (optional, Part 3)
SETTLE_STABLE_CHECKS     keep at 2
MAX_INTERACTION_TARGETS  keep at 25
PAGE_LOAD_TIMEOUT_MS     keep at 45000
SETTLE_SAFETY_NET_MS     keep at 40000
MAX_EXTRA_PAGES          keep at 8 (revisit once sequential — see §6)
```

**`getBrowser()`** — add the flags:

```
--disable-dev-shm-usage
--disable-gpu
--no-first-run
--disable-extensions
```

`--disable-dev-shm-usage` is the one that matters most: on a small VM `/dev/shm` is often 64 MB and Chrome crashes when it fills.

**`runHiddenAudit()`** — restructure the page loop.

Today the shape is (per the md):

```
for pass of [1, 2, 3]:
  contexts = urls.map(url => openContext(url))     // parallel
  await Promise.all(contexts.map(measure))
  // contexts NOT closed here
// finally: close all contexts
```

Replace with:

```
const contexts = [];
try {
  for (const url of urls) {              // sequential
    const ctx = await browser.newContext(...);
    contexts.push(ctx);
    try {
      const page = await ctx.newPage();
      await measurePage(page, url, {
        pass: 1,
        coverage: true,
        foldSnapshot: true,
        interaction: true,
        maxInteractionTargets: MAX_INTERACTION_TARGETS,
      });
    } finally {
      await ctx.close();                 // close per page
      contexts.pop();
    }
  }
} finally {
  await Promise.allSettled(contexts.map(c => c.close()));
  // S4: don't leave the browser idle for 2 minutes
  await browser.close();
}
```

Key points:
- **One pass.** No `pass 2` / `pass 3` loop.
- **One context at a time.** The `for` loop is sequential, not `Promise.all`.
- **Close the context immediately** after `measurePage` resolves, inside a `finally` so it closes even on error.
- **Close Chrome at the end** of the scan, not on a 2-minute idle timer.

**Remove `res.body()`** — wherever the scan currently does:

```
if (!contentLength) {
  const body = await res.body();
  sizeBytes = body.length;
}
```

replace with:

```
if (contentLength) sizeBytes = Number(contentLength);
// else leave blank — the md says this is a missing header, not a failed page
```

**Do not touch:**
- the request listener,
- the classifier,
- the fold snapshot code,
- `mergeSlugVariants`,
- `readPriorDeferTokens`.

### 4.2 `app/lib/audit-runner.server.ts`

`startAuditForStore()` currently marks the shop running and fires the scan in a floating promise.

Add two things:

1. **A per-shop `AbortController`.** If a second scan is requested for the same shop, abort the first instead of letting two Chrome workloads run for the same shop. The md notes this is missing today.

```
const inflight = new Map<string, AbortController>();

export async function startAuditForStore(shop: string) {
  inflight.get(shop)?.abort();           // cancel prior scan for this shop
  const ac = new AbortController();
  inflight.set(shop, ac);
  try {
    await runHiddenAudit(shop, { signal: ac.signal });
  } finally {
    if (inflight.get(shop) === ac) inflight.delete(shop);
  }
}
```

2. **A global semaphore of 1** around the scan body (S5), so the runner itself enforces the cap regardless of whether the queue module is started.

```
const scanSemaphore = new Semaphore(Number(process.env.AUDIT_MAX_CONCURRENT_SHOPS ?? 1));

export async function startAuditForStore(shop: string) {
  return scanSemaphore.run(() => runHiddenAudit(shop, ...));
}
```

The md says the queue exists but `shopify.server.js` doesn't start it. Putting the semaphore in the runner makes the cap real even if the queue is never wired up. (If you *do* wire up the queue, keep both — belt and braces.)

### 4.3 `app/shopify.server.js`

Either:

- **start the queue** (`startAuditQueue()` or whatever the export is), **or**
- leave it and rely on the runner semaphore from §4.2.

Do not leave it in the current state where neither is active. That's multiplier (6).

### 4.4 `script-generator.js`

`TEMP_TIMING_LOG` is hardcoded on. Set it to `false` (or gate it behind `process.env.TEMP_TIMING_LOG === '1'`). This is storefront console noise, not server RAM, but the md flags it as a pre-release item.

### 4.5 `app/lib/audit-queue.server.ts`

If you start the queue, confirm `MAX_CONCURRENT_AUDITS = 1` for now. The md's "2 is safe" table assumed 3 pages and closed-per-pass tabs — neither of which the current tree does. Once Sol2+ is live and you've measured RSS on the real host, you can consider raising to 2.

---

## Part 5 — Proof that the quality bar is preserved

Walking the md's §4 quality bar one item at a time:

| # | Quality bar | How Sol2+ keeps it |
|---|---|---|
| 1 | Script list from the request listener | The listener is untouched. It runs during pass 1 for every URL. Sequential ordering doesn't affect which requests fire. |
| 2 | Classification (deferred, never-defer, noise, app's own, fold-protected) | The classifier is untouched. Coverage runs in pass 1, which is the only pass Sol2+ runs. |
| 3 | Fold hide list at 1100 px, with CSS | The fold snapshot code is untouched. CSS is **not** blocked (see §6). |
| 4 | Token stability (`mergeSlugVariants` + `readPriorDeferTokens`) | Both are untouched. Deploy-time hash changes are covered by the prior audit's tokens. See §5.1 for the one real gap. |
| 5 | Size/timeline are measurements, not the result | `res.body()` removal only blanks Size when `Content-Length` is missing. That's a header gap, not a page-left-early signal. |

### 5.1 The one real risk: in-request URL hash rotation

Three passes existed for exactly one reason: a script URL containing a value that changes on every request (nonce, A/B bucket, cache-buster). One pass sees one value, so `mergeSlugVariants` has nothing to merge, and the storefront's exact-substring rule can miss the next request's URL.

This is the only quality gap Sol2+ introduces. It is **not** "the scan left the page early."

Cover it in this order:

1. **Already in the code:** `readPriorDeferTokens` merges the previous audit's tokens. A hash that changed at *deploy time* is still collapsed. This covers the common case.
2. **Only if production logs actually show a miss:** add a **single home-only harvest reload** after the full pass. One extra navigation, not `×3 pages ×2 passes`. The md is explicit: do not build it "just in case," because it spends the load Sol2+ removes.

Do **not** drop coverage or skip the fold snapshot to chase the last bit of RAM. Those two are the audit result; the extra passes are not.

---

## Part 6 — Things deliberately *not* in this plan

| Idea | Why not |
|---|---|
| Block images, fonts, media | The md says CSS must stay (fold hide list depends on layout). Images/fonts are a *later experiment* only if a measurement shows the fold snapshot still matches a full load. Not in the first cut. |
| Move Chrome to another machine | Right later, when one light scan still fills the box. It doesn't reduce work, it moves it. |
| Run the obfuscator in a worker thread | Worth doing, but it's an ~80 ms event-loop blip, not the outage. |
| Cap at 2 while still doing 3 parallel passes | That's Sol1. Saves the box from a crowd; doesn't cut one scan. |
| Download script bodies so Size is never blank | Fills a column by risking Node. Size isn't a defer/hide input. |
| Skip fold or coverage | Those are the decisions the storefront script is built from. |
| Cut `MAX_INTERACTION_TARGETS` to 10 | You said you want interaction. Keep 25. |

---

## Part 7 — Rollout order

If you want to ship safely in stages:

**Stage 1 (one release, zero quality risk)**
- S5: runner semaphore = 1
- S4: `BROWSER_IDLE_CLOSE_MS` → 10 s
- S6: Chrome flags
- Close each context at end of pass (even if you keep 3 passes for now)
- Remove `res.body()`
- Turn off `TEMP_TIMING_LOG`

Stage 1 alone removes the worst peak (11 pages × 3 passes held open) and the Node body-buffer spike, without changing the scan's shape. The md explicitly recommends this as a useful intermediate.

**Stage 2 (the 80% cut)**
- S1: `AUDIT_REPEAT_PASSES = 1`
- S2: sequential page loop with immediate context close
- S4: close Chrome at scan end

**Stage 3 (optional, only if wall-clock still matters)**
- `SETTLE_MIN_MS` → 2000
- `SETTLE_PROBE_GAP_MS` → 500

**Never**
- `MAX_INTERACTION_TARGETS` → 10, unless a measurement shows clicks 11–25 add no new scripts.

---

## Part 8 — Measurement plan (how you know it worked)

On the 4 GiB host, during one scan of a real shop (home + collection + product):

1. **Sample RSS every second** for both the Chromium process and the Node process. The md's 80–150 MB/context figure is a benchmark, not a reading from this server. You need the real number.
2. **Wall time** of the scan.
3. **Diff `deferArray` and `hideSelectors`** against a Sol1 (3-pass) scan of the same shop, taken the same day.

Success criteria:
- Chromium-seconds and peak context count are ~⅕ of the 3-pass parallel scan.
- The defer and hide lists **match**, except for hash-only token variants.
- A variant that appears in the 3-pass list but not the 1-pass list is the §5.1 case — not a failed page.

If the diff shows a *non-hash* difference, stop and investigate before shipping. If it shows only hash variants, ship, and only add the home-only reload if production logs later show a real miss.

---

## Part 9 — Open questions to add to the md

Per the file's own instruction ("Add the next round of thinking under **Open questions**"):

- [ ] Measure RSS of Chrome and Node on the 4 GiB host during one current 3-page scan. Replace the 80–150 MB/context benchmark with a real reading.
- [ ] Does a 1-pass scan of a real shop miss defer tokens that the 3-pass scan found, after `readPriorDeferTokens`? If yes, is it hash rotation (§5.1) or a script that only loads on pass 2?
- [ ] Once pages are sequential, is `MAX_EXTRA_PAGES = 8` still right? Sequential makes 8 safe for RAM but expensive for wall time. A lower cap may still be correct for latency.
- [ ] Is blocking fonts and media safe for the 1100 px fold snapshot? Images stay until measured.
- [ ] Confirm the queue is actually started (or the runner semaphore is actually enforced) — the md says `shopify.server.js` currently starts neither.

---

## Bottom line

Your instinct is right: you can keep **interaction, first-fold, coverage, and the full script list** and still cut the load dramatically. The load isn't coming from doing the audit — it's coming from doing it **three times, in parallel, with tabs held open, with whole script bodies in Node, with Chrome alive for two minutes, and with no concurrency cap at the entry point**.

Fix those six things (S1–S6) and you get roughly **60–70% less time-integrated load** on a 3-page store and far more on an 11-page store, with **zero** change to the defer list, hide list, or classification. Add the settle-time cuts if you want another ~10% and accept a very small risk. Do not cut the click count.

If you paste the actual `audit.server.ts`, `audit-runner.server.ts`, and `shopify.server.js`, I'll turn each item in Part 4 into an exact diff.



#AI 2
# Deeper analysis — and an honest scope statement

## What I actually have, and what I don't

I have **only the markdown file**. I do **not** have your git repo, so I have not read `audit.server.ts`, `audit-runner.server.ts`, `audit-queue.server.ts`, `shopify.server.js`, `script-generator.js`, or any other file. Everything below is derived from what the md *says* about those files. Where the md is silent, I mark it as an unknown and tell you exactly what to check.

That said, the md is unusually detailed — it names constants, functions, call flow, and failure modes. It's enough to do a genuinely deeper pass than my first answer. Below is that pass. It corrects two things I got wrong, adds several things the md itself under-analyzes, and ends with a precise list of what I'd verify in the repo.

---

## Part A — What closer reading of the md reveals

### A1. The 3-pass design is narrower than it looks — and so is the loss from removing it

The md says passes 2 and 3 are "harvest-only (no coverage, no fold snapshot, no clicking)." That means:

- **Coverage** ("did this script run before interaction?") is measured **only in pass 1**.
- **Fold snapshot** (1100 px, with CSS) is measured **only in pass 1**.
- **Interaction** (scroll + up to 25 clicks) happens **only in pass 1**.
- Passes 2 and 3 do exactly one thing: **load every page again and wait for settle**, so `mergeSlugVariants` sees the script URLs a second and third time.

So the *only* audit feature that depends on passes 2–3 is **URL-variant merging**. Everything you said you care about — interaction, first fold, coverage, classification, the full script list — lives entirely in pass 1.

This is a bigger deal than my first answer made it. It means `AUDIT_REPEAT_PASSES = 1` is **not** a general quality cut. It removes one specific capability: detecting that a script URL contains a value that changes between requests. That's the whole loss. Everything else is preserved exactly.

The md itself says this in §5.1 and §5.3, but it's worth stating flatly because it reframes the risk: you're not trading "some audit quality" for speed. You're trading "one narrow capability" for two-thirds of the Chrome work.

### A2. The prior-token mitigation is weaker than the md implies — for per-request hashes

The md says (§5.3):

> Already in the code: merge this run's tokens with the previous audit's tokens. A hash that changed at deploy time is still collapsed.

That's true for **deploy-time** hash changes. If scan N (3-pass) sees `/app.js?h=abc`, `/app.js?h=def`, `/app.js?h=ghi` and collapses to `/app.js?h=`, and scan N+1 (1-pass) sees `/app.js?h=jkl`, then `readPriorDeferTokens` brings in the collapsed prefix and the storefront still matches. Good.

But for **per-request** hash rotation (nonce, A/B bucket, cache-buster), the logic is different:

- With 3 passes, scan N sees three *different* per-request values and collapses them to a prefix.
- With 1 pass, scan N sees **one** value. `mergeSlugVariants` has nothing to merge. The token stored is likely the full URL including that one value.
- Scan N+1 (also 1-pass) sees a *different* single value. Merging the two full URLs may or may not produce a usable prefix, depending on `mergeSlugVariants`' algorithm.
- If the algorithm needs ≥2 samples of the *same* varying region to identify it, then 1-pass scans never accumulate enough samples. **The gap is permanent, not temporary.**

The md's phrasing — "the previous audit's tokens are already merged in" — reads as if this covers the per-request case. It doesn't, unless `mergeSlugVariants` can collapse a *single* sample into a prefix (e.g., by stripping known query-string patterns). Without the code, I can't tell. This is the single most important thing to check.

**Consequence:** the md's "wait for an observed miss, then add a home-only reload" is the right *process*, but the gap may be more persistent than the md implies. If you ship 1-pass, you may need the home-only reload sooner than expected — not as a rare fallback, but as a permanent part of the scan for any store whose scripts use per-request hashes.

**What to check:** the body of `mergeSlugVariants`. Does it require ≥2 samples? Does it strip query strings? Does it look for a common prefix/suffix? Does it handle mid-URL hashes? The answer determines whether 1-pass is safe for your stores.

### A3. The settle cut is riskier for the fold than I first said

In my first answer I called `SETTLE_MIN_MS 5000 → 2000` "safe to take" because the two 900 ms probes still run. On closer reading, that's too confident.

What the settle does:
- Wait at least `SETTLE_MIN_MS` (5 s).
- Then run two probes, 900 ms apart (`SETTLE_PROBE_GAP_MS`), requiring stability across both (`SETTLE_STABLE_CHECKS = 2`).
- Cap at 40 s (`SETTLE_SAFETY_NET_MS`).

The probes detect **DOM mutations**. They do not necessarily detect **slow network resources** — a hero image that is still downloading does not mutate the DOM when it finally arrives; it just repaints. If the image arrives *after* the probes have finished, the settle ends, the fold snapshot is taken, and the image is missing from the measurement.

The 5 s minimum exists precisely to give slow resources a window. On a 4 GiB / 2 vCPU box, on a real storefront over a real network, 2 s may not be enough.

**Impact:** the fold snapshot at 1100 px could miss above-the-fold elements that are images or image-dependent. The hide list would then be wrong — which the md itself calls "a storefront bug, not a performance win" (§4.3).

**Revised recommendation:** do **not** cut `SETTLE_MIN_MS` as part of the first release. Measure first: run a 5 s-settle scan and a 2 s-settle scan of the same shop, diff `hideSelectors`. If they match, the cut is safe for that shop. If they don't, keep 5 s. This is exactly the kind of "measure, then cut" discipline the md's §5.5 describes for the pass count — it should apply to the settle too.

The probe-gap cut (900 → 500 ms) is safer, because it only shortens the *confirmation* window, not the minimum wait. But it still risks missing a late mutation. Measure the same way.

### A4. `MAX_INTERACTION_TARGETS` — the md's claim is an assumption, not a proof

The md says (§5.1, Sol1/R3):

> Clicks 11–25 repeat patterns the first 10 already opened.

That may be true for the shops the author looked at. It is not a general truth. A mega-menu with 30 items, each loading a different script, would need all 30 clicks to discover all scripts. A tabbed product page with 12 tabs would need 12. A carousel with 20 slides would need 20.

The deeper issue: **coverage is measured before interaction**, so interaction clicks don't change the coverage classification of scripts already loaded. But interaction *does* cause lazy-loaded scripts to enter the request list in the first place. If a script only loads on click 15, and you only click 10 times, that script never enters the list — so it's never classified, never deferred, and the storefront doesn't defer it. That's a real miss.

**Recommendation:** keep 25. You said you don't want to compromise the audit; this is the one Sol1 item that actually does. The ~6 s it saves is not worth the risk.

### A5. The floating promise is a reliability bug independent of load

The md says `startAuditForStore()` "starts the scan in a floating promise." In Node, a floating promise that rejects produces an `unhandledRejection`. Depending on your Node version and process policy, that can:
- log a warning (Node ≥15 default),
- crash the process (if `--unhandled-rejections=strict` or a custom handler),
- or be silently swallowed (if a handler exists).

If it crashes the process, **every in-flight scan dies**, every shop is left "running," and the app restarts cold. That is an outage that looks exactly like an OOM but has a different cause.

This is not in Sol1 or Sol2, but it belongs in any hardening pass. **Fix:** wrap the scan body in try/catch and either await it (if the caller can afford to wait) or attach `.catch()` that logs and marks the shop as failed.

**What to check:** `startAuditForStore()` in `audit-runner.server.ts`. Does it `await`, `.catch()`, or neither? Is there a global `unhandledRejection` handler in the app entry? If neither, you have a latent crash path.

### A6. The "running" flag has no recovery path

The md says the shop is marked running and the dashboard polls until the scan finishes. It does not say what happens if:
- the process crashes mid-scan,
- the scan hangs (e.g., Chrome is unresponsive but not dead),
- the scan throws before the `finally` clears the flag.

In any of those cases, the shop is stuck "running" forever. The dashboard polls forever. No new scan can start (or, worse, a new scan starts and overlaps the zombie).

**Fix:** a watchdog. On process start, and periodically, find shops marked running with no active scan and either re-queue them or mark them failed. This is orthogonal to Sol1/Sol2 but is part of "don't make the server fall over."

**What to check:** is there any code that clears the running flag on startup? Is there a `lastHeartbeat` column on the scan row?

### A7. The 250-entry performance buffer may affect coverage, not just the script list

The md says (§4.1):

> The request listener, not the 250-entry performance buffer, is the source of that list [the script list].

That's about the **script list**. But coverage — "did this script run before interaction?" — is a separate question. If coverage is implemented by reading `performance.getEntriesByType('resource')` and comparing `responseEnd` to the interaction timestamp, then the 250-entry buffer is the *coverage* source, and it overflows on any page with more than 250 resources.

On an 11-page storefront, 250 entries is easy to exceed. If coverage silently returns "not seen" for entries beyond 250, those scripts are misclassified — probably as deferred (safe), which is the conservative direction, but possibly as never-defer if the logic is inverted. Either way, it's a correctness bug that exists **today**, independent of Sol2+.

**What to check:** how is coverage computed? Does it use `performance.getEntriesByType`? Is there a buffer-size guard? If yes, this is a pre-existing issue worth fixing separately.

### A8. `res.body()` removal is more important than the md's phrasing suggests

The md calls it "a Node heap spike of every uncached script body, per page." On closer reading, the scale is worse than that sounds:

- Up to 11 pages are open **in parallel** today (before Sol2+).
- Each page can have dozens of scripts.
- Each script without `Content-Length` triggers a full `res.body()` read into Node's heap.
- 11 pages × ~10 uncached scripts × ~200 KB average = **~22 MB per pass**, and with 3 passes holding bodies alive (if references are retained), more.
- On a heavy store with 2 MB bundles, it's 10× that.
- Node's GC may not run during the spike, so RSS stays elevated.
- The kernel's OOM killer scores Node highly when its RSS spikes, so Node — not Chrome — may be the process that dies. When Node dies, the whole app dies, including the admin panel and the queue.

So `res.body()` isn't just a memory cost; it's a **crash-the-whole-app** risk. Removing it is one of the highest-value changes in the whole plan, and it's independent of the pass-count and sequential changes.

**What to check:** every call site of `res.body()` or `response.body()` in `audit.server.ts`. Confirm there's exactly one and that removing it doesn't break a downstream consumer (e.g., if a hash of the body is used for something).

### A9. The queue module exists but isn't started — why?

The md says `audit-queue.server.ts` exists with `MAX_CONCURRENT_AUDITS = 1` default, but `app/shopify.server.js` does not start it. Two possibilities:

1. It was written but never wired up (oversight).
2. It was wired up, caused problems, and was unwired (deliberate).

If (1), starting it is a one-line fix. If (2), starting it without understanding why it was removed could reintroduce a bug.

**Recommendation:** don't start the queue blindly. Put the concurrency cap in the runner (where the scan actually starts) as I suggested in my first answer. That's safe regardless of the queue's history. If you later confirm the queue is sound, you can start it *in addition*.

**What to check:** `git log app/lib/audit-queue.server.ts` and `git log app/shopify.server.js`. Look for a commit that removed the queue start. Read its message.

### A10. Chrome crash recovery

`getBrowser()` returns a shared browser. If Chrome crashes (OOM, segfault, `/dev/shm` exhaustion), the cached reference is dead. The next scan calls `getBrowser()`, gets the dead browser, and fails immediately — or hangs.

**Fix:** in `getBrowser()`, attach a `disconnected` listener that clears the cached reference. On next call, relaunch. Also: `--disable-dev-shm-usage` (Sol1/R4) makes `/dev/shm` crashes much less likely, so this is defense-in-depth.

**What to check:** `getBrowser()` in `audit.server.ts`. Is there a `browser.on('disconnected', ...)`? Is the cached promise invalidated on failure?

### A11. Sequential scanning has secondary wins the md doesn't mention

The md focuses on RAM and Chrome-seconds. Sequential processing also:

- **Reduces CPU contention** on the 2 vCPU box. Today, 3 renderers + 1 browser process compete with Node, the admin panel, and PostgreSQL. Sequential leaves cores free for those. The admin panel is noticeably more responsive during a scan.
- **Reduces network contention.** One page's requests at a time instead of 3 pages' worth. Fewer open sockets, less TCP state, less ephemeral port churn.
- **Leaves more page cache for PostgreSQL.** Chrome's lower RSS means the kernel can cache more DB pages. Queries are faster during a scan.
- **Makes the Node event loop more available.** Node handles the status poll, webhooks, and the admin panel. With fewer concurrent Chrome interactions, Node is less blocked.

These are real user-visible improvements during a scan, not just "the server doesn't die." Worth stating in the md.

### A12. The 11-page worst case, sequential, is a product decision

Today, 11 pages in parallel: wall time ≈ max(page times) ≈ 45 s worst case.

Sequential: wall time ≈ sum(page times) ≈ 11 × 45 s = **8+ minutes** worst case, ~110 s typical.

The md's open question asks whether to keep `MAX_EXTRA_PAGES = 8`. That's the right question. But it's not just a RAM question — it's a UX question. A merchant who adds 8 extra pages and waits 8 minutes will think the scan hung. Options:

- Keep 8, accept the wait, show progress.
- Lower to 5, accept less coverage of merchant-added pages.
- Process the 3 base pages first, then the extras, so the dashboard can show partial results early.
- Warn the merchant at add-time that extra pages lengthen the scan.

This is a product call, not a technical one. Flag it for the product owner.

### A13. Long transactions in PostgreSQL

If the scan writes results to PostgreSQL in a single transaction that spans the whole scan, then sequential scanning lengthens the transaction. Long transactions cause:

- Bloat (dead tuples can't be vacuumed).
- Lock contention (if the transaction holds locks).
- WAL growth.

If the scan is 8 minutes, the transaction is 8 minutes. On a 4 GiB box also running the app, that's not great.

**Fix:** write results in short transactions — e.g., insert the scan row at start, update status periodically, write the full result at end. Or use a job table with status transitions.

**What to check:** how does the scan persist its result? Is there a `prisma.$transaction(async tx => { ... })` that wraps the whole scan?

### A14. Defense in depth: cgroup limits and `oom_score_adj`

These don't reduce load, but they contain the blast radius if something goes wrong:

- **systemd `MemoryMax=`** on the app service. When the cgroup hits the limit, only that service is affected. The rest of the box (PostgreSQL, OS) stays alive.
- **`oom_score_adj`** on the Chrome process. Make Chrome more likely to be killed than Node. Then an OOM kills Chrome (one scan fails) instead of Node (whole app dies).
- **`MemoryHigh=`** for soft pressure before `MemoryMax`.

These are worth adding regardless of Sol1/Sol2. They're not fixes; they're seatbelts.

### A15. `TEMP_TIMING_LOG` is small but non-zero

The md says it's "storefront console noise, not server RAM." True, but console noise consumes **browser** memory (the console buffer) and **CPU** (formatting log strings). On a heavy page with thousands of log lines, that's a few MB and a small CPU cost per page. Turning it off is free. Do it.

---

## Part B — Revised recommendation

Based on the deeper reading, here's my revised ordering. It's slightly different from my first answer, mainly because I'm now more cautious about the settle cut.

### Must-do (zero audit-quality risk)

1. **Semaphore = 1 in the runner** (not just the queue module). Prevents the multi-shop multiplier.
2. **Close each context immediately after its page is measured.** Removes the "pages × passes held open" peak even if you keep 3 passes for now.
3. **Remove `res.body()`.** Eliminates the Node heap spike and the Node-OOM crash path.
4. **Chrome flags:** `--disable-dev-shm-usage --disable-gpu --no-first-run --disable-extensions`.
5. **`BROWSER_IDLE_CLOSE_MS` → 10 s** (or explicit `browser.close()` at scan end).
6. **`TEMP_TIMING_LOG = false`.**
7. **Catch the floating promise** in `startAuditForStore()`.
8. **Chrome `disconnected` listener** in `getBrowser()` to clear the cached reference.
9. **Watchdog for stuck "running" shops.**

Items 1–6 are load. Items 7–9 are reliability. All nine are zero-quality-risk.

### The 80% cut (one narrow quality trade)

10. **`AUDIT_REPEAT_PASSES = 1`.**
11. **Sequential page loop** with immediate context close (replaces item 2's "close at end of pass" with "close per page").

The only quality loss is per-request URL-variant merging. Mitigations:
- `readPriorDeferTokens` covers deploy-time changes.
- If `mergeSlugVariants` can collapse a single sample to a prefix, per-request changes are also covered.
- If not, add a **home-only harvest reload** after the full pass — one extra navigation, only for home, only if production logs show a miss.

**Before shipping this**, run the measurement in §5.5 of the md: diff `deferArray` and `hideSelectors` between a 3-pass and a 1-pass scan of the same shop, same day. If they match (modulo hash-only variants), ship. If not, investigate before shipping.

### Measure-then-decide (possible quality risk)

12. **`SETTLE_MIN_MS` 5000 → 2000.** Only after diffing `hideSelectors` between a 5 s-settle and a 2 s-settle scan. If they match, take it. If not, keep 5 s.
13. **`SETTLE_PROBE_GAP_MS` 900 → 500.** Same measurement.

### Do not do

14. **`MAX_INTERACTION_TARGETS` 25 → 10.** You said you want interaction; this is the one cut that actually risks the audit.
15. **Block images/fonts/media.** CSS must stay for the fold snapshot; images affect layout. Only after a dedicated fold-equivalence measurement.

---

## Part C — What I need from the repo to go further

If you paste (or give me read access to) these, I can turn every item above into an exact diff and catch anything the md doesn't mention:

1. **`app/lib/audit.server.ts`** — the full file. I need to see:
   - `getBrowser()` (flags, caching, disconnect handling).
   - `runHiddenAudit()` (the pass loop, the parallel `Promise.all`, the `finally`).
   - `measurePage` (what settle does, what probes check, how coverage is computed, how fold is captured).
   - Every `res.body()` call site.
   - `mergeSlugVariants` and `readPriorDeferTokens` — specifically, whether `mergeSlugVariants` needs ≥2 samples.
   - All the constants (`AUDIT_REPEAT_PASSES`, `SETTLE_*`, `MAX_INTERACTION_TARGETS`, `PAGE_LOAD_TIMEOUT_MS`, `BROWSER_IDLE_CLOSE_MS`, `MAX_EXTRA_PAGES`).

2. **`app/lib/audit-runner.server.ts`** — the full file. I need:
   - `startAuditForStore()` — is the promise caught? Is there a per-shop lock?
   - How the running flag is set and cleared.
   - Whether there's a watchdog or startup recovery.

3. **`app/lib/audit-queue.server.ts`** — the full file. I need:
   - Whether the queue is functional.
   - `git log` of this file and of `app/shopify.server.js` to see why the queue isn't started.

4. **`app/shopify.server.js`** — the relevant section. I need to see what it does on install/start, and whether it calls `startAuditForStore()` directly.

5. **`script-generator.js`** — the `TEMP_TIMING_LOG` line and the obfuscator.

6. **The Prisma schema** for the scan/audit tables. I need to see:
   - Whether there's a `lastHeartbeat` or `startedAt` column.
   - Whether results are written in one transaction.

7. **`docs/SERVER-CAPACITY-AND-AUDIT-PERFORMANCE.md`** — the referenced capacity note. It may contain measurements (the 45–110 s figure, the 8-scans-OOM figure) that I've been treating as authoritative.

With those, I can:
- Confirm or refute each of my A1–A15 findings.
- Give exact diffs for items 1–15.
- Identify anything the md missed entirely.

---

## Part D — The single most important unknown

If you only check one thing, check **`mergeSlugVariants`**.

Everything about whether 1-pass is safe hinges on whether it can collapse a **single** URL sample into a stable prefix. If it can (e.g., by stripping query strings, or by recognizing common cache-buster patterns), then 1-pass is safe and the whole Sol2+ plan is clean. If it requires ≥2 samples to identify the varying region, then 1-pass permanently loses per-request hash coverage, and the home-only reload becomes a necessary part of the scan — which adds back some load (though far less than two full passes).

The md's §5.3 treats this as a "wait and see" item. On closer reading, it's the pivot point of the whole design. Check it first.


#AI 3
I've accessed your GitHub repository and read the key files. I can now give you a grounded analysis based on the actual code, not just the markdown. I need to be upfront about one limitation: the raw view of `audit.server.ts` was truncated at line 393, and I could not locate the definition of `runHiddenAudit()` within it. The function is imported from `./audit.server` by `audit-runner.server.ts`, so it must exist there or in a file that file re-exports, but I couldn't retrieve the full body. I'll flag exactly what that means for the analysis.

Here is what the code actually shows, and how it changes the plan.

---

## What the actual code confirms

### 1. The floating promise is real, and it's explicit

`audit-runner.server.ts` lines 41–42 show:

```ts
// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
  try {
    if (!isCurrentRun()) return;
    ...
```

The `eslint-disable` comment is a deliberate signal: the author knew this was a floating promise and chose to suppress the lint rule. The IIFE does have a `try` block, but I need to see the rest of the file to know if there's a `catch`. If there isn't, an unhandled rejection is possible. **This is a concrete, verifiable code smell**, not a hypothetical.

### 2. The browser has a `disconnected` handler — one of my earlier concerns is already addressed

`audit.server.ts` lines 81–82 show:

```ts
launching
  .then((b) => b.on("disconnected", () => {
    if (browserPromise === launching) browserPromise = null;
  }))
```

The cached browser reference **is** cleared on disconnect. This is better than I assumed. The remaining gap is that `withBrowser()` (lines 84–89) decrements `browserUsers` and schedules the idle close in a `finally`, but if the browser disconnects mid-use, the next `getBrowser()` will relaunch. That's acceptable.

### 3. The settle logic is more sophisticated than the md describes

`waitForScriptsSettled()` (lines 373–392) is not a simple "wait 5 s then probe." It:

- Runs a `while` loop with a hard cap of `SETTLE_SAFETY_NET_MS` (40 s).
- Each iteration waits for `networkidle` with an **8 s cap** (`NETWORK_IDLE_CAP_MS`), then waits `SETTLE_PROBE_GAP_MS` (900 ms), then evaluates `max(responseEnd)` across script resource entries.
- Requires the value to be **identical across two consecutive probes** (`SETTLE_STABLE_CHECKS = 2`).
- Additionally requires `Date.now() - started >= SETTLE_MIN_MS` (5 s) before accepting stability.

This means the minimum wall time per page is **not** simply 5 s. It is:

```
max(5s, (2 probes × (networkidle cap + 900ms gap)) )
```

If `networkidle` fires quickly (e.g., in 200 ms), each probe is ~1.1 s, so two probes take ~2.2 s. But the 5 s minimum forces the loop to continue until 5 s have elapsed. If `networkidle` times out at 8 s each time, two probes take ~17.8 s. The md's "30 s of pure sleeping" is in the right ballpark but not precise.

**This matters for the Sol2 estimate.** If you cut `SETTLE_MIN_MS` to 2 s, the loop can exit after two stable probes at ~2.2 s instead of 5 s. But if `networkidle` is slow, the 8 s cap dominates and the cut saves nothing. **The actual saving depends on how quickly `networkidle` fires on real stores.** You need the measurement the md's §5.5 calls for.

### 4. The constants are exactly as the md says — with one addition

From `audit.server.ts`:

| Constant | Value | Line |
|---|---|---|
| `BROWSER_IDLE_CLOSE_MS` | 120,000 (2 min) | 75 |
| `PAGE_LOAD_TIMEOUT_MS` | 45,000 | 292 |
| `NETWORK_IDLE_CAP_MS` | 8,000 | 292 |
| `SETTLE_STABLE_CHECKS` | 2 | 293 |
| `SETTLE_PROBE_GAP_MS` | 900 | 294 |
| `SETTLE_MIN_MS` | 5,000 | 300 |
| `SETTLE_SAFETY_NET_MS` | 40,000 | 300 |
| `MAX_INTERACTION_TARGETS` | 25 | 310 |
| `MAX_EXTRA_PAGES` | 8 | 326 |
| `AUDIT_REPEAT_PASSES` | 3 | 326 |
| `AUDIT_PASS_GAP_MS` | 0 | 335 |

The md did not mention `NETWORK_IDLE_CAP_MS = 8000`. This is important: the settle loop's per-probe upper bound is 8 s, not the full 40 s safety net. On a store with long-polling analytics, each probe burns 8 s, and two probes burn 16 s per page per pass.

### 5. `res.body()` is **not** in `audit.server.ts`

My earlier analysis said it was there. The `find` for `res.body` in `audit.server.ts` returned **no matches**. It may be in `audit-inventory.server.ts` or `audit-classified-inventory.ts`, which are imported (lines 7–8). I did not retrieve those files. This is a correction: **I cannot confirm the `res.body()` call site from the files I read.** The md says it exists; the code I saw doesn't show it. Check the inventory files.

### 6. `mergeSlugVariants` is imported but not defined in `audit.server.ts`

Line 5 shows it imported from `./audit-candidates`. The comment block at lines 314–323 explains the rationale for 3 passes:

> "with a single pass there is only ever ONE variant per script, so the merge is a no-op. Repeating the pass feeds it the divergence it was written to consume."

This is the **most important line in the file** for your decision. The code itself says that with one pass, `mergeSlugVariants` does nothing. The three passes exist solely to feed it multiple samples. If you go to one pass, you lose per-request hash merging entirely, as I suspected in my earlier analysis. The comment confirms it.

### 7. The queue exists and is sophisticated — but I didn't find it being called

`audit-queue.server.ts` is a real, non-trivial module with stale-job cleanup, a drain lock, and `MAX_CONCURRENT_AUDITS` enforcement. It imports from `audit-queue-policy` and `audit-queue-reconcile`. This is not a stub.

`shopify.server.js` (18 lines) does **not** import or start the queue. It only configures the Shopify app, session storage, and exports helpers. The md's claim is correct: **the queue is written but not started.**

I did not find `enqueueAuditJob` being called from `audit-runner.server.ts` (the `find` returned no matches). `startAuditForStore` calls `runHiddenAudit` directly (line 65), bypassing the queue. This is the multiplier (6) from my earlier analysis, confirmed.

### 8. `startAuditForStore` has a generation-based cancellation mechanism

Lines 31–33 show:

```ts
const runGeneration = (auditRunGenerations.get(shopDomain) ?? 0) + 1;
auditRunGenerations.set(shopDomain, runGeneration);
const isCurrentRun = () => auditRunGenerations.get(shopDomain) === runGeneration;
```

This is a **per-shop supersede mechanism**. When a new scan starts for the same shop, `runGeneration` increments, and the old scan's `isCurrentRun()` returns false at its next checkpoint. The old scan does **not** abort its Chrome work immediately — it checks `isCurrentRun()` at several points (lines 42, 54, 59, 70, 75, 78, 80) and returns early. But **between checks, the Chrome work continues.** If the old scan is in the middle of `runHiddenAudit` (line 65), there is no `isCurrentRun()` check inside that call, so the old Chrome workload runs to completion or until the next checkpoint.

This is better than nothing, but it's not a true abort. The md's concern about overlapping Chrome work is valid but partially mitigated.

---

## What the code changes about the plan

### Correction 1: `res.body()` is not in the file I read

Do not apply the `res.body()` removal to `audit.server.ts`. Search `audit-inventory.server.ts` and `audit-classified-inventory.ts` instead.

### Correction 2: The settle cut is riskier than I said

Because `NETWORK_IDLE_CAP_MS` is 8 s and the loop requires two stable probes, cutting `SETTLE_MIN_MS` to 2 s may save **zero** time on stores where `networkidle` times out at 8 s. The 5 s minimum is not the binding constraint in that case. You must measure `networkidle` behavior on real stores before deciding.

### Correction 3: `mergeSlugVariants` is definitively a no-op with one pass

The code comment at lines 319–321 is unambiguous. If you go to one pass, per-request hash merging is lost. The md's §5.3 mitigation (prior tokens + optional home-only reload) is the only cover. This is not a "maybe"; it's a certainty per the code's own documentation.

### Confirmation 1: The floating promise is real and deliberate

The `eslint-disable` comment is evidence. Check for a `catch` in the rest of the IIFE (lines 42–96). If there is none, add one.

### Confirmation 2: The queue is not started

The runner calls `runHiddenAudit` directly. The queue module is dead code unless something else starts it. Search the repo for `enqueueAuditJob` and `drainAuditQueue` call sites.

### Confirmation 3: Per-shop supersede exists but is not a hard abort

The `runGeneration` mechanism prevents a *second* scan from starting, but does not abort the first scan's in-flight Chrome work. This is a soft cancel, not a hard one.

---

## Revised plan based on actual code

### Must-do (zero quality risk, verified against code)

1. **Wrap the floating promise in `catch`.** Lines 42–96 of `audit-runner.server.ts`. Add a `.catch(err => { ... })` or a `catch` block that logs and marks the shop failed. The `eslint-disable` shows the author knew this was a risk.

2. **Start the queue, or enforce the cap in the runner.** Either call `enqueueAuditJob` from `startAuditForStore`, or add a semaphore around the `runHiddenAudit` call. The queue module is ready; it just isn't wired.

3. **Close each context immediately after its page is measured.** The current code does close contexts in `finally` blocks inside `withBrowser` callbacks (e.g., line 223 in `discoverViaBrowser`), but the main audit's context management is in `runHiddenAudit`, which I couldn't read. Check how contexts are created and closed there.

4. **Chrome flags in `getBrowser()`.** Line 79 shows `chromium.launch({ headless: true, executablePath })`. Add `--disable-dev-shm-usage`, `--disable-gpu`, `--no-first-run`, `--disable-extensions`.

5. **`BROWSER_IDLE_CLOSE_MS` → 10 s.** Line 75. Easy, zero risk.

6. **`TEMP_TIMING_LOG` off.** In `script-generator.js`, which I didn't read. The md says it's hardcoded on. Verify and set to false.

### The 80% cut (one certain quality trade)

7. **`AUDIT_REPEAT_PASSES = 1`.** Line 326. The code comment confirms this makes `mergeSlugVariants` a no-op. Mitigate with `readPriorDeferTokens` and, if needed, a home-only reload.

8. **Sequential page loop with immediate context close.** This is in `runHiddenAudit`, which I couldn't read. You'll need to apply it there. The md's §3 says pages run in `Promise.all`; the code comment at lines 284–285 says "All pages run at the same time." Confirm and restructure.

### Measure before deciding

9. **`SETTLE_MIN_MS` cut.** Do not apply blindly. Measure how often `networkidle` times out at 8 s on your real stores. If it times out often, the cut saves nothing. If it fires quickly, the cut helps.

10. **`SETTLE_PROBE_GAP_MS` cut.** Same reasoning, smaller effect.

### Do not do

11. **`MAX_INTERACTION_TARGETS` cut.** The code comment at line 310 says "25 safe targets existed on a measured page." That's a measured value, not a guess. Keep 25.

12. **Block images/fonts.** No evidence in the code that this is safe for the fold snapshot. The fold height is 1100 px (line 304), and CSS must stay. Images can affect layout. Measure first.

---

## What I still cannot verify

I could not read:

- The body of `runHiddenAudit()` — the core of the audit.
- `mergeSlugVariants` in `audit-candidates.ts` — specifically whether it needs ≥2 samples.
- `readPriorDeferTokens` — how prior tokens are merged.
- The `catch` (if any) at the end of the floating promise in `audit-runner.server.ts` (lines 83–96 were cut off).
- `audit-inventory.server.ts` and `audit-classified-inventory.ts` — where `res.body()` may live.
- `script-generator.js` — the `TEMP_TIMING_LOG` flag.
- The Prisma schema — for transaction scope and heartbeat columns.

If you paste these, I can turn every item above into an exact diff. But based on what I *did* read, the plan is now grounded in code, not just the markdown.


#AI 4
# Updated deep analysis — based on the actual code

## Scope

I now have full content for:

- `script-generator.js`
- `audit.server.ts` (the full 1000+ line file — my earlier view was truncated)
- `audit-run-hidden.server.ts`
- `audit-runner.server.ts`
- `audit-queue.server.ts` + `audit-queue-policy.ts`
- `audit-candidates.ts`
- `audit-classified-inventory.ts`
- `audit-inventory.server.ts`
- `shopify.server.js`
- `docs/SERVER-CAPACITY-AND-AUDIT-PERFORMANCE.md`

I still do **not** have: `audit-run-page-measure.server.ts`, `audit-core.server.ts`, `audit-gate-impact.server.ts`, `audit-script.ts`, `audit-template-buckets.ts`, `audit-template-extra.ts`, `audit-resource-tokens.ts`, `page-urls.server.ts`, `prisma/schema.prisma`. A few conclusions below depend on those; I flag exactly where.

This changes several things I said before. Where I was wrong, I say so.

---

## 1. The headline finding: a context leak that is almost certainly the OOM cause

This is the single most important thing in the repo, and neither the md nor the capacity note caught it.

In `audit.server.ts`, `runHiddenAudit`:

```ts
const measuredAll: MeasuredPage[] = [];
const measured: MeasuredPage[] = [];
const seenPaths = new Set<string>();
...
for (let pass = 0; pass < AUDIT_REPEAT_PASSES; pass++) {
  await Promise.allSettled(urls.map(async (url) => {
    const m = await measurePage(browser, url, password, pass > 0);
    measuredAll.push(m);           // every pass
    ...
    if (!seenPaths.has(path)) {
      seenPaths.add(path);
      measured.push(m);            // only pass 0
    }
  }));
}
...
} finally {
  await Promise.all(
    measured.map((m) => m.context.close().catch(() => {}))  // ← closes only pass 0
  );
}
```

**Every context opened in passes 1 and 2 is pushed to `measuredAll` and never closed.** `measurePage` only closes its own context on the error path (`catch { await context.close(); throw err }`), not on success. So on a normal scan:

| Store size | Contexts opened | Contexts closed | Contexts leaked |
|---|---|---|---|
| 3 pages | 3 × 3 = 9 | 3 | **6** |
| 11 pages (`MAX_EXTRA_PAGES = 8`) | 11 × 3 = 33 | 11 | **22** |

At the code's own estimate of ~80–150 MB per context (and up to 300 MB on a heavy store), a 3-page scan leaks ~720 MB–1.8 GB **per scan**, and an 11-page scan leaks ~2.6 GB–6.6 GB. Those contexts stay alive until the shared browser is closed by the 2-minute idle timer. Two or three overlapping scans will OOM the box even if every other number in the capacity note were correct.

`audit-run-hidden.server.ts` has the **identical** bug (`finally { await Promise.all(measured.map(...)) }`), so switching implementations does not help.

**This, not `MAX_EXTRA_PAGES`, is why the box dies.** The capacity note's table ("1 audit = ~1.4 GB") assumes contexts close after each pass, which the code explicitly does not do. Every memory number in §4.3 of that note is understated by roughly the number of passes.

The fix is one line plus a dedupe:

```ts
} finally {
  const unique = new Set(measuredAll.map((m) => m.context));
  await Promise.allSettled([...unique].map((c) => c.close().catch(() => {})));
}
```

Better: restructure so each context is closed inside `measurePage`'s caller as soon as the page is measured, and drop the `finally` sweep entirely. That is the Sol2 change.

---

## 2. Two parallel `runHiddenAudit` implementations

`audit-runner.server.ts` imports `runHiddenAudit` from `./audit.server`. `audit.server.ts` defines it. So **`audit.server.ts` is the live one**.

`audit-run-hidden.server.ts` is a second, newer-looking implementation that imports `withBrowser`, `DiscoveredPages`, `AuditBlockedError`, `PageFunnel`, `pageRolesFromDiscovery` from `./audit-core.server`, and `measurePage`, `AUDIT_REPEAT_PASSES`, `AUDIT_PASS_GAP_MS`, `collapseToParentSelectors`, `verifyFoldSurvives`, `selectorsOverlapFoldOnPage`, `selectorsVisibleOnPage`, `popupSelectorsSafeOnPage`, `MeasuredPage` from `./audit-run-page-measure.server`. It adds features the live file does not have: `popupSelectors`, `labVitalsByPath`, `gateImpact`, `templateBuckets`, `pageRoles`, `auditRunMeta`, and a stability-based early exit.

So the repo contains a partially-migrated refactor. Two possibilities:

1. `audit-run-hidden.server.ts` is the intended future and is not yet wired up.
2. It is abandoned.

Either way, **do not edit it and assume it takes effect**. Confirm which file `audit-runner.server.ts` resolves to before every change. The constants also live in two places: inline in `audit.server.ts`, and imported from `audit-run-page-measure.server.ts` in the newer copy. They can drift.

---

## 3. The queue is real, is not started, and calls a function that does not exist

`audit-queue.server.ts` is a complete implementation — `enqueueAuditJob`, `claimNextAuditJob` with `FOR UPDATE SKIP LOCKED`, `drainAuditQueue`, stale queued/running cleanup, `MAX_CONCURRENT_AUDITS` from `audit-queue-policy.ts`. It even has `registerAuditQueueShutdown` for SIGTERM.

But:

- `shopify.server.js` does not import it. Nothing calls `enqueueAuditJob` or `drainAuditQueue`.
- `startAuditForStore` in `audit-runner.server.ts` bypasses the queue entirely and fires the floating promise directly.
- The queue's `runClaimedJob` does `const { executeAuditJob } = await import("./audit-runner.server")`, but **`audit-runner.server.ts` as provided exports only `startAuditForStore` and `resolvePreviewThemeId`.** There is no `executeAuditJob` export.

So if anyone ever wires up `drainAuditQueue`, it will throw `executeAuditJob is not a function` on the first claim. The queue is not just unused; it is **broken at the seam**.

Two consequences:

- The md's Sol2 recommendation ("admit at most one scan via the queue") cannot be implemented by "just starting the queue." The runner must first expose an `executeAuditJob` entry point (or the queue must call `startAuditForStore`, which has different semantics).
- The safest short-term cap is a semaphore **inside `startAuditForStore`**, not the queue. That is the change that actually prevents concurrent Chrome work.

---

## 4. Corrections to what I said earlier

I was wrong on three points, and I want to be explicit.

**4.1 The floating promise is not unhandled.** In my first two answers I flagged the `eslint-disable-next-line @typescript-eslint/no-floating-promises` as a potential crash path. The actual IIFE in `audit-runner.server.ts` has `try { ... } catch (err) { ... } finally { ... }` around the entire scan. `AuditBlockedError` is mapped to a code, everything else to `msg`, the store is marked failed, and an `AuditLog` row is written. **There is no unhandled-rejection risk here.** Drop that item from the plan.

**4.2 `res.body()` is in `audit.server.ts`.** I said earlier it wasn't, based on a truncated view. It is — in `measurePage`'s `onResponse`:

```ts
const onResponse = (res: import("playwright").Response) => {
  const u = res.url();
  if (!/\.js(\?|$)/i.test(u)) return;
  const header = Number(res.headers()["content-length"]);
  if (Number.isFinite(header) && header > 0) {
    responseBytes.set(u, Math.max(responseBytes.get(u) || 0, header));
    return;
  }
  bodyReads.push(
    res.body().then((buf) => { ... }).catch(() => {}),
  );
};
```

So the Node-heap spike is real and confirmed. It is only reached when a script response has no `Content-Length`, which is common for chunked/streamed responses. On a page with many such scripts, this buffers each full body into Node's heap. The `bodyReads` array is awaited (`await Promise.all(bodyReads)`) before classification, so the bodies are held simultaneously. Removing it is a genuine win and is safe — the code comment already says Size is a measurement, not a defer input.

**4.3 `getBrowser` does clear its cache on disconnect.** Lines 81–90 already attach `b.on("disconnected", () => { if (browserPromise === launching) browserPromise = null; })`. My "Chrome crash recovery" concern is already handled. Drop it.

---

## 5. Corrections to the md and the capacity note

**5.1 The capacity note's memory math is wrong because it assumes contexts close after each pass.** §4.2 says "Pass 1 peak: 3 pages × 3 contexts … Passes 2+3 peak: same 3 pages again." The code never closes pass-1 contexts before pass 2 begins, and never closes pass-2 contexts at all (see §1 above). Actual peak for a 3-page scan is **9 contexts**, not 3. For an 11-page scan it is **33**. The "4 simultaneous audits safe" conclusion is therefore unsafe; on a 3-page store, **2** is borderline and **1** is the honest number until the leak is fixed.

**5.2 The md's Sol2 "~660 MB peak" figure is optimistic.** It assumes "3 × ~120 MB contexts". The real peak today is 9 × ~120 MB = ~1.08 GB for a 3-page store, plus Chrome base, plus Node bodies, plus the leaked contexts from any prior scan still in the browser. Sol2's sequential design genuinely reduces peak to 1 context, so the reduction is real — but the baseline is higher than stated, so the percentage improvement is larger than the md says, not smaller.

**5.3 `AUDIT_PASS_GAP_MS = 0` — the note is right, and the code comment is the source.** Confirmed at line 335: "Set to 0 deliberately."

**5.4 `mergeSlugVariants` semantics — the code comment is right, and slightly more nuanced than the md.** In `audit-candidates.ts`:

```ts
export function mergeSlugVariants(tokens: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const t of tokens) {
    const key = tokenStem(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const out: string[] = [];
  for (const variants of groups.values()) {
    if (variants.length === 1) { out.push(variants[0]); continue; }
    // longest common prefix …
  }
}
```

So a script that appears once is emitted **verbatim**. A script that appears twice with different hashes is collapsed to their longest common prefix. This confirms: **one pass produces one sample per script, so the merge is a no-op for that script.**

But there is a subtlety the md does not state, and it changes the recommendation. `readPriorDeferTokens` reads both `deferArrayUnmerged` and `deferArray` from the previous `AuditLog`. `deferArray` is the *merged* output. So:

- Audit 1 (3 passes): `app.9pOKhaB_.js`, `app.xY12zaB_.js`, `app.qW98mnB_.js` → merged to `app` → stored.
- Audit 2 (1 pass): sees `app.kL45poB_.js`. `readPriorDeferTokens` returns `app`. Merge gets `[app.kL45poB_.js, app]` → stem both `app` → prefix `app.` → trimmed to `app`. Stable.

So **once a 3-pass audit has established the prefix, subsequent 1-pass audits inherit it.** The gap is narrow: it only bites on the **first-ever audit of a store**, if that audit runs 1 pass and the store's scripts use per-request hashes. After that, the prior-token pool carries the prefix forward.

**Consequence for the plan:** a safe 1-pass rollout is "3 passes on the first audit of a store, 1 pass on every audit after that." That preserves per-request hash coverage without paying 3× on every scan. It is a better answer than the md's "wait for a miss, then add a home-only reload," because it prevents the miss instead of reacting to it. It also does not require new measurement — the `AuditLog` row's existence is the signal.

**5.5 `TEMP_TIMING_LOG` is confirmed on** — `const TEMP_TIMING_LOG = true;` in `script-generator.js`, with the comment "Re-enabled 2026-09-30 … REMEMBER TO SET BACK TO false." It wraps the obfuscated bundle in a `console.log`-heavy timing harness on every storefront page load. It costs bytes on a render-blocking script and adds console noise. Turn it off before any live release. Not server RAM, but not free either.

---

## 6. Things the md and capacity note did not mention at all

**6.1 The stability-based early exit in `audit-run-hidden.server.ts` is dead code given the current constants.** The new file adds:

```ts
if (pass > 0 && passKey === lastPassTokenKey) {
  stablePassStreak++;
  if (stablePassStreak >= 2) break;
} else {
  stablePassStreak = 0;
}
lastPassTokenKey = passKey;
```

With `AUDIT_REPEAT_PASSES = 3`, the loop runs `pass = 0, 1, 2`. At the end of pass 2, `stablePassStreak` can reach 2 and `break` — but pass 2 has already run. The exit never saves a pass. It would need `>= 1` (break after pass 1) to do what it looks like it intends. Either fix the threshold or delete the block; as written it is misleading.

**6.2 `audit-run-hidden.server.ts` adds a second home-page load.** `measureGateImpactOnHome(browser, homeUrl, ...)` runs after the main passes finish, opening another context and navigating home. That is an extra page load on top of the audit. Useful for measuring the gate's impact, but it adds wall time and one more context to the peak. Not in the older copy.

**6.3 The storefront script patches three prototypes, twice.** In `script-generator.js`, the generated storefront code overrides `Element.prototype.setAttribute` and `Node.prototype.replaceChild`, then the first-visit block overrides `HTMLScriptElement.prototype.src` and `Element.prototype.setAttribute` again, then the every-load block overrides `HTMLScriptElement.prototype.src` and `Element.prototype.setAttribute` a third time. Each override is a per-page-load cost on the storefront, not the server. Worth noting for front-end performance, not for this plan.

**6.4 `MAX_EXTRA_PAGES = 8` produces an 11-page worst case that the audit is not designed for.** Nothing in `runHiddenAudit` bounds pages other than the count. With the context leak, that is the difference between 9 live contexts and 33. Even after the leak is fixed, 11 sequential pages at ~15–25 s each is 3–5 minutes for a single audit.

**6.5 The `runGeneration` supersede is soft, not hard.** `startAuditForStore` increments a per-shop generation and checks `isCurrentRun()` at DB-write boundaries. It does **not** abort the in-flight `runHiddenAudit` call — there is no `AbortSignal` threaded into Playwright. So a superseded scan keeps its Chrome work running to completion, opening and leaking contexts the whole time. The leak amplifies this.

---

## 7. Updated recommendation

Ordered by impact, with the leak first.

### Tier 0 — correctness (do these regardless of Sol1/Sol2)

1. **Close every context, not just pass 0's.** Change `audit.server.ts`'s `finally` to close `measuredAll` deduped by context. Same fix needed in `audit-run-page-measure.server.ts` if it has an equivalent. This is the OOM fix.
2. **Fix or delete the dead early-exit** in `audit-run-hidden.server.ts` (`stablePassStreak >= 2` → `>= 1`, or remove).
3. **Add the missing `executeAuditJob` export** to `audit-runner.server.ts`, or change `audit-queue.server.ts` to call `startAuditForStore`. The queue cannot work as shipped.
4. **Decide which `runHiddenAudit` is canonical** and delete the other, or add a one-line re-export with a comment. Two divergent copies of the core scan will keep drifting.
5. **`TEMP_TIMING_LOG = false`** in `script-generator.js`.

### Tier 1 — memory (zero audit-quality risk)

6. **Chromium flags** in `getBrowser()`: `--disable-dev-shm-usage --disable-gpu --no-first-run --disable-extensions`. `--disable-dev-shm-usage` is the important one on a 4 GiB VM.
7. **Close each context immediately after `measurePage` resolves**, inside the page loop, instead of accumulating and closing in `finally`. This is both the leak fix and the Sol2 "one context at a time" change in a single edit.
8. **`BROWSER_IDLE_CLOSE_MS` → 10 s** (or explicit `browser.close()` at the end of `withBrowser`). Drops the ~300 MB base within seconds instead of holding it two minutes.
9. **Remove `res.body()`** from `measurePage`'s `onResponse`. Leave Size blank when `Content-Length` is absent.

### Tier 2 — the 80% cut (one narrow, bounded trade)

10. **`AUDIT_REPEAT_PASSES` conditional on prior existence.** Not a flat 1. Read the most recent `AuditLog` for the shop first; if none, run 3 passes; otherwise run 1. This preserves per-request hash coverage on a store's first scan and eliminates two-thirds of the work on every scan after. This is a better version of the md's §5.3 mitigation because it prevents the miss rather than reacting to it.
11. **Process URLs sequentially within the remaining pass**, with the context closed immediately after each. Peak drops from up to 11 contexts to 1.

### Tier 3 — measure first

12. **`SETTLE_MIN_MS` / `SETTLE_PROBE_GAP_MS`.** The capacity note claims 18 s and 5 s savings. Given the actual `waitForScriptsSettled` loop (networkidle cap 8 s, two probes, 5 s floor), the saving depends on how often `networkidle` times out. On a store where it fires in 200 ms, the 5 s floor dominates and cutting to 2 s saves 3 s per settle round. On a store where it times out at 8 s, the floor is not binding and the cut saves nothing. Measure before changing.
13. **`MAX_INTERACTION_TARGETS`.** Do **not** cut to 10. The comment says "25 safe targets existed on a measured page", which is a measurement, not a guess. You said you want interaction preserved; keep 25. The ~6 s it saves is not worth the risk of missing a lazy-loaded script behind the 15th accordion.

---

## 8. What is still missing, and why it matters

| File | Why I need it |
|---|---|
| `audit-run-page-measure.server.ts` | Contains the newer `measurePage`. I need to confirm the context leak is identical there and to see whether `popups`, `labVitals`, and `res.body()` handling differ. |
| `audit-core.server.ts` | Contains `withBrowser`, `DiscoveredPages`, `AuditBlockedError`, `pageRolesFromDiscovery`. Needed to confirm the browser idle logic in the newer architecture matches the older one. |
| `audit-gate-impact.server.ts` | The extra home-page load in `audit-run-hidden.server.ts`. I need to know its cost and whether it opens a context that is closed. |
| `prisma/schema.prisma` | To confirm whether `AuditJob` has the heartbeat and `stopRequested` columns the queue assumes, and whether `StoreConfig.activeAuditJobId` exists. The queue will fail at runtime if any of these are missing. |
| `audit-script.ts` | The in-page audit script. Needed to confirm the interaction/coverage contract the md's §4 describes. |
| `audit-template-buckets.ts`, `audit-template-extra.ts`, `audit-resource-tokens.ts` | Used only by `audit-run-hidden.server.ts`. Needed if you migrate to that file. |
| `page-urls.server.ts` | `normalizeCustomUrl` is the gate on merchant-typed extras. Low priority. |

---

## 9. Bottom line

The load problem is not primarily "3 passes" or "parallel pages" or "no concurrency cap," though all three contribute. **The dominant cause is a context leak: two-thirds of every scan's browser contexts are never closed.** A 3-page scan leaves 6 contexts live; an 11-page scan leaves 22. At the code's own 80–150 MB per context, that is 0.5–3.3 GB retained per scan until the 2-minute browser idle timer fires. Overlapping scans stack this until the box dies.

Fix the leak first. It is a one-line change in the `finally`, plus moving the close into the page loop if you want the sequential design. That alone changes the OOM threshold from "2 overlapping audits on a light store" to "several audits on any store."

After that, the md's Sol2 shape is sound with two amendments:

- **1-pass only when a prior audit exists.** First audit of a store gets 3 passes so `mergeSlugVariants` can establish the prefix; every subsequent audit gets 1 and inherits the prefix through `readPriorDeferTokens`. This preserves the exact quality bar the md is worried about, without paying for it on every scan.
- **Keep `MAX_INTERACTION_TARGETS = 25` and keep both settle rounds in the one pass that remains.** Interaction and fold are the audit; the extra passes are not.

#final AI
# Short answer

Yes — those six are the right first release. All six are safe against your stated quality bar, and they cover the worst of the current damage. There are two refinements that matter (one on the semaphore, one on tab-closing), and two small additions worth folding into the same release. After that, the only big win left on the table is the pass count, which is a separate conversation.

Below, per item.

---

## Per-item

### 1. One scan at a time inside `startAuditForStore` — correct, with one placement detail

Right call. The queue file (`audit-queue.server.ts`) is dead code and is actually broken: it does `const { executeAuditJob } = await import("./audit-runner.server")`, and `audit-runner.server.ts` exports only `startAuditForStore` and `resolvePreviewThemeId`. There is no `executeAuditJob`. If anyone ever starts the queue, it throws on the first claim. Do not touch it.

Put the semaphore **inside the floating promise**, after the `await prisma.storeConfig.upsert(...)` that sets `auditRunning: true`. If you gate before that write, a queued scan shows nothing in the merchant's dashboard; if you gate after, the UI still reads "running" while it waits — which is what it does today, so it is not a regression.

```
(async () => {
  await acquire();
  try {
    if (!isCurrentRun()) return;   // superseded while queued
    ...
  } finally {
    release();
  }
})();
```

The `isCurrentRun()` check inside the acquired block matters: if a shop's scan is queued and the shop triggers a new scan, `runGeneration` bumps, the old one becomes stale — you want it to release immediately, not burn a semaphore slot on a no-op.

Set the limit to **1**, not 2. The capacity note's "2 is safe" math assumes contexts close after each pass, which they do not. After the tab-leak fix below, 2 might be safe, but you will not know until you measure on the actual 4 GiB host.

### 2. Close each tab when the page finishes — directionally right, but the current code needs a page kept open

Careful here, because the phrasing "close each tab when that page finishes" is not quite what the code needs. Read `runHiddenAudit` closely:

- `measurePage` returns `{ context, page, acc, ... }`.
- Pass-0 pages are pushed to both `measuredAll` **and** `measured`.
- Passes 1 and 2 pages are pushed only to `measuredAll`.
- The `finally` block closes **only** `measured` (pass 0).

So the leak is: **passes 1 and 2's contexts are never closed at all**, and pass 0's stay open through the whole scan. The md says "every tab from all three passes stays open until the end" — closer to the truth is "pass-1+ tabs stay open forever; pass-0 tabs stay open until the end."

The critical constraint: **pass-0 pages must stay open through post-processing.** After the pass loop, the code calls, on `measured`:

- `selectorsVisibleOnPage(page, offList)`
- `selectorsOverlapFoldOnPage(page, offList)` (twice)
- `collapseToParentSelectors(page, hideCandidates)`
- `verifyFoldSurvives(measured, hideSelectors)`

All of those need a live page. So you cannot close pass-0 tabs the moment `measurePage` resolves.

The correct shape:

- **Passes 1 and 2:** close the context as soon as `measurePage` resolves, since nothing downstream needs those pages.
- **Pass 0:** leave open, close in `finally` as now.

Or, as a strictly-safe one-liner that fixes the leak without restructuring: make `finally` close `measuredAll` deduped by context, not `measured`:

```
const unique = new Set(measuredAll.map((m) => m.context));
await Promise.allSettled([...unique].map((c) => c.close().catch(() => {})));
```

That is the minimum change. It does not lower peak during the scan (pass-0 tabs still live while passes 1 and 2 run), but it stops the leak. The per-pass fix above lowers peak *and* stops the leak, and it is what you actually want.

`audit-run-hidden.server.ts` has the identical bug, but `audit-runner.server.ts` imports `runHiddenAudit` from `./audit.server`, so `audit.server.ts` is the live one. `audit-run-hidden.server.ts` is dead code today. Either fix both or delete the dead one — do not leave two divergent copies of the core scan in the tree.

### 3. Stop calling `res.body()` — correct, and you are right about the location

Confirmed: it is in `audit.server.ts`, in `measurePage`'s `onResponse`:

```ts
bodyReads.push(
  res.body().then((buf) => {
    if (buf?.length) {
      responseBytes.set(u, Math.max(responseBytes.get(u) || 0, buf.length));
    }
  }).catch(() => {}),
);
```

`responseBytes` is only used to fill `row.transferSize` when resource timing gives a smaller value — i.e. it affects the Size column, not `deferArray`, not `hideSelectors`, not `neverDefer`, not `noise`, not `fold`. Safe to remove. When you remove the push, also remove the `bodyReads` array declaration and the `await Promise.all(bodyReads);` call that drains it — leaving an empty array awaited is harmless but reads as if there is work happening.

### 4. Chrome flags — correct

`--disable-dev-shm-usage` is the one that matters most on a 4 GiB VM. The other three are standard and safe. `--disable-dev-shm-usage` alone is worth the release.

### 5. Close Chrome ~10 seconds after the scan — correct

Change `BROWSER_IDLE_CLOSE_MS = 2 * 60 * 1000` to `10 * 1000`. The mechanism is already correct: the timer only starts when `browserUsers === 0`, and a new scan clears it. A new scan within 10 s reuses the browser; a scan after that pays ~1 s for a fresh launch. That trade is heavily in your favour on a 4 GiB box.

### 6. `TEMP_TIMING_LOG = false` — correct

Confirmed live in `script-generator.js` (`const TEMP_TIMING_LOG = true;`, with a comment saying "REMEMBER TO SET BACK TO false"). It wraps the obfuscated storefront bundle in a `console.log` harness on every page load. Not server RAM, but not free either, and it was only meant to be temporary.

---

## Two things to add to the same release

### A. Fix the broken queue import

Even though you are not turning the queue on, `audit-queue.server.ts` does `const { executeAuditJob } = await import("./audit-runner.server")` and there is no such export. It is a landmine for whoever next reads the code and thinks "the queue is right there, let me just start it." Either export `executeAuditJob` from the runner as a thin wrapper around the body of the floating promise, or delete `audit-queue.server.ts` + `audit-queue-policy.ts` and the `AuditJob` model usage. Delete is cleaner if you are not using it.

### B. Confirm the canonical `runHiddenAudit`

Two implementations exist. `audit.server.ts` is imported by the runner; `audit-run-hidden.server.ts` is not imported by anything you have shown me. Either delete `audit-run-hidden.server.ts` and its support files (`audit-run-page-measure.server.ts`, `audit-gate-impact.server.ts` if unused), or add a header comment to each naming the other as dead. Two divergent copies of the core scan is how "we fixed the context leak" turns into "we fixed it in one file and shipped the other."

---

## What this release buys you, honestly

With those six plus A and B:

- The OOM cause is gone. Today, a 3-page scan leaves 6 live contexts (~0.5–1.8 GB); an 11-page scan leaves 22 (~1.8–6.6 GB). After the fix, peak is one pass's worth of contexts, closed as each pass ends.
- Peak RAM during a scan drops roughly by the pass factor for the extra passes, and by the fact that pass-0 contexts are the only long-lived ones.
- One scan at a time means concurrent shops can no longer multiply the peak. Queued shops wait, and the UI already shows "running" while they do.
- Chrome base drops to ~10 s lifetime instead of 2 minutes, freeing ~300 MB between scans.
- Node heap no longer spikes on uncached script bodies.
- Storefront script gets a tiny bit smaller when `TEMP_TIMING_LOG` comes off.

None of this changes which scripts are found, which are deferred, or what is hidden above the fold. Your statement is accurate.

**Peak RAM does not fall 80%** from these six alone, because Chrome's base (~300 MB) is still on the box, and pass 0 still runs. What changes is that the box stops dying under any realistic load, and the time-integrated load falls substantially. The 80% figure only becomes true when you also go from 3 passes to 1 — which is the next conversation.

---

## The one thing still on the table

`AUDIT_REPEAT_PASSES = 3` is two-thirds of the page loads. Removing it is safe in a specific, bounded way that the code itself documents (the `AUDIT_REPEAT_PASSES` comment in `audit.server.ts`): the only thing passes 2 and 3 feed is `mergeSlugVariants`, and only for tokens whose URL contains a value that varies per request. Deploy-time hash changes are already covered by `readPriorDeferTokens`.

A safe version of the cut, worth considering for the release *after* this one:

- First-ever audit of a shop: run all 3 passes, so `mergeSlugVariants` sees the divergence and stores a merged prefix.
- Every audit after that: run 1 pass. `readPriorDeferTokens` returns the previously-merged prefix, the new single sample merges against it, and the result is stable.

That gives you the 2/3 win on every scan except the first, without losing the per-request-hash coverage the md is worried about. It is a better answer than the md's "wait for a miss, then add a home-only reload," because it prevents the miss rather than reacting to it.

But it is a different release, with its own verification step (diff `deferArray` and `hideSelectors` between a 3-pass scan and a 1-pass scan of the same shop, same day). Do the six first, measure on the real host, then decide.

---

## Bottom line

Your six-item plan is the right first release. Two small refinements:

- Put the semaphore **inside** the floating promise, with an `isCurrentRun()` check after acquiring.
- Do not literally close pass-0 tabs as each page finishes — passes 1 and 2 can close immediately, pass 0 must stay open through post-processing. The minimum fix is to change the `finally` to close `measuredAll` deduped by context.

Add the queue cleanup (A) and the dead-file decision (B) to the same release so the tree does not keep drifting. Then measure on the real box and decide on the pass count.