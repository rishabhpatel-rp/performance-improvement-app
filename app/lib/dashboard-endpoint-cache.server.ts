/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
export function resolveStoreIdForCache(storeBeforeUpsert: any, storeAfterUpsert: any) {
  return storeAfterUpsert?.id ?? storeBeforeUpsert?.id ?? null;
}

export function cachedAppEndpointValue(shopifyConfig: any, endpoint: any) {
  return shopifyConfig?.appEndpoint || endpoint || null;
}

export async function cacheAppEndpoint(db: any, storeId: any, cachedEndpoint: any, logger: any) {
  if (!storeId) return false;
  try {
    await db.storeConfig.upsert({
      where: { storeId },
      create: {
        storeId,
        appEnabled: false,
        script1Enabled: false,
        script2Enabled: false,
        script3Enabled: false,
        debugMode: false,
        scriptTitles: [],
        cachedAppEndpoint: cachedEndpoint,
      },
      update: { cachedAppEndpoint: cachedEndpoint },
    });
    return true;
  } catch (err) {
    logger.error("[Dashboard] Failed to cache app endpoint:", err);
    return false;
  }
}
