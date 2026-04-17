const fs = require('fs');

const code = fs.readFileSync('index.html', 'utf8');

// I need to test the performance of sorting in getFilteredReleases
// We can mock releases and reviews and getFilteredReleases

let getFilteredReleasesOriginal;

function setupOriginal() {
    let activeGenreFilter = null;
    let sortMode = 'rating-desc';
    let releases = [];
    let reviews = [];

    // Generate 1000 releases
    for (let i = 0; i < 1000; i++) {
        releases.push({ id: 'rel' + i, genre: 'Rock', timestamp: Date.now() - Math.random() * 10000 });
    }

    // Generate 5000 reviews
    for (let i = 0; i < 5000; i++) {
        reviews.push({ relId: 'rel' + Math.floor(Math.random() * 1000), rating: Math.floor(Math.random() * 10) + 1 });
    }

    function getAvgRating(relId) {
      const rvs = reviews.filter(r => r.relId === relId);
      if (rvs.length === 0) return 0;
      return rvs.reduce((s, r) => s + (r.rating || 0), 0) / rvs.length;
    }

    function getFilteredReleases() {
      let filtered = [...releases];

      // Фильтр по жанру
      if (activeGenreFilter) {
        filtered = filtered.filter(r => (r.genre || 'Другое') === activeGenreFilter);
      }

      // Сортировка
      switch (sortMode) {
        case 'rating-desc':
          filtered.sort((a, b) => getAvgRating(b.id) - getAvgRating(a.id));
          break;
        case 'rating-asc':
          filtered.sort((a, b) => getAvgRating(a.id) - getAvgRating(b.id));
          break;
        case 'reviews':
          filtered.sort((a, b) => {
            const countA = reviews.filter(r => r.relId === a.id).length;
            const countB = reviews.filter(r => r.relId === b.id).length;
            return countB - countA;
          });
          break;
        default: // 'new'
          filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      }

      return filtered;
    }

    return { getFilteredReleases, setSortMode: (mode) => { sortMode = mode; } };
}

function setupOptimized() {
    let activeGenreFilter = null;
    let sortMode = 'rating-desc';
    let releases = [];
    let reviews = [];

    // Generate 1000 releases
    for (let i = 0; i < 1000; i++) {
        releases.push({ id: 'rel' + i, genre: 'Rock', timestamp: Date.now() - Math.random() * 10000 });
    }

    // Generate 5000 reviews
    for (let i = 0; i < 5000; i++) {
        reviews.push({ relId: 'rel' + Math.floor(Math.random() * 1000), rating: Math.floor(Math.random() * 10) + 1 });
    }

    function getAvgRating(relId) {
      const rvs = reviews.filter(r => r.relId === relId);
      if (rvs.length === 0) return 0;
      return rvs.reduce((s, r) => s + (r.rating || 0), 0) / rvs.length;
    }

    function getFilteredReleases() {
      let filtered = [...releases];

      // Фильтр по жанру
      if (activeGenreFilter) {
        filtered = filtered.filter(r => (r.genre || 'Другое') === activeGenreFilter);
      }

      // Сортировка
      if (sortMode !== 'new') {
        const statsMap = new Map();
        for (const release of filtered) {
          statsMap.set(release.id, { count: 0, sum: 0 });
        }
        for (const r of reviews) {
          const stat = statsMap.get(r.relId);
          if (stat) {
            stat.count++;
            stat.sum += (r.rating || 0);
          }
        }

        const getAvg = (id) => {
          const stat = statsMap.get(id);
          return stat && stat.count > 0 ? stat.sum / stat.count : 0;
        };
        const getCount = (id) => {
          const stat = statsMap.get(id);
          return stat ? stat.count : 0;
        };

        switch (sortMode) {
          case 'rating-desc':
            filtered.sort((a, b) => getAvg(b.id) - getAvg(a.id));
            break;
          case 'rating-asc':
            filtered.sort((a, b) => getAvg(a.id) - getAvg(b.id));
            break;
          case 'reviews':
            filtered.sort((a, b) => getCount(b.id) - getCount(a.id));
            break;
        }
      } else {
        filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      }

      return filtered;
    }

    return { getFilteredReleases, setSortMode: (mode) => { sortMode = mode; } };
}

function runBenchmark() {
    const original = setupOriginal();
    const optimized = setupOptimized();

    console.log("Measuring Original 'rating-desc'...");
    original.setSortMode('rating-desc');
    let start = Date.now();
    for (let i = 0; i < 100; i++) original.getFilteredReleases();
    let originalTime = Date.now() - start;
    console.log(`Original Time: ${originalTime}ms`);

    console.log("Measuring Optimized 'rating-desc'...");
    optimized.setSortMode('rating-desc');
    start = Date.now();
    for (let i = 0; i < 100; i++) optimized.getFilteredReleases();
    let optimizedTime = Date.now() - start;
    console.log(`Optimized Time: ${optimizedTime}ms`);

    console.log("Measuring Original 'reviews'...");
    original.setSortMode('reviews');
    start = Date.now();
    for (let i = 0; i < 100; i++) original.getFilteredReleases();
    let originalReviewsTime = Date.now() - start;
    console.log(`Original Reviews Time: ${originalReviewsTime}ms`);

    console.log("Measuring Optimized 'reviews'...");
    optimized.setSortMode('reviews');
    start = Date.now();
    for (let i = 0; i < 100; i++) optimized.getFilteredReleases();
    let optimizedReviewsTime = Date.now() - start;
    console.log(`Optimized Reviews Time: ${optimizedReviewsTime}ms`);
}

runBenchmark();
