#!/usr/bin/env node
'use strict';
/*
 * Keeps data/events.json in sync with the public channel preview https://t.me/s/<channel>.
 *   node tools/fetch-telegram.js                 append new posts
 *   node tools/fetch-telegram.js --seed export.json   rebuild from a Telegram Desktop export
 */
const fs = require('node:fs');
const path = require('node:path');
const E = require('../lib/electricity');
const {parseChannelPage} = require('./sources');

const root = path.resolve(__dirname, '..');
const STORE = path.join(root, 'data', 'events.json');
const CHANNEL = 'subgroups62';
const MAX_PAGES = 50;

function readStore(file = STORE) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
// One event per line keeps hourly git diffs small and readable.
function writeStore(store, file = STORE) {
  const head = JSON.stringify({...store, events: undefined}, null, 2).replace(/\n}$/, '');
  const lines = store.events.map(e => '    ' + JSON.stringify(e));
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, head + ',\n  "events": [\n' + lines.join(',\n') + '\n  ]\n}\n');
}
function eventRecord(sourceId, pointId, timestamp, state, id) {
  return {sourceId, pointId, timestamp: new Date(timestamp).toISOString(), state, id: String(id)};
}
function pointRecord(sourceId, id) { return {sourceId, id, name: id.toUpperCase()}; }

function seed(exportData, channel = CHANNEL) {
  const imported = E.importData(exportData, 'telegram-export.json');
  const source = imported.sources[0];
  const messages = exportData.messages.filter(m => m.type === 'message');
  const last = messages.reduce((a, m) => (Number(m.id) > Number(a.id) ? m : a), messages[0]);
  const lastTime = last.date_unixtime != null ? Number(last.date_unixtime) * 1000 : E.parseTime(last.date);
  return {
    schemaVersion: 1,
    sources: [{id: source.id, name: source.name, kind: 'event-log', method: 'telegram', url: 'https://t.me/' + channel,
      channel, lastMessageId: Number(last.id), observedUntil: new Date(lastTime).toISOString()}],
    points: imported.points.map(p => pointRecord(source.id, p.id)).sort((a, b) => a.id.localeCompare(b.id, 'en', {numeric: true})),
    events: imported.events.sort((a, b) => a.timestamp - b.timestamp || Number(a.eventId) - Number(b.eventId))
      .map(e => eventRecord(source.id, e.pointId, e.timestamp, e.state, e.eventId))
  };
}

async function update(store, {fetchPage, now = Date.now, sleep = () => Promise.resolve()}) {
  const source = store.sources[0];
  const known = Number(source.lastMessageId) || 0;
  const startedAt = now();
  const fresh = new Map();
  let before = null, reached = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page) await sleep(1000);
    const messages = parseChannelPage(await fetchPage(source.channel, before), source.channel);
    if (!messages.length) throw new Error('На сторінці каналу не знайдено повідомлень: можливо, змінилася розмітка t.me');
    for (const m of messages) if (m.id > known) fresh.set(m.id, m);
    const min = Math.min(...messages.map(m => m.id));
    if (min <= known + 1) { reached = true; break; }
    before = min;
  }
  if (!reached && known) throw new Error('Не вдалося дійти до повідомлення ' + known + ' за ' + MAX_PAGES + ' сторінок');
  const points = new Set(store.points.map(p => p.id));
  let added = 0;
  for (const m of [...fresh.values()].sort((a, b) => a.id - b.id)) {
    const parsed = E.parseTelegramEvent(m.text);
    if (!parsed) continue;
    store.events.push(eventRecord(source.id, parsed.pointId, Date.parse(m.date), parsed.state, m.id));
    if (!points.has(parsed.pointId)) { points.add(parsed.pointId); store.points.push(pointRecord(source.id, parsed.pointId)); }
    added++;
  }
  if (fresh.size) source.lastMessageId = Math.max(known, ...fresh.keys());
  // The newest page was read at startedAt: nothing newer existed, so the log is complete up to here.
  source.observedUntil = new Date(startedAt).toISOString();
  return {added, messages: fresh.size};
}

async function fetchPage(channel, before) {
  const url = 'https://t.me/s/' + channel + (before ? '?before=' + before : '');
  const response = await fetch(url, {headers: {'User-Agent': 'light-stat (+https://github.com/Alezx311/light_stat)'},
    signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status + ' для ' + url), {network: true});
  return response.text();
}

async function main(args) {
  const seedIndex = args.indexOf('--seed');
  if (seedIndex !== -1) {
    const store = seed(JSON.parse(fs.readFileSync(args[seedIndex + 1], 'utf8').replace(/^﻿/, '')));
    writeStore(store);
    console.log('Seeded ' + store.events.length + ' events, ' + store.points.length + ' points, last message ' + store.sources[0].lastMessageId);
    return;
  }
  const store = readStore();
  let result;
  try {
    result = await update(store, {fetchPage: (channel, before) => fetchPage(channel, before).catch(error => {
      throw Object.assign(error, {network: true});
    }), sleep: ms => new Promise(r => setTimeout(r, ms))});
  } catch (error) {
    if (error.network) { console.warn('Telegram недоступний, дані не змінено: ' + error.message); return; }
    throw error;
  }
  writeStore(store);
  console.log('New messages: ' + result.messages + ', events: ' + result.added + ', observed until ' + store.sources[0].observedUntil);
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
module.exports = {seed, update, readStore, writeStore, STORE};
