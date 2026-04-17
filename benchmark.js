const { performance } = require('perf_hooks');

const releases = [];
for (let i = 0; i < 10000; i++) {
  releases.push({ id: 'rel_' + i, name: 'Release ' + i });
}

const userReviews = [];
for (let i = 0; i < 500; i++) {
  // random release
  const relId = 'rel_' + Math.floor(Math.random() * 10000);
  userReviews.push({ id: 'rev_' + i, relId: relId, author: 'testuser', rating: 5, text: 'Great' });
}

function runOld() {
  let html = '';
  const start = performance.now();
  for (let iter = 0; iter < 100; iter++) {
    html = userReviews.map(r => {
      const rel = releases.find(release => release.id === r.relId);
      return rel ? rel.name : 'Unknown';
    }).join('');
  }
  const end = performance.now();
  console.log(`Old approach: ${(end - start).toFixed(2)} ms`);
}

function runNewMap() {
  let html = '';
  const start = performance.now();
  for (let iter = 0; iter < 100; iter++) {
    const releasesMap = new Map(releases.map(r => [r.id, r]));
    html = userReviews.map(r => {
      const rel = releasesMap.get(r.relId);
      return rel ? rel.name : 'Unknown';
    }).join('');
  }
  const end = performance.now();
  console.log(`New approach (Map): ${(end - start).toFixed(2)} ms`);
}

function runNewObject() {
  let html = '';
  const start = performance.now();
  for (let iter = 0; iter < 100; iter++) {
    const releasesObj = {};
    for (let i = 0; i < releases.length; i++) {
      releasesObj[releases[i].id] = releases[i];
    }
    html = userReviews.map(r => {
      const rel = releasesObj[r.relId];
      return rel ? rel.name : 'Unknown';
    }).join('');
  }
  const end = performance.now();
  console.log(`New approach (Object): ${(end - start).toFixed(2)} ms`);
}

runOld();
runNewMap();
runNewObject();
