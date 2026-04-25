# Code Audit Report (2026-04-25)

## Scope
- `index.html`
- `src/utils.js`
- `tests/utils.test.js`

## Checks Performed
- Manual static review of the single-page Telegram Web App UI.
- JavaScript syntax check for the inline script inside `index.html`.
- Utility test run with `node --test`.
- Pattern search for previously identified risky/buggy constructs.

## Fixed Issues

### 1) App crashed outside Telegram
**Severity:** High  
`index.html` accessed `window.Telegram.WebApp` directly. Opening the app in a normal browser could throw before the UI initialized.

**Fix:** Added a safe Telegram WebApp fallback and optional `expand()` call.

### 2) Invalid release card width
**Severity:** High  
Release cards used `w-[calc(50%-8px)]`. CSS `calc()` requires spaces around operators, so the generated width could be invalid and break the two-column layout.

**Fix:** Replaced the flex-based card sizing with stable `grid grid-cols-2 gap-4` containers and `w-full` cards.

### 3) Sort active state could remain visually stuck
**Severity:** Medium  
The initial sort button had the `active` class, but `setSortMode()` did not move that class when users changed sorting.

**Fix:** `setSortMode()` now removes and applies `active` consistently.

### 4) Genre dropdown did not open on empty focus
**Severity:** Medium  
The search field called `showGenreDropdown()` on focus, but the function immediately closed the dropdown for an empty query.

**Fix:** Empty focus now shows the full genre list, while typed input still filters it.

### 5) Mobile modal overflow risk
**Severity:** Medium  
The add-release modal could overflow smaller screens because it lacked max height and internal scrolling.

**Fix:** Added `max-h-[92vh]`, `overflow-y-auto`, and hidden scrollbar styling to the modal container.

### 6) Profile name double-escaping
**Severity:** Low  
Profile names were assigned with `innerText = escapeHtml(...)`, which can display entities such as `&amp;` literally.

**Fix:** Switched to `textContent` with the raw string.

### 7) Brittle like-button DOM selector
**Severity:** Low  
The like update path searched inline `onclick` text, which is fragile and hard to escape correctly.

**Fix:** Added `data-like-id` and a tested `escapeCssString()` helper for selector-safe updates.

### 8) Legacy cache could show stale data
**Severity:** Low  
Old cache objects without timestamps could be rendered once before fresh data arrived.

**Fix:** Legacy cache is now invalidated instead of displayed.

## Remaining Risks
- Inline event handlers and broad `innerHTML` rendering remain the largest long-term XSS maintenance surface.
- External CDN scripts are still required by this static page; self-hosting/pinning all third-party assets would improve supply-chain resilience.
- There is no browser automation dependency in this repo, so visual validation was limited to static/layout review and script/test checks.

## Verification
- `node --test` passed: 19/19 tests.
- Inline script parse check passed.
- `node --check src/utils.js` passed.
