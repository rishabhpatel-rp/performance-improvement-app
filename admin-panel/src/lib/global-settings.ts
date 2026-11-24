import { prisma } from "@/lib/prisma";
import { STEP2_OFFER_POPUP_KEY } from "../../../shared/global-settings.ts";

function parseEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  if (value !== null && typeof value === "object") {
    return (value as { enabled?: unknown }).enabled === true;
  }
  return false;
}

export async function getStep2OfferPopupEnabled(): Promise<boolean> {
  try {
    const row = await prisma.globalSetting.findUnique({
      where: { key: STEP2_OFFER_POPUP_KEY },
      select: { value: true },
    });
    return row ? parseEnabled(row.value) : false;
  } catch {
    return false;
  }
}

export async function setStep2OfferPopupEnabled(enabled: boolean, actorEmail: string) {
  await prisma.globalSetting.upsert({
    where: { key: STEP2_OFFER_POPUP_KEY },
    create: { key: STEP2_OFFER_POPUP_KEY, value: enabled, updatedBy: actorEmail },
    update: { value: enabled, updatedBy: actorEmail },
  });
}
