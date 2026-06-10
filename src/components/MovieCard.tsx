import { Link } from "@tanstack/react-router";
import type { Movie } from "@/lib/cinema-data";
import { formatRuntime } from "@/lib/cinema-data";
import { Poster } from "./Poster";

export function MovieCard({ movie }: { movie: Movie }) {
  return (
    <Link
      to="/movie/$id"
      params={{ id: movie.id }}
      className="group block"
    >
      <Poster
        movie={movie}
        showTitle={false}
        className="transition-transform duration-500 ease-out group-hover:-translate-y-1 group-hover:shadow-2xl group-hover:shadow-black/50"
      />
      <div className="mt-3">
        <h3 className="font-display text-base leading-snug text-foreground transition-colors group-hover:text-primary">
          {movie.title}
        </h3>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatRuntime(movie.runtime)}</span>
          <span className="text-foreground/20">·</span>
          <span>{movie.genre.join(", ")}</span>
        </div>
      </div>
    </Link>
  );
}
