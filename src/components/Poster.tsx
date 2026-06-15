import type { Movie } from "@/lib/cinema-data";

type Props = {
  movie: Movie;
  className?: string;
  showTitle?: boolean;
};

export function Poster({ movie, className = "", showTitle = true }: Props) {
  const posterUrl = movie.poster.url;
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
      {posterUrl && (
        <img
          src={posterUrl}
          alt={movie.poster.alt ?? movie.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
      {showTitle && (
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="font-display text-xl leading-tight text-white drop-shadow-md">
            {movie.title}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/70">
            {movie.director} · {movie.year}
          </div>
        </div>
      )}
      <div className="absolute right-3 top-3 rounded-sm border border-white/30 bg-black/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-sm">
        {movie.rating}
      </div>
    </div>
  );
}
