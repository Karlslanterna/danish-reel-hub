# Filterprincipper for Lanterna

These principles are the permanent acceptance criteria for all public screening filters.

## 1. One model, everywhere

All active filters live in one persisted state. Internal navigation must not reset them. Film, city, cinema, child, and special-programme pages must read the same state and apply the same relevant predicates.

A route may activate a filter, for example `/babybio` or `/for-boern`, but it must also update the shared state. The filter remains active when the user opens a film or cinema. Clicking the active option once removes it.

## 2. Taxonomy

Keep these concepts separate:

- Screening attributes: date, time, format, language, Babybio, Seniorbio.
- Film attributes: genre and child suitability.
- Curated programmes: Filmporten and Biografklub Danmark.
- Geography: city, cinema, and distance.

Babybio and Seniorbio describe a particular screening and require an explicit source signal or a reviewed manual override. Time of day is not proof.

Filmporten and Biografklub Danmark describe films in a current official programme. Their title lists must be stored with the official source and a review date. A title that is absent from the current official list must not receive the tag merely because a free-text source happens to contain the word.

## 3. Visible options

Public special options are exactly:

- Babybio
- Seniorbio
- Filmporten
- Biografklub Danmark

Do not expose Formiddagsbio, Cinemateket, or internal/source-specific tags as public filters without a new product decision.

An option is visible only when selecting it would return at least one result inside the current date, geography, and page context. Counts in admin and tests must be based on the same canonical screening model as the public site.

## 4. Matching semantics

Different dimensions combine with AND. Multiple values inside a future multi-select dimension combine only according to an explicitly documented rule.

- Date uses the cinema's local calendar date.
- Time uses the screening's local start time: morning before 12:00, afternoon 12:00–16:59, evening 17:00–20:59, late from 21:00.
- Format and language require an explicit normalized source tag.
- Genre is matched on normalized movie genres.
- Child suitability uses the documented conservative classifier; an unknown rating alone is not sufficient.
- City, cinema, and distance constrain the eligible cinemas before result counts are calculated.

## 5. Source validation

For each special filter, maintain at least one checked positive example and one checked negative example. Validation has four layers:

1. Raw source payload contains the expected signal.
2. Normalizer produces the expected canonical tag.
3. Canonical production rows contain the tag after import.
4. The live UI shows the correct result and carries the filter through navigation.

After a normalizer change, re-run the affected imports. A green test suite without refreshed production rows is not a completed fix.

## 6. Manual corrections

Manual additions/removals must be attributable, dated, reversible, and reapplied after imports. They must not be silent edits to generated rows. Admin should show the source value, normalized value, correction, note, and last editor.

## 7. Release checklist

- Audit every visible option and all time/date boundaries.
- Check no-result options are hidden.
- Check one-press removal.
- Check carry-over: listing → film → cinema → city and back.
- Check cinema pages use the same predicates.
- Compare Babybio/Seniorbio samples with official cinema schedules.
- Compare Filmporten/Biografklub titles with their current official programmes.
- Run unit, type, build, mobile, desktop, and production smoke tests.
