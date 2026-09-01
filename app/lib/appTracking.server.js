"use server";

import { PrismaClient } from "@prisma/client";

let prisma;

// Singleton pattern to ensure only one Prisma Client instance
function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

/**
 * Create a new app tracking record
 * @param {Object} data - The tracking data
 * @returns {Promise<Object>} The created tracking record
 */
export async function createAppTracking(data) {
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

/**
 * Get all app tracking records with optional filtering
 * @param {Object} filter - Optional filter parameters
 * @returns {Promise<Object>} List of tracking records
 */
export async function getAllAppTracking(filter = {}) {
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

/**
 * Get a single app tracking record by ID
 * @param {number} id - The tracking record ID
 * @returns {Promise<Object>} The tracking record
 */
export async function getAppTrackingById(id) {
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

/**
 * Get app tracking record by domain
 * @param {string} domain - The store domain
 * @returns {Promise<Object>} The tracking record
 */
export async function getAppTrackingByDomain(domain) {
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
 * Update an app tracking record
 * @param {number} id - The tracking record ID
 * @param {Object} data - The data to update
 * @returns {Promise<Object>} The updated tracking record
 */
export async function updateAppTracking(id, data) {
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

/**
 * Delete an app tracking record
 * @param {number} id - The tracking record ID
 * @returns {Promise<Object>} Confirmation message
 */
export async function deleteAppTracking(id) {
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
 * Record app uninstallation
 * @param {string} domain - The store domain
 * @returns {Promise<Object>} The updated tracking record
 */
export async function recordUninstallation(domain) {
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

export { getPrisma };
