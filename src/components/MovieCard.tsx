import { Link } from "@tanstack/react-router";
import type { Movie } from "@/lib/cinema-data";
import { formatRuntime } from "@/lib/cinema-data";
import { Poster } from "./Poster";

export function MovieCard({ movie, citySlug }: { movie: Movie; citySlug?: string | null }) {
  const facts = [formatRuntime(movie.runtime), movie.genre.join(", ")].filter(Boolean);
  const inner = (
    <>
      <Poster
        movie={movie}
        showTitle={false}
        className="transition-transform duration-500 ease-out group-hover:-translate-y-1 group-hover:shadow-2xl group-hover:shadow-black/50"
      />
      <div className="mt-3">
        <h3 className="font-display text-base leading-snug text-foreground line-clamp-2 transition-colors group-hover:text-primary">
          {movie.title}
        </h3>
        {facts.length > 0 && (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {facts.map((fact, index) => (
              <span key={fact} className={index === facts.length - 1 ? "truncate" : undefined}>
                {index > 0 && <span className="mr-2 text-foreground/20">·</span>}
                {fact}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return citySlug ? (
    <Link
      to="/$city/film/$slug"
      params={{ city: citySlug, slug: movie.slug }}
      preload="intent"
      className="group block"
    >
      {inner}
    </Link>
  ) : (
    <Link to="/film/$slug" params={{ slug: movie.slug }} preload="intent" className="group block">
      {inner}
    </Link>
  );
}
