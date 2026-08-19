import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Switch } from "@/components/ui/switch";
import {
  AdminDataState,
  Metric,
  number,
  Panel,
  SimpleList,
  useAdminOverview,
} from "@/components/admin/AdminOverviewUi";
import { checkIsAdmin } from "@/lib/admin.functions";
import { isAnalyticsOptedOut, setAnalyticsOptOut } from "@/lib/analytics";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  head: () => ({
    meta: [{ title: "Besøg & klik — Lanterna" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw redirect({ to: "/admin/denied" });
  },
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const query = useAdminOverview();
  const [excludeThisBrowser, setExcludeThisBrowser] = useState(false);

  useEffect(() => {
    setExcludeThisBrowser(isAnalyticsOptedOut());
  }, []);

  const updateExclusion = (excluded: boolean) => {
    setAnalyticsOptOut(excluded);
    setExcludeThisBrowser(excluded);
  };

  return (
    <AdminShell title="Besøg & klik">
      <AdminDataState query={query}>
        {(data) => {
          const analytics = data.analytics;
          return (
            <div className="mx-auto max-w-6xl space-y-6">
              <div>
                <h2 className="font-display text-2xl font-semibold">Besøg & klik</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Anonym, cookie-fri produktmåling. Der gemmes ingen bruger-id, IP-adresse eller
                  henvisende side.
                </p>
              </div>
              <div className="flex items-start justify-between gap-6 rounded-lg border border-border bg-card p-5">
                <div>
                  <label htmlFor="exclude-admin-browser" className="font-medium text-foreground">
                    Tæl ikke denne browser med
                  </label>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Når den er slået til, registreres dine besøg, filtervalg og billetklik ikke fra
                    denne browser. Slå den til på hver telefon eller computer, du selv bruger.
                    Tidligere tal kan ikke fjernes, fordi målingen er anonym.
                  </p>
                </div>
                <Switch
                  id="exclude-admin-browser"
                  checked={excludeThisBrowser}
                  onCheckedChange={updateExclusion}
                  aria-label="Tæl ikke denne browser med i besøgsstatistikken"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Sidevisninger i dag" value={number(analytics.pageViewsToday)} />
                <Metric label="Sidevisninger · 7 dage" value={number(analytics.pageViews7Days)} />
                <Metric label="Sidevisninger · 30 dage" value={number(analytics.pageViews30Days)} />
                <Metric label="Billetklik · 30 dage" value={number(analytics.ticketClicks30Days)} />
                <Metric
                  label="Aktiverede filtre"
                  value={number(analytics.filterUses30Days)}
                  help="Seneste 30 dage"
                />
                <Metric
                  label="Ingen resultater"
                  value={number(analytics.zeroResults30Days)}
                  help="Seneste 30 dage"
                />
              </div>
              <div className="grid gap-6 lg:grid-cols-3">
                <Panel title="Mest sete sider">
                  <SimpleList items={analytics.topPaths} />
                </Panel>
                <Panel title="Mest brugte filtre">
                  <SimpleList items={analytics.topFilters} />
                </Panel>
                <Panel title="Flest billetklik">
                  <SimpleList items={analytics.topTickets} />
                </Panel>
              </div>
              <Panel title="Sådan læses tallene">
                <p className="text-sm text-muted-foreground">
                  Sidevisninger er hændelser, ikke unikke personer. Et billetklik registreres, når
                  en besøgende går videre til biografens billetsalg. “Ingen resultater” hjælper med
                  at finde filterkombinationer, hvor data eller brugeroplevelse bør forbedres.
                </p>
              </Panel>
            </div>
          );
        }}
      </AdminDataState>
    </AdminShell>
  );
}
