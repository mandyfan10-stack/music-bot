/** @type {import('tailwindcss').Config} */
// Классы используются и в index.html, и в шаблонных строках src/app.js —
// поэтому оба файла в content. CSS собирается заранее (npm run build:css),
// в браузере рантайм-компилятора больше нет.
module.exports = {
  content: ['./index.html', './src/app.js'],
  theme: { extend: {} },
  plugins: [],
};
