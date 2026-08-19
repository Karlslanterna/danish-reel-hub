import { useEffect, useState, type ComponentProps } from "react";
import type { Movie } from "@/lib/cinema-data";
import { MovieDetail } from "./MovieDetail";

type Props = Omit<ComponentProps<typeof MovieDetail>, "movie"> & {
  movie: Movie;
  details?: Promise<Movie | null>;
};

/**
 * Client navigation can paint from the compact listing card immediately while
 * the rich synopsis, backdrop and trailer record resolves in parallel.
 * Direct requests still receive the full movie during SSR for complete SEO.
 */
export function DeferredMovieDetail({ movie, details, ...props }: Props) {
  const [resolvedMovie, setResolvedMovie] = useState(movie);

  useEffect(() => {
    setResolvedMovie(movie);
  }, [movie]);

  useEffect(() => {
    if (!details) return;
    let active = true;
    void details
      .then((value) => {
        if (active && value) setResolvedMovie(value);
      })
      .catch(() => {
        // The compact card is a complete functional fallback. A metadata
        // failure must not block showtimes or ticket links.
      });
    return () => {
      active = false;
    };
  }, [details]);

  return <MovieDetail movie={resolvedMovie} {...props} />;
}
