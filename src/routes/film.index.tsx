import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Poster } from "@/components/Poster";
import { fetchCinemas, type Movie, type Cinema } from "@/lib/cinema-data";
import { fetchPhysicallyRankedMovies } from "@/lib/physical-movie-ranking";
import { CANONICAL_HOST, canonicalUrl } from "@/lib/canonical";
import { indexTitle, indexDescription } from "@/lib/seo";

export const FILM_INDEX_PAGE_SIZE = 30;
const FILM_INDEX_IMMEDIATE_POSTERS = 2;
const FILM_INDEX_POSTER_ROOT_MARGIN = "400px 0px";
const FILM_INDEX_POSTER_SIZES = "(min-width: 1024px) 220px, 45vw";

export function paginateFilmIndex<T>(items: T[], requestedPage: number, pageSize = FILM_INDEX_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return {
    page,
    totalPages,
    totalItems: items.length,
    items: items.slice(start, start + pageSize),
  };
}

type FilmIndexSearch = { side?: number };

const normalizePage = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const page = Math.floor(parsed);
  return page > 1 ? page : undefined;
};

const filmIndexUrl = (page: number) =>
  page > 1 ? `${CANONICAL_HOST}/film?side=${page}` : canonicalUrl("/film");

export const Route = createFileRoute("/film/")({
  validateSearch: (search: Record<string, unknown>): FilmIndexSearch => ({
    side: normalizePage(search.side),
  }),
  loaderDeps: ({ search }) => ({ page: search.side ?? 1 }),
  loader: async ({ deps: { page } }) => {
    const [allMovies, cinemas] = await Promise.all([fetchPhysicallyRankedMovies(), fetchCinemas()]);
    const paginated = paginateFilmIndex(allMovies, page);
    if (page > paginated.totalPages) {
      throw redirect({
        to: "/film",
        search: paginated.totalPages > 1 ? { side: paginated.totalPages } : {},
        replace: true,
      });
    }
    return { ...paginated, cinemas };
  },
  head: ({ loaderData }) => {
    const page = loaderData?.page ?? 1;
    const href = filmIndexUrl(page);
    const baseTitle = indexTitle("film");
    const title = page > 1 ? `${baseTitle.replace(/\s*\|\s*Lanterna$/u, "")} – side ${page} | Lanterna` : baseTitle;
    const baseDescription = indexDescription("film");
    const description = page > 1 ? `${baseDescription} Side ${page}.` : baseDescription;
    const links: Array<{ rel: string; href: string }> = [{ rel: "canonical", href }];
    if (loaderData && page > 1) links.push({ rel: "prev", href: filmIndexUrl(page - 1) });
    if (loaderData && page < loaderData.totalPages) links.push({ rel: "next", href: filmIndexUrl(page + 1) });
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: href },
        { property: "og:type", content: "website" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links,
    };
  },
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">Prøv igen</button>
    </div>
  ),
  component: FilmIndexPage,
});

function pageSearch(page: number): FilmIndexSearch {
  return page > 1 ? { side: page } : {};
}

function FilmIndexPage() {
  const { items: movies, cinemas, page, totalPages, totalItems } = Route.useLoaderData() as {
    items: Movie[];
    cinemas: Cinema[];
    page: number;
    totalPages: number;
    totalItems: number;
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <section className="mx-auto max-w-[1400px] px-6 py-10 sm:px-8 sm:py-14">
        <Breadcrumb items={[{ label: "Forside", to: "/" }, { label: "Film" }]} />
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Alle film i biografen
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          {totalItems} film på plakaten i danske biografer. Vælg en film for at se spilletider og
          købe billetter.{page > 1 ? ` Side ${page} af ${totalPages}.` : ""}
        </p>

        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
          {movies.map((m, index) => (
            <Link key={m.id} to="/film/$slug" params={{ slug: m.slug }} className="group block">
              <FilmIndexPoster movie={m} index={index} />
              <div className="mt-2 line-clamp-2 text-sm text-foreground group-hover:text-primary">
                {m.title}
              </div>
            </Link>
          ))}
        </div>

        {totalPages > 1 && (
          <nav aria-label="Sider med film" className="mt-12 flex flex-wrap items-center justify-center gap-2">
            {page > 1 && (
              <Link
                to="/film"
                search={pageSearch(page - 1)}
                className="rounded-full border border-border px-4 py-2 text-sm text-foreground hover:border-primary hover:text-primary"
                rel="prev"
              >
                ← Forrige
              </Link>
            )}
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => (
              <Link
                key={number}
                to="/film"
                search={pageSearch(number)}
                aria-current={number === page ? "page" : undefined}
                className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full border px-3 text-sm ${
                  number === page
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {number}
              </Link>
            ))}
            {page < totalPages && (
              <Link
                to="/film"
                search={pageSearch(page + 1)}
                className="rounded-full border border-border px-4 py-2 text-sm text-foreground hover:border-primary hover:text-primary"
                rel="next"
              >
                Næste →
              </Link>
            )}
          </nav>
        )}
      </section>
      <SiteFooter cinemas={cinemas} />
    </div>
  );
}

function FilmIndexPoster({ movie, index }: { movie: Movie; index: number }) {
  if (index < FILM_INDEX_IMMEDIATE_POSTERS) {
    return (
      <Poster
        movie={movie}
        showTitle={false}
        sizes={FILM_INDEX_POSTER_SIZES}
        priority
        listing
      />
    );
  }

  return <DeferredFilmIndexPoster movie={movie} />;
}

function DeferredFilmIndexPoster({ movie }: { movie: Movie }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: FILM_INDEX_POSTER_ROOT_MARGIN },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-card"
    >
      {shouldLoad ? (
        <Poster movie={movie} showTitle={false} sizes={FILM_INDEX_POSTER_SIZES} listing />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 border border-border/40 bg-card"
        />
      )}
    </div>
  );
}
