import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  AdminDataState,
  dateTime,
  Metric,
  number,
  Panel,
  StatusBadge,
  useAdminOverview,
} from "@/components/admin/AdminOverviewUi";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Lanterna Administration" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw redirect({ to: "/admin/denied" });
  },
  component: AdminDashboard,
});

function AdminDashboard() {
  const query = useAdminOverview();
  return (
    <AdminShell title="Dashboard">
      <AdminDataState query={query}>
        {(data) => (
          <div className="mx-auto max-w-6xl space-y-6">
            <section className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-semibold">Overblik</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Aktuel status for data, filtre og brugeraktivitet. Opdateret {dateTime(data.generatedAt)}.
                </p>
              </div>
              <StatusBadge status={data.status} />
            </section>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Aktuelle film" value={number(data.counts.movies)} />
              <Metric label="Biografer med program" value={number(data.counts.cinemas)} />
              <Metric label="Kommende forestillinger" value={number(data.counts.screenings)} />
              <Metric label="Sidevisninger · 30 dage" value={number(data.analytics.pageViews30Days)} />
            </div>

            {data.attention.length > 0 ? (
              <Panel title="Dette kræver opmærksomhed">
                <ul className="space-y-2 text-sm">
                  {data.attention.map((item) => (
                    <li key={item} className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700">
                      {item}
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : (
              <Panel title="Ingen kendte problemer">
                <p className="text-sm text-muted-foreground">
                  Begge datakilder er friske, og de automatiske kvalitetskontroller er bestået.
                </p>
              </Panel>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="Datakilder" description="Status bygger på den kanoniske screeningstabel og begge aktive importer.">
                <div className="divide-y divide-border/60">
                  {data.sources.map((source) => (
                    <div key={source.source} className="flex items-start justify-between gap-4 py-3">
                      <div>
                        <p className="font-medium">{source.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Senest gennemført: {dateTime(source.latestSuccessAt)}
                        </p>
                      </div>
                      <StatusBadge status={source.status} />
                    </div>
                  ))}
                </div>
                <Link to="/admin/data" className="mt-4 inline-block text-sm text-primary hover:underline">
                  Se importer og historik
                </Link>
              </Panel>

              <Panel title="Seneste 30 dage">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Billetklik</p>
                    <p className="font-display text-2xl">{number(data.analytics.ticketClicks30Days)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Aktiverede filtre</p>
                    <p className="font-display text-2xl">{number(data.analytics.filterUses30Days)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ingen resultater</p>
                    <p className="font-display text-2xl">{number(data.analytics.zeroResults30Days)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Sidevisninger i dag</p>
                    <p className="font-display text-2xl">{number(data.analytics.pageViewsToday)}</p>
                  </div>
                </div>
                <Link to="/admin/analytics" className="mt-4 inline-block text-sm text-primary hover:underline">
                  Se besøg og klik
                </Link>
              </Panel>
            </div>
          </div>
        )}
      </AdminDataState>
    </AdminShell>
  );
}
