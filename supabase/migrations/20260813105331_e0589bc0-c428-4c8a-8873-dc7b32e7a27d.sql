UPDATE public.movies
SET poster = (
  SELECT jsonb_object_agg(
    key,
    CASE WHEN jsonb_typeof(value) = 'string' AND value #>> '{}' LIKE 'http://%'
         THEN to_jsonb('https://' || substring(value #>> '{}' from 8))
         ELSE value END
  )
  FROM jsonb_each(poster::jsonb)
)
WHERE poster::text LIKE '%http://%';