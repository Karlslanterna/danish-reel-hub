/**
 * Poster URLs from the Kultunaut feed are emitted as plain `http://` links even
 * though the same host serves them fine over TLS. Loading them as-is triggers
 * mixed-content blocking in the browser, so every URL is upgraded to `https://`
 * before it reaches an <img> tag. Protocol-relative URLs are normalized too.
 *
 * No transformation is applied to the path or query, so image quality is
 * untouched.
 */
export function toHttpsUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const v = url.trim();
  if (!v) return undefined;
  if (v.startsWith("//")) return `https:${v}`;
  if (v.startsWith("http://")) return `https://${v.slice("http://".length)}`;
  return v;
}
