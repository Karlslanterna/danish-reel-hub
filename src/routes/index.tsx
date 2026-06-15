import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { MovieCard } from "@/components/MovieCard";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { fetchMovies, fetchCinemas, fetchMovieCinemaPairs, type Movie, type Cinema } from "@/lib/cinema-data";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [movies, cinemas, pairs] = await Promise.all([fetchMovies(), fetchCinemas(), fetchMovieCinemaPairs()]);
    return { movies, cinemas, pairs };
  },
  head: () => ({
    meta: [
      { title: "Lanterna — Find film og spilletider i Danmark" },
      { name: "description", content: "Opdag film, se spilletider og find din nærmeste biograf i København, Aarhus, Odense og Aalborg." },
    ],
  }),
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">Prøv igen</button>
    </div>
  ),
  notFoundComponent: () => <div className="p-12">Siden findes ikke</div>,
  component: HomePage,
});

type Radius = 2 | 5 | 10 | 25 | 50 | "all";

const RADIUS_OPTIONS: Array<{ value: Radius; label: string }> = [
  { value: 2, label: "2 km" },
  { value: 5, label: "5 km" },
  { value: 10, label: "10 km" },
  { value: 25, label: "25 km" },
  { value: 50, label: "50 km" },
  { value: "all", label: "Hele Danmark" },
];

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

type Suggestion =
  | { kind: "movie"; label: string; sub: string; slug: string }
  | { kind: "cinema"; label: string; sub: string; slug: string }
  | { kind: "city"; label: string; sub: string; city: string };

function HomePage() {
  const { movies, cinemas, pairs } = Route.useLoaderData() as { movies: Movie[]; cinemas: Cinema[]; pairs: Array<{ movieId: string; cinemaId: string }> };
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [radius, setRadius] = useState<Radius>("all");
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [radiusOpen, setRadiusOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  const requestLocation = (onSuccess?: () => void) => {
    if (!("geolocation" in navigator)) {
      setGeoError("Geolokation understøttes ikke");
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoLoading(false);
        onSuccess?.();
      },
      (err) => {
        setGeoError(err.code === err.PERMISSION_DENIED ? "Adgang nægtet" : "Kunne ikke finde dig");
        setGeoLoading(false);
        setRadius("all");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  const handleRadiusChange = (r: Radius) => {
    setRadius(r);
    setRadiusOpen(false);
  };

  const openRadiusPanel = () => {
    if (!userLoc) {
      requestLocation(() => setRadiusOpen(true));
    } else {
      setRadiusOpen(true);
    }
  };

  const nearbyCinemaIds = useMemo(() => {
    if (radius === "all" || !userLoc) return null;
    const ids = new Set<string>();
    for (const c of cinemas) {
      if (c.latitude == null || c.longitude == null) continue;
      const d = haversineKm(userLoc, { lat: c.latitude, lng: c.longitude });
      if (d <= radius) ids.add(c.id);
    }
    return ids;
  }, [radius, userLoc, cinemas]);

  const nearbyMovieIds = useMemo(() => {
    if (!nearbyCinemaIds) return null;
    const ids = new Set<string>();
    for (const p of pairs) {
      if (nearbyCinemaIds.has(p.cinemaId)) ids.add(p.movieId);
    }
    return ids;
  }, [nearbyCinemaIds, pairs]);


  const cities = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cinemas) {
      const key = c.city;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map, ([city, count]) => ({ city, count }));
  }, [cinemas]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Suggestion[] = [];

    for (const c of cities) {
      if (c.city.toLowerCase().includes(q)) {
        out.push({
          kind: "city",
          label: c.city,
          sub: `${c.count} ${c.count === 1 ? "biograf" : "biografer"}`,
          city: c.city,
        });
      }
    }
    for (const m of movies) {
      if (m.title.toLowerCase().includes(q) || m.director.toLowerCase().includes(q)) {
        out.push({ kind: "movie", label: m.title, sub: m.director, slug: m.slug });
      }
    }
    for (const c of cinemas) {
      if (c.name.toLowerCase().includes(q)) {
        out.push({ kind: "cinema", label: c.name, sub: c.city, slug: c.slug });
      }
    }
    return out.slice(0, 8);
  }, [query, movies, cinemas, cities]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return movies.filter(
      (m) => {
        if (nearbyMovieIds && !nearbyMovieIds.has(m.id)) return false;
        return (
          !q ||
          m.title.toLowerCase().includes(q) ||
          m.director.toLowerCase().includes(q) ||
          m.genre.some((g) => g.toLowerCase().includes(q))
        );
      },
    );
  }, [query, movies, nearbyMovieIds]);

  const nearbyCinemaCount = nearbyCinemaIds?.size ?? null;

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (s: Suggestion) => {
    setOpen(false);
    if (s.kind === "movie") navigate({ to: "/film/$slug", params: { slug: s.slug } });
    else if (s.kind === "cinema") navigate({ to: "/biograf/$slug", params: { slug: s.slug } });
    else navigate({ to: "/by/$city", params: { city: s.city.toLowerCase() } });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section className="border-b border-border/60">
        <div className="mx-auto max-w-[1400px] px-8 pb-14 pt-20">
          <div className="flex items-end justify-between gap-12">
            <div className="max-w-2xl">
              <h1 className="mt-4 font-display text-6xl leading-[0.95] tracking-tight text-foreground">
                En hurtigere vej i biografen
              </h1>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
                Alle danske biografer og aktuelle film, ét sted.
              </p>
            </div>
            <div className="hidden text-right text-xs uppercase tracking-[0.2em] text-muted-foreground lg:block">
              <div>{movies.length} film</div>
              <div className="mt-1">{cinemas.length} biografer</div>
            </div>
          </div>

          <div className="mt-12" ref={boxRef}>
            <div className="group relative">
              <div className="pointer-events-none absolute left-5 top-10 -translate-y-1/2 text-muted-foreground">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                placeholder="Søg på by, titel eller biograf..."
                className="h-20 w-full rounded-md border border-border/80 bg-card/60 pl-16 pr-6 font-display text-2xl text-foreground placeholder:font-sans placeholder:text-lg placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-ring/40"
                aria-autocomplete="list"
                aria-expanded={open && suggestions.length > 0}
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    setOpen(false);
                  }}
                  className="absolute right-4 top-10 -translate-y-1/2 rounded-sm px-2 py-1 text-xs uppercase tracking-wider text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  Ryd
                </button>
              )}

              {open && suggestions.length > 0 && (
                <ul
                  role="listbox"
                  className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-[28rem] overflow-y-auto rounded-md border border-border/80 bg-card shadow-2xl shadow-black/40"
                >
                  {suggestions.map((s, i) => (
                    <li key={`${s.kind}-${s.label}-${i}`} role="option" aria-selected={i === active}>
                      <button
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(s)}
                        className={`flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors ${
                          i === active ? "bg-secondary" : "hover:bg-secondary/60"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-display text-base text-foreground">{s.label}</div>
                          <div className="truncate text-xs text-muted-foreground">{s.sub}</div>
                        </div>
                        <span className="shrink-0 text-[10px] uppercase tracking-[0.2em] text-primary">
                          {s.kind === "movie" ? "Film" : s.kind === "cinema" ? "Biograf" : "By"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-8 py-14">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <h2 className="font-display text-2xl tracking-tight">Aktuelt i biograferne</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                <span aria-hidden>📍</span> Nær mig
              </span>
              {RADIUS_OPTIONS.map((opt) => {
                const selected = radius === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => handleRadiusChange(opt.value)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card/40 text-muted-foreground hover:border-primary/60 hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="text-right text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {geoLoading && <div>Finder din placering…</div>}
            {geoError && <div className="text-destructive">{geoError}</div>}
            {radius !== "all" && userLoc && nearbyCinemaCount !== null && (
              <div>{nearbyCinemaCount} biografer · {filtered.length} film inden for {radius} km</div>
            )}
            {(radius === "all" || (!userLoc && !geoLoading)) && (
              <div>{filtered.length} film</div>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-24 text-center">
            <p className="font-display text-xl text-foreground">Ingen film matcher</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {radius !== "all" && userLoc ? "Prøv en større radius." : "Prøv et andet søgeord."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((m) => (
              <MovieCard key={m.id} movie={m} />
            ))}
          </div>
        )}
      </section>


      <section id="cinemas" className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-[1400px] px-8 py-16">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-display text-2xl tracking-tight">Biografer</h2>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {cinemas.length} steder
            </div>
          </div>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md bg-border md:grid-cols-2 lg:grid-cols-3">
            {cinemas.map((c) => (
              <Link
                key={c.id}
                to="/biograf/$slug"
                params={{ slug: c.slug }}
                className="group flex flex-col justify-between bg-background p-6 transition-colors hover:bg-card"
              >
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{c.city}</div>
                  <h3 className="mt-2 font-display text-2xl tracking-tight text-foreground group-hover:text-primary">{c.name}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{c.description}</p>
                </div>
                <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{c.screens} sale</span>
                  <span className="text-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary">→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-[1400px] px-8 py-8 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Lanterna · 2026
        </div>
      </footer>
    </div>
  );
}
