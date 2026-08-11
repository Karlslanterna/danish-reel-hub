import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function isSafeNext(next: string | undefined): next is string {
  return !!next && next.startsWith("/") && !next.startsWith("//");
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Lanterna Administration" },
      { name: "robots", content: "noindex, follow" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      throw redirect({ href: isSafeNext(search.next) ? search.next : "/" });
    }
  },
  component: AuthPage,
});

function AuthPage() {
  const { next } = Route.useSearch();
  const safeNext = isSafeNext(next) ? next : "/";
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    window.location.href = safeNext;
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth${
        safeNext !== "/" ? `?next=${encodeURIComponent(safeNext)}` : ""
      }`,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setInfo("Tjek din e-mail for et link til at nulstille din adgangskode.");
    setBusy(false);
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
            <p className="mt-1 text-sm font-medium text-primary">Administrator-login</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Log ind med din administratorkonto for at administrere Lanterna.
            </p>
          </div>

          <form
            onSubmit={mode === "signin" ? handleSignIn : handleReset}
            className="flex w-full flex-col gap-4"
          >
            <label className="flex flex-col gap-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
              E-mail
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 rounded-md border border-border bg-card px-3 font-sans text-sm text-foreground focus:border-primary/60 focus:outline-none"
              />
            </label>

            {mode === "signin" && (
              <label className="flex flex-col gap-1.5 text-xs uppercase tracking-[0.15em] text-muted-foreground">
                Adgangskode
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-md border border-border bg-card px-3 font-sans text-sm text-foreground focus:border-primary/60 focus:outline-none"
                />
              </label>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-muted-foreground">{info}</p>}

            <button
              type="submit"
              disabled={busy}
              className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {mode === "signin" ? "Log ind" : "Send nulstillingslink"}
            </button>
          </form>

          {mode === "signin" ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setInfo(null);
                setMode("reset");
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Glemt adgangskode?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setInfo(null);
                setMode("signin");
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Tilbage til login
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
