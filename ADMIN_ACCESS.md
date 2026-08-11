# Admin Access Model

## Public access model

The public site (`/`, `/film/$slug`, `/biograf/$slug`, `/by/$city`) is fully
anonymous. It contains:

- no login or logout controls,
- no links to `/auth`, `/admin`, or any admin tool,
- no text, icon, or markup that reveals that an administration system exists.

A visitor browsing the public site cannot discover the admin interface through
navigation, sitemap, or search engines.

## Admin entry point

The only entry point is a direct visit to:

```
/admin
```

From the dashboard, admins navigate internally to:

- `/admin/import` — upload a Kultunaut XML file and start an import job
- `/admin/import/$jobId` — live status of a running import job
- future admin tools are added as children of `/admin`

## Authentication flow

Supabase Auth is unchanged.

1. `/admin` and all admin routes live under the pathless `_authenticated`
   layout (`src/routes/_authenticated/route.tsx`), which is client-only
   (`ssr: false`) because the Supabase session lives in `localStorage`.
2. The layout calls `supabase.auth.getUser()`. With no valid user it redirects
   to `/auth?next=<original path>`.
3. `/auth` offers Google OAuth and email/password sign-in. On success the user
   is returned to the originally requested admin path.

## Authorization flow

Role storage and checks are unchanged:

- roles live in `public.user_roles` (never on profiles),
- `public.has_role(_user_id, _role)` is a `SECURITY DEFINER` function,
- `checkIsAdmin` (`src/lib/admin.functions.ts`) is a server function behind
  `requireSupabaseAuth` that calls `has_role(auth user, 'admin')`,
- every admin server function (`adminCreateImportJob`,
  `adminProcessImportJob`, `adminGetImportJobStatus`) re-asserts the admin role
  server-side, so the UI gate is never the only protection.

Behaviour on `/admin`:

| State | Result |
| --- | --- |
| not authenticated | redirect to `/auth` |
| authenticated, not admin | redirect to `/admin/denied` (403 "Adgang nægtet") |
| authenticated admin | admin dashboard |

## SEO

- Every admin route sets `robots: noindex, nofollow` in its `head()`.
- `public/robots.txt` disallows `/admin`, `/auth`, `/api`, and internal paths.
- `src/routes/sitemap[.]xml.ts` only emits public content routes; no admin URL
  is ever included.

## Why the admin interface is intentionally undiscoverable

Obscurity is not the security control — role checks in the database and in
every server function are. Hiding the entry point simply removes the admin
surface from the public product: it eliminates a target for credential
stuffing and automated probing, keeps crawlers and AI agents away from an
interface that has no public value, and prevents ordinary visitors from
being confused by a login they can never use.
