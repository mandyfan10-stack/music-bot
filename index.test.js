const { JSDOM } = require('jsdom');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

test('getCriteriaAverage tests', async (t) => {
  const html = fs.readFileSync('index.html', 'utf8');
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: 'dangerously',
    beforeParse(win) {
      win.Telegram = {
        WebApp: {
          initDataUnsafe: { user: { id: 1, first_name: 'Test' } },
          ready: () => {},
          expand: () => {},
          disableVerticalSwipes: () => {},
          setHeaderColor: () => {},
          setBackgroundColor: () => {},
          enableClosingConfirmation: () => {},
          MainButton: { onClick: () => {}, hide: () => {} }
        }
      };
      win.lucide = { createIcons: () => {} };
    }
  });

  await new Promise(r => setTimeout(r, 500)); // wait for scripts

  const getCriteriaAverage = dom.window.getCriteriaAverage;

  await t.test('calculates average correctly with all values provided', () => {
    const criteria = { sound: 10, production: 8, originality: 6, meaning: 4, relevance: 2, image: 0 };
    assert.strictEqual(getCriteriaAverage(criteria), 5);
  });

  await t.test('uses default value 5 for missing criteria', () => {
    const criteria = { sound: 10 };
    assert.strictEqual(getCriteriaAverage(criteria), 5.8);
  });

  await t.test('uses default value 5 for non-number criteria', () => {
    const criteria = { sound: '10', production: null };
    assert.strictEqual(getCriteriaAverage(criteria), 5);
  });

  await t.test('handles empty object', () => {
    assert.strictEqual(getCriteriaAverage({}), 5);
  });

  await t.test('handles undefined argument', () => {
    assert.strictEqual(getCriteriaAverage(), 5);
  });
});
