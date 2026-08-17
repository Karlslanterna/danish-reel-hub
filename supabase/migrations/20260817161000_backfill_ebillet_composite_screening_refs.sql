-- Normalize canonical eBillet screening refs to the organizer-scoped format
-- used by the active normalizer: eb-<organizerId>-<showtimeId>.
--
-- The initial canonical backfill copied legacy refs as eb-<showtimeId>. That
-- makes the first live canonical sync collide with screenings_identity_key
-- because the same physical screening arrives under the newer composite ref.
-- This is a one-time identity migration only; no screening is created/deleted.

DO $$
DECLARE
  v_unmapped bigint;
  v_conflicts bigint;
BEGIN
  SELECT count(*) INTO v_unmapped
  FROM public.screenings s
  JOIN public.cinemas c ON c.id = s.cinema_id
  LEFT JOIN LATERAL (
    SELECT e.id
    FROM public.ebillet_organizers e
    WHERE e.cinema_id = s.cinema_id
    ORDER BY e.id
    LIMIT 1
  ) e ON true
  WHERE s.source = 'ebillet'
    AND s.source_ref ~ '^eb-[0-9]+$'
    AND COALESCE(c.ebillet_organizer_id, e.id) IS NULL;

  IF v_unmapped > 0 THEN
    RAISE EXCEPTION 'eBillet source-ref migration: % legacy refs have no organizer mapping', v_unmapped
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_conflicts
  FROM public.screenings s
  JOIN public.cinemas c ON c.id = s.cinema_id
  LEFT JOIN LATERAL (
    SELECT e.id
    FROM public.ebillet_organizers e
    WHERE e.cinema_id = s.cinema_id
    ORDER BY e.id
    LIMIT 1
  ) e ON true
  JOIN public.screenings existing
    ON existing.source = 'ebillet'
   AND existing.source_ref =
       'eb-' || COALESCE(c.ebillet_organizer_id, e.id)::text || '-' || substring(s.source_ref from '^eb-([0-9]+)$')
   AND existing.id <> s.id
  WHERE s.source = 'ebillet'
    AND s.source_ref ~ '^eb-[0-9]+$';

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'eBillet source-ref migration: % target composite refs already exist', v_conflicts
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

UPDATE public.screenings s
SET source_ref =
  'eb-' || COALESCE(c.ebillet_organizer_id, e.id)::text || '-' || substring(s.source_ref from '^eb-([0-9]+)$')
FROM public.cinemas c
LEFT JOIN LATERAL (
  SELECT eo.id
  FROM public.ebillet_organizers eo
  WHERE eo.cinema_id = c.id
  ORDER BY eo.id
  LIMIT 1
) e ON true
WHERE s.source = 'ebillet'
  AND s.cinema_id = c.id
  AND s.source_ref ~ '^eb-[0-9]+$';

COMMENT ON CONSTRAINT screenings_source_ref_key ON public.screenings IS
  'Source-native screening identity. eBillet refs are organizer-scoped: eb-<organizerId>-<showtimeId>.';
