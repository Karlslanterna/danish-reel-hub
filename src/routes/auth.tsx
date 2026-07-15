import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { SiteHeader } from "@/components/SiteHeader";

function isSafeNext(next: string | undefined): next is string {
  return !!next && next.startsWith("/") && !next.startsWith("//");
}

export const Route = createFileRoute("/auth")({
  ssr: false,
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
  const navigate = useNavigate();
  const safeNext = isSafeNext(next) ? next : "/";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        window.location.href = safeNext;
      }
    });
    return () => data.subscription.unsubscribe();
  }, [safeNext]);

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth${
        safeNext !== "/" ? `?next=${encodeURIComponent(safeNext)}` : ""
      }`,
    });
    if (result.error) {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    window.location.href = safeNext;
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      window.location.href = safeNext;
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth${
            safeNext !== "/" ? `?next=${encodeURIComponent(safeNext)}` : ""
          }`,
        },
      });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      setInfo("Tjek din e-mail for et bekræftelseslink.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <div>
          <h1 className="font-display text-3xl tracking-tight">
            {mode === "signin" ? "Log ind" : "Opret konto"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Log ind for at forbinde eksterne AI-klienter til Lanterna.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={handleGoogle}
          className="flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-secondary disabled:opacity-60"
        >
          Fortsæt med Google
        </button>

        <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          eller
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleEmail} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.15em] text-muted-foreground">
            E-mail
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-md border border-border bg-card px-3 font-sans text-sm text-foreground focus:border-primary/60 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.15em] text-muted-foreground">
            Adgangskode
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-md border border-border bg-card px-3 font-sans text-sm text-foreground focus:border-primary/60 focus:outline-none"
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}
          <button
            type="submit"
            disabled={busy}
            className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {mode === "signin" ? "Log ind" : "Opret konto"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setInfo(null);
            setMode(mode === "signin" ? "signup" : "signin");
          }}
          className="text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "Ny her? Opret konto" : "Har du en konto? Log ind"}
        </button>

        <button
          type="button"
          onClick={() => navigate({ to: "/" })}
          className="text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          ← Tilbage til forsiden
        </button>
      </main>
    </div>
  );
}
