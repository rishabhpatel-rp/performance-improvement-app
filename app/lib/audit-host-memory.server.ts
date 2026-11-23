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

/** Host or cgroup memory use in [0, 1]. */
export function hostMemoryUseRatio(): number {
  const cgroup = readCgroupUseRatio();
  if (cgroup != null) return Math.min(1, Math.max(0, cgroup));
  const total = os.totalmem();
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (total - os.freemem()) / total));
}

export function memoryAboveWatermark(watermark: number | null): boolean {
  if (watermark == null) return false;
  return hostMemoryUseRatio() >= watermark;
}
