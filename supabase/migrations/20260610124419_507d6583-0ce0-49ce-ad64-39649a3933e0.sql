
CREATE TABLE public.movies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_title TEXT,
  runtime INT NOT NULL,
  genre TEXT[] NOT NULL DEFAULT '{}',
  year INT NOT NULL,
  director TEXT NOT NULL,
  rating TEXT NOT NULL,
  synopsis TEXT NOT NULL,
  poster JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.cinemas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  description TEXT NOT NULL,
  screens INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.showtimes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id TEXT NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
  cinema_id TEXT NOT NULL REFERENCES public.cinemas(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  times TEXT[] NOT NULL DEFAULT '{}',
  hall TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_showtimes_movie ON public.showtimes(movie_id);
CREATE INDEX idx_showtimes_cinema ON public.showtimes(cinema_id);

GRANT SELECT ON public.movies TO anon, authenticated;
GRANT ALL ON public.movies TO service_role;
GRANT SELECT ON public.cinemas TO anon, authenticated;
GRANT ALL ON public.cinemas TO service_role;
GRANT SELECT ON public.showtimes TO anon, authenticated;
GRANT ALL ON public.showtimes TO service_role;

ALTER TABLE public.movies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.showtimes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read movies" ON public.movies FOR SELECT USING (true);
CREATE POLICY "Public can read cinemas" ON public.cinemas FOR SELECT USING (true);
CREATE POLICY "Public can read showtimes" ON public.showtimes FOR SELECT USING (true);
