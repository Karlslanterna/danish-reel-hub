# Lanterna delivery rules

Read `FILTER_PRINCIPLES.md` and `MISTAKES.md` before changing filters, imports, analytics, SEO, or the admin area.

## Completion gate

- Keep the user's original acceptance list intact. Do not silently redefine or narrow it.
- Never mark a group of tasks complete while an agreed deliverable is missing, placeholder-only, or unverified in production.
- Report partial status explicitly: implemented, verified locally, deployed, and verified in production are different states.

## Filters and data

- Use one shared filter state across internal navigation. A selected filter must survive navigation to film, city, and cinema pages until the user removes it.
- Every page that displays screenings must apply every relevant active filter through the same matching rules.
- An active option can be removed with one press on that option. Do not add separate close icons to filter buttons.
- Only show filter options that yield a current result in the relevant page context.
- Public special filters are limited to Babybio, Seniorbio, Filmporten, and Biografklub Danmark unless the product scope is explicitly changed.
- Babybio and Seniorbio are screening attributes. Never infer them from time of day alone.
- Filmporten and Biografklub Danmark are curated film programmes. Validate them against the current official programme, with a dated review marker.
- Validate representative official examples and actual production rows before declaring data labelling correct.
- A parser change is incomplete until affected production data has been re-imported and checked.
- Confirm the actual production project and canonical read model before querying, migrating, or reporting database status.

## Admin, SEO, and tracking

- Admin language is plain Danish. Operational health must use canonical screenings and every active data source, not legacy tables or a single importer.
- Analytics may record page views, filter use, zero-result states, and outbound ticket clicks. Do not collect sensitive personal data.
- Index only stable, curated landing pages with real content and current results. Filter combinations are not indexable pages.
- Release only after unit tests, build/type checks, responsive checks, and a production smoke test pass.
