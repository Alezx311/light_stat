# Приклади

~~~sh
# Дочитати нові пости каналу й відкрити сайт локально
npm run fetch
npm start

# Перебудувати журнал з експорту Telegram Desktop
node tools/fetch-telegram.js --seed result.json

# Оновити знімок адрес (лише вручну, зі збереженої сторінки eh-map)
node tools/import-eh-map.js eh-map.html

# Останні 7 календарних днів доступної історії
node analyze_electricity.js --days 7

# Січень, за місцевим часом Києва; кінцевий день включено
node analyze_electricity.js data/events.json --from 2026-01-01 --to 2026-01-31 --output january.json

# Кілька джерел, ідентичні події не подвоюють час
node analyze_electricity.js first.json second.json --days 30 --output merged.json

# Усі стандартні періоди (Bash)
bash generate_all_periods.sh data/events.json

# Перевірки та автономний HTML
npm test
npm run build
npm run test:browser
~~~

У розширеній аналітиці (explore.html) використовуйте «Додати архів», пошук і вибір періоду. Приклад нормалізованого JSON можна завантажити на екрані «Джерела й методика»; він містить лише синтетичні події для пояснення формату й не має координат.

Специфікація подій датчиків, термінів актуальності та геоприв’язки: [README](README.md).
