ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS tmdb_id integer,
  ADD COLUMN IF NOT EXISTS tmdb_runtime integer,
  ADD COLUMN IF NOT EXISTS tmdb_overview text,
  ADD COLUMN IF NOT EXISTS tmdb_genres text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS tmdb_poster_url text,
  ADD COLUMN IF NOT EXISTS tmdb_backdrop_url text,
  ADD COLUMN IF NOT EXISTS tmdb_trailer_url text,
  ADD COLUMN IF NOT EXISTS tmdb_cast jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tmdb_director text,
  ADD COLUMN IF NOT EXISTS tmdb_vote_average numeric,
  ADD COLUMN IF NOT EXISTS tmdb_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS tmdb_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tmdb_skip_reason text;

CREATE INDEX IF NOT EXISTS movies_tmdb_status_idx ON public.movies (tmdb_status, tmdb_fetched_at);