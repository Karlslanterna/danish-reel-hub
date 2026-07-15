import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  checkIsAdmin,
  adminGetImportJobStatus,
  adminProcessImportJob,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/import_/$jobId")({
  head: () => ({
    meta: [
      { title: "Import status — Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async ({ location }) => {
    const { isAdmin } = await checkIsAdmin();
    if (!isAdmin) {
      throw redirect({
        to: "/auth",
        search: { next: location.pathname + location.searchStr },
      });
    }
  },
  component: ImportStatusPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-destructive">{(error as Error)?.message ?? "Fejl"}</p>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <p>Import-job ikke fundet.</p>
    </div>
  ),
});

type JobStatus = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  phase: string;
  total_movies: number;
  total_cinemas: number;
  total_showtimes: number;
  processed_movies: number;
  processed_cinemas: number;
  processed_showtimes: number;
  errors: string[];
  message: string | null;
  created_at: string;
  updated_at: string;
};

function ImportStatusPage() {
  const { jobId } = Route.useParams();
  const getStatus = useServerFn(adminGetImportJobStatus);
  const processOne = useServerFn(adminProcessImportJob);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const processingRef = useRef(false);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    const loop = async () => {
      try {
        const initial = (await getStatus({ data: { jobId } })) as JobStatus;
        setJob(initial);
        setFatal(null);
        if (initial.status === "completed" || initial.status === "failed") return;

        while (!stoppedRef.current) {
          if (processingRef.current) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          processingRef.current = true;
          try {
            const result = (await processOne({ data: { jobId } })) as {
              done: boolean;
              status: string;
              phase: string;
            };
            const next = (await getStatus({ data: { jobId } })) as JobStatus;
            setJob(next);
            if (result.done || next.status === "completed" || next.status === "failed") {
              return;
            }
          } finally {
            processingRef.current = false;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch (err) {
        setFatal(err instanceof Error ? err.message : "Ukendt fejl");
      }
    };

    loop();

    const poll = window.setInterval(async () => {
      try {
        const s = (await getStatus({ data: { jobId } })) as JobStatus;
        setJob(s);
        if (s.status === "completed" || s.status === "failed") {
          stoppedRef.current = true;
          window.clearInterval(poll);
        }
      } catch {
        /* ignore transient */
      }
    }, 2000);

    return () => {
      stoppedRef.current = true;
      window.clearInterval(poll);
    };
  }, [jobId, getStatus, processOne]);

  const statusColor =
    job?.status === "completed"
      ? "text-green-600"
      : job?.status === "failed"
        ? "text-destructive"
        : job?.status === "running"
          ? "text-blue-600"
          : "text-muted-foreground";

  const pct = (done: number, total: number) =>
    total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wider text-muted-foreground">
            Admin · Import
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-foreground">
            Job {jobId.slice(0, 8)}…
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin/import">Ny import</Link>
        </Button>
      </header>

      {fatal && (
        <Card className="mb-6 border-destructive">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">{fatal}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Status: <span className={statusColor}>{job?.status ?? "loading…"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Fase: <span className="font-mono">{job?.phase ?? "—"}</span>
            {job?.message ? ` · ${job.message}` : ""}
          </p>

          <ProgressBlock
            label="Film"
            done={job?.processed_movies ?? 0}
            total={job?.total_movies ?? 0}
            pct={pct(job?.processed_movies ?? 0, job?.total_movies ?? 0)}
          />
          <ProgressBlock
            label="Biografer"
            done={job?.processed_cinemas ?? 0}
            total={job?.total_cinemas ?? 0}
            pct={pct(job?.processed_cinemas ?? 0, job?.total_cinemas ?? 0)}
          />
          <ProgressBlock
            label="Visninger"
            done={job?.processed_showtimes ?? 0}
            total={job?.total_showtimes ?? 0}
            pct={pct(job?.processed_showtimes ?? 0, job?.total_showtimes ?? 0)}
          />
        </CardContent>
      </Card>

      {job && job.errors.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Fejl ({job.errors.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 rounded border border-border bg-muted/30 p-3">
              {job.errors.map((e, i) => (
                <li key={i} className="font-mono text-xs text-destructive">
                  {e}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ProgressBlock({
  label,
  done,
  total,
  pct,
}: {
  label: string;
  done: number;
  total: number;
  pct: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="font-mono text-muted-foreground">
          {done} / {total} ({pct}%)
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}
