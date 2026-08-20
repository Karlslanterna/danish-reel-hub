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

export type CardPosterSources = {
  src?: string;
  srcSet?: string;
};

/**
 * Homepage/card posters do not need TMDb's 500 px asset. On a two-column mobile
 * grid a 342 px source is already around 2 CSS pixels per displayed pixel, and
 * capping the card srcset prevents a high-DPR phone from downloading the much
 * heavier w500 image for every near-viewport card. Detail pages keep their
 * original source because they do not pass card `sizes` to Poster.
 */
export function cardPosterSources(url: string | null | undefined): CardPosterSources {
  const value = toHttpsUrl(url);
  if (!value) return {};

  try {
    const parsed = new URL(value);
    if (parsed.hostname !== "image.tmdb.org") return { src: value };

    const match = parsed.pathname.match(/^\/t\/p\/(?:w\d+|original)(\/.+)$/u);
    if (!match) return { src: value };

    const variant = (width: 185 | 342) => {
      const next = new URL(parsed.toString());
      next.pathname = `/t/p/w${width}${match[1]}`;
      return next.toString();
    };
    const w185 = variant(185);
    const w342 = variant(342);
    return {
      src: w342,
      srcSet: `${w185} 185w, ${w342} 342w`,
    };
  } catch {
    return { src: value };
  }
}

/** Known eBillet placeholders are not film artwork and should never be rendered. */
export function isPlaceholderPosterUrl(url: string | null | undefined): boolean {
  const value = toHttpsUrl(url)?.toLowerCase();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "admin.ebillet.dk" && /^\/teamposters\/?$/u.test(parsed.pathname)) {
      return true;
    }
    return (
      parsed.hostname === "poster.ebillet.dk" &&
      /^\/plakat\.(?:small|large|hd)\.jpg$/u.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}
