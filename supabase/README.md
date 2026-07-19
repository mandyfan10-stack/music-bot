# Supabase backend

This directory is the only active backend. The FastAPI and MongoDB implementation remains in the archived `music_backend` repository for history and rollback only.

## Migration files

- `20260719000000_repository_baseline.sql` is the imported repository snapshot used to build a clean local database in CI. It is a baseline candidate, not proof of the current production schema.
- `20260719000100_identity_expand.sql` is the backwards-compatible expansion phase. It adds stable Telegram `user_id` columns and reports identity mappings that require operator review.
- `20260719000200_server_api_expand.sql` is the server/API rollout phase. It stops on unresolved identity or duplicate-review data, then installs server-authoritative RPCs, current-table authorization, RLS, uniqueness, and delivery idempotency while retaining the legacy username columns.
- `20260719000250_notification_webhook.sql` replaces the legacy anon webhook with a service-role call whose URL and key are read from Supabase Vault.
- `20260719000300_identity_contract.sql` is the delayed contract phase. After seven stable days it makes stable Telegram IDs mandatory and switches the administrator/block primary keys.

Never run the repository baseline against an existing production database. Pull the real production baseline first and mark the matching baseline migration as applied only after a zero schema diff.

The latest redacted production inventory and gate results are recorded in
[`PRODUCTION_BASELINE.md`](PRODUCTION_BASELINE.md).

## Local validation

Docker (or another Docker-compatible runtime), Deno 2.4.1, and Supabase CLI 2.84.2 are required.

```bash
supabase db start
supabase test db
deno fmt --check supabase/functions
deno check --frozen supabase/functions/*/index.ts
deno test --frozen supabase/functions/_shared/*_test.ts
```

CI starts a fresh local Supabase database, applies all migrations, and runs the pgTAP RLS contract. CI never links to or deploys a hosted project.

## Create and baseline staging

Use two different project references and verify them before every linked command:

```bash
supabase login
supabase link --project-ref <production-project-ref>
supabase db dump --linked --schema public --file production-public-schema.sql
supabase db dump --linked --data-only --schema public --file production-public-data.sql

supabase link --project-ref <staging-project-ref>
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

Keep dumps outside Git and in encrypted storage. Reconcile the production dump with the baseline candidate. On an empty scratch database, apply the reconciled baseline and require an empty diff:

```bash
supabase db diff --linked --schema public
```

Do not mark the production baseline applied until that diff is empty. Do not use `db reset --linked` on production.

## Identity-binding gate

After the expansion migration, the owner must perform a fresh signed Telegram login. Compare the JWT `sub` with the Telegram user ID from that login and bind it explicitly:

```sql
update public.admins
set user_id = <verified_telegram_user_id>
where username = lower(trim(leading '@' from '<verified_username>'));
```

Before the contract migration, all of these queries must return zero rows:

```sql
select * from public.admins where user_id is null;
select * from public.blocked_users where user_id is null;
select release_id, author_id, count(*)
from public.reviews
group by release_id, author_id
having count(*) > 1;
```

Review every ambiguous username manually. The contract migration is designed to stop instead of guessing.

## Staging acceptance matrix

Validate with distinct anon, normal, blocked, and admin sessions:

- review/comment RPCs ignore forged author and timestamp fields;
- ratings require exactly six numeric criteria from 1 through 10;
- a second review for the same release and author fails;
- likes/reactions are attributed by the server;
- blocking takes effect with an already-issued JWT;
- deleting an admin row revokes access with an already-issued JWT;
- changing a Telegram username does not change identity or permissions;
- valid Telegram initData succeeds; expired, future, and tampered data fails;
- notification webhook rejects anon/authenticated JWTs, accepts service-role, and does not duplicate a delivery;
- metadata parsing rejects localhost, private/documentation IPv4, IPv6 loopback/link-local/ULA, DNS failure, a private redirect, oversized HTML, and non-HTML content.

Store only these values in Supabase/GitHub Secrets: Telegram bot token, Supabase JWT/service keys, Groq key, and webhook credentials. Never put values in committed config or logs.

Before testing notifications on each hosted project, create or update the Vault
secrets without committing their values:

```sql
select vault.create_secret(
  '<project service-role key>',
  'notification_webhook_service_role'
);
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/send-notifications',
  'notification_webhook_url'
);
```

## Production rollout and rollback

1. Take a verified database backup.
2. Apply only backwards-compatible expansion SQL.
3. Deploy Edge Functions.
4. Deploy the RPC-aware frontend.
5. Observe staging-equivalent telemetry and errors.
6. After seven stable days, apply the contract migration.
7. Update the old repository README to point here, then archive it on GitHub.

Rollback frontend and Edge Functions by redeploying their previous versions. Do not run destructive down-migrations; repair schema changes with a forward migration. A production deploy or old-repository archive is always a separate, manually approved operation.