## 2024-05-30 - Fix reverse tabnabbing vulnerability
**Vulnerability:** External links were opened using `window.open(url.href, '_blank')` without specifying `noopener,noreferrer`.
**Learning:** This exposes the application to reverse tabnabbing, allowing the opened page to potentially redirect the original page to a malicious site.
**Prevention:** Always use `'noopener,noreferrer'` in the third argument of `window.open` when opening external URLs with `_blank`.

## 2024-06-03 - Fix DOM XSS in inline JS event handler
**Vulnerability:** User-controlled input was passed into inline JavaScript event handler strings without being escaped for JS (e.g. `onerror="this.src='${fb}'"`), causing DOM XSS through string breakout.
**Learning:** `escapeHtml` is not sufficient for variables interpolated inside JS contexts inside HTML attributes. A single quote `'` or a backslash `\` could break out of the string literal and execute arbitrary code.
**Prevention:** Always use `escapeJsHtml` for user input interpolated into inline JS context (such as `onerror`, `onclick`).
