import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Lanterna Administration" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setHasSession(!!data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setHasSession(!!session);
      setReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Adgangskoderne er ikke ens.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    await supabase.auth.signOut();
    setDone(true);
    setBusy(false);
    setTimeout(() => {
      navigate({ to: "/auth", search: { next: "/admin" } });
    }, 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-6">
          <img src="/logo.svg" alt="Lanterna" width={48} height={48} className="h-12 w-12" />

          <div className="text-center">
            <h1 className="font-hero text-2xl font-semibold tracking-tight text-foreground">
              Lanterna Administration
            </h1>
            <p className="mt-1 text-sm font-medium text-primary">Ny adgangskode</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Vælg en ny adgangskode til din administratorkonto.
            </p>
          </div>

          {!ready ? (
            <p className="text-sm text-muted-foreground">Indlæser…</p>
          ) : done ? (
            <p className="text-sm text-muted-foreground">
              Din adgangskode er opdateret. Du sendes til login…
            </p>
          ) : !hasSession ? (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-destructive">
                Linket er udløbet eller ugyldigt. Bed om et nyt nulstillingslink.
              </p>
              <button
                type="button"
                onClick={() => navigate({ to: "/auth", search: { next: "/admin" } })}
                className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Tilbage til login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                Ny adgangskode
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-md border border-border bg-card px-3 font-sans text-sm text-foreground focus:border-primary/60 focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                Gentag adgangskode
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-11 rounded-md border border-border bg-card px-3 font-sans text-sm text-foreground focus:border-primary/60 focus:outline-none"
                />
              </label>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                Gem ny adgangskode
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
