## 2024-05-24 - Redundant Array Computations in Rendering
**Learning:** The application heavily relies on pre-calculated Maps for global state (like `avgRatingByRelId` and `genreCounts`), but several rendering functions (`renderReleaseCard`, `updateGenreBadge`) were bypassing these caches and manually recalculating values via `.reduce()` and `.filter()` during DOM updates. This causes unnecessary O(N*M) scaling when rendering the release grid.
**Action:** Always verify if a required aggregate value (like counts or averages) is already being maintained in a global cache/Map before recalculating it from scratch in a render loop.

## 2024-05-25 - Redundant Array Computations in Rendering userReviews
**Learning:** The application was calling `releases.find` inside `userReviews.map()`, causing an O(N*M) time complexity during the rendering of user reviews in a profile.
**Action:** Always verify if O(N) array operations inside loops can be replaced with O(1) lookups by precomputing a Map before the loop to reduce time complexity to O(N + M).
