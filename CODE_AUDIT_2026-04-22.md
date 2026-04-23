# Code Audit Report (2026-04-23)

## Scope
- `index.html`
- `src/utils.js`
- `tests/utils.test.js`

## Method
- Manual static review (security, reliability, maintainability, performance).
- Pattern search for risky constructs (`onclick`, `innerHTML`, `localStorage`, `fetch`, CSP directives).
- Test execution: `node --test`.

## Findings

### 1) URL escaping bug for avatar image source
**Severity:** High  
**Area:** Correctness / reliability  
**Evidence:** In profile modal, the code writes an already-safe URL into `img.src` after `escapeHtml(...)`. This transforms `&` into `&amp;`, but for JS property assignment that entity decoding does not happen.  
**Where:** `index.html` (profile avatar assignment).

**Risk:** Query params may be corrupted (`&amp;...`), causing wrong avatar rendering and hard-to-debug behavior depending on provider parsing.

**Recommendation:** For DOM property assignment (`element.src`), avoid HTML escaping and assign URL string directly. Keep `encodeURIComponent` for user-provided fragments.

---

### 2) CSP allows `unsafe-inline` scripts and extensive inline handlers
**Severity:** High  
**Area:** Front-end security hardening  
**Evidence:** CSP uses `script-src ... 'unsafe-inline'`; page includes many inline `onclick="..."` handlers and dynamic HTML with inline handler attributes.

**Risk:** Any XSS regression gets significantly higher impact because inline script execution is explicitly allowed.

**Recommendation:** Gradually migrate to `addEventListener` and remove inline handler strings; then tighten CSP by removing `'unsafe-inline'` from `script-src`.

---

### 3) Templated `innerHTML` remains a concentrated XSS risk surface
**Severity:** Medium  
**Area:** Security / maintainability  
**Evidence:** Multiple render paths build large HTML strings via `innerHTML`.

**Risk:** Current escaping helpers reduce risk, but any future missed escaping in one field can become a DOM XSS.

**Recommendation:** For user content fields, prefer DOM APIs (`createElement`, `textContent`, `setAttribute`) in critical paths (reviews, release cards, profile reviews). Keep `innerHTML` only for static fragments.

---

### 4) External dependencies are not uniformly integrity-pinned
**Severity:** Medium  
**Area:** Supply-chain risk  
**Evidence:** `lucide` has SRI, but Tailwind CDN and Telegram script are loaded from third-party domains without integrity pinning.

**Risk:** Compromised CDN/asset chain can inject malicious code.

**Recommendation:** Prefer self-hosting critical JS/CSS, or use version pinning + SRI for all possible third-party assets.

---

### 5) Cache backward-compat path can return non-expiring stale data
**Severity:** Medium  
**Area:** Data consistency / UX  
**Evidence:** TTL exists for new cache format (`savedAt`), but legacy-format fallback returns data without expiry checks.

**Risk:** Users migrating from old cache format may see stale data until cache is overwritten by successful network fetch.

**Recommendation:** In legacy branch, add migration wrapper with synthetic timestamp and/or one-time invalidation.

---

### 6) Test coverage is focused on utility helpers only
**Severity:** Medium  
**Area:** Quality assurance  
**Evidence:** `tests/utils.test.js` covers escape/normalization functions; main UI logic and state transitions in `index.html` are untested.

**Risk:** Regressions in sorting/filtering/review workflows will likely bypass CI.

**Recommendation:** Extract pure functions (filter/sort/criteria/cache helpers) into `src/` modules and add Node tests for those units.

---

## Optimization opportunities (without functional changes)
1. **Reduce repeated icon re-initialization cost**: batch `lucide.createIcons()` calls after grouped DOM updates.
2. **Avoid full rerenders where possible**: in likes/filter actions, update affected card state instead of replacing entire grid HTML.
3. **Memoize repeated derived data**: `releasesById` map can be built once per data refresh, not per `renderUserReviews` call.
4. **Move to delegated event handling**: improves performance and reduces HTML string size by removing repeated inline handler attributes.

## Positive controls observed
- URL opening is protocol-restricted (`http/https`) in `openSafeUrl`.
- Escaping helpers exist and are covered by tests.
- Cache TTL mechanism is present in the new format.

## Executed checks
- `node --test` ✅ (13/13 passed)

## Notes
This audit is based on the repository snapshot reviewed on **2026-04-23** (UTC) and excludes backend source code.
