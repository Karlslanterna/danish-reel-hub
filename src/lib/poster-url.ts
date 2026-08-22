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
  fallbackSrc?: string;
};

/**
 * Homepage/card posters do not need the largest source assets. On a two-column
 * mobile grid a ~350 px source is already around 2 CSS pixels per displayed
 * pixel. Cap TMDb at w342 and prefer eBillet's `large` variant over the stored
 * `hd` file; retain the original eBillet URL as an error fallback in case an
 * upstream poster is missing that standard derivative.
 */
export function cardPosterSources(url: string | null | undefined): CardPosterSources {
  const value = toHttpsUrl(url);
  if (!value) return {};

  try {
    const parsed = new URL(value);
    if (parsed.hostname === "image.tmdb.org") {
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
    }

    if (parsed.hostname === "poster.ebillet.dk" && /\.hd\.jpg$/u.test(parsed.pathname)) {
      const compact = new URL(parsed.toString());
      compact.pathname = compact.pathname.replace(/\.hd\.jpg$/u, ".large.jpg");
      return { src: compact.toString(), fallbackSrc: value };
    }

    return { src: value };
  } catch {
    return { src: value };
  }
}

/**
 * Kultunaut exposes only the original `/images/film/.../plakat.jpg` asset for
 * these feed posters. Their byte size is unbounded and can be hundreds of KB on
 * a small card, with no proven resize endpoint. Listing surfaces therefore use
 * Lanterna's branded placeholder for that raw path instead of downloading it.
 * Detail surfaces keep using `cardPosterSources`, so the original poster remains
 * available where the extra transfer is justified.
 */
export function listingPosterSources(url: string | null | undefined): CardPosterSources {
  const value = toHttpsUrl(url);
  if (!value) return {};

  try {
    const parsed = new URL(value);
    const isRawKultunautPoster =
      (parsed.hostname === "www.kultunaut.dk" || parsed.hostname === "kultunaut.dk") &&
      /^\/images\/film\/[^/]+\/plakat\.jpg$/u.test(parsed.pathname);
    if (isRawKultunautPoster) return {};
  } catch {
    return { src: value };
  }

  return cardPosterSources(value);
}

/**
 * Movie-detail backdrops are decorative, heavily dimmed artwork. The TMDb
 * enrichment record stores w1280, but sending that full asset to a phone can
 * dominate LCP while adding no useful detail. Keep desktop fidelity reasonable
 * while capping every client at w780 and letting narrow/1x viewports choose w500.
 */
export function detailBackdropSources(url: string | null | undefined): CardPosterSources {
  const value = toHttpsUrl(url);
  if (!value) return {};

  try {
    const parsed = new URL(value);
    if (parsed.hostname !== "image.tmdb.org") return { src: value };

    const match = parsed.pathname.match(/^\/t\/p\/(?:w\d+|original)(\/.+)$/u);
    if (!match) return { src: value };

    const variant = (width: 500 | 780) => {
      const next = new URL(parsed.toString());
      next.pathname = `/t/p/w${width}${match[1]}`;
      return next.toString();
    };
    const w500 = variant(500);
    const w780 = variant(780);
    return {
      src: w780,
      srcSet: `${w500} 500w, ${w780} 780w`,
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
