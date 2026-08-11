import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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

const STATUS_LABEL: Record<HealthStatus, string> = {
  healthy: "Alle systemer kører normalt",
  warning: "Advarsel",
  critical: "Kritisk",
  unknown: "Status ukendt",
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

const STATUS_SENTENCE: Record<HealthStatus, string> = {
  healthy: "Alle systemer fungerer normalt.",
  warning: "Seneste import kræver opmærksomhed.",
  critical: "Importpipelinen fejler og kræver handling nu.",
  unknown: "Der er endnu ikke nok data til at vurdere systemets tilstand.",
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

/** Turn backend (English, technical) reasons into readable Danish sentences. */
function humanizeReason(reason: string, lastSuccessAt: string | null): string {
  const r = reason.toLowerCase();
  if (r.includes("last success was")) {
    return lastSuccessAt
      ? `Seneste vellykkede import blev gennemført ${formatDateTime(lastSuccessAt)}.`
      : "Der er endnu ingen vellykket import.";
  }
  if (r.includes("no successful import")) return "Der er endnu ingen vellykket import.";
  if (r.includes("scheduler has never run")) return "Den automatiske import har endnu ikke kørt.";
  if (r.includes("scheduler has no successful run"))
    return "Den automatiske import har endnu ikke gennemført en kørsel.";
  if (r.includes("last scheduled import succeeded")) {
    return lastSuccessAt
      ? `Seneste automatiske import blev gennemført ${formatDateTime(lastSuccessAt)}.`
      : "Den automatiske import mangler en nylig gennemførsel.";
  }
  if (r.includes("last scheduled run failed")) return "Seneste automatiske kørsel gik galt.";
  if (r.includes("consecutive failed scheduled runs"))
    return "Flere automatiske kørsler i træk er gået galt.";
  if (r.includes("consecutive failed import")) return "Flere importkørsler i træk er gået galt.";
  if (r.includes("zero movies")) return "Seneste import hentede ingen film.";
  if (r.includes("zero cinemas")) return "Seneste import hentede ingen biografer.";
  if (r.includes("zero showtimes")) return "Seneste import hentede ingen forestillinger.";
  if (r.includes("movie count dropped")) return "Antallet af film faldt markant ved seneste import.";
  if (r.includes("cinema count dropped"))
    return "Antallet af biografer faldt markant ved seneste import.";
  if (r.includes("showtime count dropped"))
    return "Antallet af forestillinger faldt markant ved seneste import.";
  if (r.includes("import took")) return "Seneste import tog usædvanligt lang tid.";
  if (r.includes("no import jobs")) return "Der er endnu ikke kørt nogen import.";
  if (r.includes("all checks passed") || r.includes("scheduler healthy"))
    return "Alle kontroller er bestået.";
  if (r.includes("failed to read scheduler runs"))
    return "Oplysninger om automatiske kørsler kunne ikke hentes.";
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
        <p className="mt-2 font-display text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
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


function AdminDashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "import-health"],
    queryFn: async (): Promise<HealthPayload> => {
      const res = await fetch("/api/public/import-health", { cache: "no-store" });
      return (await res.json()) as HealthPayload;
    },
    refetchInterval: 60_000,
  });

  const counts = useQuery({
    queryKey: ["admin", "content-counts"],
    queryFn: async () => {
      const [movies, cinemas, showtimes] = await Promise.all([
        supabase.from("movies").select("id", { count: "exact", head: true }),
        supabase.from("cinemas").select("id", { count: "exact", head: true }),
        supabase.from("showtimes").select("id", { count: "exact", head: true }),
      ]);
      return {
        movies: movies.count ?? 0,
        cinemas: cinemas.count ?? 0,
        showtimes: showtimes.count ?? 0,
        ok: !movies.error && !cinemas.error && !showtimes.error,
      };
    },
    refetchInterval: 60_000,
  });

  const status: HealthStatus = data?.status ?? "unknown";
  const metrics = data?.metrics;
  const scheduler = data?.scheduler;

  const lastAutoSuccess = scheduler?.lastSuccessAt ?? metrics?.lastSuccessAt ?? null;
  const nextRun = lastAutoSuccess
    ? new Date(new Date(lastAutoSuccess).getTime() + 24 * 3_600_000).toISOString()
    : null;

  const currentJobStatus = metrics?.lastJobStatus
    ? (JOB_STATUS_LABEL[metrics.lastJobStatus] ?? metrics.lastJobStatus)
    : "—";

  const numberFmt = new Intl.NumberFormat("da-DK");
  const count = (n: number | undefined) =>
    counts.isLoading || n === undefined ? "—" : numberFmt.format(n);

  // Derived, human-readable component statuses (existing data only).
  const feedStatus: HealthStatus = isError
    ? "unknown"
    : metrics?.lastJobStatus === "failed"
      ? "critical"
      : (data?.importStatus ?? status);
  const feedText =
    feedStatus === "healthy"
      ? "Data fra Kultunaut hentes som forventet."
      : feedStatus === "warning"
        ? "Seneste datahentning kræver opmærksomhed."
        : feedStatus === "critical"
          ? "Data fra Kultunaut kunne ikke hentes korrekt."
          : "Der er endnu ikke data nok til at vurdere datakilden.";

  const schedulerStatus: HealthStatus = scheduler?.status ?? "unknown";
  const schedulerText =
    schedulerStatus === "healthy"
      ? "Den automatiske import kører efter planen."
      : schedulerStatus === "warning"
        ? "Den automatiske import er forsinket."
        : schedulerStatus === "critical"
          ? "Den automatiske import kører ikke som den skal."
          : "Den automatiske import har endnu ikke kørt.";

  const dbStatus: HealthStatus = counts.isLoading
    ? "unknown"
    : counts.isError || counts.data?.ok === false
      ? "critical"
      : "healthy";
  const dbText =
    dbStatus === "healthy"
      ? "Databasen svarer normalt."
      : dbStatus === "critical"
        ? "Databasen fungerer ikke korrekt."
        : "Kontrollerer forbindelsen til databasen…";

  const pipelineStatus: HealthStatus = isError ? "unknown" : status;
  const pipelineText =
    pipelineStatus === "healthy"
      ? "Datapipelinen fungerer normalt."
      : pipelineStatus === "warning"
        ? "Datapipelinen kræver opmærksomhed."
        : pipelineStatus === "critical"
          ? "Datapipelinen fejler og kræver handling."
          : "Datapipelinens tilstand kan ikke vurderes endnu.";


  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
            Lanterna Administration
          </h1>
          <p className="mt-1 text-sm uppercase tracking-[0.2em] text-muted-foreground">
            Dashboard
          </p>
        </div>
        <AdminSignOut />
      </header>

      {/* Overall system status */}
      <Card className="mb-6">
        <CardContent className="py-8">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Henter systemstatus…</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={`h-3 w-3 rounded-full ${STATUS_DOT[isError ? "unknown" : status]}`}
                />
                <h2
                  className={`font-display text-2xl font-semibold ${STATUS_TEXT[isError ? "unknown" : status]}`}
                >
                  {STATUS_LABEL[isError ? "unknown" : status]}
                </h2>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {isError
                  ? "Statusdata kunne ikke hentes."
                  : STATUS_SENTENCE[status]}
              </p>
              {!isError && status !== "healthy" && data?.reasons?.length ? (
                <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                  {data.reasons.map((r) => (
                    <li key={r}>· {r}</li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Automatic import */}
      <Card className="mb-10">
        <CardHeader>
          <CardTitle className="text-base font-medium">Automatisk import</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Row label="Seneste vellykkede import" value={formatDateTime(lastAutoSuccess)} />
          <Row label="Varighed" value={formatDuration(metrics?.lastDurationSeconds)} />
          <Row label="Næste planlagte import" value={formatDateTime(nextRun)} />
          <Row label="Nuværende importstatus" value={currentJobStatus} />
          {metrics ? (
            <Row
              label="Seneste resultat"
              muted
              value={`${metrics.lastMovies} film · ${metrics.lastCinemas} biografer · ${metrics.lastShowtimes} visninger`}
            />
          ) : null}
        </CardContent>
      </Card>

      {/* Quick actions — deliberately secondary */}
      <section>
        <h3 className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Handlinger
        </h3>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/admin/import"
            className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            Start manuel import
          </Link>
          {metrics?.lastJobId ? (
            <Link
              to="/admin/import/$jobId"
              params={{ jobId: metrics.lastJobId }}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              Se importhistorik
            </Link>
          ) : (
            <span className="rounded-md border border-border/50 px-4 py-2 text-sm text-muted-foreground/50">
              Se importhistorik
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
