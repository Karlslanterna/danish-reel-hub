import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  AdminDataState,
  dateTime,
  Panel,
  stateLabel,
  StatusBadge,
  useAdminOverview,
} from "@/components/admin/AdminOverviewUi";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/data")({
  head: () => ({
    meta: [
      { title: "Data & importer — Lanterna" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw redirect({ to: "/admin/denied" });
  },
  component: DataPage,
});

function DataPage() {
  const query = useAdminOverview();
  return (
    <AdminShell title="Data & importer">
      <AdminDataState query={query}>
        {(data) => (
          <div className="mx-auto max-w-6xl space-y-6">
            <div>
              <h2 className="font-display text-2xl font-semibold">Data & importer</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Se hver datakilde for sig og følg de seneste automatiske kørsler.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {data.sources.map((source) => (
                <Panel key={source.source} title={source.label}>
                  <div className="flex items-center justify-between gap-4">
                    <StatusBadge status={source.status} />
                    <span className="text-sm text-muted-foreground">
                      {stateLabel(source.latestState)}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Seneste succes</dt>
                      <dd>{dateTime(source.latestSuccessAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Venter / kører</dt>
                      <dd>
                        {source.queued} / {source.running}
                      </dd>
                    </div>
                  </dl>
                </Panel>
              ))}
            </div>

            <Panel
              title="Seneste kørsler"
              description="Nyeste står øverst. En fastlåst kørsel vises også under Datakvalitet."
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-4">Kilde</th>
                      <th className="py-2 pr-4">Omfang</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Start</th>
                      <th className="py-2">Fejl</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentRuns.map((run) => (
                      <tr key={run.id} className="border-b border-border/50 align-top">
                        <td className="py-3 pr-4 font-medium">
                          {run.source === "ebillet" ? "eBillet" : "Kultunaut"}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{run.scope || "Alle"}</td>
                        <td className="py-3 pr-4">
                          {run.superseded ? "Overhalet af nyere succes" : stateLabel(run.state)}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {dateTime(run.createdAt)}
                        </td>
                        <td
                          className={`max-w-sm py-3 ${run.superseded ? "text-muted-foreground" : "text-destructive"}`}
                        >
                          {run.superseded
                            ? "Historisk fejl – efterfølgende import er gennemført"
                            : (run.error ?? "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              title="Manuelle værktøjer"
              description="De tekniske knapper er samlet under Avanceret, så daglig status er let at læse."
            >
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/admin/advanced"
                  className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
                >
                  Åbn avancerede værktøjer
                </Link>
                <button
                  type="button"
                  onClick={() => query.refetch()}
                  className="rounded-md border border-border px-4 py-2 text-sm"
                >
                  Opdatér status
                </button>
              </div>
            </Panel>
          </div>
        )}
      </AdminDataState>
    </AdminShell>
  );
}
