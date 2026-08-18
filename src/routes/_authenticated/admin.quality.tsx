import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminDataState, Metric, number, Panel, useAdminOverview } from "@/components/admin/AdminOverviewUi";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/quality")({
  head: () => ({ meta: [{ title: "Datakvalitet — Lanterna" }, { name: "robots", content: "noindex, nofollow" }] }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw redirect({ to: "/admin/denied" });
  },
  component: QualityPage,
});

function QualityPage() {
  const query = useAdminOverview();
  return (
    <AdminShell title="Datakvalitet">
      <AdminDataState query={query}>
        {(data) => {
          const q = data.quality;
          return (
            <div className="mx-auto max-w-6xl space-y-6">
              <div>
                <h2 className="font-display text-2xl font-semibold">Datakvalitet</h2>
                <p className="mt-1 text-sm text-muted-foreground">Automatiske kontroller af de data, der faktisk vises på websitet.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Film uden plakat" value={number(q.missingPosters)} />
                <Metric label="Film uden beskrivelse" value={number(q.missingSynopsis)} />
                <Metric label="Forestillinger uden billetlink" value={number(q.missingTicketUrls)} />
                <Metric label="Uløste kildereferencer" value={number(q.unresolvedEntities)} />
                <Metric label="Fastlåste importer" value={number(q.staleRuns)} />
                <Metric label="Eksakte dubletter" value={number(q.duplicateScreenings)} />
                <Metric label="Forkerte programtags" value={number(q.incorrectProgrammeTags)} />
                <Metric label="Manglende programtags" value={number(q.missingProgrammeTags)} />
              </div>
              <Panel title="Kontrolpunkter for de særlige filtre">
                <div className="divide-y divide-border/60 text-sm">
                  <div className="flex justify-between gap-4 py-3"><span>Empire Bio · kommende Babybio-markeringer</span><strong>{number(q.empireBabybio)}</strong></div>
                  <div className="flex justify-between gap-4 py-3"><span>Programtags, der ikke står på den officielle liste</span><strong>{number(q.incorrectProgrammeTags)}</strong></div>
                  <div className="flex justify-between gap-4 py-3"><span>Officielle programfilm uden korrekt tag</span><strong>{number(q.missingProgrammeTags)}</strong></div>
                </div>
              </Panel>
              <Panel title="Hvad skal jeg gøre?">
                {data.attention.length ? (
                  <ol className="list-decimal space-y-2 pl-5 text-sm">{data.attention.map((item) => <li key={item}>{item}</li>)}</ol>
                ) : (
                  <p className="text-sm text-muted-foreground">Der er ingen aktuelle handlinger.</p>
                )}
              </Panel>
            </div>
          );
        }}
      </AdminDataState>
    </AdminShell>
  );
}
