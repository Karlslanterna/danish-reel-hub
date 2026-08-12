ALTER TABLE public.showtimes
  ADD COLUMN IF NOT EXISTS formats text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS events text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS showtimes_formats_idx ON public.showtimes USING GIN (formats);
CREATE INDEX IF NOT EXISTS showtimes_languages_idx ON public.showtimes USING GIN (languages);
CREATE INDEX IF NOT EXISTS showtimes_events_idx ON public.showtimes USING GIN (events);