# Code Audit Report (2026-04-22)

## Scope
- `index.html`
- `src/utils.js`
- `tests/utils.test.js`

## Method
- Manual static review for security, reliability, maintainability, and UX risks.
- Basic test execution: `node --test`.

## Findings

### 1) Missing Content Security Policy (CSP)
**Severity:** High  
**Area:** Front-end security hardening  
**Evidence:** No CSP `<meta http-equiv="Content-Security-Policy">` present in `index.html`.  
**Risk:** Any XSS bug that slips through escaping has a much larger blast radius because inline scripts/events and third-party script execution are unrestricted.

### 2) Third-party scripts loaded without Subresource Integrity (SRI)
**Severity:** High  
**Area:** Supply-chain security  
**Evidence:** External script includes for Tailwind CDN and Telegram/Lucide where SRI is not consistently applied.  
**Risk:** If CDN content is tampered with, malicious JavaScript can run in user sessions.

### 3) Inline event handlers are used throughout the page
**Severity:** Medium  
**Area:** Security + maintainability  
**Evidence:** Multiple `onclick="..."` attributes in markup and templated HTML.
**Risk:** Makes CSP adoption harder (`unsafe-inline` often required) and increases DOM XSS exposure if escaping regresses.

### 4) Single-file architecture (HTML + CSS + large JS block)
**Severity:** Medium  
**Area:** Maintainability / change risk  
**Evidence:** Main logic is embedded directly in one large script block inside `index.html`.
**Risk:** Harder code review, slower onboarding, and increased chance of regressions from unrelated edits.

### 5) Client-side cache has no freshness policy
**Severity:** Medium  
**Area:** Data consistency / UX  
**Evidence:** `localStorage` cache (`xxii_cache_v2`) is loaded eagerly and reused without TTL metadata.
**Risk:** Users can see stale data for long periods if backend calls fail intermittently.

### 6) Tests cover utility helpers only
**Severity:** Medium  
**Area:** Test coverage gap  
**Evidence:** `tests/utils.test.js` validates utility escaping/normalization only; core app flows (fetch, role handling, add/review/delete workflows) are untested.
**Risk:** High chance of shipping regressions in primary user journeys.

### 7) Positive controls found
**Severity:** Informational  
**Evidence:**
- Potentially unsafe links are filtered in `openSafeUrl` by protocol allowlist (`http/https`).
- Output escaping helpers exist (`escapeHtml`, `escapeJs`, `escapeJsHtml`) and are used in many templated render paths.
- Telegram init data is passed to backend via header, supporting server-side auth validation.

## Prioritized Recommendations
1. Add CSP and remove inline handlers incrementally (move to `addEventListener`).
2. Pin and protect external dependencies:
   - Prefer self-hosted critical JS/CSS bundles.
   - Use SRI+`crossorigin` for all CDN assets where possible.
3. Split front-end code into modules (`ui`, `api`, `state`, `render`) and keep HTML mostly declarative.
4. Add cache TTL/versioning and stale-data indicator in UI.
5. Expand automated tests:
   - Unit tests for filtering/sorting and escaping edge cases.
   - Integration tests for API error handling and role-based behavior.
6. Add linting + formatting + CI checks (e.g., ESLint + Prettier + Node test in CI).

## Quick Wins (1-2 days)
- Introduce ESLint config and run in CI.
- Add TTL to cache object (`savedAt`) with fallback refresh logic.
- Add at least 5-8 unit tests for rating/filter logic.

## Notes
This audit is based on the repository snapshot reviewed on **2026-04-22** and does not include backend source code.
