## 2024-05-24 - Redundant Array Computations in Rendering
**Learning:** The application heavily relies on pre-calculated Maps for global state (like `avgRatingByRelId` and `genreCounts`), but several rendering functions (`renderReleaseCard`, `updateGenreBadge`) were bypassing these caches and manually recalculating values via `.reduce()` and `.filter()` during DOM updates. This causes unnecessary O(N*M) scaling when rendering the release grid.
**Action:** Always verify if a required aggregate value (like counts or averages) is already being maintained in a global cache/Map before recalculating it from scratch in a render loop.
## 2024-05-25 - Nested Array Operations inside Rendering Loops
**Learning:** The application was calling `releases.find()` (an O(N) operation) inside a `.map()` loop during the `renderUserReviews` function, creating a hidden O(N*M) performance bottleneck when rendering a profile's reviews.
**Action:** Always precompute a Map or Dictionary for O(1) lookups before entering a rendering loop when cross-referencing global state arrays like `releases`.
