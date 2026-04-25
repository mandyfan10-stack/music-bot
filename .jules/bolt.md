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

## 2024-05-28 - Duplicate Inflight External API Requests
**Learning:** Functions communicating with external APIs (like `fetchItunesData`) can generate duplicate inflight requests if identical requests are triggered concurrently before the first completes, causing excessive latency, bandwidth usage, and potential rate limits.
**Action:** When adding memory cache (like `new Map()`) to deduplicate requests, cache the initial `Promise` rather than just the final result, and ensure failed promises are evicted so retries can occur.

## 2024-05-29 - Unnecessary Array Allocations in Sort/Filter Paths
**Learning:** During rendering updates, making an initial copy of an entire array (e.g. `let filtered = [...releases]`) only to immediately replace it with a filtered version (`filtered = filtered.filter(...)`) causes unnecessary memory allocation and GC overhead. Additionally, using `(map.get(id) || []).length` inside a sort comparator allocates a new empty array on every comparison miss, which runs `O(N log N)` times.
**Action:** Only make array copies when strictly necessary (e.g., before `.sort()`, but not before `.filter()`, which returns a new array anyway). In sort comparators, prefer optional chaining `map.get(id)?.length || 0` over allocating fallback arrays.
