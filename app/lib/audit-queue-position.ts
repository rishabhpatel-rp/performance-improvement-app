/** Pure queue ordering (no DB). */

export function isJobAheadInQueue(
  candidate: { priority: number; createdAtMs: number },
  job: { priority: number; createdAtMs: number },
): boolean {
  if (candidate.priority !== job.priority) {
    return candidate.priority > job.priority;
  }
  return candidate.createdAtMs < job.createdAtMs;
}
