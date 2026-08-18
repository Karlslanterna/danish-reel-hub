import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  AdminDataState,
  Metric,
  number,
  Panel,
  SimpleList,
  useAdminOverview,
} from "@/components/admin/AdminOverviewUi";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  head: () => ({ meta: [{ title: "Besøg & klik — Lanterna" }, { name: "robots", content: "noindex, nofollow" }] }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw redirect({ to: "/admin/denied" });
  },
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const query = useAdminOverview();
  return (
    <AdminShell title="Besøg & klik">
      <AdminDataState query={query}>
        {(data) => {
          const analytics = data.analytics;
          return (
            <div className="mx-auto max-w-6xl space-y-6">
              <div><h2 className="font-display text-2xl font-semibold">Besøg & klik</h2><p className="mt-1 text-sm text-muted-foreground">Anonym, cookie-fri produktmåling. Der gemmes ingen bruger-id, IP-adresse eller henvisende side.</p></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Sidevisninger i dag" value={number(analytics.pageViewsToday)} />
                <Metric label="Sidevisninger · 7 dage" value={number(analytics.pageViews7Days)} />
                <Metric label="Sidevisninger · 30 dage" value={number(analytics.pageViews30Days)} />
                <Metric label="Billetklik · 30 dage" value={number(analytics.ticketClicks30Days)} />
                <Metric label="Aktiverede filtre" value={number(analytics.filterUses30Days)} help="Seneste 30 dage" />
                <Metric label="Ingen resultater" value={number(analytics.zeroResults30Days)} help="Seneste 30 dage" />
              </div>
              <div className="grid gap-6 lg:grid-cols-3">
                <Panel title="Mest sete sider"><SimpleList items={analytics.topPaths} /></Panel>
                <Panel title="Mest brugte filtre"><SimpleList items={analytics.topFilters} /></Panel>
                <Panel title="Flest billetklik"><SimpleList items={analytics.topTickets} /></Panel>
              </div>
              <Panel title="Sådan læses tallene"><p className="text-sm text-muted-foreground">Sidevisninger er hændelser, ikke unikke personer. Et billetklik registreres, når en besøgende går videre til biografens billetsalg. “Ingen resultater” hjælper med at finde filterkombinationer, hvor data eller brugeroplevelse bør forbedres.</p></Panel>
            </div>
          );
        }}
      </AdminDataState>
    </AdminShell>
  );
}
