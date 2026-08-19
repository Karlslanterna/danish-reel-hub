/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin.functions";
import { FILM_PROGRAMMES, programmeTagsForMovieTitle } from "@/lib/film-programmes";
import { isMovieForChildren } from "@/lib/children-filter";
import {
  isSupersededActiveRun,
  summarizeAdminSourceRuns,
  type AdminImportRun,
} from "@/lib/admin-run-status";

type Status = "healthy" | "warning" | "critical";

export type AdminOverview = {
  generatedAt: string;
  status: Status;
  attention: string[];
  counts: { movies: number; cinemas: number; screenings: number; cities: number };
  sources: Array<{
    source: string;
    label: string;
    status: Status;
    latestSuccessAt: string | null;
    latestState: string | null;
    queued: number;
    running: number;
    failedSinceSuccess: number;
  }>;
  recentRuns: Array<{
    id: string;
    source: string;
    scope: string;
    state: string;
    createdAt: string;
    finishedAt: string | null;
    error: string | null;
    stats: string;
    superseded: boolean;
  }>;
  quality: {
    missingPosters: number;
    missingSynopsis: number;
    missingTicketUrls: number;
    unresolvedEntities: number;
    staleRuns: number;
    duplicateScreenings: number;
    incorrectProgrammeTags: number;
    missingProgrammeTags: number;
    empireBabybio: number;
  };
  filters: {
    events: Array<{ value: string; screenings: number; movies: number; cinemas: number }>;
    formats: Array<{ value: string; screenings: number; movies: number; cinemas: number }>;
    languages: Array<{ value: string; screenings: number; movies: number; cinemas: number }>;
    examples: Array<{
      source: string;
      sourceRef: string;
      event: string;
      movie: string;
      cinema: string;
      date: string;
    }>;
    programmes: typeof FILM_PROGRAMMES;
  };
  analytics: {
    pageViewsToday: number;
    pageViews7Days: number;
    pageViews30Days: number;
    ticketClicks30Days: number;
    zeroResults30Days: number;
    filterUses30Days: number;
    topPaths: Array<{ label: string; value: number }>;
    topFilters: Array<{ label: string; value: number }>;
    topTickets: Array<{ label: string; value: number }>;
  };
  seo: {
    moviePages: number;
    cinemaPages: number;
    cityPages: number;
    childMovies: number;
    specialPages: Array<{ tag: string; results: number; indexable: boolean }>;
    missingDescriptions: number;
    missingPosters: number;
  };
  overrides: Array<{
    id: string;
    source: string;
    sourceRef: string;
    event: string;
    action: string;
    note: string;
    active: boolean;
    updatedAt: string;
  }>;
};

const PAGE_SIZE = 1000;

async function collectPages(load: (from: number, to: number) => Promise<any>) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await load(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

const countBy = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
};

const posterExists = (movie: any) => {
  if (movie.tmdb_poster_url) return true;
  const poster = movie.poster;
  return Boolean(
    poster &&
    typeof poster === "object" &&
    [poster.url, poster.a, poster.b, poster.c, poster.d].some(
      (value) => typeof value === "string" && value.trim(),
    ),
  );
};

const sourceLabel = (source: string) => (source === "ebillet" ? "eBillet" : "Kultunaut");

export const adminGetOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminOverview> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const now = new Date();
    const nowIso = now.toISOString();
    const start30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const start7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const startToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();

    const [screenings, movies, cinemas, runsResult, unresolvedResult, analytics, overridesResult] =
      await Promise.all([
        collectPages((from, to) =>
          db
            .from("screenings")
            .select(
              "source,source_ref,movie_id,cinema_id,starts_at,local_date,local_time,hall,ticket_url,formats,languages,events",
            )
            .gte("starts_at", nowIso)
            .order("starts_at", { ascending: true })
            .range(from, to),
        ),
        collectPages((from, to) =>
          db
            .from("movies")
            .select("id,title,slug,genre,rating,synopsis,poster,tmdb_poster_url")
            .range(from, to),
        ),
        collectPages((from, to) => db.from("cinemas").select("id,name,slug,city").range(from, to)),
        db
          .from("import_runs")
          .select(
            "id,source,scope_type,scope_key,state,created_at,updated_at,finished_at,last_error,stats",
          )
          .order("created_at", { ascending: false })
          .limit(200),
        db
          .from("unresolved_source_entities")
          .select("id", { count: "exact", head: true })
          .eq("resolved", false),
        collectPages((from, to) =>
          db
            .from("analytics_events")
            .select("event_type,path,item_id,filter_name,filter_value,is_active,created_at")
            .gte("created_at", start30)
            .order("created_at", { ascending: false })
            .range(from, to),
        ),
        db
          .from("screening_event_overrides")
          .select("id,source,source_ref,event,action,note,active,updated_at")
          .order("updated_at", { ascending: false })
          .limit(100),
      ]);

    if (runsResult.error) throw runsResult.error;
    if (unresolvedResult.error) throw unresolvedResult.error;
    const overrideRows =
      overridesResult.error?.code === "42P01" || overridesResult.error?.code === "PGRST205"
        ? []
        : overridesResult.error
          ? (() => {
              throw overridesResult.error;
            })()
          : (overridesResult.data ?? []);
    const runs = runsResult.data ?? [];
    const movieById = new Map(movies.map((movie) => [movie.id, movie]));
    const cinemaById = new Map(cinemas.map((cinema) => [cinema.id, cinema]));
    const activeMovieIds = new Set(screenings.map((screening) => screening.movie_id));
    const activeCinemaIds = new Set(screenings.map((screening) => screening.cinema_id));
    const activeMovies = movies.filter((movie) => activeMovieIds.has(movie.id));
    const activeCinemas = cinemas.filter((cinema) => activeCinemaIds.has(cinema.id));
    const cities = new Set(
      activeCinemas.map((cinema) =>
        String(cinema.city ?? "")
          .replace(/^\s*\d{3,4}\s+/u, "")
          .trim(),
      ),
    );

    const dimensions = (key: "events" | "formats" | "languages") => {
      const map = new Map<
        string,
        { screenings: number; movies: Set<string>; cinemas: Set<string> }
      >();
      for (const screening of screenings) {
        for (const value of screening[key] ?? []) {
          const item = map.get(value) ?? { screenings: 0, movies: new Set(), cinemas: new Set() };
          item.screenings += 1;
          item.movies.add(screening.movie_id);
          item.cinemas.add(screening.cinema_id);
          map.set(value, item);
        }
      }
      return [...map]
        .map(([value, item]) => ({
          value,
          screenings: item.screenings,
          movies: item.movies.size,
          cinemas: item.cinemas.size,
        }))
        .sort((a, b) => b.screenings - a.screenings);
    };
    const events = dimensions("events");
    const formats = dimensions("formats");
    const languages = dimensions("languages");

    let incorrectProgrammeTags = 0;
    let missingProgrammeTags = 0;
    const duplicateKeys = new Set<string>();
    let duplicateScreenings = 0;
    for (const screening of screenings) {
      const movie = movieById.get(screening.movie_id);
      const expected = new Set(programmeTagsForMovieTitle(movie?.title ?? ""));
      for (const tag of ["Filmporten", "Biografklub Danmark"] as const) {
        const actual = (screening.events ?? []).includes(tag);
        if (actual && !expected.has(tag)) incorrectProgrammeTags += 1;
        if (!actual && expected.has(tag)) missingProgrammeTags += 1;
      }
      const key = [
        screening.source,
        screening.cinema_id,
        screening.movie_id,
        screening.starts_at,
        screening.hall,
      ].join("|");
      if (duplicateKeys.has(key)) duplicateScreenings += 1;
      duplicateKeys.add(key);
    }

    const typedRuns = runs as AdminImportRun[];
    const sourceSummaries = ["kultunaut", "ebillet"].map((source) => ({
      ...summarizeAdminSourceRuns(typedRuns, source, now),
      label: sourceLabel(source),
    }));
    const latestSuccessBySource = new Map(
      sourceSummaries.map((summary) => [summary.source, summary.latestSuccessAt]),
    );
    const staleRuns = sourceSummaries.reduce(
      (total, summary) => total + summary.staleActiveRuns,
      0,
    );
    const empireIds = new Set(
      cinemas.filter((cinema) => /empire bio/i.test(cinema.name)).map((cinema) => cinema.id),
    );
    const empireBabybio = screenings.filter(
      (screening) =>
        empireIds.has(screening.cinema_id) && (screening.events ?? []).includes("Babybio"),
    ).length;

    const eventExamples = screenings
      .flatMap((screening) =>
        (screening.events ?? [])
          .filter((event: string) =>
            ["Babybio", "Seniorbio", "Filmporten", "Biografklub Danmark"].includes(event),
          )
          .map((event: string) => ({
            source: screening.source,
            sourceRef: screening.source_ref,
            event,
            movie: movieById.get(screening.movie_id)?.title ?? screening.movie_id,
            cinema: cinemaById.get(screening.cinema_id)?.name ?? screening.cinema_id,
            date: screening.local_date,
          })),
      )
      .slice(0, 80);

    const analytics30 = analytics;
    const pageViews = analytics30.filter((event) => event.event_type === "page_view");
    const pageViews7 = pageViews.filter((event) => event.created_at >= start7);
    const pageViewsToday = pageViews.filter((event) => event.created_at >= startToday);
    const filterUses = analytics30.filter(
      (event) => event.event_type === "filter_change" && event.is_active === true,
    );
    const ticketClicks = analytics30.filter((event) => event.event_type === "ticket_click");
    const zeroResults = analytics30.filter((event) => event.event_type === "zero_results");

    const childMovieIds = new Set(
      activeMovies
        .filter((movie) =>
          isMovieForChildren(
            movie,
            screenings
              .filter((screening) => screening.movie_id === movie.id)
              .map((screening) => ({
                events: screening.events ?? [],
                languages: screening.languages ?? [],
              })),
          ),
        )
        .map((movie) => movie.id),
    );
    const specialPages = ["Babybio", "Seniorbio", "Filmporten", "Biografklub Danmark"].map(
      (tag) => {
        const results = new Set(
          screenings
            .filter((screening) => (screening.events ?? []).includes(tag))
            .map((screening) => screening.movie_id),
        ).size;
        return { tag, results, indexable: results > 0 };
      },
    );

    const quality = {
      missingPosters: activeMovies.filter((movie) => !posterExists(movie)).length,
      missingSynopsis: activeMovies.filter((movie) => !String(movie.synopsis ?? "").trim()).length,
      missingTicketUrls: screenings.filter((screening) => !screening.ticket_url).length,
      unresolvedEntities: unresolvedResult.count ?? 0,
      staleRuns,
      duplicateScreenings,
      incorrectProgrammeTags,
      missingProgrammeTags,
      empireBabybio,
    };

    const attention: string[] = [];
    for (const source of sourceSummaries) {
      if (source.status !== "healthy")
        attention.push(`${source.label}: seneste datahentning kræver opmærksomhed.`);
    }
    if (staleRuns)
      attention.push(`${staleRuns} importkørsel${staleRuns === 1 ? "" : "er"} sidder fast.`);
    if (quality.unresolvedEntities)
      attention.push(`${quality.unresolvedEntities} kildereferencer mangler en sikker kobling.`);
    if (incorrectProgrammeTags || missingProgrammeTags)
      attention.push("Programfiltrene afviger fra de officielle filmlister.");
    if (empireIds.size > 0 && empireBabybio === 0)
      attention.push("Empire Bio har ingen kommende Babybio-markeringer i de aktuelle data.");
    if (screenings.length === 0) attention.push("Der er ingen kommende forestillinger.");

    const status: Status =
      screenings.length === 0 || sourceSummaries.some((source) => source.status === "critical")
        ? "critical"
        : attention.length > 0
          ? "warning"
          : "healthy";

    return {
      generatedAt: nowIso,
      status,
      attention,
      counts: {
        movies: activeMovieIds.size,
        cinemas: activeCinemaIds.size,
        screenings: screenings.length,
        cities: cities.size,
      },
      sources: sourceSummaries,
      recentRuns: runs.slice(0, 40).map((run: any) => ({
        id: run.id,
        source: run.source,
        scope: [run.scope_type, run.scope_key].filter(Boolean).join(": "),
        state: run.state,
        createdAt: run.created_at,
        finishedAt: run.finished_at,
        error: run.last_error,
        stats: JSON.stringify(run.stats ?? {}),
        superseded: isSupersededActiveRun(run, latestSuccessBySource.get(run.source) ?? null),
      })),
      quality,
      filters: {
        events,
        formats,
        languages,
        examples: eventExamples,
        programmes: FILM_PROGRAMMES,
      },
      analytics: {
        pageViewsToday: pageViewsToday.length,
        pageViews7Days: pageViews7.length,
        pageViews30Days: pageViews.length,
        ticketClicks30Days: ticketClicks.length,
        zeroResults30Days: zeroResults.length,
        filterUses30Days: filterUses.length,
        topPaths: countBy(pageViews.map((event) => event.path ?? "/")).slice(0, 12),
        topFilters: countBy(
          filterUses.map((event) => `${event.filter_name}: ${event.filter_value}`),
        ).slice(0, 12),
        topTickets: countBy(ticketClicks.map((event) => event.item_id ?? "Ukendt film")).slice(
          0,
          12,
        ),
      },
      seo: {
        moviePages: activeMovieIds.size,
        cinemaPages: activeCinemaIds.size,
        cityPages: cities.size,
        childMovies: childMovieIds.size,
        specialPages,
        missingDescriptions: quality.missingSynopsis,
        missingPosters: quality.missingPosters,
      },
      overrides: overrideRows.map((row: any) => ({
        id: row.id,
        source: row.source,
        sourceRef: row.source_ref,
        event: row.event,
        action: row.action,
        note: row.note,
        active: row.active,
        updatedAt: row.updated_at,
      })),
    };
  });

const overrideSchema = z.object({
  source: z.enum(["kultunaut", "ebillet"]),
  sourceRef: z.string().min(3).max(240),
  event: z.enum(["Babybio", "Seniorbio", "Filmporten", "Biografklub Danmark"]),
  action: z.enum(["add", "remove"]),
  note: z.string().min(3).max(500),
});

export const adminSetScreeningEventOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => overrideSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const userId = (context as { userId: string }).userId;
    const { data: screening, error: screeningError } = await db
      .from("screenings")
      .select("cinema_id")
      .eq("source", data.source)
      .eq("source_ref", data.sourceRef)
      .maybeSingle();
    if (screeningError || !screening) throw new Error("Forestillingen blev ikke fundet");
    const { error } = await db.from("screening_event_overrides").upsert(
      {
        source: data.source,
        source_ref: data.sourceRef,
        event: data.event,
        action: data.action,
        note: data.note,
        active: true,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source,source_ref,event" },
    );
    if (error) throw new Error(`Rettelsen kunne ikke gemmes: ${error.message}`);
    const { error: applyError } = await db.rpc("apply_screening_event_overrides", {
      p_source: data.source,
      p_cinema_id: screening.cinema_id,
    });
    if (applyError) throw new Error(`Rettelsen kunne ikke anvendes: ${applyError.message}`);
    return { ok: true };
  });
