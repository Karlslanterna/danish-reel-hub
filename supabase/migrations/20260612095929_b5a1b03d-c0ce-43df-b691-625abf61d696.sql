-- Add slug fields
ALTER TABLE public.movies ADD COLUMN slug text;
ALTER TABLE public.cinemas ADD COLUMN slug text;

-- Slugify helper
CREATE OR REPLACE FUNCTION public.slugify(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' from regexp_replace(
    regexp_replace(
      lower(
        translate(
          value,
          'àáâäãåæçèéêëìíîïñòóôöõøùúûüýÿœÀÁÂÄÃÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÖÕØÙÚÛÜÝŸŒæøåÆØÅ',
          'aaaaaaaceeeeiiiinoooooouuuuyyoeaaaaaaaceeeeiiiinoooooouuuuyyoeaeoaaeoa'
        )
      ),
      '[^a-z0-9]+', '-', 'g'
    ),
    '-+', '-', 'g'
  ));
$$;

-- Backfill slugs
UPDATE public.movies SET slug = public.slugify(title) WHERE slug IS NULL;
UPDATE public.cinemas SET slug = public.slugify(name) WHERE slug IS NULL;

-- Enforce
ALTER TABLE public.movies ALTER COLUMN slug SET NOT NULL;
ALTER TABLE public.cinemas ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX movies_slug_key ON public.movies(slug);
CREATE UNIQUE INDEX cinemas_slug_key ON public.cinemas(slug);

-- Auto-generate on insert/update
CREATE OR REPLACE FUNCTION public.set_movie_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.slugify(NEW.title);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_cinema_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.slugify(NEW.name);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER movies_set_slug BEFORE INSERT OR UPDATE ON public.movies
  FOR EACH ROW EXECUTE FUNCTION public.set_movie_slug();
CREATE TRIGGER cinemas_set_slug BEFORE INSERT OR UPDATE ON public.cinemas
  FOR EACH ROW EXECUTE FUNCTION public.set_cinema_slug();