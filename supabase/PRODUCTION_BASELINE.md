# Production baseline verification

Verified on 2026-07-19 against project `ftpofwybzvhvyukrshcm` using
read-only Management API queries. No production data or schema was modified.

## Schema inventory

- 8 public tables and 62 public columns;
- 15 constraints and 14 indexes;
- 20 RLS policies;
- 2 public views;
- 1 public trigger function and 1 trigger.

Tables, columns, constraints, indexes, views, and RLS policies match
`20260719000000_repository_baseline.sql`. The only catalog drift is the legacy
release-notification trigger/function, which embeds an anon credential.
`20260719000250_notification_webhook.sql` replaces it with a Vault-backed
service-role call. Credential values are intentionally excluded from this
report and from Git.

## Data gates

- 2 administrator rows;
- both administrators map unambiguously to one authored Telegram `user_id`;
- 0 blocked-user rows;
- 0 ambiguous or missing blocked-user mappings;
- 0 duplicate `(release_id, author_id)` review groups;
- 18 releases, 8 reviews, and 1 comment.

The authored mapping is evidence for operator review, not a substitute for the
required fresh signed Telegram login before binding administrator IDs.

## Deployment status

The repository baseline has not been marked as applied on production.
Production SQL, Functions, frontend, secrets, and webhook configuration remain
unchanged until a separate hosted staging project passes the acceptance matrix.