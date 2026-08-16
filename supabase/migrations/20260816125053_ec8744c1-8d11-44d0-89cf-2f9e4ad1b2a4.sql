UPDATE public.ebillet_organizers
SET is_active = false,
    last_sync_status = 'skipped',
    last_sync_error = 'Ikke-biograf spillested (venue-filter)'
WHERE id IN (193, 222, 223, 224);

CREATE OR REPLACE FUNCTION private.ebillet_organizer_is_active(_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ebillet_organizers o
    WHERE o.id = _id AND o.is_active
  );
$$;

DROP POLICY IF EXISTS "Public can read cinemas" ON public.cinemas;
CREATE POLICY "Public can read cinemas"
ON public.cinemas
FOR SELECT
USING (
  ebillet_organizer_id IS NULL
  OR private.ebillet_organizer_is_active(ebillet_organizer_id)
);