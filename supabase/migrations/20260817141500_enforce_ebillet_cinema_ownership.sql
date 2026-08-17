-- Keep the cinema row itself consistent with the authority model used by the
-- canonical screening pipeline. A cinema linked to eBillet is eBillet-owned;
-- the source column must not remain "kultunaut" merely because that row was
-- originally discovered by Kultunaut.

UPDATE public.cinemas c
SET source = 'ebillet'
WHERE c.ebillet_organizer_id IS NOT NULL
   OR EXISTS (
     SELECT 1
     FROM public.ebillet_organizers e
     WHERE e.cinema_id = c.id
   );

CREATE OR REPLACE FUNCTION public.enforce_cinema_source_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- The direct organizer id is enough on the first linking write. The registry
  -- lookup also protects established mappings when another writer updates the
  -- cinema without including ebillet_organizer_id in its patch.
  IF NEW.ebillet_organizer_id IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.ebillet_organizers e
       WHERE e.cinema_id = NEW.id
     ) THEN
    NEW.source := 'ebillet';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cinemas_source_authority ON public.cinemas;
CREATE TRIGGER trg_cinemas_source_authority
BEFORE INSERT OR UPDATE ON public.cinemas
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cinema_source_authority();

COMMENT ON FUNCTION public.enforce_cinema_source_authority() IS
  'Forces source=ebillet whenever a cinema is linked to an eBillet organizer; authority follows the durable link, not discovery origin.';
