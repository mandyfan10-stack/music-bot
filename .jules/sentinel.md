## 2024-05-30 - Fix reverse tabnabbing vulnerability
**Vulnerability:** External links were opened using `window.open(url.href, '_blank')` without specifying `noopener,noreferrer`.
**Learning:** This exposes the application to reverse tabnabbing, allowing the opened page to potentially redirect the original page to a malicious site.
**Prevention:** Always use `'noopener,noreferrer'` in the third argument of `window.open` when opening external URLs with `_blank`.

## 2025-02-23 - Prevent DOM XSS in inline JS event handlers due to unescaped single quotes
**Vulnerability:** User-controlled values dynamically embedded into inline JS event handlers in HTML attributes (e.g. `onerror="this.src='${fb}'"`) were vulnerable to DOM XSS because `encodeURIComponent` (used to sanitize `fb`) does not escape single quotes (`'`). This allows an attacker to break out of the string context and execute arbitrary JavaScript.
**Learning:** `encodeURIComponent` does not provide sufficient escaping for single quotes when the resulting string is embedded within a single-quoted JavaScript string inside an HTML attribute.
**Prevention:** Always use `escapeJsHtml()` when interpolating variables into inline JavaScript handlers (like `onclick`, `onerror`, etc.) to properly escape JS special characters and prevent string breakout.

## 2025-02-23 - Prevent DOM XSS when injecting external API data via innerHTML
**Vulnerability:** In `handleAddRelease()`, the application fetched data from external APIs (oEmbed, iTunes, etc.) and injected `parsedCover` directly into the DOM using `innerHTML` without escaping. An attacker could potentially return malicious payloads containing double quotes to break out of the `src` attribute context and inject executable code (DOM XSS).
**Learning:** Even data from seemingly trusted or well-known APIs (like oEmbed or iTunes) must be treated as untrusted. Injecting external API data directly into `innerHTML` is dangerous.
**Prevention:** Always sanitize/escape external data using `escapeHtml()` before injecting it into the DOM via `innerHTML`, even if the data originates from a "trusted" external source.

## 2026-04-26 - Fix path traversal vulnerability in dynamically built API request URLs
**Vulnerability:** Unsanitized variables were appended directly to API paths in `fetch` requests (e.g., `fetch(BACKEND_URL + "/api/releases/" + releaseToDelete)`). An attacker could manipulate `releaseToDelete` or `pendingReviewDelete` to include path traversal characters like `../`, allowing them to execute operations on unintended endpoints or access arbitrary paths on the backend server.
**Learning:** Even when the backend handles IDs internally, any variable injected directly into an endpoint URL structure from the frontend must be URL-encoded to prevent path traversal issues.
**Prevention:** Always sanitize dynamically embedded variables in URL paths using `encodeURIComponent()` to ensure path segments are treated as data, not directory traversals.
