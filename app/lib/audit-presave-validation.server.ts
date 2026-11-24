import type { Browser } from "playwright";
import { classifyCandidate } from "./audit-candidates.ts";
import type { HiddenAuditResult } from "./audit-core.ts";
import { measureGateImpactOnHome } from "./audit-gate-impact.server.ts";
import { runStorefrontSmokeTest } from "./audit-smoke-test.server.ts";
import { logger } from "./logger.ts";

const GATE_LCP_REGRESSION_MS = 300;
const GATE_RISKY_ORDER_MAX = 15;
const GATE_STRIP_MAX = 5;

export async function applyPreSaveAuditValidation(
  browser: Browser,
  homeUrl: string,
  password: string | undefined,
  report: HiddenAuditResult,
  shopifySpecific = true,
): Promise<HiddenAuditResult> {
  const warnings = [...(report.warnings ?? [])];
  let deferArray = [...report.deferArray];
  let delayEveryArray = [...(report.delayEveryArray ?? [])];
  let delayFirstArray = [...(report.delayFirstArray ?? [])];

  const smokeResult = await runStorefrontSmokeTest(
    browser,
    homeUrl,
    deferArray,
    report.hideSelectors,
    password,
    shopifySpecific,
  );
  if (!smokeResult.passed) {
    const critical = smokeResult.failures.filter((f) =>
      ["cart-api", "checkout-reachable"].includes(f.check),
    );
    if (critical.length > 0) {
      logger.error("[audit] Smoke test critical failure — clearing defer config", critical);
      deferArray = [];
      delayEveryArray = [];
      delayFirstArray = [];
      warnings.push("smoke-test-failed-cleared-defer");
    } else {
      warnings.push(`smoke-test-warnings:${smokeResult.failures.map((f) => f.check).join(",")}`);
    }
  }

  const gateImpact = await measureGateImpactOnHome(
    browser,
    homeUrl,
    password,
    report.hideSelectors,
    deferArray,
  );
  if (gateImpact?.deltaLcpMs != null && gateImpact.deltaLcpMs > GATE_LCP_REGRESSION_MS) {
    const deferSet = new Set(deferArray);
    const riskiest =
      report.scriptInventory?.byToken
        ?.filter(
          (e) => deferSet.has(e.token) && (e.homeRequestOrder ?? 999) <= GATE_RISKY_ORDER_MAX,
        )
        ?.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
        ?.slice(0, GATE_STRIP_MAX)
        ?.map((e) => e.token) ?? [];
    if (riskiest.length) {
      const strip = new Set(riskiest);
      deferArray = deferArray.filter((t) => !strip.has(t));
      delayEveryArray = delayEveryArray.filter((t) => !strip.has(t));
      delayFirstArray = delayFirstArray.filter((t) => !strip.has(t));
      warnings.push("gate-sim-stripped-risky-scripts");
      logger.warn("[audit] Gate sim LCP regression — stripped early defer tokens", riskiest);
    }
  }

  const stripNever = (list: string[]) => list.filter((t) => classifyCandidate(t) !== "never-defer");

  return {
    ...report,
    deferArray: stripNever(deferArray),
    delayEveryArray: stripNever(delayEveryArray),
    delayFirstArray: stripNever(delayFirstArray),
    warnings,
  };
}
