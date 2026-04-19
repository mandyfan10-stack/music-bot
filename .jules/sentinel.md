## 2024-05-30 - Fix reverse tabnabbing vulnerability
**Vulnerability:** External links were opened using `window.open(url.href, '_blank')` without specifying `noopener,noreferrer`.
**Learning:** This exposes the application to reverse tabnabbing, allowing the opened page to potentially redirect the original page to a malicious site.
**Prevention:** Always use `'noopener,noreferrer'` in the third argument of `window.open` when opening external URLs with `_blank`.
