import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  checkIsAdmin,
  adminListImportJobs,
  adminRetryImportJob,
} from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/pipeline")({
  head: () => ({
    meta: [
      { title: "Data Pipeline — Lanterna Administration" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) {
      throw redirect({ to: "/admin/denied" });
    }
  },
  component: DataPipelinePage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-destructive">{(error as Error)?.message ?? "Fejl"}</p>
    </div>
  ),
});

type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

type HealthPayload = {
  status: HealthStatus;
  importStatus?: HealthStatus;
  reasons?: string[];
  metrics?: {
    lastSuccessAt: string | null;
    lastJobId: string | null;
    lastJobStatus: string | null;
    lastDurationSeconds: number | null;
    avgDurationSeconds: number;
    lastMovies: number;
    lastCinemas: number;
    lastShowtimes: number;
  };
  scheduler?: {
    status: HealthStatus;
    lastRunAt: string | null;
    lastRunStatus: string | null;
    lastSuccessAt: string | null;
  };
};

const STATUS_DOT: Record<HealthStatus, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-destructive",
  unknown: "bg-muted-foreground",
};

const STATUS_TEXT: Record<HealthStatus, string> = {
  healthy: "text-emerald-500",
  warning: "text-amber-500",
  critical: "text-destructive",
  unknown: "text-muted-foreground",
};

const STATUS_HEADLINE: Record<HealthStatus, string> = {
  healthy: "Datapipelinen kører normalt",
  warning: "Datapipelinen kræver opmærksomhed",
  critical: "Datapipelinen fejler",
  unknown: "Status er endnu ukendt",
};

const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "I kø",
  running: "Kører",
  completed: "Gennemført",
  failed: "Fejlet",
  skipped: "Sprunget over",
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} sek.`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m} min.` : `${m} min. ${rest} sek.`;
}

function humanizeReason(reason: string, lastSuccessAt: string | null): string {
  const r = reason.toLowerCase();
  if (r.includes("last success was") || r.includes("last scheduled import succeeded")) {
    return lastSuccessAt
      ? `Seneste vellykkede import blev gennemført ${formatDateTime(lastSuccessAt)}.`
      : "Der er endnu ingen vellykket import.";
  }
  if (r.includes("no successful import")) return "Der er endnu ingen vellykket import.";
  if (r.includes("scheduler has never run")) return "Den automatiske import har endnu ikke kørt.";
  if (r.includes("scheduler has no successful run"))
    return "Den automatiske import har endnu ikke gennemført en kørsel.";
  if (r.includes("last scheduled run failed")) return "Seneste automatiske kørsel gik galt.";
  if (r.includes("consecutive failed")) return "Flere kørsler i træk er gået galt.";
  if (r.includes("zero movies")) return "Seneste kørsel hentede ingen film.";
  if (r.includes("zero cinemas")) return "Seneste kørsel hentede ingen biografer.";
  if (r.includes("zero showtimes")) return "Seneste kørsel hentede ingen forestillinger.";
  if (r.includes("movie count dropped")) return "Antallet af film faldt markant ved seneste kørsel.";
  if (r.includes("cinema count dropped"))
    return "Antallet af biografer faldt markant ved seneste kørsel.";
  if (r.includes("showtime count dropped"))
    return "Antallet af forestillinger faldt markant ved seneste kørsel.";
  if (r.includes("import took")) return "Seneste kørsel tog usædvanligt lang tid.";
  if (r.includes("no import jobs")) return "Der er endnu ikke kørt nogen import.";
  if (r.includes("all checks passed") || r.includes("scheduler healthy"))
    return "Alle kontroller er bestået.";
  return "Systemet kræver opmærksomhed.";
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border/50 py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm ${muted ? "text-muted-foreground" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function StatusLine({
  label,
  status,
  description,
}: {
  label: string;
  status: HealthStatus;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border/50 py-3 last:border-0">
      <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">{children}</h2>
  );
}

function DataPipelinePage() {
  const navigate = useNavigate();
  const retryImport = useServerFn(adminRetryImportJob);
  const listJobs = useServerFn(adminListImportJobs);
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const health = useQuery({
    queryKey: ["admin", "import-health"],
    queryFn: async (): Promise<HealthPayload> => {
      const res = await fetch("/api/public/import-health", { cache: "no-store" });
      return (await res.json()) as HealthPayload;
    },
    refetchInterval: 60_000,
  });

  const jobs = useQuery({
    queryKey: ["admin", "import-jobs"],
    queryFn: async () => listJobs({}),
    refetchInterval: 60_000,
  });

  const dbOk = useQuery({
    queryKey: ["admin", "db-ping"],
    queryFn: async () => {
      const { error } = await supabase.from("movies").select("id", { count: "exact", head: true });
      return !error;
    },
    refetchInterval: 120_000,
  });

  const data = health.data;
  const metrics = data?.metrics;
  const scheduler = data?.scheduler;
  const status: HealthStatus = health.isError ? "unknown" : (data?.status ?? "unknown");

  const lastSuccess = scheduler?.lastSuccessAt ?? metrics?.lastSuccessAt ?? null;
  const nextRun = lastSuccess
    ? new Date(new Date(lastSuccess).getTime() + 24 * 3_600_000).toISOString()
    : null;

  const jobList = jobs.data ?? [];
  const latest = jobList[0];
  const latestFailed = jobList.find((j) => j.status === "failed");

  const feedStatus: HealthStatus = health.isError
    ? "unknown"
    : metrics?.lastJobStatus === "failed"
      ? "critical"
      : (data?.importStatus ?? status);
  const feedText =
    feedStatus === "healthy"
      ? "Data hentes fra kilden som forventet."
      : feedStatus === "warning"
        ? "Seneste datahentning kræver opmærksomhed."
        : feedStatus === "critical"
          ? "Data kunne ikke hentes korrekt."
          : "Der er endnu ikke data nok til at vurdere datakilden.";

  const parserStatus: HealthStatus = latest
    ? latest.status === "failed" || latest.errorCount > 0
      ? latest.status === "failed"
        ? "critical"
        : "warning"
      : "healthy"
    : "unknown";
  const parserText =
    parserStatus === "healthy"
      ? "Data blev behandlet uden fejl."
      : parserStatus === "warning"
        ? "Der opstod enkelte fejl under behandlingen af data."
        : parserStatus === "critical"
          ? "Behandlingen af data kunne ikke gennemføres."
          : "Ingen behandling er kørt endnu.";

  const schedulerStatus: HealthStatus = scheduler?.status ?? "unknown";
  const schedulerText =
    schedulerStatus === "healthy"
      ? "Den automatiske import kører efter planen."
      : schedulerStatus === "warning"
        ? "Den automatiske import er forsinket."
        : schedulerStatus === "critical"
          ? "Den automatiske import kører ikke som den skal."
          : "Den automatiske import har endnu ikke kørt.";

  const dbStatus: HealthStatus = dbOk.isLoading
    ? "unknown"
    : dbOk.data === true
      ? "healthy"
      : "critical";
  const dbText =
    dbStatus === "healthy"
      ? "Databasen svarer normalt."
      : dbStatus === "critical"
        ? "Databasen fungerer ikke korrekt."
        : "Databasens tilstand kontrolleres."; 

  const jobDuration = (j: { createdAt: string; updatedAt: string }) =>
    (new Date(j.updatedAt).getTime() - new Date(j.createdAt).getTime()) / 1000;

  const onRetry = async () => {
    if (!latestFailed) return;
    setRetrying(true);
    setActionError(null);
    try {
      const { jobId } = await retryImport({ data: { jobId: latestFailed.id } });
      navigate({ to: "/admin/import/$jobId", params: { jobId } });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Handlingen kunne ikke gennemføres.");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <AdminShell title="Data Pipeline">
      <div className="mx-auto max-w-4xl">
      <p className="mb-8 text-sm text-muted-foreground">
        Overblik over dataopdateringer af film, biografer og forestillinger.
      </p>

      {/* 1 — Nuværende status */}
      <section className="mb-10">
        <SectionTitle>Nuværende status</SectionTitle>
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center gap-3">
              <span aria-hidden className={`h-3 w-3 rounded-full ${STATUS_DOT[status]}`} />
              <h3 className={`font-display text-xl font-semibold ${STATUS_TEXT[status]}`}>
                {STATUS_HEADLINE[status]}
              </h3>
            </div>
            {!health.isError && status !== "healthy" && data?.reasons?.length ? (
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {[...new Set(data.reasons.map((r) => humanizeReason(r, lastSuccess)))].map((r) => (
                  <li key={r}>· {r}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4">
              <Row label="Datakilde" value={feedText} />
              <Row label="Automatisk import" value={schedulerText} />
              <Row label="Seneste vellykkede import" value={formatDateTime(lastSuccess)} />
              <Row label="Næste planlagte import" value={formatDateTime(nextRun)} />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 2 — Seneste import */}
      <section className="mb-10">
        <SectionTitle>Seneste import</SectionTitle>
        <Card>
          <CardContent className="py-4">
            {jobs.isLoading ? (
              <p className="py-4 text-sm text-muted-foreground">Henter oplysninger…</p>
            ) : !latest ? (
              <p className="py-4 text-sm text-muted-foreground">
                Der er endnu ikke gennemført nogen import.
              </p>
            ) : (
              <>
                <Row label="Startet" value={formatDateTime(latest.createdAt)} />
                <Row
                  label="Afsluttet"
                  value={
                    latest.status === "completed" || latest.status === "failed"
                      ? formatDateTime(latest.updatedAt)
                      : "Ikke afsluttet endnu"
                  }
                />
                <Row label="Varighed" value={formatDuration(jobDuration(latest))} />
                <Row label="Film" value={String(latest.movies)} />
                <Row label="Biografer" value={String(latest.cinemas)} />
                <Row label="Forestillinger" value={String(latest.showtimes)} />
                <Row
                  label="Advarsler"
                  value={
                    data?.reasons?.length && status === "warning"
                      ? String(new Set(data.reasons).size)
                      : "0"
                  }
                />
                <Row label="Fejl" value={String(latest.errorCount)} />
                <Row
                  label="Status"
                  muted
                  value={JOB_STATUS_LABEL[latest.status] ?? latest.status}
                />
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* 3 — Manuelle handlinger */}
      <section className="mb-10">
        <SectionTitle>Manuelle handlinger</SectionTitle>
        <Card>
          <CardContent className="py-5">
            <p className="text-sm text-muted-foreground">
              Data opdateres automatisk hver dag. Brug kun handlingerne nedenfor, hvis noget er gået
              galt.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                to="/admin/import"
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                Start manuel import
              </Link>
              {latestFailed ? (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retrying}
                  className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
                >
                  {retrying ? "Genstarter…" : "Prøv seneste fejlede import igen"}
                </button>
              ) : (
                <span className="rounded-md border border-border/50 px-4 py-2 text-sm text-muted-foreground/50">
                  Ingen fejlede importer at gentage
                </span>
              )}
            </div>
            {actionError ? (
              <p className="mt-3 text-sm text-destructive">{actionError}</p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {/* 4 — Importhistorik */}
      <section className="mb-10">
        <SectionTitle>Importhistorik</SectionTitle>
        <Card>
          <CardContent className="py-2">
            {jobs.isLoading ? (
              <p className="py-4 text-sm text-muted-foreground">Henter historik…</p>
            ) : jobList.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">Ingen importer registreret endnu.</p>
            ) : (
              <ul>
                {jobList.map((j) => (
                  <li key={j.id} className="border-b border-border/50 last:border-0">
                    <Link
                      to="/admin/import/$jobId"
                      params={{ jobId: j.id }}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 transition-colors hover:text-foreground"
                    >
                      <span className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className={`h-2.5 w-2.5 rounded-full ${
                            j.status === "completed"
                              ? "bg-emerald-500"
                              : j.status === "failed"
                                ? "bg-destructive"
                                : j.status === "running"
                                  ? "bg-amber-500"
                                  : "bg-muted-foreground"
                          }`}
                        />
                        <span className="text-sm text-foreground">
                          {formatDateTime(j.createdAt)}
                        </span>
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {JOB_STATUS_LABEL[j.status] ?? j.status} · {formatDuration(jobDuration(j))} ·{" "}
                        {j.movies} film · {j.showtimes} forestillinger
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* 5 — Pipelinens tilstand */}
      <section>
        <SectionTitle>Pipelinens tilstand</SectionTitle>
        <Card>
          <CardContent className="py-2">
            <StatusLine label="Datakilde" status={feedStatus} description={feedText} />
            <StatusLine label="Databehandling" status={parserStatus} description={parserText} />
            <StatusLine label="Database" status={dbStatus} description={dbText} />
            <StatusLine
              label="Automatisk import"
              status={schedulerStatus}
              description={schedulerText}
            />
          </CardContent>
        </Card>
      </section>
      </div>
    </AdminShell>
  );
}
