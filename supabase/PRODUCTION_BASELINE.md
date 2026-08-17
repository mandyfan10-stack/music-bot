# Production baseline and rollout record

Project `ftpofwybzvhvyukrshcm` (`music_bot`) was verified and migrated on
2026-07-19. Credential values are intentionally excluded from this report and
from Git.

## Pre-migration baseline

Before any hosted change, a local migration-scope logical snapshot was written
outside the repository. It contains the public catalog and all data touched by
the migrations; large embedded cover bodies are represented by byte length and
SHA-256 because the rollout does not modify release images.

Snapshot SHA-256:
`12632bfb50cd37a744e946f1d6de477202dbd3b60de94758ae1baa6aea373413`.

The original inventory contained 8 public tables, 62 public columns, 15
constraints, 14 indexes, 20 RLS policies, 2 public views, and one legacy
release-notification trigger. It matched
`20260719000000_repository_baseline.sql` except for the legacy trigger function,
which embedded an anon credential and was intentionally excluded from Git.

## Identity gates

- 2 administrator rows were bound to stable Telegram IDs;
- each binding had the same ID in the signature-verified subscriber mapping and
  in unambiguous authored content;
- 0 blocked-user rows required mapping;
- 0 duplicate `(release_id, author_id)` review groups existed.

## Applied production scope

The baseline marker and these backwards-compatible migrations are applied:

- `identity_expand`;
- `server_api_expand`;
- `notification_webhook`;
- `security_advisor_fixes`;
- `private_rls_helpers`;
- `policy_normalization`.

Vault contains `notification_webhook_url` and
`notification_webhook_service_role`. The database webhook no longer contains a
hardcoded JWT. The deployed Functions are `auth`, `parse-link`,
`send-notifications`, and `share-message`; notification JWT verification is
enabled at the Edge gateway and the function additionally requires the
`service_role` claim.

Post-rollout data counts remained 18 releases, 8 reviews, 1 comment, 5 likes, 7
reactions, 3 subscribers, and 2 administrators. Transactional production probes
were rolled back after verifying server-authoritative review/comment fields,
duplicate-review rejection, immediate blocked-user enforcement, and immediate
admin revocation. Notification probes returned 401 without auth, 403 for anon,
200 for service-role on a non-delivery event, and created no delivery rows.
Supabase Security Advisors report no findings.

## Delayed contract phase (status recorded 2026-07-19)

`20260719000300_identity_contract.sql` is not applied. Do not apply it before
seven stable days have elapsed and production telemetry has been reviewed. The
earliest planned review date is 2026-07-26. Roll schema issues forward; do not
run destructive down-migrations.

The section above is the historical 2026-07-19 record. Current hosted state is
recorded in the dated rollout note below.

## Production privacy and runtime rollout (2026-08-16)

The Supabase integration reported the project as `ACTIVE_HEALTHY` on Postgres
17. Migration `20260816074509_protect_private_reactions_and_counts` is applied
and its version matches the repository filename.

The rollout repaired the hosted drift found by the preflight audit:

- removed the unauthenticated `SECURITY DEFINER` development RPCs;
- replaced public raw like/reaction reads with owner-only policies;
- backfilled and verified public aggregate reaction counts (7 stored and 7 raw,
  with zero mismatches);
- published all six application tables required by Supabase Realtime;
- kept both public views as `security_invoker=true` and the review trigger
  enabled.

Deployed Edge Function versions are `auth` v12 (`verify_jwt=false`, Telegram
signature bootstrap), `parse-link` v16 (`verify_jwt=true` plus either an
internal `authenticated` role check or signature-verified Telegram initData for
already-deployed clients), `share-message` v12 (`verify_jwt=true` plus its
signature/claim checks), and `send-notifications` v11 (`verify_jwt=true`). The
auth subscriber upsert now runs with the newly issued user JWT instead of the
service-role request context.

Transactional RLS probes confirmed that anon and an unrelated authenticated
user cannot enumerate like/reaction identities, while aggregate counts remain
visible. A rolled-back subscriber probe confirmed the user-context upsert and
server-owned Telegram identity fields. HTTP probes returned 401 without auth,
403/401 for anon JWTs on the two user functions, and the auth endpoint returned
200 for CORS preflight, 400 for an invalid payload, and 405 for GET. Supabase
Security Advisors report no findings after the rollout.

Performance Advisors retain only informational notices for two currently
unused indexes and the fixed Auth connection allocation. Keep the indexes until
representative query statistics justify removal; revisit the Auth allocation
when changing compute size.

## Startup and artwork rollout (2026-08-16)

The startup audit found that the Telegram bootstrap function was hand-signing
tokens with a stale application secret. Supabase Auth rejected those tokens as
`bad_jwt`, and one observed `/auth/v1/user` failure took 4.42 seconds. The
replacement flow uses admin-generated, single-use magic-link hashes to mint a
normal managed Supabase Auth session. Telegram ID and display claims are stored
in `app_metadata`, while RLS continues to resolve the live admin and blocked
tables on every protected operation.

The public catalog now starts in parallel with authentication, and account
state hydrates in the background. Six Base64 JPEG covers were copied byte for
byte into the public `release-covers` Storage bucket. The release payload fell
from 1,734,299 bytes to 6,184 bytes; production contains six Storage objects,
six Storage-backed release URLs, and zero remaining Base64 release rows.

Final hosted versions after removing all one-time verification hooks are
`auth` v24 and `release-cover` v2, both `verify_jwt=false` with signed Telegram
initData enforced in their function bodies. The managed Auth exchange was
verified end to end for both first login and repeat login; temporary test users
were deleted afterward.

## Identity contract pre-apply checklist (2026-08-17)

This was the same-day checklist before applying
`20260719000300_identity_contract.sql`. The seven-day observation window had
elapsed; hosted gates still had to be re-checked on project
`ftpofwybzvhvyukrshcm`, and there is no down-migration. Additive
`20260817120000_accept_client_entity_ids.sql` was to ship with the matching
frontend (`p_id` on `create_review` / `create_comment`). Both migrations were
applied in the hosted rollout below.

## Hosted rollout (2026-08-17)

Project `ftpofwybzvhvyukrshcm` gates were re-checked live: 2 admins both bound
to Telegram `user_id`, 0 blocked rows, 0 duplicate `(release_id, author_id)`
groups. Applied hosted migrations `accept_client_entity_ids` and
`identity_contract`. Admin/blocked primary keys are now `user_id`.
`create_review` / `create_comment` accept optional `p_id`.

Deployed Edge Function versions: `share-message` v13 (`verify_jwt=true`,
managed Telegram claims), `auth` v25 (`verify_jwt=false`, Telegram signature
still required, no `DEV_MODE`), `parse-link` v17 (`verify_jwt=true`,
authenticated JWT only). `release-cover` v2 and `send-notifications` v11 were
not changed.

## Catalog-parse extract (2026-08-17)

`parse-link` v18 matches the repository layout: genre/title/Yandex URL helpers
live in `_shared/catalog_parse.ts`. Gateway `verify_jwt=true` and the
authenticated-role check are unchanged. HTTP probes after deploy returned 200
for CORS preflight, 401 without a JWT, and 403 for an anon JWT. `auth` v25,
`share-message` v13, `release-cover` v2, and `send-notifications` v11 were not
changed.
