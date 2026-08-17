/**
 * Snapshot validation for the Kultunaut feed.
 *
 * Stale reconciliation (deleting Kultunaut showtimes that are no longer in the
 * feed) is only safe when the parsed payload is a COMPLETE snapshot of the
 * source. `desired.length > 0` is not a validation: a truncated download, a
 * partially parsed XML or an error page can still yield a handful of rows.
 *
 * Therefore reconciliation requires an explicit verdict:
 *  - `complete`    — payload passed every plausibility check → removals allowed
 *  - `valid-empty` — the feed is explicitly declared empty by the caller →
 *                    removals allowed (this is the only way an empty snapshot
 *                    can ever delete data; it is never inferred)
 *  - `incomplete`  — anything suspicious → removals are skipped, upserts still
 *                    run so the import remains additive and non-destructive
 */

export type SnapshotVerdict = "complete" | "valid-empty" | "incomplete";

export type SnapshotInput = {
  /** Raw XML length in characters (0 when unavailable). */
  xmlLength: number;
  /** Distinct movies produced by the parser. */
  movies: number;
  /** Distinct cinemas produced by the parser. */
  cinemas: number;
  /** Raw showtime entries produced by the parser (before grouping). */
  showtimes: number;
  /** Grouped showtime rows that will be written. */
  grouped: number;
  /**
   * Explicit operator/caller assertion that an empty feed is legitimate.
   * Never inferred from the payload itself.
   */
  declaredEmpty?: boolean;
};

export type SnapshotValidation = {
  verdict: SnapshotVerdict;
  /** True only for `complete` and `valid-empty`. */
  reconcileRemovals: boolean;
  reasons: string[];
};

/** XML shorter than this cannot be a real Kultunaut feed. */
export const MIN_FEED_XML_LENGTH = 500;

export function validateKultunautSnapshot(input: SnapshotInput): SnapshotValidation {
  const reasons: string[] = [];

  if (input.declaredEmpty) {
    return {
      verdict: "valid-empty",
      reconcileRemovals: true,
      reasons: ["caller explicitly declared the feed empty"],
    };
  }

  if (!Number.isFinite(input.xmlLength) || input.xmlLength < MIN_FEED_XML_LENGTH) {
    reasons.push(`xml payload too small (${input.xmlLength} chars)`);
  }
  if (input.showtimes <= 0) reasons.push("feed contained no showtimes");
  if (input.movies <= 0) reasons.push("feed contained no movies");
  if (input.cinemas <= 0) reasons.push("feed contained no cinemas");
  if (input.grouped <= 0) reasons.push("no grouped showtime rows were produced");
  // A feed with showtimes but (almost) no venues/films is structurally broken.
  if (input.showtimes > 0 && input.cinemas > 0 && input.showtimes / input.cinemas < 1) {
    reasons.push("implausibly few showtimes per cinema");
  }

  if (reasons.length > 0) {
    return { verdict: "incomplete", reconcileRemovals: false, reasons };
  }
  return { verdict: "complete", reconcileRemovals: true, reasons: [] };
}
