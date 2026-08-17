-- eBillet sync eligibility is NOT the same thing as `is_active`.
-- `is_active` describes current screening availability. Once a cinema has been
-- linked to an eBillet organizer, it must keep being polled even during a quiet
-- period; otherwise one zero-showtime response would make the organizer fall
-- out of the sync forever.
CREATE OR REPLACE FUNCTION public.enqueue_ebillet_import_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  INSERT INTO public.import_runs (source, scope_type, scope_key, state, cursor)
  SELECT
    'ebillet',
    'organizer',
    e.id::text,
    'queued',
    '{}'::jsonb
  FROM public.ebillet_organizers e
  WHERE e.is_active = true
     OR e.cinema_id IS NOT NULL
  ON CONFLICT (source, scope_type, scope_key)
    WHERE state IN ('queued','running')
  DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_ebillet_import_runs()
  FROM public, anon, authenticated;

COMMENT ON FUNCTION public.enqueue_ebillet_import_runs() IS
  'Queues every currently active or already-linked eBillet organizer in the unified import_runs model. Linked cinemas remain sync-eligible even when is_active=false.';
