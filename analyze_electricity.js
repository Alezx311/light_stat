#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {importData, mergeArchives, analyze, parseTime, addDays} = require('./lib/electricity');
function main(args) {
  const files = [];
  let days, from, to, output;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Light Stat — аналіз фактичної історії\n\nnode analyze_electricity.js [archive.json ...] [--days N | --from YYYY-MM-DD --to YYYY-MM-DD] [--output file.json]\n\n--to включає весь обраний день. Без дат: весь архів. --days відраховується від кінця архіву.');
      return;
    }
    if (['--days','-d','--from','--to','--output','-o'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Відсутнє значення ' + arg);
      if (arg === '--days' || arg === '-d') {
        days = Number(value);
        if (!Number.isInteger(days) || days < 1 || days > 3660) throw new Error('--days: ціле число від 1 до 3660');
      } else if (arg === '--from') from = value;
      else if (arg === '--to') to = value;
      else output = value;
    } else if (arg.startsWith('-')) throw new Error('Невідома опція ' + arg);
    else files.push(arg);
  }
  if (!!from !== !!to || (days && from)) throw new Error('Вкажіть або --days, або обидві дати --from та --to');
  if (!files.length) files.push(path.join(__dirname, 'data', 'events.json'));
  const archive = mergeArchives(files.map(file => importData(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),path.basename(file))));
  const options = {days};
  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Дати мають формат YYYY-MM-DD');
    options.start = parseTime(from);
    parseTime(to);
    options.end = parseTime(addDays(to,1));
  }
  const result = analyze(archive,options);
  const out = path.resolve(output || (days ? 'electricity_analysis_' + days + 'days.json' : 'electricity_analysis.json'));
  if (files.some(file => path.resolve(file).toLowerCase() === out.toLowerCase())) throw new Error('Вихідний файл не може замінювати вхідний архів');
  fs.writeFileSync(out,JSON.stringify(result,null,2) + '\n');
  console.log('Light Stat · ' + result.timeZone);
  console.log(result.dateRange.from + ' → ' + result.dateRange.to);
  console.log('Точка                     Є, год  Немає, год  Невідомо, год  Покриття');
  for (const g of result.groups) console.log((g.name + ' [' + g.sourceId + ']').padEnd(26) + g.onHours.toFixed(2).padStart(8) + g.offHours.toFixed(2).padStart(12) + g.unknownHours.toFixed(2).padStart(14) + (100*g.coverage).toFixed(1).padStart(9) + '%');
  console.log('\nТочок: ' + result.groups.length + '. Це вибірка спостережень, не середнє всього Києва.');
  console.log('Дублікати: ' + result.diagnostics.duplicates + '; конфлікти: ' + result.diagnostics.conflicts + '; пропущено: ' + result.diagnostics.skipped);
  console.log('Збережено: ' + out);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error('Помилка: ' + error.message); process.exitCode = 1; }
}
module.exports = {main};
