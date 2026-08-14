import { Link } from "@tanstack/react-router";
import { baseCityOf, citySlug } from "@/lib/city-slug";

export type FooterCinema = { slug: string; name: string; city: string };

/**
 * Sitewide SEO footer: popular cities, popular cinemas and the two index
 * pages. Rendered server-side from data the route already loaded, so the
 * links are in the initial HTML.
 */
export function SiteFooter({ cinemas = [] }: { cinemas?: FooterCinema[] }) {
  const cityMap = new Map<string, { name: string; slug: string; count: number }>();
  for (const c of cinemas) {
    const name = baseCityOf(c.city);
    const slug = citySlug(c.city);
    if (!name || !slug) continue;
    const prev = cityMap.get(slug);
    if (prev) prev.count += 1;
    else cityMap.set(slug, { name, slug, count: 1 });
  }

  const cities = [...cityMap.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "da"))
    .slice(0, 12);

  const citySize = new Map([...cityMap.values()].map((c) => [c.slug, c.count] as const));
  const popularCinemas = [...cinemas]
    .sort(
      (a, b) =>
        (citySize.get(citySlug(b.city)) ?? 0) - (citySize.get(citySlug(a.city)) ?? 0) ||
        a.name.localeCompare(b.name, "da"),
    )
    .slice(0, 12);

  return (
    <footer className="mt-16 border-t border-border/60 bg-background">
      <div className="mx-auto max-w-[1400px] px-6 py-12 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <nav aria-labelledby="footer-cities">
            <h2 id="footer-cities" className="text-[10px] uppercase tracking-[0.25em] text-primary">
              Populære byer
            </h2>
            <ul className="mt-4 space-y-2">
              {cities.map((c) => (
                <li key={c.slug}>
                  <Link
                    to="/$city"
                    params={{ city: c.slug }}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Biograf i {c.name}
                  </Link>
                </li>
              ))}
              {cities.length === 0 && (
                <li>
                  <Link to="/biograf" className="text-sm text-muted-foreground hover:text-foreground">
                    Se alle byer og biografer
                  </Link>
                </li>
              )}
            </ul>
          </nav>

          <nav aria-labelledby="footer-cinemas">
            <h2 id="footer-cinemas" className="text-[10px] uppercase tracking-[0.25em] text-primary">
              Populære biografer
            </h2>
            <ul className="mt-4 space-y-2">
              {popularCinemas.map((c) => (
                <li key={c.slug}>
                  <Link
                    to="/biograf/$slug"
                    params={{ slug: c.slug }}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
              {popularCinemas.length === 0 && (
                <li>
                  <Link to="/biograf" className="text-sm text-muted-foreground hover:text-foreground">
                    Se alle biografer
                  </Link>
                </li>
              )}
            </ul>
          </nav>

          <nav aria-labelledby="footer-index">
            <h2 id="footer-index" className="text-[10px] uppercase tracking-[0.25em] text-primary">
              Oversigter
            </h2>
            <ul className="mt-4 space-y-2">
              <li>
                <Link to="/film" className="text-sm text-muted-foreground hover:text-foreground">
                  Alle film
                </Link>
              </li>
              <li>
                <Link to="/biograf" className="text-sm text-muted-foreground hover:text-foreground">
                  Alle biografer
                </Link>
              </li>
              <li>
                <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
                  Forside
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-primary">Lanterna</div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              En hurtigere vej i biografen. Find film, spilletider og billetter i hele Danmark.
            </p>
          </div>
        </div>

        <div className="mt-10 border-t border-border/60 pt-6 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          © {new Date().getFullYear()} Lanterna
        </div>
      </div>
    </footer>
  );
}
