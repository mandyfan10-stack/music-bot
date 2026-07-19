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

## Delayed contract phase

`20260719000300_identity_contract.sql` is not applied. Do not apply it before
seven stable days have elapsed and production telemetry has been reviewed. The
earliest planned review date is 2026-07-26. Roll schema issues forward; do not
run destructive down-migrations.
