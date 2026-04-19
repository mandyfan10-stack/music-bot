## 2024-04-19 - Missing Accessibility Attributes Pattern
**Learning:** The application heavily utilizes Lucide icons for icon-only buttons and relies on placeholders for form inputs across its single-page architecture, leading to a systemic pattern of missing `aria-label` attributes on interactive elements and `alt` attributes on images.
**Action:** When working on UI components in `index.html` (both static and dynamically rendered), systematically enforce the addition of `aria-label` to all icon-only buttons and form inputs lacking visible labels, and ensure `alt` attributes on all images.
