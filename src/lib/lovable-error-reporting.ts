/**
 * Client-side error monitoring built on Lovable's native error capture
 * (`window.__lovableEvents.captureException`). No third-party SDK, no DSN,
 * no extra network requests. See ERROR_MONITORING.md for the full design.
 */

type LovableErrorMechanism =
  | "manual"
  | "onerror"
  | "unhandledrejection"
  | "react_error_boundary"
  | "fetch"
  | "console";

type LovableErrorOptions = {
  mechanism?: LovableErrorMechanism;
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type LovableEvents = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: LovableErrorOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: LovableEvents;
    __lovableMonitorInstalled?: boolean;
  }
}

// ---------- PII scrubbing ----------
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Long opaque tokens (JWTs, API keys). Keep short numbers/IDs untouched.
const TOKEN_RE = /\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{40,})\b/g;

function scrub(value: string): string {
  return value.replace(EMAIL_RE, "[email]").replace(TOKEN_RE, "[token]");
}

function scrubError(error: unknown): unknown {
  if (error instanceof Error) {
    try {
      error.message = scrub(error.message);
    } catch {
      /* frozen error — ignore */
    }
    return error;
  }
  if (typeof error === "string") return scrub(error);
  return error;
}

function scrubContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = typeof v === "string" ? scrub(v) : v;
  }
  return out;
}

// ---------- User + release context ----------
let currentUserId: string | null = null;

export function setMonitoringUser(userId: string | null) {
  currentUserId = userId;
}

const RELEASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_APP_RELEASE) ||
  "dev";

const ENVIRONMENT =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string | undefined> }).env?.MODE) ||
  "production";

function baseContext(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    release: RELEASE,
    environment: ENVIRONMENT,
  };
  if (typeof window !== "undefined") {
    ctx.route = window.location.pathname;
    ctx.userAgent = window.navigator.userAgent;
    ctx.platform = window.navigator.platform;
    ctx.viewport = `${window.innerWidth}x${window.innerHeight}`;
  }
  if (currentUserId) ctx.userId = currentUserId;
  return ctx;
}

// ---------- Reporting ----------
export function reportLovableError(
  error: unknown,
  context: Record<string, unknown> = {},
  options: LovableErrorOptions = {},
) {
  if (typeof window === "undefined") return;
  const scrubbedError = scrubError(error);
  const merged = scrubContext({ ...baseContext(), source: "manual", ...context });
  window.__lovableEvents?.captureException?.(scrubbedError, merged, {
    mechanism: options.mechanism ?? "manual",
    handled: options.handled ?? true,
    severity: options.severity ?? "error",
  });
}

// ---------- Ignore list ----------
// Noisy, non-actionable browser errors we intentionally drop.
const IGNORED_MESSAGES = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  "Non-Error promise rejection captured",
  // Browser extensions & injected scripts
  "Script error.",
  "Load failed", // Safari network cancel
];

function shouldIgnore(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return IGNORED_MESSAGES.some((m) => msg.includes(m));
}

// ---------- Global install ----------
export function initClientErrorMonitor() {
  if (typeof window === "undefined") return;
  if (window.__lovableMonitorInstalled) return;
  window.__lovableMonitorInstalled = true;

  window.addEventListener("error", (event) => {
    const err = event.error ?? new Error(event.message || "Unknown error");
    if (shouldIgnore(err)) return;
    reportLovableError(
      err,
      { filename: event.filename, lineno: event.lineno, colno: event.colno },
      { mechanism: "onerror", handled: false },
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason ?? new Error("Unhandled rejection");
    if (shouldIgnore(reason)) return;
    reportLovableError(reason, {}, { mechanism: "unhandledrejection", handled: false });
  });

  // Wrap fetch to capture network failures + 5xx responses.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const input = args[0];
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : "";
    try {
      const res = await originalFetch(...(args as Parameters<typeof fetch>));
      if (res.status >= 500) {
        reportLovableError(
          new Error(`HTTP ${res.status} on ${new URL(url, window.location.origin).pathname}`),
          { fetchUrl: new URL(url, window.location.origin).pathname, status: res.status },
          { mechanism: "fetch", handled: true, severity: "warning" },
        );
      }
      return res;
    } catch (err) {
      if (!shouldIgnore(err)) {
        reportLovableError(
          err,
          { fetchUrl: url },
          { mechanism: "fetch", handled: false },
        );
      }
      throw err;
    }
  };
}
