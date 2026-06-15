ALTER TABLE public.cinemas ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.showtimes ADD COLUMN IF NOT EXISTS ticket_url text;