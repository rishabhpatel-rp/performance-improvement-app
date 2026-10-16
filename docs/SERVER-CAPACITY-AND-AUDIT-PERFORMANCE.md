# PagePulse — Server Capacity & Audit Performance Analysis

> **Purpose**: Answer two questions from production evidence and code measurement:
> 1. Can the 2 vCPU / 4 GiB server handle multiple customers running audits at the same time?
> 2. Why does each audit take so long, and exactly how can it be made faster?
>
> **Source of truth**: direct reading of `app/lib/audit.server.ts`, `app/lib/audit-runner.server.ts`, `app/lib/performance-script.server.ts`, and `app/lib/script-generator.js`.
> All timing numbers come from named constants in those files. Memory estimates are industry benchmarks for headless Chromium.

---

## Table of Contents

1. [Production Server Specs](#1-production-server-specs)
2. [Application Architecture](#2-application-architecture)
3. [How One Audit Works — Phase by Phase](#3-how-one-audit-works--phase-by-phase)
4. [Memory Model](#4-memory-model)
5. [CPU Model](#5-cpu-model)
6. [Concurrent Customer Verdict](#6-concurrent-customer-verdict)
7. [Why Audits Take 2–3 Minutes — Root Cause Breakdown](#7-why-audits-take-23-minutes--root-cause-breakdown)
8. [Optimization Options — Ranked by Impact](#8-optimization-options--ranked-by-impact)
9. [Recommended Changes](#9-recommended-changes)
10. [Quick-Wins Checklist](#10-quick-wins-checklist)

---

## 1. Production Server Specs

| Resource | Value |
|---|---|
| vCPUs | 2 |
| RAM | 4 GiB (≈ 4096 MB) |
| Usable RAM (OS overhead ~300 MB) | ≈ 3750 MB |
| OS | Linux |
| Node.js version (required) | ≥ 20.19 |
| Headless browser | Chromium (system-installed via `apk`, path set in `CHROMIUM_PATH`) |

---

## 2. Application Architecture

There are **two separate Node.js processes** deployed from this repository:

```
┌─────────────────────────────────────────────────────────────┐
│                         Server (2 vCPU / 4 GiB)            │
│                                                             │
│  ┌──────────────────────────────┐  ┌──────────────────────┐ │
│  │  Shopify App (React Router 7)│  │  Admin Panel (Next 15)│ │
│  │  Port 3000                   │  │  Port 3001 (internal) │ │
│  │                              │  │                      │ │
│  │  - Merchant wizard & config  │  │  - Fleet dashboard   │ │
│  │  - App Proxy (storefront JS) │  │  - Store detail view │ │
│  │  - Audit engine (Playwright) │  │  - Activity timeline │ │
│  └──────────────┬───────────────┘  └──────────┬───────────┘ │
│                 │                             │             │
│                 └──────────┬──────────────────┘             │
│                            │ shared connection               │
│                  ┌─────────▼──────────┐                     │
│                  │   PostgreSQL        │                     │
│                  └────────────────────┘                     │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Chromium (headless)  — singleton, shared process      │ │
│  │  Launched on first audit, reused for 2 min idle, then  │ │
│  │  closed.  Each audit opens its own browser contexts.   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Critical design fact**: `audit.server.ts` maintains a **single global Chromium process** (`browserPromise`, `browserUsers`). Every simultaneous audit on the server shares this one process and opens their pages as isolated browser contexts inside it. This means:

- Chromium's base memory (~300 MB) is paid **once**, not once per customer.
- But every page context each audit opens adds ~80–150 MB on top.
- If Chromium crashes (OOM kill), **all audits in progress fail simultaneously**.

---

## 3. How One Audit Works — Phase by Phase

When a merchant clicks "Run Audit", the flow in `audit-runner.server.ts` and `audit.server.ts` is:

```
startAuditForStore()
│
├─ [DB] Reset StoreConfig: auditRunning=true, phase="discovering"
│
├─ [Shopify] Fetch PLP + PDP URLs via GraphQL (discoverPages)
│   └─ Fallback 1: parse homepage HTML over plain HTTP
│   └─ Fallback 2: render homepage in Chromium (browser already warm)
│
├─ [DB] Write discovered pages (auditPages, auditTotalPages), phase="auditing"
│
├─ runHiddenAudit()  ← most of the wall time lives here
│   │
│   ├─ PASS 1 — FULL MEASUREMENT  (all pages run in parallel)
│   │   ├─ browser.newContext()  per page
│   │   ├─ CDP Profiler.startPreciseCoverage
│   │   ├─ page.goto() — waitUntil: "load", timeout 45 s
│   │   ├─ waitForScriptsSettled()  ← pre-interaction settle (min 5 s)
│   │   ├─ captureInitialFold()     ← snapshot above-the-fold elements
│   │   ├─ CDP Profiler.takePreciseCoverage  ← JS coverage snapshot
│   │   ├─ simulateInteractions()   ← scroll + mouse + click (up to 30 s)
│   │   ├─ waitForScriptsSettled()  ← post-interaction settle (min 5 s)
│   │   └─ measure + classify all script URLs
│   │
│   ├─ PASS 2 — HARVEST ONLY  (all pages in parallel, no coverage/fold/interaction)
│   │   ├─ page.goto()
│   │   └─ waitForScriptsSettled()
│   │
│   ├─ PASS 3 — HARVEST ONLY  (same as Pass 2)
│   │
│   └─ POST-PROCESSING  (sequential, but fast)
│       ├─ selectorsVisibleOnPage × pages
│       ├─ selectorsOverlapFoldOnPage × pages  (called twice)
│       ├─ collapseToParentSelectors × pages
│       ├─ verifyFoldSurvives
│       ├─ readPriorDeferTokens (1 DB query)
│       └─ mergeSlugVariants
│
├─ [DB] Write phase="building"
│
├─ saveAuditReport()
│   ├─ [DB] Upsert StoreConfig with defer/hide arrays
│   ├─ [DB] Create AuditLog entry
│   └─ rebuildPerformanceScript()
│       ├─ Read perPage audit data (1 DB query)
│       ├─ generateDeferredScript() — JS template + JavaScriptObfuscator (~80 ms CPU)
│       └─ [DB] Upsert PerformanceScript
│
└─ [DB] Set auditRunning=false, auditComplete=true, phase=null
```

The merchant's dashboard polls `/api/audit/status` every few seconds and shows live progress chips.

---

## 4. Memory Model

### 4.1 Components at idle (no audit running)

| Component | Typical RAM |
|---|---|
| Node.js — Shopify app (idle) | 150–200 MB |
| Node.js — Admin panel (Next.js, idle) | 120–180 MB |
| PostgreSQL | 80–200 MB |
| OS + kernel | 250–350 MB |
| **Total at idle** | **600–930 MB** |

### 4.2 Memory added per audit

| Item | RAM estimate | Notes |
|---|---|---|
| Chromium base process | ~300 MB | Paid **once** for all audits (singleton). Already included after the first audit starts. |
| Each open browser context (page) | ~80–150 MB | Scales with store complexity (DOM, JS heap) |
| Pass 1 peak: 3 pages × 3 contexts open at once | 3 × ~120 MB = **360 MB** | Contexts close after each pass |
| Passes 2+3 peak: same 3 pages again | 3 × ~100 MB = **300 MB** | Harvest-only; lighter |
| Peak per audit (Chromium already running) | **~360 MB** | The 3 simultaneously-open contexts of one audit's busiest pass |

### 4.3 Concurrent audit load — RAM table

| Running audits | Base idle | + Chromium (shared) | + Audit contexts (peak) | **Total estimate** | Headroom (of 4 GiB) |
|---|---|---|---|---|---|
| 0 | 750 MB | — | — | **750 MB** | 3250 MB |
| 1 | 750 MB | 300 MB | 360 MB | **~1.4 GB** | ~2.6 GB |
| 2 | 750 MB | 300 MB | 720 MB | **~1.77 GB** | ~2.2 GB |
| 3 | 750 MB | 300 MB | 1080 MB | **~2.13 GB** | ~1.9 GB |
| 4 | 750 MB | 300 MB | 1440 MB | **~2.49 GB** | ~1.5 GB |
| 5 | 750 MB | 300 MB | 1800 MB | **~2.85 GB** | ~1.1 GB |
| 6 | 750 MB | 300 MB | 2160 MB | **~3.21 GB** | ~790 MB |
| 7 | 750 MB | 300 MB | 2520 MB | **~3.57 GB** | ~430 MB |
| **8** | 750 MB | 300 MB | 2880 MB | **~3.93 GB** | **~70 MB ← OOM zone** |

> **Heavy-store adjustment**: Stores with large home pages (many carousels, animations, 3rd-party widgets) can push a single page context to 200–300 MB instead of 120 MB. Halve the "safe" thresholds above for worst-case stores.

**Conservative safe limit: 4 simultaneous audits** (leaves ~1.5 GB headroom for spikes).
**Absolute hard limit: 7 simultaneous audits** (only ~430 MB margin — any memory spike OOMs the server).

### 4.4 What happens on OOM

Linux's OOM killer sends SIGKILL to the largest memory consumer, which will be the Chromium process. This:
1. Crashes the shared Chromium singleton.
2. All Playwright calls across **every running audit** throw immediately.
3. All in-flight audits for **every store** fail with an unhandled error.
4. The Node.js process may also be killed if Chromium is not the largest process at that moment.
5. All affected stores get `auditFailed=true` and a confusing error message.

---

## 5. CPU Model

### 5.1 What uses CPU

| Work | CPU character | Blocks event loop? |
|---|---|---|
| Playwright page navigation | I/O-bound (network) | No |
| Chromium rendering JS/layout | CPU inside Chromium process | No (separate process) |
| `waitForScriptsSettled` probes | Mixed (IPC + setTimeout) | No |
| `simulateInteractions` | I/O-bound (Playwright IPC) | No |
| `page.evaluate()` calls | Chromium CPU | No |
| `JavaScriptObfuscator.obfuscate()` | **CPU-bound, synchronous** | **YES — ~80 ms** |
| Prisma DB queries | I/O-bound | No |
| React Router request handling | Minimal | No |

### 5.2 The obfuscator is the only event-loop blocker

`script-generator.js` line 590–605 calls `JavaScriptObfuscator.obfuscate()` synchronously. The code comments state it takes ~80 ms per call (measured from the old heavy profile at ~660 ms vs. the current light profile at ~80 ms).

- **1 audit finishing**: 80 ms of event-loop blocking → minor; storefront requests experience one 80 ms stall.
- **3 audits finishing simultaneously**: up to 3 × 80 ms = 240 ms of staggered blocking. Shopify's session verification and proxy requests during that window time out or queue.
- **Mitigation**: Run `generateDeferredScript` in a `worker_threads` Worker. No code change needed in the callers; only `rebuildPerformanceScript` needs wrapping.

### 5.3 Chromium CPU vs. 2 vCPUs

Chromium's renderer processes are multi-threaded but largely single-threaded per page. With 3 pages running in parallel inside a single Chromium process, all three compete for the same 2 vCPUs.

- At idle: page rendering uses < 0.1 vCPU.
- During `waitForScriptsSettled` probes: 0.2–0.5 vCPU per page.
- During JS-heavy pages (analytics, carousels, popups): short spikes to 1+ vCPU per page.

With 2 concurrent audits (6 pages in parallel), CPU can saturate at 100% during settlement probes. This slows each page's rendering, which in turn makes it take longer to settle — creating a feedback loop that adds 10–30% to each audit's wall time when two audits overlap.

---

## 6. Concurrent Customer Verdict

### Short answer

| # simultaneous audits | Server verdict |
|---|---|
| 1 | ✅ Safe — comfortable headroom |
| 2 | ✅ Safe — ~2.2 GB headroom |
| 3 | ⚠️ Borderline — safe for simple stores; risky for complex ones |
| 4 | ⚠️ Risky — only ~1.5 GB headroom, CPU saturation likely |
| 5+ | ❌ Likely OOM on stores with heavy pages; CPU thrash |

### Why it's better than it looks

The audits from different customers (different Shopify stores, installed on different devices) do **not** interact with each other's data. The Chromium singleton is shared but pages are fully isolated via browser contexts (isolated cookies, localStorage, V8 heap). A crash in one customer's audit context does not corrupt another customer's audit data — only the audit itself fails.

### Why it's worse than it looks

There is **no concurrency gate** in the current code. If 10 customers install the app within the same minute on launch day, 10 Playwright audits start simultaneously. The server OOMs, Chromium dies, all 10 audits fail, and all 10 customers see an error on their first experience with the app.

### Evidence from the code

`audit-runner.server.ts` lines 56–100:
```typescript
// No semaphore, no queue, no concurrency check.
// startAuditForStore() fires a floating promise immediately:
(async () => {
  // ... the full audit runs here, un-gated
})();
return { started: true };
```

`audit.server.ts` lines 156–200: `getBrowser()` / `withBrowser()` — global singleton, no per-audit limit.

---

## 7. Why Audits Take 2–3 Minutes — Root Cause Breakdown

### 7.1 Timing constants (source: `audit.server.ts`)

| Constant | Value | Where it costs time |
|---|---|---|
| `AUDIT_REPEAT_PASSES` | 3 | Multiplies every page load + settle by 3 |
| `SETTLE_MIN_MS` | 5000 ms | **Hard floor**: every settle waits at least 5 s, even on a 1 s page |
| `SETTLE_PROBE_GAP_MS` | 900 ms | Each stability check takes 900 ms; 2 checks needed |
| `SETTLE_STABLE_CHECKS` | 2 | Requires 2 × 900 ms = 1.8 s of stability on top of the 5 s floor |
| `SETTLE_SAFETY_NET_MS` | 40,000 ms | Absolute cap; analytics-heavy pages can hit this |
| `NETWORK_IDLE_CAP_MS` | 8000 ms | Each `waitForLoadState('networkidle')` probe can block for up to 8 s |
| `PAGE_LOAD_TIMEOUT_MS` | 45,000 ms | Per-page navigation timeout |
| `INTERACTION_PHASE_TIMEOUT_MS` | 30,000 ms | Interaction phase hard cap |
| `MIN_SCROLL_STEPS` | 6 | Minimum scroll iterations |
| `SCROLL_STEP_SETTLE_MS` | 300 ms | Pause after each scroll step |
| `MAX_INTERACTION_TARGETS` | 25 | Max elements clicked per page |
| `INTERACTION_CLICK_TIMEOUT_MS` | 1500 ms | Per-click actionability wait |
| `INTERACTION_STEP_SETTLE_MS` | 400 ms | Pause after each click |
| `MEASURE_TIMEOUT_MS` | 15,000 ms | Audit script result wait |
| `AUDIT_PASS_GAP_MS` | 0 ms | No gap between passes (was 2 min, removed — good) |

### 7.2 Wall-time budget for one typical audit (3-page store)

Each pass runs all pages in parallel; wall time = **slowest page**.

```
┌────────────────────────────────────────────────────────────────────┐
│  PASS 1 — FULL MEASUREMENT                                         │
│                                                                    │
│  Page load (goto + waitUntil:"load")          3–8 s               │
│  Pre-interaction settle                                            │
│    networkidle probe (up to 8 s cap)          1–8 s               │
│    SETTLE_MIN_MS floor                        5 s    ← fixed cost │
│    2× stability probes (2 × 900 ms)          1.8 s  ← fixed cost │
│    ─────────────────────────────────────────────────              │
│    Pre-settle subtotal                       7–15 s               │
│                                                                    │
│  CDP coverage snapshot                       0.1–0.3 s            │
│  captureInitialFold                          0.1–0.3 s            │
│                                                                    │
│  Interaction simulation                                            │
│    MIN_SCROLL_STEPS × SCROLL_STEP_SETTLE    6 × 300 = 1.8 s min  │
│    Typical 10–15 scroll steps               3–4.5 s               │
│    Up to 25 clicks × INTERACTION_STEP       25 × 400 = 10 s max  │
│    Typical 5–10 clicks                      2–4 s                 │
│    ─────────────────────────────────────────────────              │
│    Interaction subtotal                      4–15 s               │
│                                                                    │
│  Post-interaction settle (same logic)        7–15 s               │
│                                                                    │
│  Script classification                       0.1–0.5 s            │
│  ──────────────────────────────────────────────────────           │
│  PASS 1 TOTAL                               ~22–54 s              │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  PASS 2 — HARVEST ONLY (no coverage, fold capture, interaction)    │
│                                                                    │
│  Page load                                  3–8 s                 │
│  Settle (same logic, same floor)            7–15 s                │
│  ──────────────────────────────────────────────────────           │
│  PASS 2 TOTAL                               ~10–23 s              │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  PASS 3 — HARVEST ONLY (same as Pass 2)     ~10–23 s              │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  POST-PROCESSING (sequential Playwright evaluate calls)            │
│                                                                    │
│  selectorsVisibleOnPage × 3 pages           0.5–2 s               │
│  selectorsOverlapFoldOnPage × 3 pages × 2   1–3 s                 │
│  collapseToParentSelectors × 3 pages        0.5–2 s               │
│  verifyFoldSurvives                         0.5–2 s               │
│  readPriorDeferTokens (DB query)            0.1–0.3 s             │
│  mergeSlugVariants                          < 0.1 s               │
│  saveAuditReport (DB writes)                0.2–0.5 s             │
│  generateDeferredScript (obfuscator)        ~0.08 s               │
│  ──────────────────────────────────────────────────────           │
│  POST-PROCESSING TOTAL                      ~3–10 s               │
└────────────────────────────────────────────────────────────────────┘

══════════════════════════════════════════════════════════════════════
  AUDIT TOTAL (typical, 3-page store)         ~45–110 s
  AUDIT TOTAL (slow/heavy store)              up to 3–4 min
══════════════════════════════════════════════════════════════════════
```

### 7.3 The three biggest individual costs

**#1 — `SETTLE_MIN_MS = 5000` × 2 settle rounds × 3 passes = ~30 s of mandatory sleeping**

Even if every script on every page finishes loading at 800 ms, the code waits 5 s per settle round before it will even start the 2-probe stability check. With 2 settle rounds (pre + post interaction) across 3 passes that is a guaranteed minimum of 5 s × 2 × 3 = **30 seconds of pure waiting**, regardless of actual page speed.

**#2 — Interaction simulation: up to 25 clicks × 400 ms = 10 s per page in Pass 1**

`MAX_INTERACTION_TARGETS = 25` and `INTERACTION_STEP_SETTLE_MS = 400 ms` means the interaction phase alone can take 10 s on a page with many accordion/carousel elements. This is deliberately conservative to catch lazy-loaded widgets, but is also the largest variable cost in Pass 1.

**#3 — `AUDIT_REPEAT_PASSES = 3` multiplies every load + settle by 3**

Passes 2 and 3 are harvest-only (much cheaper: no coverage, fold, or interaction) but each still loads the page and waits for it to settle. With `SETTLE_MIN_MS = 5000` the minimum cost of each harvest pass is still ~8 s per page. Two extra passes = ~16 s extra minimum.

---

## 8. Optimization Options — Ranked by Impact

### Legend
- **Impact**: time or memory saved
- **Risk**: chance of reducing audit quality
- **Effort**: lines of code to change

---

### Option A — Reduce `SETTLE_MIN_MS` (5000 → 2000 ms)

**File**: `app/lib/audit.server.ts` line 699  
**Change**: `const SETTLE_MIN_MS = 2000;`

| | |
|---|---|
| **Time saved** | 3 s × 2 settle rounds × 3 passes = **18 s** for a typical 3-page store |
| **Risk** | Low. The 5 s floor was chosen to guard against "a page that is quiet for 1.8 s can still have a lazy chunk arriving at 2.5 s". At 2 s the guard is still present; the 2-probe stability check (2 × 900 ms on top) still catches scripts that arrive at 2–3 s. |
| **Effort** | 1 line |

---

### Option B — Reduce `SETTLE_PROBE_GAP_MS` (900 → 500 ms)

**File**: `app/lib/audit.server.ts` line 698  
**Change**: `const SETTLE_PROBE_GAP_MS = 500;`

| | |
|---|---|
| **Time saved** | 400 ms × 2 probes × 2 rounds × 3 passes = **~5 s** |
| **Risk** | Low. The probe reads `performance.getEntriesByType('resource')` inside the page — a synchronous in-page call with essentially zero latency. 500 ms is still a generous settle gap for any real network activity. |
| **Effort** | 1 line |

---

### Option C — Reduce `INTERACTION_STEP_SETTLE_MS` (400 → 200 ms)

**File**: `app/lib/audit.server.ts` line 712  
**Change**: `const INTERACTION_STEP_SETTLE_MS = 200;`

| | |
|---|---|
| **Time saved** | On a page with 10 clicks: 200 ms × 10 = **2 s** per page in Pass 1 |
| **Risk** | Low-medium. Clicking an accordion and reading its revealed content 200 ms later is sufficient for most frameworks. 400 ms was a conservative choice; some very slow animation-heavy widgets may not fully render in 200 ms. |
| **Effort** | 1 line |

---

### Option D — Reduce `SCROLL_STEP_SETTLE_MS` (300 → 150 ms)

**File**: `app/lib/audit.server.ts` line 712  
**Change**: `const SCROLL_STEP_SETTLE_MS = 150;`

| | |
|---|---|
| **Time saved** | With 10 scroll steps: 150 ms × 10 = **1.5 s** per page |
| **Risk** | Low. `IntersectionObserver` callbacks fire within one frame (16 ms) of the element entering the viewport. 150 ms is 9× a frame — more than sufficient to trigger lazy-load logic. |
| **Effort** | 1 line |

---

### Option E — Reduce `MAX_INTERACTION_TARGETS` (25 → 10)

**File**: `app/lib/audit.server.ts` line 710  
**Change**: `const MAX_INTERACTION_TARGETS = 10;`

| | |
|---|---|
| **Time saved** | 15 fewer clicks × 400 ms = **6 s per page** in Pass 1 |
| **Risk** | Low. On a measured real store only 25 safe targets were found on the whole page — but the coverage value of clicks 11–25 is marginal. The first 10 clicks cover: the header hamburger menu, the first hero carousel control, the first accordion, the first tab. Clicks 11–25 are deep-page carousels and repeated patterns the first 10 already exercised. |
| **Effort** | 1 line |

---

### Option F — Reduce `AUDIT_REPEAT_PASSES` (3 → 2)

**File**: `app/lib/audit.server.ts` line 736  
**Change**: `const AUDIT_REPEAT_PASSES = 2;`

| | |
|---|---|
| **Time saved** | One full harvest pass (~10–23 s) = **10–23 s** |
| **Risk** | Low-medium. The purpose of 3 passes is to catch tokens whose URL fragment varies per request (nonces, A/B buckets, CDN cache-busters). 2 passes still observes 2 independent URL samples per script and still feeds `mergeSlugVariants`. Only tokens that rotate on a very short window (< 20 s) and use a different hash on both observed requests would be missed — an extremely niche case. The cross-run merge against the previous audit report catches deploy-time hash changes regardless. |
| **Effort** | 1 line |

---

### Option G — Add a concurrency gate (max 2 simultaneous audits)

**File**: `app/lib/audit-runner.server.ts`  
**Change**: Add an in-process semaphore before the `(async () => { ... })()` floating promise.

```typescript
// Add near the top of the file (after imports):
let runningAudits = 0;
const MAX_CONCURRENT_AUDITS = 2;
const auditQueue: Array<() => void> = [];

function acquireAuditSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (runningAudits < MAX_CONCURRENT_AUDITS) {
      runningAudits++;
      resolve();
    } else {
      auditQueue.push(() => { runningAudits++; resolve(); });
    }
  });
}

function releaseAuditSlot(): void {
  const next = auditQueue.shift();
  if (next) {
    next();
  } else {
    runningAudits--;
  }
}

// Then wrap the floating promise:
(async () => {
  await acquireAuditSlot();
  try {
    // ... existing audit body ...
  } finally {
    releaseAuditSlot();
  }
})();
```

| | |
|---|---|
| **Memory saved** | Prevents the 3rd+ simultaneous audit from launching → caps peak at ~1.77 GB instead of unlimited |
| **Risk** | None for correctness. Queued audits take slightly longer to start (they wait for a slot). The merchant sees the audit as "waiting" in the UI via `auditRunning=true` already set before the queue. |
| **Effort** | ~25 lines |

---

### Option H — Chromium launch flags for lower memory

**File**: `app/lib/audit.server.ts` — `getBrowser()` function  
**Change**:
```typescript
const launching = chromium.launch({
  headless: true,
  executablePath: chromiumExecutablePath(),
  args: [
    '--disable-dev-shm-usage',   // use /tmp instead of /dev/shm (64 MB on most Linux VMs)
    '--disable-gpu',              // no GPU renderer needed for headless
    '--no-first-run',             // skip first-run wizards
    '--disable-extensions',       // no Chrome extensions
    '--disable-background-networking', // stop background update checks
    '--disable-default-apps',
    '--mute-audio',
    '--no-zygote',                // skip the zygote forking process (saves ~30 MB)
  ],
});
```

| | |
|---|---|
| **Memory saved** | ~50–100 MB per Chromium process |
| **Risk** | Low. These are standard headless Chromium flags used in every CI/CD environment. `--no-zygote` is the highest-risk flag — if Chromium behaves unexpectedly, remove it first. |
| **Effort** | ~10 lines |

---

### Summary table

| Option | Time saved | Memory saved | Risk | Effort |
|---|---|---|---|---|
| A — Reduce `SETTLE_MIN_MS` | ~18 s | — | Low | 1 line |
| B — Reduce `SETTLE_PROBE_GAP_MS` | ~5 s | — | Low | 1 line |
| C — Reduce `INTERACTION_STEP_SETTLE_MS` | ~2–4 s | — | Low | 1 line |
| D — Reduce `SCROLL_STEP_SETTLE_MS` | ~1–2 s | — | Low | 1 line |
| E — Reduce `MAX_INTERACTION_TARGETS` | ~6 s | — | Low | 1 line |
| F — Reduce `AUDIT_REPEAT_PASSES` | ~10–23 s | — | Low-medium | 1 line |
| G — Concurrency gate | — | Prevents OOM | None | ~25 lines |
| H — Chromium launch flags | — | ~50–100 MB | Low | ~10 lines |

**Combined savings (A + B + C + D + E + F)**: approximately **40–60 seconds** off a typical 3-page audit — reducing median time from ~90 s down to ~35–50 s.

---

## 9. Recommended Changes

These four changes give the best improvement with the lowest risk and are safe to ship together:

### R1 — Add the concurrency gate (Option G)

This is the only change that **prevents data loss**. Without it, a sudden surge of new installs (e.g. after a marketing push) causes an OOM kill that silently fails every running audit simultaneously. Implement Option G in `app/lib/audit-runner.server.ts`. Set `MAX_CONCURRENT_AUDITS = 2` to stay well within the memory envelope.

### R2 — Reduce `SETTLE_MIN_MS` to 2000 ms (Option A)

This is the single highest time saving with the lowest risk. A 2 s floor is still more than twice the time the code comment itself says is dangerous ("a lull at 1.8 s"). The stability checks that follow still catch anything that arrives in the 2–5 s window.

### R3 — Reduce `MAX_INTERACTION_TARGETS` to 10 (Option E)

Saves ~6 s per page in Pass 1 with no meaningful coverage loss. The 25-target limit was set from a measured page; the coverage value of targets 11–25 is marginal.

### R4 — Add Chromium launch flags (Option H)

`--disable-dev-shm-usage` alone is high-priority: on a 4 GiB VM, `/dev/shm` is often limited to 64 MB and Chromium falls back to a slow disk path when it exceeds it. Adding this flag alone fixes intermittent Chromium crashes on memory-constrained VMs.

**Expected outcome after R1–R4**: Median audit time drops from ~90 s to ~50–60 s. Peak concurrent audits capped at 2, preventing OOM on any store mix. Chromium memory footprint ~80 MB lighter.

---

## 10. Quick-Wins Checklist

For the team to action immediately, in priority order:

- [ ] **R1 — Concurrency gate** (`audit-runner.server.ts`): add `MAX_CONCURRENT_AUDITS = 2` semaphore — prevents OOM on launch-day surges
- [ ] **R4 — Chromium flags** (`audit.server.ts` `getBrowser()`): add `--disable-dev-shm-usage --disable-gpu --no-first-run --disable-extensions` — fixes `/dev/shm` exhaustion and sheds ~80 MB
- [ ] **R2 — Lower settle floor** (`audit.server.ts`): `SETTLE_MIN_MS = 2000` — saves ~18 s per audit for free
- [ ] **R3 — Fewer interaction clicks** (`audit.server.ts`): `MAX_INTERACTION_TARGETS = 10` — saves ~6 s per audit for free
- [ ] **Option B** (`audit.server.ts`): `SETTLE_PROBE_GAP_MS = 500` — saves ~5 s for free
- [ ] **Option F** (`audit.server.ts`): `AUDIT_REPEAT_PASSES = 2` — saves ~15 s; reconsider only if token-variation false-negatives are observed in production
- [ ] **Monitor** with `TEMP_TIMING_LOG` (already in `script-generator.js` line 625) — keep it enabled on staging to measure actual gate-install time before and after changes
- [ ] **Consider `worker_threads`** for `JavaScriptObfuscator.obfuscate()` in `rebuildPerformanceScript` — eliminates the 80 ms event-loop block on audit completion; lower priority than the above

---

*Document generated: October 2026. Re-validate timing constants against `app/lib/audit.server.ts` after any code change — the constants are the source of truth.*
