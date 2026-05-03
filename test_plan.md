1. **Optimize getFilteredReleases in index.html**
   - Refactor `getFilteredReleases()` to avoid intermediate array copies (`[...releases]`) before filtering. Instead, apply the filter directly to `releases` or return a copy if no filter is active.
   - Prevent unnecessary array allocation during sorting by replacing `(reviewsByRelId.get(id) || []).length` with optional chaining `reviewsByRelId.get(id)?.length || 0`. This eliminates allocations inside an `O(N log N)` operation.
2. **Verify changes**
   - Run tests using `node --test tests/utils.test.js` to ensure nothing is broken.
3. **Complete pre commit steps**
   - Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.
4. **Submit PR**
   - Submit the PR with standard Bolt formatting, including What, Why, Impact, and Measurement.
