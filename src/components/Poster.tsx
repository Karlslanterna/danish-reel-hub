import type { Movie } from "@/lib/cinema-data";
import { cardPosterSources, toHttpsUrl } from "@/lib/poster-url";

type Props = {
  movie: Movie;
  className?: string;
  showTitle?: boolean;
  priority?: boolean;
  sizes?: string;
};

export function Poster({
  movie,
  className = "",
  showTitle = true,
  priority = false,
  sizes,
}: Props) {
  const posterUrl = toHttpsUrl(movie.poster.url);
  const cardSources = sizes ? cardPosterSources(posterUrl) : { src: posterUrl };

  if (!cardSources.src) {
    return (
      <div
        className={`relative aspect-[2/3] w-full overflow-hidden rounded-md border border-border/40 bg-card ${className}`}
      >
        <BrandedPlaceholder movie={movie} />
        {movie.rating.trim() && (
          <div className="absolute right-3 top-3 rounded-sm border border-white/20 bg-black/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/90 backdrop-blur-sm">
            {movie.rating}
          </div>
        )}
      </div>
    );
  }

  const style = {
    "--p-a": movie.poster.a,
    "--p-b": movie.poster.b,
    "--p-c": movie.poster.c,
    "--p-d": movie.poster.d,
  } as React.CSSProperties;

  return (
    <div
      style={style}
      className={`poster-gradient grain grain-overlay relative aspect-[2/3] w-full overflow-hidden rounded-md ${className}`}
    >
      <img
        src={cardSources.src}
        {...(cardSources.srcSet ? { srcSet: cardSources.srcSet } : {})}
        alt={movie.poster.alt ?? movie.title}
        width={400}
        height={600}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        {...(priority ? { fetchPriority: "high" as const } : { fetchPriority: "low" as const })}
        {...(sizes ? { sizes } : {})}
        className={`absolute inset-0 h-full w-full bg-black ${
          movie.poster.fit === "contain" ? "object-contain" : "object-cover"
        }`}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
      {showTitle && (
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="font-display text-xl leading-tight text-white drop-shadow-md">
            {movie.title}
          </div>
          {(movie.director.trim() || movie.year > 0) && (
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/70">
              {[movie.director.trim(), movie.year > 0 ? String(movie.year) : ""]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
        </div>
      )}
      {movie.rating.trim() && (
        <div className="absolute right-3 top-3 rounded-sm border border-white/30 bg-black/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-sm">
          {movie.rating}
        </div>
      )}
    </div>
  );
}

function BrandedPlaceholder({ movie }: { movie: Movie }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
        <div className="grid grid-cols-2 gap-1">
          <div className="h-3 w-3 rounded-[1px] bg-primary" />
          <div className="h-3 w-3 rounded-[1px] bg-primary/75" />
          <div className="h-3 w-3 rounded-[1px] bg-primary/50" />
          <div className="h-3 w-3 rounded-[1px] bg-primary/30" />
        </div>
        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Lanterna
        </span>
      </div>
      <div className="border-t border-border/60 bg-card px-5 py-5">
        <div className="font-display text-base leading-snug text-foreground line-clamp-3">
          {movie.title}
        </div>
        {movie.year > 0 && (
          <div className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {movie.year}
          </div>
        )}
      </div>
    </div>
  );
}
