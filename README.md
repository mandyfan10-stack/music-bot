# XXII SOUND

Telegram Mini App for publishing music releases, reviews, reactions, and comments.

## Repository layout

- `index.html`, `src/` ? the static Telegram Mini App deployed to GitHub Pages.
- `tests/` ? frontend unit tests run with Node.js.
- `supabase/` ? the only active backend: database schema and Edge Functions.

The former FastAPI and MongoDB implementation is retained only in the archived
`mandyfan10-stack/music_backend` repository and its
`pre-monorepo-backend-2026-07-19` tag. It is not part of the production runtime.

## Local checks

```bash
npm ci
npm test
node --check src/app.js
node --check src/utils.js
deno check --frozen supabase/functions/*/index.ts
```

GitHub Pages publishes a staged `_site` artifact containing only `index.html`
and `src/`. Backend source and repository metadata are never included in the
Pages artifact.
