import { runEbilletJob, type SyncRunSummary } from "./sync.server";

/**
 * One durable unit of eBillet work is exactly one organizer.
 * `runEbilletJob({ kind: "sync" })` claims the run cursor with a
 * compare-and-set, syncs a single organizer through `syncOrganizer()` and
 * commits the cursor before returning — so a killed invocation can never lose
 * more than one organizer of progress, and two invocations can never work on
 * the same organizer.
 *
 * Callers keep invoking this until `done === true`.
 */
export async function runEbilletOrganizerBatch(): Promise<SyncRunSummary> {
  return runEbilletJob({ kind: "sync", trigger: "manual" });
}
