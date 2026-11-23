import fs from "node:fs";
import os from "node:os";

function readCgroupUseRatio(): number | null {
  try {
    const current = Number(fs.readFileSync("/sys/fs/cgroup/memory.current", "utf8").trim());
    const maxRaw = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();
    if (maxRaw === "max") return null;
    const max = Number(maxRaw);
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) {
      return null;
    }
    return current / max;
  } catch {
    return null;
  }
}

/** Prefer MemAvailable so Linux page cache is not treated as pressure. */
function readMemAvailableUseRatio(): number | null {
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
    const availMatch = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    const totalMatch = meminfo.match(/^MemTotal:\s+(\d+)\s+kB/m);
    if (!availMatch || !totalMatch) return null;
    const available = Number(availMatch[1]) * 1024;
    const total = Number(totalMatch[1]) * 1024;
    if (!Number.isFinite(available) || !Number.isFinite(total) || total <= 0) {
      return null;
    }
    return Math.min(1, Math.max(0, (total - available) / total));
  } catch {
    return null;
  }
}

/** Host or cgroup memory use in [0, 1]. */
export function hostMemoryUseRatio(): number {
  const cgroup = readCgroupUseRatio();
  if (cgroup != null) return Math.min(1, Math.max(0, cgroup));
  const fromAvail = readMemAvailableUseRatio();
  if (fromAvail != null) return fromAvail;
  const total = os.totalmem();
  if (total <= 0) return 0;
  // Last resort: freemem under-counts reclaimable cache on Linux.
  return Math.min(1, Math.max(0, (total - os.freemem()) / total));
}

export function memoryAboveWatermark(watermark: number | null): boolean {
  if (watermark == null) return false;
  return hostMemoryUseRatio() >= watermark;
}
