import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Breadcrumb } from "@/components/Breadcrumb";
import { fetchCinemas, type Cinema } from "@/lib/cinema-data";
import { baseCityOf, citySlug } from "@/lib/city-slug";
import { canonicalUrl } from "@/lib/canonical";
import { indexTitle, indexDescription } from "@/lib/seo";

export const Route = createFileRoute("/biograf/")({
  loader: async () => ({ cinemas: await fetchCinemas() }),
  head: () => {
    const href = canonicalUrl("/biograf");
    const title = indexTitle("cinemas");
    const description = indexDescription("cinemas");
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
      links: [{ rel: "canonical", href }],
    };
  },
  errorComponent: ({ reset }) => (
    <div className="p-12">
      <button onClick={reset} className="text-primary">Prøv igen</button>
    </div>
  ),
  component: CinemaIndexPage,
});

function CinemaIndexPage() {
  const { cinemas } = Route.useLoaderData() as { cinemas: Cinema[] };

  const groups = new Map<string, { name: string; slug: string; items: Cinema[] }>();
  for (const c of cinemas) {
    const slug = citySlug(c.city);
    const name = baseCityOf(c.city);
    if (!slug || !name) continue;
    const g = groups.get(slug) ?? { name, slug, items: [] };
    g.items.push(c);
    groups.set(slug, g);
  }
  const sorted = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "da"));

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <section className="mx-auto max-w-[1400px] px-6 py-10 sm:px-8 sm:py-14">
        <Breadcrumb items={[{ label: "Forside", to: "/" }, { label: "Biografer" }]} />
        <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Alle biografer i Danmark
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          {cinemas.length} biografer i {sorted.length} byer. Vælg en biograf for at se programmet og
          dagens spilletider.
        </p>

        <div className="mt-10 space-y-10">
          {sorted.map((g) => (
            <div key={g.slug}>
              <h2 className="font-display text-xl tracking-tight">
                <Link to="/$city" params={{ city: g.slug }} className="hover:text-primary">
                  {g.name}
                </Link>
              </h2>
              <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {g.items
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name, "da"))
                  .map((c) => (
                    <li key={c.id}>
                      <Link
                        to="/biograf/$slug"
                        params={{ slug: c.slug }}
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        {c.name}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <SiteFooter cinemas={cinemas} />
    </div>
  );
}
