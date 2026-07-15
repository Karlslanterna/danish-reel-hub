import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function SiteHeader() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (isMounted) setIsAuthenticated(Boolean(data.user));
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setIsAuthenticated(false);
        return;
      }
      setIsAuthenticated(Boolean(session?.user));
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-8">
        <Link to="/" className="flex items-center gap-3">
          <img src="/logo.svg" alt="Lanterna" width={32} height={32} className="h-8 w-8" />
          <span className="font-display text-lg font-bold tracking-tight">Lanterna - Danmarks nye biografportal</span>
        </Link>
        <nav className="flex items-center gap-7 text-sm text-muted-foreground">
          {isAuthenticated ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-block rounded-sm border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-secondary"
            >
              Log ud
            </button>
          ) : (
            <Link to="/auth" className="inline-block rounded-sm border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-secondary">
              Log ind
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
