// Central title + meta-description templates.
//
// One place for every page type keeps titles and descriptions unique and
// consistent across routes, which is what the SEO QA checks for.

export const BRAND = "Lanterna";

const clamp = (s: string, max = 158) =>
  s.length <= max ? s : s.slice(0, max - 1).replace(/[\s,.;:–—-]+$/u, "") + "…";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "{Movie} | Lanterna" */
export const movieTitle = (movie: string) => `${movie} | ${BRAND}`;

/** "{Movie} i {City} | Spilletider og billetter | Lanterna" */
export const cityMovieTitle = (movie: string, city: string) =>
  `${movie} i ${city} | Spilletider og billetter | ${BRAND}`;

/** "{Movie} i {Cinema} | Spilletider og billetter | Lanterna" */
export const cinemaMovieTitle = (movie: string, cinema: string) =>
  `${movie} i ${cinema} | Spilletider og billetter | ${BRAND}`;

/** "{Cinema} | Film og spilletider | Lanterna" */
export const cinemaTitle = (cinema: string) => `${cinema} | Film og spilletider | ${BRAND}`;

/** "Biografprogram i {City} | Lanterna" */
export const cityTitle = (city: string) => `Biografprogram i ${city} | ${BRAND}`;

export const indexTitle = (what: "film" | "cinemas") =>
  what === "film" ? `Alle film i biografen | ${BRAND}` : `Alle biografer i Danmark | ${BRAND}`;

export function movieDescription(movie: string, cinemaCount: number, cityCount: number) {
  if (cinemaCount === 0) {
    return clamp(
      `${movie} — se aktuelle spilletider, biografer og billetter i hele Danmark på ${BRAND}.`,
    );
  }
  return clamp(
    `Se aktuelle spilletider for ${movie} i ${plural(cinemaCount, "biograf", "biografer")} fordelt på ${plural(cityCount, "by", "byer")}. Sammenlign tidspunkter og køb billetter direkte.`,
  );
}

export function cityMovieDescription(movie: string, city: string, cinemaCount: number) {
  if (cinemaCount === 0) {
    return clamp(
      `${movie} spiller ikke i ${city} lige nu. Se aktuelle spilletider og billetter for ${movie} i resten af landet.`,
    );
  }
  return clamp(
    `Se aktuelle spilletider for ${movie} i ${city}. ${plural(cinemaCount, "biograf viser", "biografer viser")} filmen — find tidspunkt og køb billetter direkte.`,
  );
}

export function cinemaMovieDescription(movie: string, cinema: string, city: string, screeningCount: number) {
  if (screeningCount === 0) {
    return clamp(
      `${movie} spiller ikke i ${cinema} i ${city} lige nu. Se filmens aktuelle spilletider i andre biografer på ${BRAND}.`,
    );
  }
  return clamp(
    `Se aktuelle spilletider for ${movie} i ${cinema} i ${city}. ${plural(screeningCount, "kommende forestilling", "kommende forestillinger")} — vælg tidspunkt og køb billetter direkte.`,
  );
}

export function cinemaDescription(cinema: string, city: string, movieCount: number) {
  return clamp(
    `Se det aktuelle program i ${cinema} i ${city}: ${plural(movieCount, "film", "film")} på plakaten, kommende spilletider og direkte køb af billetter.`,
  );
}

export function cityDescription(city: string, cinemaCount: number, movieCount: number) {
  return clamp(
    `Biografprogram for ${city}: ${plural(movieCount, "aktuel film", "aktuelle film")} i ${plural(cinemaCount, "biograf", "biografer")}. Se spilletider i dag og de kommende dage og køb billetter.`,
  );
}

export const indexDescription = (what: "film" | "cinemas") =>
  what === "film"
    ? clamp(
        `Oversigt over alle film der spiller i danske biografer lige nu. Find spilletider, biografer og billetter til hver enkelt film.`,
      )
    : clamp(
        `Oversigt over alle biografer i Danmark med aktuelle film. Find din biograf, se hele programmet og køb billetter til kommende spilletider.`,
      );
