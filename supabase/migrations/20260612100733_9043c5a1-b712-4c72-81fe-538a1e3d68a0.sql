ALTER TABLE public.movies
  ADD COLUMN external_id text,
  ADD COLUMN trailer_url text,
  ADD COLUMN release_date date;

ALTER TABLE public.cinemas
  ADD COLUMN website text,
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision;

ALTER TABLE public.showtimes
  ADD COLUMN external_id text,
  ADD COLUMN start_time timestamptz;

CREATE UNIQUE INDEX movies_external_id_key ON public.movies(external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX showtimes_external_id_key ON public.showtimes(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX showtimes_start_time_idx ON public.showtimes(start_time);