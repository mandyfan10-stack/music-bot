# XXII SOUND

Telegram Mini App for publishing music releases, reviews, reactions, and comments.

## Repository layout

- `index.html`, `src/` — the static Telegram Mini App deployed to GitHub Pages.
- `tests/` — frontend unit tests run with Node.js.
- `supabase/` — the only active backend: database schema and Edge Functions.

The former FastAPI and MongoDB implementation is retained only in the archived
`mandyfan10-stack/music_backend` repository and its
`pre-monorepo-backend-2026-07-19` tag. It is not part of the production runtime.

## Local checks

```bash
npm ci
npm test
node --check src/app.js
node --check src/utils.js
node --check src/catalog-parse.js
node --check src/data-store.js
node --check src/boot.js
node --check src/telegram-web-app.js
node --check server.js
deno check --frozen supabase/functions/*/index.ts
deno fmt --check supabase/functions
deno test --frozen --allow-read=tests/fixtures supabase/functions/_shared/*_test.ts
```

Run the app locally with `node server.js` (http://127.0.0.1:3000). It serves
only `index.html` and `src/`, mirroring the Pages artifact.

Database migrations and the staging-first rollout procedure are documented in
[supabase/README.md](supabase/README.md). Production schema changes are never
deployed automatically by CI.

`supabase/schema.sql` is intentionally non-executable. The ordered migration
files are the only repository source of truth for database state.

GitHub Pages publishes a staged `_site` artifact containing only `index.html`
and `src/`. Backend source and repository metadata are never included in the
Pages artifact.
