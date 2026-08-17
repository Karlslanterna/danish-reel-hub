import { runNextEbilletOrganizer, type EbilletQueueResult } from "./runner.server";

/**
 * Admin compatibility wrapper. One click-loop iteration processes at most one
 * leased organizer from the canonical `import_runs` queue. `forceQueue` only
 * matters when the queue is empty, allowing an explicit admin action to start
 * a fresh cycle even inside the scheduler's normal freshness interval.
 */
export async function runEbilletOrganizerBatch(): Promise<EbilletQueueResult> {
  return runNextEbilletOrganizer({ forceQueue: true });
}
