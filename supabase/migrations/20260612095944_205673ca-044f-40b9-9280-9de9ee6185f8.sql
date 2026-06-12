CREATE OR REPLACE FUNCTION public.slugify(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
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