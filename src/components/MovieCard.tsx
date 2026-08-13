import { Link } from "@tanstack/react-router";
import type { Movie } from "@/lib/cinema-data";
import { formatRuntime } from "@/lib/cinema-data";
import { Poster } from "./Poster";

export function MovieCard({ movie, citySlug }: { movie: Movie; citySlug?: string | null }) {
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
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatRuntime(movie.runtime)}</span>
          <span className="text-foreground/20">·</span>
          <span>{movie.genre.join(", ")}</span>
        </div>
      </div>
    </>
  );

  return citySlug ? (
    <Link to="/$city/film/$slug" params={{ city: citySlug, slug: movie.slug }} className="group block">
      {inner}
    </Link>
  ) : (
    <Link to="/film/$slug" params={{ slug: movie.slug }} className="group block">
      {inner}
    </Link>
  );
}
