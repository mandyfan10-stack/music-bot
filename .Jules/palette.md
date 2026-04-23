## 2026-04-22 - Semantic Tags for Interactive Elements
**Learning:** Using `<div>` elements with `onclick` handlers, common in custom UI components (like profile buttons or image upload previews), breaks native keyboard accessibility and screen reader support.
**Action:** Always prefer semantic tags like `<button>` over `<div>` for interactive elements to ensure out-of-the-box keyboard navigation (Enter/Space) and focus states, combined with `aria-label` attributes where visual text is missing.

## 2026-04-22 - Dynamic Element Accessibility
**Learning:** Elements generated dynamically via JavaScript (like the 1-10 rating scale buttons created with `document.createElement`) often lack intrinsic context for screen readers if their content is purely numerical.
**Action:** When dynamically generating UI controls via DOM manipulation, ensure `.setAttribute('aria-label', ...)` is called to provide clear, descriptive context for assistive technologies.
