// Canonical URL helper. Production host is fixed to https://lanterna.dk so
// that when the custom domain is connected no SEO changes are required.
export const CANONICAL_HOST = "https://lanterna.dk";

/**
 * Build a canonical URL for the given path. Strips query strings and
 * fragments, collapses duplicate slashes, and ensures a leading slash.
 * Never returns a trailing slash except for the root ("/").
 */
export function canonicalUrl(path: string): string {
  const clean = (path || "/").split("?")[0].split("#")[0];
  const normalized = ("/" + clean).replace(/\/+/g, "/");
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, "") : "/";
  return `${CANONICAL_HOST}${trimmed}`;
}
