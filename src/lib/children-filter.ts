import type { Movie, ShowtimeIndexRow } from "@/lib/cinema-data";

type ChildMovie = Pick<Movie, "title" | "genre" | "rating">;
type ChildScreening = Pick<ShowtimeIndexRow, "events" | "languages">;

const CHILD_GENRE =
  /(?:^|\b)(?:animation|tegnefilm|familie|familiefilm|family|børnefilm|børn|kids?)(?:\b|$)/iu;
const CHILD_PROGRAMME = /(?:børnebiffen|børnebio|børnefilm|familievisning|for børn)/iu;
const DANISH_DUB = /(?:dansk tale|dubbet(?: på)? dansk|danish dub)/iu;
const AGE_15 = /(?:t\.?\s*o\.?\s*15|(?:over|fra)\s*15|15\s*år)/iu;
const KNOWN_CHILD_AGE =
  /(?:t\.?\s*f\.?\s*a|alle|f\.?\s*u\.?\s*7|(?:over|fra)\s*(?:7|11)|(?:7|11)\s*år)/iu;

/**
 * Conservative public classification: require a clear child/family signal,
 * and always let a 15+ rating veto the match.
 */
export function isMovieForChildren(movie: ChildMovie, screenings: ChildScreening[] = []): boolean {
  if (AGE_15.test(movie.rating)) return false;

  const movieText = [movie.title, ...movie.genre].join(" ");
  if (CHILD_GENRE.test(movieText) || CHILD_PROGRAMME.test(movieText)) return true;

  const screeningText = screenings
    .flatMap((screening) => [...screening.events, ...screening.languages])
    .join(" ");
  if (CHILD_PROGRAMME.test(screeningText)) return true;

  // A Danish dub is a useful source-level signal, but only together with an
  // explicit age marking so an unrelated Danish-language film is not included.
  return DANISH_DUB.test(screeningText) && KNOWN_CHILD_AGE.test(movie.rating);
}
