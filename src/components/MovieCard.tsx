import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Movie } from "@/lib/cinema-data";
import { formatRuntime } from "@/lib/cinema-data";
import { Poster } from "./Poster";

const POSTER_ROOT_MARGIN = "400px 0px";
const POSTER_CLASS_NAME =
  "transition-transform duration-500 ease-out group-hover:-translate-y-1 group-hover:shadow-2xl group-hover:shadow-black/50";

export function MovieCard({
  movie,
  citySlug,
  priority = false,
  sizes,
}: {
  movie: Movie;
  citySlug?: string | null;
  /** Only the first few above-the-fold posters should preload eagerly. */
  priority?: boolean;
  sizes?: string;
}) {
  const facts = [formatRuntime(movie.runtime), movie.genre.join(", ")].filter(Boolean);
  const inner = (
    <>
      <ListingPoster movie={movie} priority={priority} sizes={sizes} />

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

function ListingPoster({
  movie,
  priority,
  sizes,
}: {
  movie: Movie;
  priority: boolean;
  sizes?: string;
}) {
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(priority);

  useEffect(() => {
    if (priority || shouldLoad) return;
    const element = placeholderRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setShouldLoad(true);
      },
      { rootMargin: POSTER_ROOT_MARGIN },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [priority, shouldLoad]);

  if (!shouldLoad) {
    return (
      <div
        ref={placeholderRef}
        aria-hidden="true"
        className={`relative aspect-[2/3] w-full overflow-hidden rounded-md border border-border/40 bg-card ${POSTER_CLASS_NAME}`}
      />
    );
  }

  return (
    <Poster
      movie={movie}
      showTitle={false}
      priority={priority}
      listing
      {...(sizes ? { sizes } : {})}
      className={POSTER_CLASS_NAME}
    />
  );
}
