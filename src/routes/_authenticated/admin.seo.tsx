import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminDataState, Metric, number, Panel, useAdminOverview } from "@/components/admin/AdminOverviewUi";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/seo")({
  head: () => ({ meta: [{ title: "Google & SEO — Lanterna" }, { name: "robots", content: "noindex, nofollow" }] }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw redirect({ to: "/admin/denied" });
  },
  component: SeoPage,
});

function SeoPage() {
  const query = useAdminOverview();
  return (
    <AdminShell title="Google & SEO">
      <AdminDataState query={query}>
        {(data) => (
          <div className="mx-auto max-w-6xl space-y-6">
            <div><h2 className="font-display text-2xl font-semibold">Google & SEO</h2><p className="mt-1 text-sm text-muted-foreground">Kun stabile sider med aktuelle resultater er beregnet til indeksering.</p></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Filmsider" value={number(data.seo.moviePages)} />
              <Metric label="Biografsider" value={number(data.seo.cinemaPages)} />
              <Metric label="Bysider" value={number(data.seo.cityPages)} />
              <Metric label="Børnefilm" value={number(data.seo.childMovies)} />
            </div>
            <Panel title="Kuraterede landingssider">
              <div className="divide-y divide-border/60 text-sm">
                {data.seo.specialPages.map((page) => (
                  <div key={page.tag} className="flex items-center justify-between gap-4 py-3">
                    <span>{page.tag}</span>
                    <span className={page.indexable ? "text-emerald-600" : "text-amber-600"}>{number(page.results)} film · {page.indexable ? "kan indekseres" : "noindex"}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-4 py-3"><span>Film for børn</span><span className={data.seo.childMovies ? "text-emerald-600" : "text-amber-600"}>{number(data.seo.childMovies)} film</span></div>
              </div>
            </Panel>
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="Indholdsproblemer"><div className="space-y-3 text-sm"><div className="flex justify-between"><span>Manglende beskrivelser</span><strong>{number(data.seo.missingDescriptions)}</strong></div><div className="flex justify-between"><span>Manglende plakater</span><strong>{number(data.seo.missingPosters)}</strong></div></div></Panel>
              <Panel title="Teknisk opsætning"><ul className="space-y-2 text-sm text-muted-foreground"><li>Canonical URL på kuraterede sider</li><li>Separate sitemaps for kerne-, film-, biograf- og by/film-sider</li><li>Strukturerede data på film, biografer, byer og landingssider</li><li>Filterkombinationer oprettes ikke som indeksérbare URL'er</li></ul></Panel>
            </div>
          </div>
        )}
      </AdminDataState>
    </AdminShell>
  );
}
