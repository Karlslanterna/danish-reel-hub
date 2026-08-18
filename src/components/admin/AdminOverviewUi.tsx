/* eslint-disable react-refresh/only-export-components */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminGetOverview, type AdminOverview } from "@/lib/admin-overview.functions";

export const number = (value: number) => new Intl.NumberFormat("da-DK").format(value);

export const dateTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )
    : "—";

export const stateLabel = (value: string | null) =>
  ({
    completed: "Gennemført",
    failed: "Fejlet",
    queued: "Venter",
    running: "Kører",
  })[value ?? ""] ??
  value ??
  "Ukendt";

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin", "overview", "v2"],
    queryFn: () => adminGetOverview(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function AdminDataState({
  query,
  children,
}: {
  query: ReturnType<typeof useAdminOverview>;
  children: (data: AdminOverview) => React.ReactNode;
}) {
  if (query.isLoading)
    return <div className="py-16 text-center text-sm text-muted-foreground">Henter aktuelle data…</div>;
  if (query.isError || !query.data)
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-8 text-sm text-destructive">
          Admin-data kunne ikke hentes. Prøv at genindlæse siden.
        </CardContent>
      </Card>
    );
  return <>{children(query.data)}</>;
}

export function StatusBadge({ status }: { status: "healthy" | "warning" | "critical" }) {
  const config = {
    healthy: {
      label: "Alt ser godt ud",
      icon: CheckCircle2,
      className: "bg-emerald-500/10 text-emerald-600",
    },
    warning: {
      label: "Kræver opmærksomhed",
      icon: AlertTriangle,
      className: "bg-amber-500/10 text-amber-600",
    },
    critical: {
      label: "Kræver handling",
      icon: CircleX,
      className: "bg-destructive/10 text-destructive",
    },
  }[status];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${config.className}`}>
      <Icon className="h-4 w-4" />
      {config.label}
    </span>
  );
}

export function Metric({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-2 font-display text-3xl font-semibold text-foreground">{value}</p>
        {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
      </CardContent>
    </Card>
  );
}

export function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function SimpleList({ items, empty = "Ingen data endnu." }: { items: Array<{ label: string; value: number }>; empty?: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="divide-y divide-border/60">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
          <span className="min-w-0 truncate text-foreground">{item.label}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{number(item.value)}</span>
        </div>
      ))}
    </div>
  );
}
