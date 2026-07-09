import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type OauthDetails = {
  client?: { name?: string; client_uri?: string };
  redirect_url?: string;
  redirect_to?: string;
  scope?: string;
  scopes?: string[];
};

// Local typed wrapper — the auth.oauth namespace is beta.
type OauthNs = {
  getAuthorizationDetails: (id: string) => Promise<{ data: OauthDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: OauthDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: OauthDetails | null; error: { message: string } | null }>;
};
function oauth(): OauthNs {
  return (supabase.auth as unknown as { oauth: OauthNs }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md px-6 py-16 text-sm text-foreground">
      Kunne ikke indlæse denne autorisationsanmodning:{" "}
      {String((error as Error)?.message ?? error)}
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientName = details?.client?.name ?? "en ekstern klient";
  const scopes = details?.scopes ?? (details?.scope ? details.scope.split(" ") : []);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("Ingen redirect returneret af autorisationsserveren.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="font-display text-2xl tracking-tight">
          Forbind {clientName} til Lanterna
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Dette tillader {clientName} at bruge Lanternas værktøjer som dig.
          Det omgår ikke appens rettigheder eller backend-politikker.
        </p>
      </div>

      {scopes.length > 0 && (
        <ul className="rounded-md border border-border bg-card p-4 text-xs text-muted-foreground">
          {scopes.map((s: string) => (
            <li key={s} className="font-mono">{s}</li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(true)}
          className="h-11 flex-1 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          Godkend
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(false)}
          className="h-11 flex-1 rounded-md border border-border px-4 text-sm font-medium hover:bg-secondary disabled:opacity-60"
        >
          Afvis
        </button>
      </div>
    </main>
  );
}
