import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  AdminDataState,
  dateTime,
  number,
  Panel,
  useAdminOverview,
} from "@/components/admin/AdminOverviewUi";
import { adminSetScreeningEventOverride } from "@/lib/admin-overview.functions";
import { checkIsAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/filters")({
  head: () => ({ meta: [{ title: "Filtre & mærkninger — Lanterna" }, { name: "robots", content: "noindex, nofollow" }] }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) throw redirect({ to: "/admin/denied" });
  },
  component: FiltersPage,
});

function DimensionTable({ rows }: { rows: Array<{ value: string; screenings: number; movies: number; cinemas: number }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-sm">
        <thead><tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground"><th className="py-2 pr-4">Værdi</th><th className="py-2 pr-4">Forestillinger</th><th className="py-2 pr-4">Film</th><th className="py-2">Biografer</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.value} className="border-b border-border/50"><td className="py-2.5 pr-4 font-medium">{row.value}</td><td className="py-2.5 pr-4">{number(row.screenings)}</td><td className="py-2.5 pr-4">{number(row.movies)}</td><td className="py-2.5">{number(row.cinemas)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function FiltersPage() {
  const query = useAdminOverview();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<"kultunaut" | "ebillet">("ebillet");
  const [sourceRef, setSourceRef] = useState("");
  const [event, setEvent] = useState<"Babybio" | "Seniorbio" | "Filmporten" | "Biografklub Danmark">("Babybio");
  const [action, setAction] = useState<"add" | "remove">("add");
  const [note, setNote] = useState("");
  const mutation = useMutation({
    mutationFn: () => adminSetScreeningEventOverride({ data: { source, sourceRef, event, action, note } }),
    onSuccess: async () => {
      setSourceRef("");
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "overview", "v2"] });
    },
  });

  return (
    <AdminShell title="Filtre & mærkninger">
      <AdminDataState query={query}>
        {(data) => (
          <div className="mx-auto max-w-6xl space-y-6">
            <div><h2 className="font-display text-2xl font-semibold">Filtre & mærkninger</h2><p className="mt-1 text-sm text-muted-foreground">Se hvilke værdier der faktisk findes, kontrollér eksempler og gem sporbare rettelser.</p></div>
            <Panel title="Særlige filtre" description="Kun de fire godkendte filtre vises offentligt, og kun når de har aktuelle resultater."><DimensionTable rows={data.filters.events.filter((row) => ["Babybio", "Seniorbio", "Filmporten", "Biografklub Danmark"].includes(row.value))} /></Panel>
            <div className="grid gap-6 lg:grid-cols-2"><Panel title="Visningstype"><DimensionTable rows={data.filters.formats} /></Panel><Panel title="Sprog"><DimensionTable rows={data.filters.languages} /></Panel></div>

            <Panel title="Officielle filmprogrammer" description="Programtags kommer fra disse kuraterede lister, ikke fra løse ord i feedet.">
              <div className="grid gap-5 md:grid-cols-2">
                {data.filters.programmes.map((programme) => (
                  <div key={programme.tag} className="rounded-md border border-border p-4">
                    <h3 className="font-medium">{programme.tag} · {programme.season}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Kontrolleret {programme.reviewedAt} · næste kontrol senest {programme.reviewDueAt}</p>
                    <ul className="mt-3 grid gap-1 text-sm">{programme.titles.map((title) => <li key={title}>{title}</li>)}</ul>
                    <a href={programme.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs text-primary hover:underline">Åbn officiel liste</a>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Enkel manuel rettelse" description="Rettelsen knyttes til kildens forestillings-id og genanvendes automatisk efter næste import.">
              <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="grid gap-4 md:grid-cols-2">
                <label className="text-sm">Kilde<select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"><option value="ebillet">eBillet</option><option value="kultunaut">Kultunaut</option></select></label>
                <label className="text-sm">Forestillings-id<input required value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="fx eb-141-418495" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" /></label>
                <label className="text-sm">Mærkning<select value={event} onChange={(e) => setEvent(e.target.value as typeof event)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"><option>Babybio</option><option>Seniorbio</option><option>Filmporten</option><option>Biografklub Danmark</option></select></label>
                <label className="text-sm">Handling<select value={action} onChange={(e) => setAction(e.target.value as typeof action)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"><option value="add">Tilføj</option><option value="remove">Fjern</option></select></label>
                <label className="text-sm md:col-span-2">Begrundelse<input required minLength={3} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2" /></label>
                <div className="md:col-span-2"><button disabled={mutation.isPending} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{mutation.isPending ? "Gemmer…" : "Gem rettelse"}</button>{mutation.isError && <p className="mt-2 text-sm text-destructive">{(mutation.error as Error).message}</p>}{mutation.isSuccess && <p className="mt-2 text-sm text-emerald-600">Rettelsen er gemt og anvendt.</p>}</div>
              </form>
            </Panel>

            <Panel title="Seneste manuelle rettelser">
              {data.overrides.length === 0 ? <p className="text-sm text-muted-foreground">Ingen manuelle rettelser.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground"><th className="py-2 pr-4">Id</th><th className="py-2 pr-4">Mærkning</th><th className="py-2 pr-4">Handling</th><th className="py-2 pr-4">Begrundelse</th><th className="py-2">Opdateret</th></tr></thead><tbody>{data.overrides.map((row) => <tr key={row.id} className="border-b border-border/50"><td className="py-2.5 pr-4 font-mono text-xs">{row.sourceRef}</td><td className="py-2.5 pr-4">{row.event}</td><td className="py-2.5 pr-4">{row.action === "add" ? "Tilføj" : "Fjern"}</td><td className="py-2.5 pr-4">{row.note}</td><td className="py-2.5">{dateTime(row.updatedAt)}</td></tr>)}</tbody></table></div>}
            </Panel>

            <Panel title="Kontroleksempler" description="Brug forestillings-id'et ovenfor, hvis en konkret mærkning skal rettes.">
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground"><th className="py-2 pr-4">Mærkning</th><th className="py-2 pr-4">Film</th><th className="py-2 pr-4">Biograf</th><th className="py-2 pr-4">Dato</th><th className="py-2">Kilde-id</th></tr></thead><tbody>{data.filters.examples.map((row) => <tr key={`${row.source}-${row.sourceRef}-${row.event}`} className="border-b border-border/50"><td className="py-2.5 pr-4">{row.event}</td><td className="py-2.5 pr-4">{row.movie}</td><td className="py-2.5 pr-4">{row.cinema}</td><td className="py-2.5 pr-4">{row.date}</td><td className="py-2.5 font-mono text-xs">{row.sourceRef}</td></tr>)}</tbody></table></div>
            </Panel>
          </div>
        )}
      </AdminDataState>
    </AdminShell>
  );
}
