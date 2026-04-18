## 2024-05-15 - [Add noopener,noreferrer to window.open]
**Vulnerability:** The `window.open(url.href, '_blank')` call in `index.html`'s `openSafeUrl` did not include the `noopener` and `noreferrer` attributes.
**Learning:** Opening user-provided links in a new tab without `noopener` allows the newly opened page to access the original page's `window.opener` object. This can lead to a reverse tabnabbing attack, where the malicious page changes `window.opener.location` to a phishing page.
**Prevention:** Always include `noopener` and `noreferrer` as the third argument in `window.open` calls when using `_blank`.
