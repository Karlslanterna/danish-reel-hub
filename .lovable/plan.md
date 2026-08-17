# Lanterna — arkitektur- og backend-audit

Baseret på gennemgang af den aktuelle kode (`src/lib/ebillet/*`, `src/lib/kultunaut/*`, `src/lib/tmdb/*`) og direkte forespørgsler mod produktionsdatabasen i dag. Tidligere audit-dokumenter er ikke lagt til grund.

## Målte tal fra den faktiske database

| Måling | Værdi |
|---|---|
| showtimes | 9.580 (ebillet 7.381 / kultunaut 2.199) |
| movies | 855 (ebillet 782 / kultunaut 73) |
| cinemas | 192 (ebillet 32 / kultunaut 160) |
| movies med `year = 0` | 547 (64 %) |
| eBillet-film uden synopsis eller plakat | 772 af 782 |
| Kultunaut-showtimes på eBillet-ejede biografer | 199 (14+ biografer, bl.a. Grand Teatret, Empire Bio) |
| eBillet-oprettede biografer uden lat/lon | 32 af 32 |
| showtimes uden for 30-dages vinduet | 2.014 |
| duplikerede titler / fortidige showtimes / skæve ticket_urls | 0 / 0 / 0 |
| tabelstørrelse showtimes | 8,7 MB |

## A. Kritiske fejl

1. **Source authority er kun håndhævet på skrivning, aldrig på eksisterende data.** Kultunaut-importen springer eBillet-dækkede biografer over, men fjerner ikke de 199 Kultunaut-rækker, der allerede ligger der. De vises offentligt side om side med eBillet-rækker. Authority-reglen er dermed ikke opfyldt i dag.
2. **`cleanupStaleData()` er global, cross-source og destruktiv, og kører inde i Kultunaut-jobbet.** Den sletter alle fortidige showtimes uanset kilde og derefter enhver film/biograf uden showtimes. Hvis en eBillet-sync fejler eller en biograf er midlertidigt tom, sletter Kultunaut-jobbet eBillet-biografen — og `showtimes_cinema_id_fkey ON DELETE CASCADE` river dens showtimes med. Det er præcis den implicitte cross-source cleanup, der ikke må findes.
3. **Ingen unik constraint på showtime-identitet.** Grupperingen `(movie_id, cinema_id, date, hall)` findes kun i applikationskode. To samtidige kørsler kan skabe dubletter uden at databasen protesterer. `external_id` er unik, men eBillet sætter den til `eb-<org>-<første showtime id>`, som ændrer sig når det første id forsvinder.
4. **Grupperede array-rækker er den forkerte kanoniske granularitet.** Én række bærer `times[]`, `ticket_urls[]`, `ebillet_showtime_ids[]`, ét `min/max_price` og ét aggregeret `free_seats`. Identitet, reconciliation, priser og ledige sæder pr. forestilling går tabt, `start_time` duplikerer `date+times[0]`, og diff-logikken skal genopfinde identitet fra arrays.
5. **Film-identitet skabes af titel.** `matchMovie` kræver titel + år, men 64 % af rækkerne har `year = 0`, så fallback fejler næsten altid og opretter en ny `eb-`-film i stedet. Det forklarer 782 eBillet-film mod 73 Kultunaut-film: samme fysiske film findes i praksis flere gange på tværs af kilder. Kultunaut-importens `merge`-fase gør det modsatte — den sletter film ud fra `ilike`-titelmatch alene og re-pointer showtimes, hvilket kan kollapse to forskellige film.
6. **Biograf-identitet bruger stadig navnepræfiks-søgning** (`ilike '<første ord>%' limit 50`) plus bynavn. Robust nok i dag, men det er strengmatch der bestemmer canonical identity.
7. **To uafhængige, uforenelige job-modeller.** `import_jobs` (faseautomat, gemmer hele XML-payloaden i rækken, ingen lease, ingen forsøgstæller, en fejl i én fase fejler hele jobbet) og `ebillet_sync_runs` (cursor-CAS pr. organizer). Single-flight i eBillet hviler kun på cursor-CAS: intet forhindrer to `running` runs i at blive oprettet, og resume-forespørgslen tager vilkårligt ældste `running` run uanset `kind`.
8. **Partial commits overalt.** Hver organizer laver 5–10 uafhængige skrivninger (cinema, organizer, movies, insert/update/delete af showtimes) uden transaktion. En timeout midt i reconciliation efterlader biografen halvt slettet.
9. **Tavse trigger-drops.** `enforce_showtime_source_authority` returnerer `NULL`/`OLD` ved konflikt. Skrivninger forsvinder uden fejl — usynligt datatab og meget svær fejlsøgning.
10. **RLS kalder en SECURITY DEFINER-funktion pr. række** (`private.cinema_is_public(cinema_id)`) på hver showtime-læsning. Fungerer ved 9.600 rækker, bliver en flaskehals ved 100.000.
11. **TMDb-berigelse ligger inde i importjobbet** (op til 40 runder i `enrich`-fasen) og kobler en ekstern, ratelimiteret API til import-completion.
12. **Datakvalitet, brugersynligt:** ingen af de 32 eBillet-biografer har koordinater, så de er usynlige for "Afstand fra mig"-filteret. 772 eBillet-film mangler synopsis eller plakat.

## B. Rodårsager

- Der findes ingen source-scoped stagingzone. Begge importere skriver direkte i canonical tabeller, så hver fejl er en produktionsfejl.
- Kildeejerskab er kodet ind i primærnøglen (`kn-`/`eb-`-præfikser) i stedet for i en mapping-tabel. Et objekt kan ikke skifte eller dele kilde uden at skifte identitet.
- Der findes ingen eksplicit identity-resolution-tabel. Matching genberegnes fra strenge ved hver kørsel i stedet for at blive besluttet én gang og gemt.
- Databasen håndhæver ingen af de invarianter, koden antager (unik screening, én kilde pr. biograf, ingen cross-source sletning). Alt er applikationslogik.
- Cleanup og ejerskab blev tilføjet efter datamodellen i stedet for at være en del af den.

## C. Målarkitektur

**Kanonisk model og ejerskab**

| Objekt | Ejer af identitet | Ejer af felter |
|---|---|---|
| `cinemas` | Lanterna (stabilt `uuid`) | eBillet for eBillet-koblede: navn, sal-antal, aktiv. Kultunaut: adresse, geo, beskrivelse, website (eBillet leverer dem ikke) |
| `movies` | Lanterna | TMDb først (plakat, synopsis, runtime, genrer, cast), derefter kildens værdi, aldrig blank overskrivning |
| `screenings` (ny, erstatter `showtimes`) | Kilden, via `(source, source_ref)` | 100 % ejet af den kilde biografen er bundet til |

**Nye strukturer**

- `source_refs(source, entity_type, external_id, canonical_id, confidence, method, confirmed_at)` — én besluttet identitet pr. eksternt id. Strengmatch må kun foreslå, aldrig binde.
- `import_snapshots(id, source, scope, fetched_at, payload_hash, status, validation)` — én række pr. fetch pr. scope (organizer eller hele Kultunaut-feedet).
- `staged_screenings(snapshot_id, …)` — normaliseret, validerbar landingszone.
- `screenings` — én række pr. forestilling: `cinema_id, movie_id, starts_at timestamptz, hall, source, source_ref, ticket_url, price_min, price_max, free_seats, formats[], languages[], events[]`, med `unique (source, source_ref)` og `unique (cinema_id, hall, starts_at, movie_id)`. Gruppering pr. dato/sal sker ved læsning, ikke i lagringen.
- `cinemas.authoritative_source` som eksplicit kolonne + `cinemas.is_public` som denormaliseret boolean vedligeholdt af trigger, så RLS bliver et kolonneopslag i stedet for et funktionskald.
- Promotion sker i én `SECURITY DEFINER`-RPC pr. scope: valider snapshot → diff mod `screenings` for netop den `(cinema_id, source)` → insert/update/delete i én transaktion. Ingen delvise commits; cleanup kan pr. konstruktion ikke ramme en anden kilde.
- Cleanup opdeles: retention (slet forestillinger ældre end N dage, kildeagnostisk og ufarlig) adskilt fra orphan-oprydning (kun film uden nogen forestillinger, aldrig biografer).
- TMDb-berigelse bliver et selvstændigt, købaseret job med egen TTL — ikke en importfase.
- Én job-model for begge kilder: `jobs(kind, scope, state, lease_until, attempts, cursor, last_error)` med lease/heartbeat, forsøgstæller, dead-letter og et partielt unikt indeks der gør to aktive kørsler af samme kind umuligt.

**Anbefaling, eksplicit:** dette er en omskrivning af importlaget. `src/lib/ebillet/sync.server.ts` (972 linjer) og `src/lib/kultunaut/import.server.ts` (650 linjer) bør erstattes, ikke lappes. Genbrugelig og god kode: `parser.server.ts`, `reconcile.ts` (diff/validate-logikken), `cinema-match.ts`, `venue-filter.ts`, `api.server.ts`, `tmdb/*`.

## D. Migrationssekvens

1. **Stop blødningen (lav risiko, ingen modelændring).** Fjern biograf-sletning fra cleanup; begræns cleanup til kildens eget scope; fjern de 199 Kultunaut-rækker på eBillet-biografer via en eksplicit, revisérbar migration; erstat de tavse triggere med `RAISE EXCEPTION`; tilføj `unique (movie_id, cinema_id, date, hall)`; backfyld koordinater på de 32 eBillet-biografer.
2. **Identitetslag.** Opret `source_refs`, backfyld fra `external_id`, `ebillet_organizer_id`, `ebillet_movie_base_id`, `ebillet_movie_ids`. Kør en read-only rapport over sandsynlige cross-source filmdubletter; flet kun manuelt bekræftede.
3. **Ny screenings-tabel skygge-udfyldes** fra `showtimes` og fra næste import, mens læsestien stadig bruger `showtimes`. Sammenlign counts pr. biograf og dato.
4. **Snapshot + promotion-RPC** tages i brug for eBillet først (mest veldefineret payload), derefter Kultunaut.
5. **Læsestien flyttes** til `screenings` bag en flag; `showtimes` beholdes read-only en release-cyklus og droppes derefter.
6. **Job-modellen konsolideres** og de to gamle drivere fjernes.
7. **Enrichment afkobles** til eget job.

## E. Tests og invarianter

Databasehåndhævet: unik screening-identitet; ingen `screenings`-række hvis kilde ≠ biografens `authoritative_source`; ingen sletning af rækker uden for det promoverede scope; ingen biograf uden `source_refs`-post.

Testet: stale delete inden for scope; ugyldigt/tomt snapshot bevarer eksisterende data; Kultunaut-only biograf urørt af eBillet-kørsel; idempotent gentaget promotion (nul writes anden gang); titelkollision opretter aldrig forkert identitet; afbrudt promotion efterlader ingen delvis tilstand; to samtidige kørsler af samme scope → én taber uden skade; retention sletter aldrig fremtidige forestillinger.

## F. Kan trygt forblive uændret

Frontend og design; `src/lib/cinema-data.ts` læsemønstre (bortset fra kildetabel); `parser.server.ts`; `venue-filter.ts`; `cinema-match.ts`; TMDb-klient og -matching; discovery af organizers; admin-UI'et; RLS-modellen som koncept (kun implementeringen af `cinema_is_public` bør denormaliseres).

## Performance ved 1.000 film / 500 biografer / 100.000 forestillinger

Datamængden i sig selv er triviel (< 100 MB). Det, der ikke skalerer, er: `cleanupStaleData()` som henter alle id'er til hukommelsen (200+ round trips); Kultunaut-fasens ét `SELECT` pr. gruppe (~30.000 kald); `movies_ranked` som fuld aggregering pr. request; RLS-funktionskald pr. række; og `loadAll` over alle showtimes pr. biograf. Målarkitekturen løser alle fem med scope-forespørgsler, mængdebaseret diff i SQL, en materialiseret rangeringstabel og et boolsk RLS-prædikat. Nødvendige indekser: `screenings(cinema_id, starts_at)`, `screenings(movie_id, starts_at)`, `screenings(starts_at)`, `unique(source, source_ref)`.

## Spørgsmål inden implementering

1. Skal jeg starte med trin 1 (stop blødningen) som en isoleret, hurtig leverance, før vi tager stilling til omskrivningen?
2. Accepteres `screenings` pr. forestilling som ny kanonisk granularitet — det er den ændring, alt andet hænger på?
3. Skal cross-source filmdubletter flettes automatisk over en confidence-tærskel, eller kun manuelt via en admin-kø?
