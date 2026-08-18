import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { Panel } from "@/components/admin/AdminOverviewUi";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/advanced")({
  head: () => ({ meta: [{ title: "Avanceret — Lanterna" }, { name: "robots", content: "noindex, nofollow" }] }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw redirect({ to: "/admin/denied" });
  },
  component: AdvancedPage,
});

function AdvancedPage() {
  return (
    <AdminShell title="Avanceret">
      <div className="mx-auto max-w-4xl space-y-6">
        <div><h2 className="font-display text-2xl font-semibold">Avancerede værktøjer</h2><p className="mt-1 text-sm text-muted-foreground">Tekniske funktioner til fejlsøgning og manuelle importer.</p></div>
        <Panel title="Kanonisk datapipeline"><p className="mb-4 text-sm text-muted-foreground">Detaljer om snapshots, køer og Kultunaut-importer.</p><Link to="/admin/pipeline" className="text-sm text-primary hover:underline">Åbn pipelineværktøjer</Link></Panel>
        <Panel title="eBillet"><p className="mb-4 text-sm text-muted-foreground">Organisatorer, synkronisering og tekniske testkørsler.</p><Link to="/admin/ebillet" className="text-sm text-primary hover:underline">Åbn eBillet-værktøjer</Link></Panel>
        <Panel title="Manuel XML-import"><p className="mb-4 text-sm text-muted-foreground">Brug kun ved kontrolleret genindlæsning af en Kultunaut-fil.</p><Link to="/admin/import" className="text-sm text-primary hover:underline">Start manuel import</Link></Panel>
      </div>
    </AdminShell>
  );
}
