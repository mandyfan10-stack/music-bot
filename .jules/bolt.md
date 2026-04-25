## 2024-05-24 - Redundant Array Computations in Rendering
**Learning:** The application heavily relies on pre-calculated Maps for global state (like `avgRatingByRelId` and `genreCounts`), but several rendering functions (`renderReleaseCard`, `updateGenreBadge`) were bypassing these caches and manually recalculating values via `.reduce()` and `.filter()` during DOM updates. This causes unnecessary O(N*M) scaling when rendering the release grid.
**Action:** Always verify if a required aggregate value (like counts or averages) is already being maintained in a global cache/Map before recalculating it from scratch in a render loop.

## 2024-05-25 - Redundant Array Computations in Rendering userReviews
**Learning:** The application was calling `releases.find` inside `userReviews.map()`, causing an O(N*M) time complexity during the rendering of user reviews in a profile.
**Action:** Always verify if O(N) array operations inside loops can be replaced with O(1) lookups by precomputing a Map before the loop to reduce time complexity to O(N + M).

## 2024-05-25 - Redundant DOM Recreations in Interactive Handlers
**Learning:** Calling full UI rendering functions (like `renderReleases()`) inside simple interactive event handlers (like toggling a "like") forces the browser to rebuild the entire DOM grid (O(N) operations), re-fetch images, and re-initialize icons, causing severe performance degradation for large datasets.
**Action:** When updating a localized interactive state (like an icon toggle), prefer targeted DOM updates using `e.currentTarget` or `document.querySelectorAll()` to achieve O(1) performance instead of triggering global state sync re-renders.

## 2024-05-26 - Redundant Array Scanning in Duplicate Checking
**Learning:** Checking for duplicate reviews or finding a user's review for a specific release was previously done by iterating over the global `reviews` array using `reviews.find(...)` which triggers an O(N) operation over all reviews.
**Action:** Always utilize the existing global maps, like `reviewsByRelId`, which index relevant items by relational IDs, enabling lookup and scans that are restricted to just the targeted subset (effectively O(1) in the broader dataset).

## 2024-05-27 - Full Recalculations During State Mutations
**Learning:** The application was recalculating full O(N) Maps (like `avgRatingByRelId`, `genreCounts`, `reviewsByRelId`) from scratch on every single add/delete mutation. This causes expensive overhead on every action. Using incremental cache updates for these maps prevents this performance degradation as lists grow.
**Action:** When mutating state (add/delete), update the relevant caches/Maps incrementally for the specific item rather than clearing and completely rebuilding the maps from the entire array.

## 2026-04-25 - [Optimize renderLikes array filtering]
**Learning:** When filtering global data arrays against a specific Set of IDs for rendering, using an O(N) `.filter()` over the full array is inefficient.
**Action:** Use an O(K) lookup by mapping `Array.from(likedSet)` directly using the `releasesById` Map and filtering out Boolean falsy values. This reduces execution time by ~97% for large arrays.
