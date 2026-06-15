ALTER TABLE public.showtimes
  ADD COLUMN IF NOT EXISTS ticket_urls text[] NOT NULL DEFAULT '{}'::text[];