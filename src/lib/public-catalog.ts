import type { Movie, Showtime, ShowtimeIndexRow } from "@/lib/cinema-data";
import { publicMovieIdentityTitle } from "@/lib/public-movie";
import { sortShowtimes } from "@/lib/showtime-sort";

const compactIdentityTitle = (title: string): string =>
  publicMovieIdentityTitle(title).replace(/\s+/g, "");

const knownYear = (year: number): number | null =>
  Number.isFinite(year) && year >= 1888 && year <= 2100 ? year : null;

const metadataScore = (movie: Movie): number =>
  (movie.tmdbId ? 1_000 : 0) +
  (movie.poster.url ? 120 : 0) +
  (movie.backdropUrl ? 80 : 0) +
  (movie.synopsis.trim() ? 60 : 0) +
  (movie.runtime > 0 ? 25 : 0) +
  (knownYear(movie.year) ? 25 : 0) +
  (movie.genre.length > 0 ? 20 : 0) +
  (movie.director.trim() ? 15 : 0) +
  (movie.trailerUrl ? 10 : 0) +
  ((movie.cast?.length ?? 0) > 0 ? 10 : 0);

const synopsisIdentity = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/[^a-z0-9æøå]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Strong enough to assign an unknown-year source row to one of several remakes. */
const hasMatchingSynopsis = (left: Movie, right: Movie): boolean => {
  const a = synopsisIdentity(left.synopsis);
  const b = synopsisIdentity(right.synopsis);
  if (Math.min(a.length, b.length) < 48) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const aTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length > 2));
  if (Math.min(aTokens.size, bTokens.size) < 8) return false;
  let shared = 0;
  for (const token of aTokens) if (bTokens.has(token)) shared += 1;
  return shared / Math.min(aTokens.size, bTokens.size) >= 0.78;
};

export type ConsolidatedMovie = Movie & {
  sourceIds: string[];
  sourceSlugs: string[];
};

export type ConsolidatedCatalog = {
  movies: ConsolidatedMovie[];
  movieIdMap: Map<string, string>;
};

/**
 * Collapse only near-certain duplicate film records: a shared TMDb id, or the
 * same normalized title with non-conflicting release years. Widely separated
 * remakes with the same title remain separate.
 */
export function consolidatePublicMovies(movies: Movie[]): ConsolidatedCatalog {
  const parent = movies.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]!]!;
      current = parent[current]!;
    }
    return current;
  };
  const join = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };

  const byTmdb = new Map<number, number>();
  const byTitle = new Map<string, number[]>();
  const byCompactTitle = new Map<string, number[]>();
  const byOriginalTitle = new Map<string, number[]>();
  const addToBucket = (bucket: Map<string, number[]>, key: string, index: number) => {
    if (!key) return;
    const matching = bucket.get(key) ?? [];
    matching.push(index);
    bucket.set(key, matching);
  };
  movies.forEach((movie, index) => {
    if (movie.tmdbId) {
      const previous = byTmdb.get(movie.tmdbId);
      if (previous !== undefined) join(previous, index);
      else byTmdb.set(movie.tmdbId, index);
    }
    addToBucket(byTitle, publicMovieIdentityTitle(movie.title), index);
    addToBucket(byCompactTitle, compactIdentityTitle(movie.title), index);
    addToBucket(byOriginalTitle, publicMovieIdentityTitle(movie.originalTitle ?? ""), index);
  });

  const joinCompatibleYears = (indexes: number[]) => {
    if (indexes.length < 2) return;
    const known = indexes
      .map((index) => ({ index, year: knownYear(movies[index]!.year) }))
      .filter((item): item is { index: number; year: number } => item.year !== null)
      .sort((a, b) => a.year - b.year);
    const unknown = indexes.filter((index) => knownYear(movies[index]!.year) === null);
    const yearClusters: Array<Array<{ index: number; year: number }>> = [];
    for (const item of known) {
      const cluster = yearClusters.at(-1);
      if (!cluster || item.year - cluster[0]!.year > 1) yearClusters.push([item]);
      else cluster.push(item);
    }
    for (const cluster of yearClusters) {
      for (const item of cluster.slice(1)) join(cluster[0]!.index, item.index);
    }

    if (yearClusters.length === 0) {
      for (const index of unknown.slice(1)) join(unknown[0]!, index);
      return;
    }

    if (yearClusters.length === 1) {
      for (const index of unknown) join(index, yearClusters[0]![0]!.index);
      return;
    }

    // Multiple active remakes make an unknown year ambiguous. Attach it only
    // when its real synopsis uniquely identifies one release; otherwise retain
    // a separate card instead of silently joining the wrong film.
    for (const index of unknown) {
      const matchingClusters = yearClusters.filter((cluster) =>
        cluster.some((item) => hasMatchingSynopsis(movies[index]!, movies[item.index]!)),
      );
      if (matchingClusters.length === 1) join(index, matchingClusters[0]![0]!.index);
    }
  };

  for (const bucket of [byTitle, byOriginalTitle, byCompactTitle]) {
    for (const indexes of bucket.values()) joinCompatibleYears(indexes);
  }

  const groups = new Map<number, number[]>();
  movies.forEach((_, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(index);
    groups.set(root, group);
  });

  const movieIdMap = new Map<string, string>();
  const consolidated = [...groups.values()]
    .sort((a, b) => a[0]! - b[0]!)
    .map((indexes): ConsolidatedMovie => {
      const members = indexes.map((index) => movies[index]!);
      const best = [...members].sort((a, b) => metadataScore(b) - metadataScore(a))[0]!;
      const sourceIds = [
        ...new Set([best.id, ...members.flatMap((movie) => movie.sourceIds ?? [movie.id])]),
      ];
      const sourceSlugs = [
        ...new Set([best.slug, ...members.flatMap((movie) => movie.sourceSlugs ?? [movie.slug])]),
      ];
      const genres = [...new Set(members.flatMap((movie) => movie.genre))];
      const screeningCount = members.reduce(
        (total, movie) => total + (movie.screeningCount ?? 0),
        0,
      );
      const nextScreeningDate =
        members
          .map((movie) => movie.nextScreeningDate)
          .filter((date): date is string => Boolean(date))
          .sort()[0] ?? null;

      const fallback = <T>(value: T | null | undefined, values: T[]): T | null | undefined =>
        value || values.find(Boolean);
      const movie: ConsolidatedMovie = {
        ...best,
        runtime:
          best.runtime > 0
            ? best.runtime
            : (members.find((item) => item.runtime > 0)?.runtime ?? 0),
        year: knownYear(best.year)
          ? best.year
          : (members.find((item) => knownYear(item.year))?.year ?? 0),
        genre: genres,
        director:
          best.director.trim() || members.find((item) => item.director.trim())?.director || "",
        rating: best.rating.trim() || members.find((item) => item.rating.trim())?.rating || "",
        synopsis:
          best.synopsis.trim() || members.find((item) => item.synopsis.trim())?.synopsis || "",
        poster: best.poster.url
          ? best.poster
          : (members.find((item) => item.poster.url)?.poster ?? best.poster),
        backdropUrl:
          fallback(
            best.backdropUrl,
            members.map((item) => item.backdropUrl ?? null),
          ) ?? null,
        trailerUrl:
          fallback(
            best.trailerUrl,
            members.map((item) => item.trailerUrl ?? null),
          ) ?? null,
        cast:
          (best.cast?.length ?? 0) > 0
            ? best.cast
            : members.find((item) => item.cast?.length)?.cast,
        voteAverage:
          best.voteAverage ?? members.find((item) => item.voteAverage)?.voteAverage ?? null,
        screeningCount,
        nextScreeningDate,
        sourceIds,
        sourceSlugs,
      };
      for (const id of sourceIds) movieIdMap.set(id, movie.id);
      return movie;
    });

  return { movies: consolidated, movieIdMap };
}

const movieMapFrom = (movies: Array<Movie & { sourceIds?: string[] }>): Map<string, string> => {
  const map = new Map<string, string>();
  for (const movie of movies) {
    for (const id of movie.sourceIds ?? [movie.id]) map.set(id, movie.id);
  }
  return map;
};

const addUnique = (target: string[], values: string[]) => {
  for (const value of values) if (value && !target.includes(value)) target.push(value);
};

/** Remap and re-group full showtimes after duplicate movie records are collapsed. */
export function remapShowtimesToMovies(showtimes: Showtime[], movies: Movie[]): Showtime[] {
  const movieMap = movieMapFrom(movies);
  type Group = Omit<Showtime, "times" | "ticketUrls"> & {
    slots: Map<string, string | null>;
    times: string[];
    ticketUrls: string[];
  };
  const groups = new Map<string, Group>();

  for (const showtime of showtimes) {
    const movieId = movieMap.get(showtime.movieId);
    if (!movieId) continue;
    const key = `${movieId}|${showtime.cinemaId}|${showtime.date}|${showtime.hall}`;
    const group = groups.get(key) ?? {
      ...showtime,
      movieId,
      times: [],
      ticketUrls: [],
      slots: new Map<string, string | null>(),
    };
    showtime.times.forEach((time, index) => {
      const incoming = showtime.ticketUrls[index] || showtime.bookingUrl || null;
      const current = group.slots.get(time);
      if (!group.slots.has(time) || (!current && incoming)) group.slots.set(time, incoming);
    });
    addUnique(group.formats, showtime.formats);
    addUnique(group.languages, showtime.languages);
    addUnique(group.events, showtime.events);
    groups.set(key, group);
  }

  const result = [...groups.values()].map(({ slots, ...group }): Showtime => {
    const ordered = [...slots].sort(([a], [b]) => a.localeCompare(b));
    const urls = ordered.map(([, url]) => url ?? "");
    return {
      ...group,
      times: ordered.map(([time]) => time),
      ticketUrls: urls,
      bookingUrl: ordered.find(([, url]) => url)?.[1] ?? null,
    };
  });
  return sortShowtimes(result);
}

/** Remap the lightweight homepage index and union its screening tags. */
export function remapShowtimeIndexToMovies(
  rows: ShowtimeIndexRow[],
  movies: Movie[],
): ShowtimeIndexRow[] {
  const movieMap = movieMapFrom(movies);
  const groups = new Map<string, ShowtimeIndexRow>();
  for (const row of rows) {
    const movieId = movieMap.get(row.movieId);
    if (!movieId) continue;
    const key = `${movieId}|${row.cinemaId}|${row.date}`;
    const group = groups.get(key) ?? { ...row, movieId, formats: [], languages: [], events: [] };
    addUnique(group.formats, row.formats);
    addUnique(group.languages, row.languages);
    addUnique(group.events, row.events);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.movieId.localeCompare(b.movieId) ||
      a.cinemaId.localeCompare(b.cinemaId),
  );
}

export type CompactShowtimeIndex = {
  movieIds: string[];
  cinemaIds: string[];
  dates: string[];
  formats: string[];
  languages: string[];
  events: string[];
  rows: Array<[number, number, number, number[], number[], number[]]>;
};

const dictionary = (values: string[]): { values: string[]; index: Map<string, number> } => {
  const unique = [...new Set(values)];
  return { values: unique, index: new Map(unique.map((value, index) => [value, index])) };
};

/** Compact the large national filter index before TanStack serializes it into HTML. */
export function compactShowtimeIndex(rows: ShowtimeIndexRow[]): CompactShowtimeIndex {
  const movieIds = dictionary(rows.map((row) => row.movieId));
  const cinemaIds = dictionary(rows.map((row) => row.cinemaId));
  const dates = dictionary(rows.map((row) => row.date));
  const formats = dictionary(rows.flatMap((row) => row.formats));
  const languages = dictionary(rows.flatMap((row) => row.languages));
  const events = dictionary(rows.flatMap((row) => row.events));
  return {
    movieIds: movieIds.values,
    cinemaIds: cinemaIds.values,
    dates: dates.values,
    formats: formats.values,
    languages: languages.values,
    events: events.values,
    rows: rows.map((row) => [
      movieIds.index.get(row.movieId)!,
      cinemaIds.index.get(row.cinemaId)!,
      dates.index.get(row.date)!,
      row.formats.map((value) => formats.index.get(value)!),
      row.languages.map((value) => languages.index.get(value)!),
      row.events.map((value) => events.index.get(value)!),
    ]),
  };
}

export function expandShowtimeIndex(compact: CompactShowtimeIndex): ShowtimeIndexRow[] {
  return compact.rows.map(([movie, cinema, date, formats, languages, events]) => ({
    movieId: compact.movieIds[movie]!,
    cinemaId: compact.cinemaIds[cinema]!,
    date: compact.dates[date]!,
    formats: formats.map((index) => compact.formats[index]!),
    languages: languages.map((index) => compact.languages[index]!),
    events: events.map((index) => compact.events[index]!),
  }));
}

export type CompactShowtimes = {
  movieIds: string[];
  cinemaIds: string[];
  dates: string[];
  times: string[];
  halls: string[];
  urls: string[];
  formats: string[];
  languages: string[];
  events: string[];
  rows: Array<
    [number, number, number, number[], number, number, number[], number[], number[], number[]]
  >;
};

/**
 * Compact film-page showtimes before they are embedded in server-rendered
 * HTML. Popular releases can have thousands of physical screenings, and the
 * repeated object keys and venue/date strings otherwise dominate the payload.
 */
export function compactShowtimes(rows: Showtime[]): CompactShowtimes {
  const movieIds = dictionary(rows.map((row) => row.movieId));
  const cinemaIds = dictionary(rows.map((row) => row.cinemaId));
  const dates = dictionary(rows.map((row) => row.date));
  const times = dictionary(rows.flatMap((row) => row.times));
  const halls = dictionary(rows.map((row) => row.hall));
  const urls = dictionary(
    rows.flatMap((row) => [row.bookingUrl ?? "", ...row.ticketUrls]).filter(Boolean),
  );
  const formats = dictionary(rows.flatMap((row) => row.formats));
  const languages = dictionary(rows.flatMap((row) => row.languages));
  const events = dictionary(rows.flatMap((row) => row.events));
  const indexes = (values: string[], index: Map<string, number>, empty = -1) =>
    values.map((value) => (value ? (index.get(value) ?? empty) : empty));

  return {
    movieIds: movieIds.values,
    cinemaIds: cinemaIds.values,
    dates: dates.values,
    times: times.values,
    halls: halls.values,
    urls: urls.values,
    formats: formats.values,
    languages: languages.values,
    events: events.values,
    rows: rows.map((row) => [
      movieIds.index.get(row.movieId)!,
      cinemaIds.index.get(row.cinemaId)!,
      dates.index.get(row.date)!,
      indexes(row.times, times.index),
      halls.index.get(row.hall)!,
      row.bookingUrl ? (urls.index.get(row.bookingUrl) ?? -1) : -1,
      indexes(row.ticketUrls, urls.index),
      indexes(row.formats, formats.index),
      indexes(row.languages, languages.index),
      indexes(row.events, events.index),
    ]),
  };
}

export function expandShowtimes(compact: CompactShowtimes): Showtime[] {
  return compact.rows.map(
    ([movie, cinema, date, times, hall, bookingUrl, ticketUrls, formats, languages, events]) => ({
      movieId: compact.movieIds[movie]!,
      cinemaId: compact.cinemaIds[cinema]!,
      date: compact.dates[date]!,
      times: times.map((index) => compact.times[index]!),
      hall: compact.halls[hall]!,
      bookingUrl: bookingUrl >= 0 ? compact.urls[bookingUrl]! : null,
      ticketUrls: ticketUrls.map((index) => (index >= 0 ? compact.urls[index]! : "")),
      formats: formats.map((index) => compact.formats[index]!),
      languages: languages.map((index) => compact.languages[index]!),
      events: events.map((index) => compact.events[index]!),
    }),
  );
}
