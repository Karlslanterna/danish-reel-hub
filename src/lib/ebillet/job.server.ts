import { runNextEbilletOrganizer, type EbilletQueueResult } from "./runner.server";

/**
 * Admin compatibility wrapper. One click-loop iteration processes at most one
 * leased organizer from the canonical `import_runs` queue.
 */
export async function runEbilletOrganizerBatch(): Promise<EbilletQueueResult> {
  return runNextEbilletOrganizer();
}
