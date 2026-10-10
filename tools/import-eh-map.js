#!/usr/bin/env node
'use strict';
/*
 * One-off snapshot of addresses -> subgroups from https://eh-map.napruha.top/ (manual run only).
 *   node tools/import-eh-map.js saved-page.html
 *   node tools/import-eh-map.js --fetch
 * The site's robots.txt disallows crawlers: never run this from CI or on a schedule.
 */
const fs = require('node:fs');
const path = require('node:path');
const {parseEhMap} = require('./sources');

const URL_MAP = 'https://eh-map.napruha.top/';
const OUT = path.resolve(__dirname, '..', 'data', 'addresses.json');

async function main(args) {
  if (!args.length) throw new Error('Використання: node tools/import-eh-map.js <page.html> | --fetch');
  const html = args[0] === '--fetch'
    ? await (await fetch(URL_MAP, {headers: {'User-Agent': 'light-stat one-off snapshot (+https://github.com/Alezx311/light_stat)'}})).text()
    : fs.readFileSync(args[0], 'utf8');
  const data = parseEhMap(html);
  const out = {
    source: {name: 'Мапа відключень «Підгрупи 6.2»', url: URL_MAP, telegram: 'https://t.me/subgroups62',
      retrievedAt: new Date().toISOString(),
      note: 'Знімок прив’язки адрес до підгруп. Використовується з атрибуцією; оновлюється вручну.'},
    colors: data.colors,
    polygons: data.polygons,
    addresses: data.addresses.sort((a, b) => a.title.localeCompare(b.title, 'uk', {numeric: true}))
  };
  fs.mkdirSync(path.dirname(OUT), {recursive: true});
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  const groups = new Set(out.addresses.flatMap(a => a.groups));
  console.log('Addresses: ' + out.addresses.length + ', polygons: ' + out.polygons.length + ', subgroups: ' + groups.size +
    ', without subgroup: ' + out.addresses.filter(a => !a.groups.length).length);
}

main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
