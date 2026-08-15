import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminShell } from "@/components/admin/AdminShell";
import { checkIsAdmin } from "@/lib/admin.functions";
import {
  ebilletOverview,
  ebilletDiscover,
  ebilletSyncAll,
  ebilletSyncOne,
  ebilletReleaseStuckRun,
} from "@/lib/ebillet.functions";

export const Route = createFileRoute("/_authenticated/admin/ebillet")({
  head: () => ({
    meta: [
      { title: "eBillet-sync — Lanterna Administration" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw redirect({ to: "/admin/denied" });
  },
  component: EbilletPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-destructive">{(error as Error)?.message ?? "Fejl"}</p>
    </div>
  ),
});

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EbilletPage() {
  const discover = useServerFn(ebilletDiscover);
  const syncAll = useServerFn(ebilletSyncAll);
  const syncOne = useServerFn(ebilletSyncOne);
  const release = useServerFn(ebilletReleaseStuckRun);

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["ebillet-overview"],
    queryFn: () => ebilletOverview(),
    refetchInterval: 15_000,
  });

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      const result = (await fn()) as { message?: string | null; done?: boolean };
      setNote(
        result?.message ??
          (result?.done === false ? "Kørslen fortsætter — tryk igen for næste del." : "Færdig."),
      );
      await overview.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ukendt fejl");
    } finally {
      setBusy(null);
    }
  }

  const data = overview.data;
  const running = data?.runs.find((r) => r.status === "running");

  return (
    <AdminShell title="eBillet-sync">
      <div className="mx-auto max-w-5xl space-y-6">
        <p className="text-sm text-muted-foreground">
          eBillet supplerer Kultunaut med biografer, film og spilletider direkte fra
          billetsystemet. Kultunaut-data overskrives aldrig — eBillet udfylder kun huller
          og tilføjer nye visninger.
        </p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi label="Fundne organizers" value={data?.totals.organizers ?? "—"} />
          <Kpi label="Aktive biografer" value={data?.totals.active ?? "—"} />
          <Kpi label="Koblet til biograf" value={data?.totals.linked ?? "—"} />
          <Kpi label="Fejlede senest" value={data?.totals.failed ?? "—"} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Handlinger</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button
              disabled={busy !== null}
              onClick={() => run("discover", () => discover({ data: {} }))}
            >
              {busy === "discover" ? "Søger…" : "Discover organizers"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => run("sync", () => syncAll({ data: undefined as never }))}
            >
              {busy === "sync" ? "Synkroniserer…" : "Synkronisér alle aktive"}
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => run("177", () => syncOne({ data: { organizerId: 177 } }))}
            >
              Test 177
            </Button>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => run("195", () => syncOne({ data: { organizerId: 195 } }))}
            >
              Test 195
            </Button>
            {running && (
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => run("release", () => release({ data: undefined as never }))}
              >
                Frigiv fastlåst kørsel
              </Button>
            )}
          </CardContent>
        </Card>

        {note && <p className="text-sm text-emerald-500">{note}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <Card>
          <CardHeader>
            <CardTitle>Seneste kørsler</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.runs ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Ingen kørsler endnu.</p>
            )}
            {(data?.runs ?? []).map((r) => (
              <div key={r.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">
                    {r.kind === "discover" ? "Discovery" : "Synkronisering"}
                  </span>
                  <span
                    className={
                      r.status === "completed"
                        ? "text-emerald-500"
                        : r.status === "failed"
                          ? "text-destructive"
                          : "text-amber-500"
                    }
                  >
                    {r.status}
                  </span>
                  <span className="text-muted-foreground">{fmt(r.startedAt)}</span>
                  {r.durationSeconds !== null && (
                    <span className="text-muted-foreground">{r.durationSeconds}s</span>
                  )}
                </div>
                <p className="mt-1 text-muted-foreground">{r.message ?? "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Biografer {r.organizersSynced}/{r.organizersActive} · fejl{" "}
                  {r.organizersFailed} · film {r.movies} · spilletider {r.showtimes}
                </p>
                {r.errors.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-destructive">
                    {r.errors.map((e, i) => (
                      <li key={i} className="break-words">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organizers ({data?.organizers.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">ID</th>
                  <th className="py-2 pr-3">Navn</th>
                  <th className="py-2 pr-3">By</th>
                  <th className="py-2 pr-3">Aktiv</th>
                  <th className="py-2 pr-3">Visninger</th>
                  <th className="py-2 pr-3">Sidste sync</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.organizers ?? []).map((o) => (
                  <tr key={o.id} className="border-t border-border/60">
                    <td className="py-2 pr-3 text-muted-foreground">{o.id}</td>
                    <td className="py-2 pr-3">{o.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{o.city ?? "—"}</td>
                    <td className="py-2 pr-3">{o.isActive ? "Ja" : "Nej"}</td>
                    <td className="py-2 pr-3">{o.showtimeCount}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{fmt(o.lastSyncedAt)}</td>
                    <td
                      className={`py-2 ${
                        o.lastSyncStatus === "failed"
                          ? "text-destructive"
                          : o.lastSyncStatus === "success"
                            ? "text-emerald-500"
                            : "text-muted-foreground"
                      }`}
                      title={o.lastSyncError ?? undefined}
                    >
                      {o.lastSyncStatus ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
