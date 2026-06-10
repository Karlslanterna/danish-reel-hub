import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { MovieCard } from "@/components/MovieCard";
import { movies, cinemas } from "@/lib/cinema-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Biograf DK — Find film og spilletider i Danmark" },
      { name: "description", content: "Opdag film, se spilletider og find din nærmeste biograf i København, Aarhus, Odense og Aalborg." },
    ],
  }),
  component: HomePage,
});

const allGenres = Array.from(new Set(movies.flatMap((m) => m.genre))).sort();

function HomePage() {
  const [query, setQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return movies.filter((m) => {
      const matchesQuery =
        !q ||
        m.title.toLowerCase().includes(q) ||
        m.director.toLowerCase().includes(q) ||
        m.genre.some((g) => g.toLowerCase().includes(q));
      const matchesGenre = !activeGenre || m.genre.includes(activeGenre);
      return matchesQuery && matchesGenre;
    });
  }, [query, activeGenre]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Hero / search */}
      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-8 pb-14 pt-20">
          <div className="flex items-end justify-between gap-12">
            <div className="max-w-2xl">
              <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                Onsdag · 10. juni
              </div>
              <h1 className="mt-4 font-display text-6xl leading-[0.95] tracking-tight text-foreground">
                Hvad ser du<br />
                <span className="text-primary italic">i aften?</span>
              </h1>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
                Alle danske biografer, ét sted. Søg blandt aktuelle film, find spilletider og opdag noget nyt på din lokale biograf.
              </p>
            </div>
            <div className="hidden text-right text-xs uppercase tracking-[0.2em] text-muted-foreground lg:block">
              <div>{movies.length} film i programmet</div>
              <div className="mt-1">{cinemas.length} biografer · 5 byer</div>
            </div>
          </div>

          {/* Search */}
          <div className="mt-12">
            <div className="group relative">
              <div className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Søg på titel, instruktør eller genre…"
                className="h-16 w-full rounded-md border border-border/80 bg-card/60 pl-14 pr-6 font-display text-xl text-foreground placeholder:font-sans placeholder:text-base placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-sm px-2 py-1 text-xs uppercase tracking-wider text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  Ryd
                </button>
              )}
            </div>

            {/* Genre chips */}
            <div className="mt-5 flex flex-wrap gap-2">
              <Chip active={activeGenre === null} onClick={() => setActiveGenre(null)}>
                Alle
              </Chip>
              {allGenres.map((g) => (
                <Chip key={g} active={activeGenre === g} onClick={() => setActiveGenre(g)}>
                  {g}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Movie grid */}
      <section className="mx-auto max-w-[1400px] px-8 py-14">
        <div className="mb-8 flex items-baseline justify-between">
          <h2 className="font-display text-2xl tracking-tight">
            {activeGenre ? activeGenre : "Aktuelt i biograferne"}
          </h2>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "film" : "film"}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-24 text-center">
            <p className="font-display text-xl text-foreground">Ingen film matcher</p>
            <p className="mt-2 text-sm text-muted-foreground">Prøv et andet søgeord eller en anden genre.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((m) => (
              <MovieCard key={m.id} movie={m} />
            ))}
          </div>
        )}
      </section>

      {/* Cinemas */}
      <section id="cinemas" className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-[1400px] px-8 py-16">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-display text-2xl tracking-tight">Biografer</h2>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              5 byer i Danmark
            </div>
          </div>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md bg-border md:grid-cols-2 lg:grid-cols-3">
            {cinemas.map((c) => (
              <Link
                key={c.id}
                to="/cinema/$id"
                params={{ id: c.id }}
                className="group flex flex-col justify-between bg-background p-6 transition-colors hover:bg-card"
              >
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{c.city}</div>
                  <h3 className="mt-2 font-display text-2xl tracking-tight text-foreground group-hover:text-primary">{c.name}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{c.description}</p>
                </div>
                <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{c.screens} sale · {c.movieIds.length} film</span>
                  <span className="text-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary">→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-[1400px] px-8 py-8 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Biograf DK · Mock data · 2026
        </div>
      </footer>
    </div>
  );
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
