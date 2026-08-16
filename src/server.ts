import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// A client that navigates away / reloads mid-render aborts the socket. h3 turns
// that into the same "unhandled HTTPError" 500, but it is not an app error —
// nobody is left to receive the response, so it must not be reported.
function isClientAbort(error: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = error;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { code?: string; name?: string; message?: string; cause?: unknown };
    if (e.code === "ECONNRESET" || e.name === "AbortError" || e.message === "aborted") return true;
    cur = e.cause;
  }
  return false;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const captured = consumeLastCapturedError();
  if (request.signal.aborted || isClientAbort(captured)) return response;

  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}


// Paths whose responses should never be indexed by search engines.
// HTML pages (auth, admin) set noindex via <meta>; these prefixes cover
// non-HTML responses (API + MCP + well-known) where meta tags don't apply.
const NOINDEX_PATH_PREFIXES = ["/api/", "/mcp", "/.mcp/", "/.well-known/"];
function shouldNoindex(pathname: string): boolean {
  if (pathname === "/mcp") return true;
  return NOINDEX_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

function withNoindexHeader(response: Response, pathname: string): Response {
  if (!shouldNoindex(pathname)) return response;
  if (response.headers.has("x-robots-tag")) return response;
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const pathname = new URL(request.url).pathname;
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return withNoindexHeader(normalized, pathname);
    } catch (error) {
      console.error("[server:fetch]", { route: pathname, method: request.method }, error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
