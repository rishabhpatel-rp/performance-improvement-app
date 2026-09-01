"use server";

import { PrismaClient } from "@prisma/client";

let prisma;

function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

function json(data, options = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
}

async function getAppTrackingById(id) {
  const prisma = getPrisma();
  try {
    const tracking = await prisma.appTracking.findUnique({
      where: { id: parseInt(id) },
    });
    if (!tracking) {
      return { success: false, error: "Tracking record not found" };
    }
    return { success: true, data: tracking };
  } catch (error) {
    console.error("Error fetching app tracking record:", error);
    return { success: false, error: error.message };
  }
}

async function getAppTrackingByDomain(domain) {
  const prisma = getPrisma();
  try {
    const tracking = await prisma.appTracking.findUnique({
      where: { domain },
    });
    if (!tracking) {
      return { success: false, error: "Tracking record not found" };
    }
    return { success: true, data: tracking };
  } catch (error) {
    console.error("Error fetching app tracking record by domain:", error);
    return { success: false, error: error.message };
  }
}

/**
 * GET: Fetch app tracking record by ID or domain
 *
 * Query parameters:
 * - id: Get record by ID
 * - domain: Get record by domain
 *
 * Examples:
 * GET /api/app-tracking/get?id=1
 * GET /api/app-tracking/get?domain=mystore.myshopify.com
 */
export async function loader({ request }) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const domain = url.searchParams.get("domain");

    if (id) {
      const result = await getAppTrackingById(id);
      return json(result, {
        status: result.success ? 200 : 404,
      });
    }

    if (domain) {
      const result = await getAppTrackingByDomain(domain);
      return json(result, {
        status: result.success ? 200 : 404,
      });
    }

    return json(
      { success: false, error: "Please provide either 'id' or 'domain' parameter" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error in app-tracking/get loader:", error);
    return json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
