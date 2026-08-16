// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

// A client that navigates away / reloads mid-request aborts the socket. Node
// surfaces that as `Error: aborted` from _http_server. Nobody is left to
// receive a response, so it is never an app error — drop it at capture time.
function isClientAbort(error: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = error;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { code?: string; name?: string; message?: string; cause?: unknown };
    if (
      e.code === "ECONNRESET" ||
      e.code === "ECONNABORTED" ||
      e.name === "AbortError" ||
      e.message === "aborted" ||
      e.message === "The operation was aborted."
    ) {
      return true;
    }
    cur = e.cause;
  }
  return false;
}

function record(error: unknown) {
  if (isClientAbort(error)) return;
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

// Node's HTTP server emits `Error: aborted` as an uncaught exception when the
// browser closes the socket mid-render. Swallow only that exact case.
const proc = (globalThis as { process?: NodeJS.Process }).process;
if (proc && typeof proc.on === "function") {
  proc.on("uncaughtException", (error: unknown) => {
    if (isClientAbort(error)) return;
    record(error);
    console.error(error);
  });
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
