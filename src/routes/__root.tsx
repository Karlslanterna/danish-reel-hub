import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import {
  reportLovableError,
  initClientErrorMonitor,
  setMonitoringUser,
} from "../lib/lovable-error-reporting";
import { FiltersProvider } from "../lib/filters";
import { LanguageProvider } from "../lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { trackAnalyticsEvent } from "@/lib/analytics";

const FILTER_STORAGE_KEY = "lanterna.filters.v1";

/**
 * Exact geolocation must never be reused across full page loads. Older builds
 * persisted `userLoc` indefinitely, so one stale coordinate could make every
 * finite radius look empty on one device while incognito/new devices worked.
 *
 * Run this synchronously before FiltersProvider mounts: preserve the harmless
 * filter preferences, but force distance back to its neutral state and make the
 * next distance interaction ask the browser for a current position.
 */
function discardPersistedGeolocation() {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    if (!("userLoc" in parsed) && parsed.radius === "all") return;
    delete parsed.userLoc;
    parsed.radius = "all";
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // FiltersProvider already treats malformed persisted state as empty.
  }
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lanterna — Find film og spilletider i Danmark" },
      {
        name: "description",
        content:
          "Opdag film, se spilletider og find din nærmeste biograf i København, Aarhus, Odense og Aalborg.",
      },
      { name: "application-name", content: "Lanterna" },
      { name: "theme-color", content: "#f5c445" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Lanterna" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Josefin+Sans:wght@400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="da" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  // This is intentionally synchronous. FiltersProvider reads localStorage in
  // its first client effect, so stale coordinates must be removed beforehand.
  discardPersistedGeolocation();

  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigating = useRouterState({ select: (state) => state.status === "pending" });

  useEffect(() => {
    initClientErrorMonitor();
    supabase.auth.getSession().then(({ data }) => {
      setMonitoringUser(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setMonitoringUser(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (pathname.startsWith("/admin") || pathname.startsWith("/api/")) return;
    trackAnalyticsEvent({ eventType: "page_view", path: pathname });
  }, [pathname]);

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className={`fixed inset-x-0 top-0 z-[100] h-1 overflow-hidden bg-primary/20 transition-opacity ${
          navigating ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        role="progressbar"
        aria-label="Åbner siden"
        aria-hidden={!navigating}
      >
        <div className="h-full w-2/3 animate-pulse bg-primary" />
      </div>
      <LanguageProvider>
        <FiltersProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </FiltersProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
