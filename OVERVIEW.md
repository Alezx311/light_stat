# Light Stat 2.1

Публічна карта світла по підгрупах каналу «Підгрупи 6.2» на GitHub Pages. Потік даних: публічний канал → журнал подій у репозиторії → щогодинна збірка сайту.

- lib/electricity.js: спільний модуль для Node і браузера — імпорт Telegram / нормалізованих подій, інтервали, метрики, DST, поточний стан (`currentState`), продовження живого журналу до `observedUntil`.
- tools/fetch-telegram.js: дочитує нові пости з https://t.me/s/subgroups62 у data/events.json; `--seed` будує журнал з експорту Telegram Desktop.
- tools/import-eh-map.js: ручний знімок адрес → підгрупи з eh-map.napruha.top у data/addresses.json.
- tools/sources.js: парсери сторінки t.me і eh-map (без мережі, тестуються на фікстурах).
- tools/summary.js + tools/build-site.js: data/summary.json і статичний сайт у _site/.
- index.html + assets/site.*: карта (Leaflet, vendored), усі підгрупи, пошук, деталі підгрупи.
- explore.html + assets/atlas.*: розширена аналітика та імпорт власних JSON.
- analyze_electricity.js: CLI на тому ж модулі.
- .github/workflows/update.yml: щогодинне оновлення і деплой Pages.
- tests/: юніт-тести розрахунків, парсерів, оновлення та підсумку; tools/browser-check.js — headless-сценарії й скриншоти.

Стан підгрупи — це повідомлення каналу, а не вимірювання в кожному будинку. Графіки операторів не враховуються як фактичні події.

Деталі: [README](README.md), [інтерфейс](DASHBOARD_GUIDE.md), [джерела](SOURCES.md), [поточний звіт](REPORT.md).
