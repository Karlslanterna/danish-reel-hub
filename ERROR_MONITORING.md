# Error Monitoring

## Recommendation

**Use Lovable's built-in error capture (`window.__lovableEvents.captureException`).**

Reviewed alternatives (Sentry, Rollbar, Bugsnag). All require a paid DSN,
a third-party SDK (~40–70 KB), extra network requests on every error, and a
separate account for the user. Lanterna already runs on Lovable, and every
Lovable project ships a native error sink that is surfaced in the Lovable
dashboard's Error Monitoring view. Building on it means:

- Zero new dependencies, zero bundle-size cost.
- No DSN/secret to rotate.
- Errors land in the same dashboard the user already uses.
- Server errors already flow through `console.error` → worker logs.

## What was implemented

### Client (`src/lib/lovable-error-reporting.ts`)

- `initClientErrorMonitor()` installs, exactly once:
  - `window.addEventListener("error", ...)` — uncaught runtime errors.
  - `window.addEventListener("unhandledrejection", ...)` — unhandled promises.
  - A `window.fetch` wrapper that reports network failures and `>=500`
    responses (as warnings for 5xx, errors for thrown network failures).
- `setMonitoringUser(userId)` — kept in sync with Supabase auth via
  `onAuthStateChange` in `__root.tsx`. Only the opaque user UUID is sent;
  no email, no name.
- `reportLovableError(error, context, options)` — manual reporting helper
  used by the root `errorComponent` (React render errors).
- PII scrubber removes email addresses and long opaque tokens (JWTs / API
  keys) from error messages and string context values before send.

### Server (`src/server.ts`, `src/start.ts`)

- `src/server.ts` catch block logs structured `{ route, method }` context
  alongside the error via `console.error("[server:fetch]", ..., error)`.
- `src/start.ts` `errorMiddleware` already logs uncaught request-middleware
  and server-function errors through `console.error`, which the platform
  ingests into worker logs.
- `src/lib/error-capture.ts` captures out-of-band errors that h3 swallows
  into generic 500 responses, so the original stack still reaches logs.

### Route-level

- Root `errorComponent` in `src/routes/__root.tsx` reports React render
  errors via `reportLovableError(error, { boundary: "tanstack_root_error_component" })`.
- Route loader errors bubble up to this boundary automatically.

### Context sent with every event

- `route` — `window.location.pathname` (client) / request pathname (server).
- `userAgent`, `platform`, `viewport` — browser / OS info from `navigator`.
- `release` — `import.meta.env.VITE_APP_RELEASE` (falls back to `"dev"`).
- `environment` — `import.meta.env.MODE` (`development` / `production`).
- `userId` — Supabase auth UUID when signed in. Never email or name.

### Source maps

Vite (via `@lovable.dev/vite-tanstack-config`) emits source maps in its
default production build; no config change needed. Stack traces in the
Lovable dashboard resolve to original source lines automatically.

## Which errors are captured

| Category | Sink | Mechanism |
|---|---|---|
| Uncaught client errors | Lovable capture | `window.onerror` |
| Unhandled promise rejections | Lovable capture | `unhandledrejection` |
| React render errors | Lovable capture | root `errorComponent` |
| Route loader / action errors | Lovable capture | root `errorComponent` (they bubble) |
| Failed `fetch` (network / 5xx) | Lovable capture | `fetch` wrapper |
| Uncaught server errors (SSR, routes, server fns) | Worker logs | `console.error` in `server.ts` + `start.ts` |
| h3-swallowed SSR errors | Worker logs | `error-capture.ts` + `normalizeCatastrophicSsrResponse` |

## Intentionally ignored

Dropped in the client (noisy, non-actionable):

- `ResizeObserver loop limit exceeded` / `... undelivered notifications` — benign browser warning.
- `Script error.` — cross-origin scripts with no stack; typically browser extensions.
- `Load failed` (Safari) — user-cancelled/aborted requests.
- `Non-Error promise rejection captured` — no diagnostic value.
- Fetch responses `<500` — treated as normal application flow, not errors.
- Fetch `AbortError` (thrown network) is scrubbed via the ignore list where it matches.

Not captured by design:

- PII: emails and long opaque tokens are stripped from messages/context.
- No user email, name, or IP is ever attached — only the auth UUID.

## How to verify

Open the deployed site and paste each snippet in the browser DevTools console.
Each should appear in Lovable → Error Monitoring within seconds.

1. **Uncaught error**
   ```js
   setTimeout(() => { throw new Error("test: uncaught error"); }, 0);
   ```

2. **Unhandled rejection**
   ```js
   Promise.reject(new Error("test: unhandled rejection"));
   ```

3. **Failed fetch (network)**
   ```js
   fetch("https://this-host-does-not-exist.invalid/x").catch(() => {});
   ```

4. **Failed fetch (5xx)** — hit any server route that will 500, or use a mock.

5. **React render error** — temporarily add `throw new Error("render")` inside
   a route component; the root `errorComponent` renders and the error is
   reported. Revert.

6. **Server error** — inspect worker logs after any server-side crash; they
   include the `[server:fetch] { route, method }` prefix.

7. **User context** — sign in, trigger any of the above, and confirm the
   captured event includes `userId` (UUID only, no email).

Confirm in each event:
- `route`, `userAgent`, `platform`, `viewport`, `release`, `environment` are present.
- `userId` is present only when signed in and is a UUID.
- No email addresses or long tokens appear in the message or context.
