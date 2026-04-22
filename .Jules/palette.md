## 2024-04-19 - Missing Accessibility Attributes Pattern
**Learning:** The application heavily utilizes Lucide icons for icon-only buttons and relies on placeholders for form inputs across its single-page architecture, leading to a systemic pattern of missing `aria-label` attributes on interactive elements and `alt` attributes on images.
**Action:** When working on UI components in `index.html` (both static and dynamically rendered), systematically enforce the addition of `aria-label` to all icon-only buttons and form inputs lacking visible labels, and ensure `alt` attributes on all images.

## 2026-04-21 - Added aria-label to rating +/- buttons
**Learning:** Dynamically created buttons with text content like '-' and '+' (or minus/plus symbols) need explicit `aria-label` attributes because their text content is ambiguous to screen readers. In this app, criteria ratings were missing this context.
**Action:** Always add descriptive `aria-label` when creating icon-only or symbol-only interactive elements using `document.createElement()`.
