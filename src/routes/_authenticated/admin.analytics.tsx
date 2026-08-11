import { createFileRoute, redirect } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminShell } from "@/components/admin/AdminShell";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Lanterna Administration" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) {
      throw redirect({ to: "/admin/denied" });
    }
  },
  component: AnalyticsPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-destructive">{(error as Error)?.message ?? "Fejl"}</p>
    </div>
  ),
});

const SOON = "Data kommer snart";

function KpiCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="text-sm text-muted-foreground/80">{SOON}</p>
      </CardContent>
    </Card>
  );
}

function EmptySection({ title, message }: { title: string; message: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function AnalyticsPage() {
  return (
    <AdminShell title="Analytics">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-semibold text-foreground">Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Et enkelt overblik over, hvordan Lanterna præsterer. Tal vises først, når de
            tilsvarende data bliver indsamlet.
          </p>
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Overblik</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Besøgende i dag" />
            <KpiCard label="Besøgende seneste 7 dage" />
            <KpiCard label="Besøgende seneste 30 dage" />
            <KpiCard label="Billetklik (30 dage)" />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Populært indhold</h3>
          <div className="grid gap-4 lg:grid-cols-3">
            <EmptySection
              title="Mest sete film"
              message="Data kommer snart. Der er endnu ikke registreret sidevisninger for film."
            />
            <EmptySection
              title="Mest sete biografer"
              message="Data kommer snart. Der er endnu ikke registreret sidevisninger for biografer."
            />
            <EmptySection
              title="Mest sete byer"
              message="Data kommer snart. Der er endnu ikke registreret sidevisninger for byer."
            />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Søgning</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <EmptySection
              title="Mest søgte film"
              message="Søgedata er endnu ikke tilgængelige."
            />
            <EmptySection
              title="Søgninger uden resultater"
              message="Søgedata er endnu ikke tilgængelige."
            />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Billetklik</h3>
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">Film med flest billetklik</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Film</th>
                      <th className="py-2 pr-4 font-medium">Visninger</th>
                      <th className="py-2 pr-4 font-medium">Billetklik</th>
                      <th className="py-2 font-medium">CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="py-6 text-muted-foreground">
                        Klikstatistik bliver tilgængelig, når tracking er aktiveret.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Indsigter</h3>
          <EmptySection
            title="Indsigter"
            message="Automatiske indsigter bliver tilgængelige, når der er indsamlet tilstrækkelige data."
          />
        </section>
      </div>
    </AdminShell>
  );
}
