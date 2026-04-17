const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let dom;
let window;

beforeEach((done) => {
    const html = fs.readFileSync(path.resolve(__dirname, './index.html'), 'utf8');

    dom = new JSDOM(html, {
        url: "http://localhost/",
        runScripts: "dangerously",
        beforeParse(win) {
            win.Telegram = { WebApp: { expand: () => {}, initData: '', initDataUnsafe: {} } };
            win.lucide = { createIcons: () => {} };
            win.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            win.requestAnimationFrame = (cb) => cb();
            // Mock intersection observer
            win.IntersectionObserver = class {
                constructor() {}
                observe() {}
                unobserve() {}
                disconnect() {}
            };
        }
    });

    window = dom.window;

    setTimeout(done, 100);
});

describe('getFilteredReleases', () => {

    const sampleReleases = [
        { id: 1, name: 'Rock 1', genre: 'Rock', timestamp: 1000 },
        { id: 2, name: 'Pop 1', genre: 'Pop', timestamp: 2000 },
        { id: 3, name: 'Rock 2', genre: 'Rock', timestamp: 3000 },
        { id: 4, name: 'Other 1', genre: 'Другое', timestamp: 4000 },
        { id: 5, name: 'No Genre', timestamp: 5000 }
    ];

    const sampleReviews = [
        { id: 1, relId: 1, rating: 5 },
        { id: 2, relId: 1, rating: 3 }, // avg 4
        { id: 3, relId: 2, rating: 5 }, // avg 5
        { id: 4, relId: 3, rating: 1 }, // avg 1
        // no reviews for 4, 5
    ];

    beforeEach(() => {
        window.applyData({
            releases: sampleReleases,
            reviews: sampleReviews
        });
    });

    it('should sort by timestamp descending when sortMode is "new" (default)', () => {
        window.setSortMode('new');

        const result = window.getFilteredReleases();

        expect(result).toHaveLength(5);
        expect(result.map(r => r.id)).toEqual([5, 4, 3, 2, 1]);
    });

    it('should filter by genre correctly', () => {
        window.selectGenreFilter('Rock');

        const result = window.getFilteredReleases();

        // Should have 2 Rock releases, sorted by timestamp descending
        expect(result).toHaveLength(2);
        expect(result.map(r => r.id)).toEqual([3, 1]);
    });

    it('should fallback to "Другое" when genre is missing', () => {
        window.selectGenreFilter('Другое');

        const result = window.getFilteredReleases();

        // Should have 'Other 1' (genre: 'Другое') and 'No Genre' (genre: undefined)
        expect(result).toHaveLength(2);
        // Sorted by timestamp desc
        expect(result.map(r => r.id)).toEqual([5, 4]);
    });

    it('should return empty array if no releases match the genre', () => {
        window.selectGenreFilter('Джаз');

        const result = window.getFilteredReleases();

        expect(result).toHaveLength(0);
    });

    it('should sort by rating descending', () => {
        window.setSortMode('rating-desc');

        const result = window.getFilteredReleases();

        // Averages:
        // 2 -> 5
        // 1 -> 4
        // 3 -> 1
        // 4 -> 0
        // 5 -> 0
        // Expected order: 2, 1, 3, and then 4, 5 (order of 4,5 is implementation dependent but typically stable or preserved)
        const top3 = result.slice(0, 3).map(r => r.id);
        expect(top3).toEqual([2, 1, 3]);
    });

    it('should sort by rating ascending', () => {
        window.setSortMode('rating-asc');

        const result = window.getFilteredReleases();

        // Expected order: lowest average first
        // 4, 5 -> 0
        // 3 -> 1
        // 1 -> 4
        // 2 -> 5
        // Ensure 3 is before 1, and 1 before 2
        const ids = result.map(r => r.id);
        expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(1));
        expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(2));
    });

    it('should sort by number of reviews descending', () => {
        window.setSortMode('reviews');

        const result = window.getFilteredReleases();

        // Counts:
        // 1 -> 2
        // 2 -> 1
        // 3 -> 1
        // 4 -> 0
        // 5 -> 0
        const ids = result.map(r => r.id);
        expect(ids[0]).toBe(1); // max reviews
        // 2 and 3 both have 1 review, so their relative order might vary, but they should be next
        expect([2, 3]).toContain(ids[1]);
        expect([2, 3]).toContain(ids[2]);
    });

    it('should handle clearing genre filter', () => {
        window.selectGenreFilter('Rock');
        expect(window.getFilteredReleases()).toHaveLength(2);

        // Call it again to toggle off
        window.selectGenreFilter('Rock');

        // Should have all 5 back
        expect(window.getFilteredReleases()).toHaveLength(5);
    });
});
