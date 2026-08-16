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
