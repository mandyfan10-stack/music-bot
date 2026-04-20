## 2024-04-19 - Missing Accessibility Attributes Pattern
**Learning:** The application heavily utilizes Lucide icons for icon-only buttons and relies on placeholders for form inputs across its single-page architecture, leading to a systemic pattern of missing `aria-label` attributes on interactive elements and `alt` attributes on images.
**Action:** When working on UI components in `index.html` (both static and dynamically rendered), systematically enforce the addition of `aria-label` to all icon-only buttons and form inputs lacking visible labels, and ensure `alt` attributes on all images.

## 2024-05-24 - Accessibility for dynamically generated rating components
**Learning:** In vanilla JS setups, dynamically generated rating buttons (e.g., a 1-10 scale, or +/- for rating criteria) are completely ambiguous to screen readers since they rely only on visual layout and simple text content (e.g., "1", "−", "+").
**Action:** When dynamically creating interactive UI components with JS (`document.createElement`), always ensure you `setAttribute('aria-label', ...)` with descriptive text linking the control to its visual context (e.g., "Оценка 1 из 10" or "Увеличить оценку по критерию Звук").
