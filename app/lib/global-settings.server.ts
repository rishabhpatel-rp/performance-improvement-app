import prisma from "../db.server";
import { STEP2_OFFER_POPUP_KEY } from "../../shared/global-settings.ts";

export async function isStep2OfferPopupEnabled(): Promise<boolean> {
  try {
    const row = await prisma.globalSetting.findUnique({
      where: { key: STEP2_OFFER_POPUP_KEY },
      select: { value: true },
    });
    if (!row) return false;
    const value: unknown = row.value;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value === "true";
    if (value !== null && typeof value === "object") {
      return (value as { enabled?: unknown }).enabled === true;
    }
    return false;
  } catch {
    return false;
  }
}
