## 2026-04-22 - Semantic Tags for Interactive Elements
**Learning:** Using `<div>` elements with `onclick` handlers, common in custom UI components (like profile buttons or image upload previews), breaks native keyboard accessibility and screen reader support.
**Action:** Always prefer semantic tags like `<button>` over `<div>` for interactive elements to ensure out-of-the-box keyboard navigation (Enter/Space) and focus states, combined with `aria-label` attributes where visual text is missing.

## 2026-04-22 - Dynamic Element Accessibility
**Learning:** Elements generated dynamically via JavaScript (like the 1-10 rating scale buttons created with `document.createElement`) often lack intrinsic context for screen readers if their content is purely numerical.
**Action:** When dynamically generating UI controls via DOM manipulation, ensure `.setAttribute('aria-label', ...)` is called to provide clear, descriptive context for assistive technologies.

## 2026-04-24 - Complex Card Accessibility
**Learning:** Adding interactive elements (like a "Like" button) inside a semantic `<button>` or `<a>` creates invalid HTML and breaks assistive tech.
**Action:** For complex interactive cards containing nested buttons, use a non-interactive wrapper (like `<div>`), but apply `tabindex="0"`, `role="button"`, and handle keyboard events (`onkeydown` for Enter and Space) to ensure the card remains accessible without generating invalid nested interactive markup.

## 2026-04-26 - Added Escape Key Support for Modals
**Learning:** Adding global keydown handlers in a single-file application structure requires careful lifecycle management (e.g., stacking modals in an array) to ensure you only dismiss the active, topmost view without interfering with other global keybindings (like Enter/Space for haptic feedback).
**Action:** Always verify if a custom implementation of a stack (like `activeModals` array) is needed for managing multi-layered components (like modals or dropdowns) when native elements (`<dialog>`) are not used. Ensure to `pop` or filter upon closing.
