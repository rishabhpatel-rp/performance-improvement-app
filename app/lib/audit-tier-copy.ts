import type { DeferTier } from "./audit-candidates.ts";

export function storefrontImpactForDeferTier(tier: DeferTier | undefined): string | undefined {
  switch (tier) {
    case "interaction":
      return "Deferred — loads after first click";
    case "delay-every":
      return "Delayed on every visit (every-load tier)";
    case "delay-first":
      return "Delayed on first visit only";
    case "never":
      return "Never deferred (protected)";
    default:
      return undefined;
  }
}
