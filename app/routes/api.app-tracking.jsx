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

async function createAppTracking(data) {
  const prisma = getPrisma();
  try {
    const tracking = await prisma.appTracking.create({
      data: {
        store_name: data.store_name,
        email: data.email,
        domain: data.domain,
        location: data.location || null,
        timezone: data.timezone || null,
        installation_time: data.installation_time || new Date(),
        uninstallation_time: data.uninstallation_time || null,
      },
    });
    return { success: true, data: tracking };
  } catch (error) {
    console.error("Error creating app tracking:", error);
    return { success: false, error: error.message };
  }
}

async function getAllAppTracking(filter = {}) {
  const prisma = getPrisma();
  try {
    const where = {};

    if (filter.store_name) where.store_name = { contains: filter.store_name };
    if (filter.email) where.email = { contains: filter.email };
    if (filter.domain) where.domain = filter.domain;
    if (filter.location) where.location = filter.location;
    if (filter.timezone) where.timezone = filter.timezone;

    const trackings = await prisma.appTracking.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data: trackings };
  } catch (error) {
    console.error("Error fetching app tracking records:", error);
    return { success: false, error: error.message };
  }
}

async function updateAppTracking(id, data) {
  const prisma = getPrisma();
  try {
    const updateData = {};

    if (data.store_name !== undefined) updateData.store_name = data.store_name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.timezone !== undefined) updateData.timezone = data.timezone;
    if (data.uninstallation_time !== undefined) updateData.uninstallation_time = data.uninstallation_time;

    const tracking = await prisma.appTracking.update({
      where: { id: parseInt(id) },
      data: updateData,
    });
    return { success: true, data: tracking };
  } catch (error) {
    console.error("Error updating app tracking record:", error);
    return { success: false, error: error.message };
  }
}

async function deleteAppTracking(id) {
  const prisma = getPrisma();
  try {
    await prisma.appTracking.delete({
      where: { id: parseInt(id) },
    });
    return { success: true, message: "Tracking record deleted successfully" };
  } catch (error) {
    console.error("Error deleting app tracking record:", error);
    return { success: false, error: error.message };
  }
}

/**
 * GET: Fetch all app tracking records or filter by query parameters
 * POST: Create a new app tracking record
 *
 * Query parameters for GET:
 * - store_name: Filter by store name (partial match)
 * - email: Filter by email (partial match)
 * - domain: Filter by domain (exact match)
 * - location: Filter by location
 * - timezone: Filter by timezone
 *
 * Body for POST:
 * {
 *   "store_name": "My Store",
 *   "email": "owner@example.com",
 *   "domain": "mystore.myshopify.com",
 *   "location": "United States",
 *   "timezone": "EST"
 * }
 */
export async function loader({ request }) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Parse query parameters for filtering
    const url = new URL(request.url);
    const filter = {
      store_name: url.searchParams.get("store_name"),
      email: url.searchParams.get("email"),
      domain: url.searchParams.get("domain"),
      location: url.searchParams.get("location"),
      timezone: url.searchParams.get("timezone"),
    };

    // Remove null values from filter
    Object.keys(filter).forEach((key) => filter[key] === null && delete filter[key]);

    const result = await getAllAppTracking(filter);
    return json(result);
  } catch (error) {
    console.error("Error in app-tracking loader:", error);
    return json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function action({ request }) {
  const method = request.method;

  try {
    // POST: Create new tracking record
    if (method === "POST") {
      const data = await request.json();

      // Validate required fields
      if (!data.store_name || !data.email || !data.domain) {
        return json(
          {
            success: false,
            error: "store_name, email, and domain are required",
          },
          { status: 400 }
        );
      }

      const result = await createAppTracking(data);
      return json(result, {
        status: result.success ? 201 : 400,
      });
    }

    // PUT: Update tracking record
    if (method === "PUT") {
      const data = await request.json();

      if (!data.id) {
        return json(
          { success: false, error: "ID is required for update" },
          { status: 400 }
        );
      }

      const result = await updateAppTracking(data.id, data);
      return json(result, {
        status: result.success ? 200 : 400,
      });
    }

    // DELETE: Delete tracking record
    if (method === "DELETE") {
      const data = await request.json();

      if (!data.id) {
        return json(
          { success: false, error: "ID is required for deletion" },
          { status: 400 }
        );
      }

      const result = await deleteAppTracking(data.id);
      return json(result, {
        status: result.success ? 200 : 400,
      });
    }

    return json({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("Error in app-tracking action:", error);
    return json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
