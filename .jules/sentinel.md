## 2024-05-30 - Fix reverse tabnabbing vulnerability
**Vulnerability:** External links were opened using `window.open(url.href, '_blank')` without specifying `noopener,noreferrer`.
**Learning:** This exposes the application to reverse tabnabbing, allowing the opened page to potentially redirect the original page to a malicious site.
**Prevention:** Always use `'noopener,noreferrer'` in the third argument of `window.open` when opening external URLs with `_blank`.

## 2024-10-24 - Fix DOM XSS via unescaped external data injection
**Vulnerability:** External user-controlled input (like release names and cover image URLs) were injected directly into inline JavaScript event handlers (like `onerror`) or directly into the DOM using `innerHTML` using template literals, leading to DOM XSS possibilities. Even when generating fallback image urls where input was safely passed to `encodeURIComponent()`, single quotes were not escaped, leading to javascript execution context breakouts in `onerror` handlers.
**Learning:** `encodeURIComponent()` does NOT escape single quotes (`'`), leading to potential breakouts when injecting data into JS event handlers wrapped in single quotes within HTML attributes. Using `innerHTML` must always be audited for user-controlled strings, even if those strings come from external (assumed safe) sources like OEmbed or iTunes, as those sources may reflect malicious user data.
**Prevention:** Always use `escapeHtml()` when updating `innerHTML` with string interpolation. Always use `escapeJsHtml()` when interpolating variables into inline JavaScript strings inside HTML event handler attributes (like `onclick` or `onerror`), regardless of whether `encodeURIComponent()` was used previously.
