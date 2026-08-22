import { supabase } from "@/integrations/supabase/client";
import { windowEnd, windowStart } from "@/lib/date-window";

export type ChildScreeningSignal = {
  movieId: string;
  events: string[];
  languages: string[];
};

type ChildScreeningSignalRow = {
  movie_id: string;
  events: string[] | null;
  languages: string[] | null;
};

type ScreeningBounds = {
  startsAfter: string;
  firstDate: string;
  lastDate: string;
};

const SIGNAL_PAGE_SIZE = 1000;
const SIGNAL_MOVIE_ID_BATCH_SIZE = 80;
const SIGNAL_PARALLEL_ID_BATCHES = 4;
const SIGNAL_PARALLEL_PAGE_REQUESTS = 8;
const SIGNAL_CACHE_TTL_MS = 5 * 60 * 1000;
let signalCache: {
  key: string;
  expiresAt: number;
  promise: Promise<ChildScreeningSignal[]>;
} | null = null;

export function collapseChildrenScreeningSignals(
  rows: ChildScreeningSignalRow[],
): ChildScreeningSignal[] {
  const byMovie = new Map<string, { events: Set<string>; languages: Set<string> }>();
  for (const row of rows) {
    const signal = byMovie.get(row.movie_id) ?? {
      events: new Set<string>(),
      languages: new Set<string>(),
    };
    for (const event of row.events ?? []) signal.events.add(event);
    for (const language of row.languages ?? []) signal.languages.add(language);
    byMovie.set(row.movie_id, signal);
  }

  return [...byMovie].map(([movieId, signal]) => ({
    movieId,
    events: [...signal.events],
    languages: [...signal.languages],
  }));
}

async function loadSignalBatch(
  movieIds: string[],
  bounds: ScreeningBounds,
): Promise<ChildScreeningSignalRow[]> {
  const loadPage = async (from: number, to: number, withCount: boolean) => {
    const result = await supabase
      .from("screenings")
      .select("movie_id, events, languages", { count: withCount ? "exact" : undefined })
      .in("movie_id", movieIds)
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate)
      .order("movie_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return result as unknown as {
      data: ChildScreeningSignalRow[] | null;
      error: unknown;
      count?: number | null;
    };
  };

  const first = await loadPage(0, SIGNAL_PAGE_SIZE - 1, true);
  if (first.error) throw first.error;
  const firstPage = first.data ?? [];
  if (firstPage.length < SIGNAL_PAGE_SIZE) return firstPage;

  if (first.count === null || first.count === undefined) {
    const out = [...firstPage];
    for (let from = SIGNAL_PAGE_SIZE; ; from += SIGNAL_PAGE_SIZE) {
      const page = await loadPage(from, from + SIGNAL_PAGE_SIZE - 1, false);
      if (page.error) throw page.error;
      const rows = page.data ?? [];
      out.push(...rows);
      if (rows.length < SIGNAL_PAGE_SIZE) return out;
    }
  }

  const ranges: Array<[number, number]> = [];
  for (let from = SIGNAL_PAGE_SIZE; from < first.count; from += SIGNAL_PAGE_SIZE) {
    ranges.push([from, Math.min(from + SIGNAL_PAGE_SIZE - 1, first.count - 1)]);
  }

  const out = [...firstPage];
  for (let index = 0; index < ranges.length; index += SIGNAL_PARALLEL_PAGE_REQUESTS) {
    const responses = await Promise.all(
      ranges
        .slice(index, index + SIGNAL_PARALLEL_PAGE_REQUESTS)
        .map(([from, to]) => loadPage(from, to, false)),
    );
    for (const response of responses) {
      if (response.error) throw response.error;
      out.push(...(response.data ?? []));
    }
  }
  return out;
}

/**
 * `/for-boern` only needs screening-level programme/language evidence for films
 * that do not already match on movie metadata. Read those narrow signals by
 * source movie id instead of awaiting the national 30-day showtime index.
 */
export async function fetchChildrenScreeningSignals(
  movieIds: string[],
): Promise<ChildScreeningSignal[]> {
  const uniqueIds = [...new Set(movieIds.filter(Boolean))].sort();
  if (uniqueIds.length === 0) return [];

  const now = Date.now();
  const key = uniqueIds.join("|");
  if (signalCache && signalCache.key === key && signalCache.expiresAt > now) {
    return signalCache.promise;
  }

  const promise = (async () => {
    const bounds: ScreeningBounds = {
      startsAfter: new Date().toISOString(),
      firstDate: windowStart(),
      lastDate: windowEnd(),
    };
    const rows: ChildScreeningSignalRow[] = [];
    const batches: string[][] = [];
    for (let index = 0; index < uniqueIds.length; index += SIGNAL_MOVIE_ID_BATCH_SIZE) {
      batches.push(uniqueIds.slice(index, index + SIGNAL_MOVIE_ID_BATCH_SIZE));
    }
    for (let index = 0; index < batches.length; index += SIGNAL_PARALLEL_ID_BATCHES) {
      const loaded = await Promise.all(
        batches
          .slice(index, index + SIGNAL_PARALLEL_ID_BATCHES)
          .map((batch) => loadSignalBatch(batch, bounds)),
      );
      for (const batchRows of loaded) rows.push(...batchRows);
    }
    return collapseChildrenScreeningSignals(rows);
  })();

  signalCache = { key, expiresAt: now + SIGNAL_CACHE_TTL_MS, promise };
  try {
    return await promise;
  } catch (error) {
    if (signalCache?.promise === promise) signalCache = null;
    throw error;
  }
}
