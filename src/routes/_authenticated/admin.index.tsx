import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminSignOut } from "@/components/AdminSignOut";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Admin — Lanterna" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) {
      throw redirect({ to: "/admin/denied" });
    }
  },
  component: AdminDashboard,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-destructive">{(error as Error)?.message ?? "Fejl"}</p>
    </div>
  ),
});

function AdminDashboard() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wider text-muted-foreground">Admin</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Kontrolpanel</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Intern administration. Denne del af sitet er ikke linket fra det offentlige site.
          </p>
        </div>
        <AdminSignOut />
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/admin/import" className="block">
          <Card className="h-full transition-colors hover:bg-secondary/40">
            <CardHeader>
              <CardTitle>Kultunaut Import</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Upload en XML-fil og start et importjob.
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
