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

async function recordUninstallation(domain) {
  const prisma = getPrisma();
  try {
    const tracking = await prisma.appTracking.update({
      where: { domain },
      data: { uninstallation_time: new Date() },
    });
    return { success: true, data: tracking };
  } catch (error) {
    console.error("Error recording uninstallation:", error);
    return { success: false, error: error.message };
  }
}

/**
 * POST: Record app uninstallation for a store
 *
 * Body:
 * {
 *   "domain": "mystore.myshopify.com"
 * }
 */
export async function action({ request }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const data = await request.json();

    if (!data.domain) {
      return json(
        { success: false, error: "domain is required" },
        { status: 400 }
      );
    }

    const result = await recordUninstallation(data.domain);
    return json(result, {
      status: result.success ? 200 : 404,
    });
  } catch (error) {
    console.error("Error in app-tracking/uninstall action:", error);
    return json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
