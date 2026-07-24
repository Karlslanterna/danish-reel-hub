import { canonicalUrl } from "./canonical";
import type { Movie, Cinema, Showtime } from "./cinema-data";

const ld = (obj: unknown) => ({
  type: "application/ld+json" as const,
  children: JSON.stringify(obj),
});

export function homeSchemas() {
  const site = canonicalUrl("/");
  return [
    ld({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Lanterna",
      url: site,
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${site}?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    }),
    ld({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Lanterna",
      url: site,
      logo: canonicalUrl("/logo.svg"),
    }),
  ];
}

const stripPostcode = (s: string) => s.replace(/^\s*\d{3,4}\s+/u, "").trim();
const citySlugOf = (city: string) => stripPostcode(city).toLowerCase();

function breadcrumbSchema(items: { name: string; url: string }[]) {
  return ld({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  });
}

export function movieSchemas(movie: Movie, cinemas: Cinema[], showtimes: Showtime[]) {
  const cinemaById = new Map(cinemas.map((c) => [c.id, c] as const));

  const movieObj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: movie.title,
    url: canonicalUrl(`/film/${movie.slug}`),
    description: movie.synopsis || undefined,
  };
  if (movie.poster?.url) movieObj.image = movie.poster.url;
  if (movie.genre?.length) movieObj.genre = movie.genre;
  if (movie.runtime) movieObj.duration = `PT${movie.runtime}M`;
  if (movie.rating) movieObj.contentRating = movie.rating;
  if (movie.director) movieObj.director = { "@type": "Person", name: movie.director };
  if (movie.year) movieObj.datePublished = String(movie.year);

  const events: unknown[] = [];
  for (const s of showtimes) {
    const cinema = cinemaById.get(s.cinemaId);
    if (!cinema) continue;
    const location: Record<string, unknown> = {
      "@type": "MovieTheater",
      name: cinema.name,
      url: canonicalUrl(`/biograf/${cinema.slug}`),
    };
    if (cinema.address) {
      location.address = { "@type": "PostalAddress", streetAddress: cinema.address, addressLocality: cinema.city, addressCountry: "DK" };
    }
    if (cinema.latitude != null && cinema.longitude != null) {
      location.geo = { "@type": "GeoCoordinates", latitude: cinema.latitude, longitude: cinema.longitude };
    }
    s.times.forEach((t, i) => {
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(s.date) && /^\d{2}:\d{2}$/.test(t) ? `${s.date}T${t}:00` : undefined;
      const ticketUrl = s.ticketUrls?.[i] || s.bookingUrl || undefined;
      const ev: Record<string, unknown> = {
        "@type": "ScreeningEvent",
        name: movie.title,
        location,
      };
      if (startDate) ev.startDate = startDate;
      if (ticketUrl) ev.offers = { "@type": "Offer", url: ticketUrl };
      events.push(ev);
    });
  }

  const crumbs = breadcrumbSchema([
    { name: "Forside", url: canonicalUrl("/") },
    { name: movie.title, url: canonicalUrl(`/film/${movie.slug}`) },
  ]);

  return [ld(movieObj), ...events.map((e) => ld(e)), crumbs];
}

export function cinemaSchemas(cinema: Cinema) {
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MovieTheater",
    name: cinema.name,
    url: canonicalUrl(`/biograf/${cinema.slug}`),
  };
  if (cinema.address) {
    obj.address = {
      "@type": "PostalAddress",
      streetAddress: cinema.address,
      addressLocality: cinema.city,
      addressCountry: "DK",
    };
  }
  if (cinema.latitude != null && cinema.longitude != null) {
    obj.geo = { "@type": "GeoCoordinates", latitude: cinema.latitude, longitude: cinema.longitude };
  }
  const cityName = stripPostcode(cinema.city);
  const citySlug = citySlugOf(cinema.city);
  const crumbs = breadcrumbSchema([
    { name: "Forside", url: canonicalUrl("/") },
    { name: cityName, url: canonicalUrl(`/by/${citySlug}`) },
    { name: cinema.name, url: canonicalUrl(`/biograf/${cinema.slug}`) },
  ]);
  return [ld(obj), crumbs];
}

export function citySchemas(citySlug: string, cityName: string) {
  const url = canonicalUrl(`/by/${citySlug}`);
  return [
    ld({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `Film i ${cityName}`,
      url,
    }),
    ld({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Forside", item: canonicalUrl("/") },
        { "@type": "ListItem", position: 2, name: cityName, item: url },
      ],
    }),
  ];
}
