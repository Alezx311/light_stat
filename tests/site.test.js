'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../lib/electricity');
const {parseChannelPage, parseEhMap, decode} = require('../tools/sources');
const {seed, update} = require('../tools/fetch-telegram');
const {buildSummary, compact} = require('../tools/summary');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const T = value => E.parseTime('2026-02-01T' + value + ':00+02:00');
const SOURCE = 'telegram:1';
function store(events, observedUntil, lastMessageId = 100) {
  return {schemaVersion: 1,
    sources: [{id: SOURCE, name: 'Канал', kind: 'event-log', method: 'telegram', channel: 'chan', lastMessageId, observedUntil}],
    points: [...new Set(events.map(e => e[1]))].map(id => ({sourceId: SOURCE, id, name: id.toUpperCase()})),
    events: events.map(([time, id, state], i) => ({sourceId: SOURCE, pointId: id, timestamp: new Date(time).toISOString(), state, id: String(i + 1)}))};
}
function page(messages) {
  return '<section>' + messages.map(([id, iso, text]) => '<div class="tgme_widget_message js-widget_message" data-post="chan/' + id + '">' +
    '<div class="tgme_widget_message_text js-message_text" dir="auto">' + text + '</div>' +
    '<a class="tgme_widget_message_date"><time datetime="' + iso + '" class="time">x</time></a></div>').join('') + '</section>';
}

test('channel event text parser accepts both formats and ignores other posts', () => {
  assert.deepEqual(E.parseTelegramEvent('✅ ID_232 увімкнено'), {pointId: 'id_232', state: 'on'});
  assert.deepEqual(E.parseTelegramEvent('🔴 sg20 03:30:45 вимкнено'), {pointId: 'sg20', state: 'off'});
  assert.deepEqual(E.parseTelegramEvent('  🔴 SG20 вимкнено'), {pointId: 'sg20', state: 'off'});
  assert.equal(E.parseTelegramEvent('Озерний — локальна проблема'), null);
  assert.equal(E.parseTelegramEvent(''), null);
});

test('live log extends the last state to the last check, but not across 30 days of silence', () => {
  const live = E.importData(store([[T('00:00'), 'a', 'on'], [T('02:00'), 'a', 'off']], new Date(T('06:00')).toISOString()), 's');
  const g = E.analyze(live, {start: T('00:00'), end: T('08:00')}).groups[0];
  assert.equal(g.onHours, 2); assert.equal(g.offHours, 4); assert.equal(g.unknownHours, 2);
  const now = E.currentState(live, T('06:00'))[0];
  assert.equal(now.state, 'off'); assert.equal(now.since, T('02:00')); assert.equal(now.active, true);

  const later = T('00:00') + 40 * 24 * E.HOUR;
  const silent = E.importData(store([[T('00:00'), 'a', 'on']], new Date(later).toISOString()), 's');
  const s = E.analyze(silent, {start: T('00:00'), end: later}).groups[0];
  assert.equal(s.onHours, 30 * 24); assert.equal(s.unknownHours, 10 * 24);
  const stale = E.currentState(silent, later)[0];
  assert.equal(stale.state, 'unknown'); assert.equal(stale.active, false); assert.equal(stale.since, null);
});

test('current state reports the start of a run of repeated messages', () => {
  const a = E.importData(store([[T('00:00'), 'a', 'off'], [T('01:00'), 'a', 'on'], [T('03:00'), 'a', 'on']], new Date(T('04:00')).toISOString()), 's');
  const s = E.currentState(a, T('04:00'))[0];
  assert.equal(s.state, 'on'); assert.equal(s.since, T('01:00'));
});

test('t.me preview parser reads ids, times and emoji text from the real markup', () => {
  const messages = parseChannelPage(fixture('tme-page.html'), 'subgroups62');
  assert.deepEqual(messages.map(m => m.id), [20165, 20166, 20167, 20168]);
  assert.equal(messages[0].text, '✅ sg60 увімкнено');
  assert.equal(messages[0].date, '2026-10-10T07:53:46+00:00');
  assert.ok(messages[1].text.includes('\n'));
  assert.equal(messages.map(m => E.parseTelegramEvent(m.text)).filter(Boolean).length, 3);
  assert.equal(decode('A &amp; B &#39;x&#39; &#x2705;'), "A & B 'x' ✅");
});

test('update pages back to the last known post, appends events once and records the check time', async () => {
  const s = store([[T('00:00'), 'sg1', 'on']], new Date(T('00:00')).toISOString(), 100);
  const pages = {
    '': page([[103, '2026-02-01T03:00:00+00:00', '🔴 sg1 вимкнено'], [104, '2026-02-01T03:30:00+00:00', 'новина'], [105, '2026-02-01T04:00:00+00:00', '✅ ID_7 увімкнено']]),
    '103': page([[100, '2026-01-31T22:00:00+00:00', '✅ sg1 увімкнено'], [101, '2026-02-01T01:00:00+00:00', 'текст'], [102, '2026-02-01T02:00:00+00:00', '✅ sg1 увімкнено']])
  };
  const requested = [];
  const fetchPage = async (channel, before) => { requested.push(before); return pages[before ? String(before) : '']; };
  const nowValue = Date.parse('2026-02-01T05:00:00Z');
  const result = await update(s, {fetchPage, now: () => nowValue});
  assert.deepEqual(requested, [null, 103]);
  assert.equal(result.added, 3);
  assert.deepEqual(s.events.slice(1).map(e => [e.id, e.pointId, e.state]), [['102', 'sg1', 'on'], ['103', 'sg1', 'off'], ['105', 'id_7', 'on']]);
  assert.ok(s.points.some(p => p.id === 'id_7'));
  assert.equal(s.sources[0].lastMessageId, 105);
  assert.equal(s.sources[0].observedUntil, new Date(nowValue).toISOString());
  const again = await update(s, {fetchPage: async () => pages[''], now: () => nowValue + 1});
  assert.equal(again.added, 0); assert.equal(s.events.length, 4);
  await assert.rejects(update(s, {fetchPage: async () => '<html></html>'}), /не знайдено повідомлень/);
});

test('seed converts a Telegram export into the event store', () => {
  const s = seed({id: 9, name: 'Канал', messages: [
    {id: 1, type: 'message', date_unixtime: String(T('00:00') / 1000), text: '✅ sg1 увімкнено'},
    {id: 2, type: 'message', date_unixtime: String(T('01:00') / 1000), text: [{type: 'plain', text: '🔴 sg1 вимкнено'}]},
    {id: 3, type: 'message', date_unixtime: String(T('02:00') / 1000), text: 'інше'}]});
  assert.equal(s.sources[0].id, 'telegram:9'); assert.equal(s.sources[0].lastMessageId, 3);
  assert.equal(s.sources[0].observedUntil, new Date(T('02:00')).toISOString());
  assert.deepEqual(s.events.map(e => [e.id, e.state]), [['1', 'on'], ['2', 'off']]);
  assert.equal(E.importData(s, 'events.json').events.length, 2);
});

test('eh-map snapshot keeps unique addresses, both inputs, entrances and polygons', () => {
  const data = parseEhMap(fixture('eh-map.html'));
  assert.equal(data.addresses.length, 3);
  const two = data.addresses.find(a => a.id === 'bulah_5g');
  assert.deepEqual(two.groups, ['sg10', 'sg20']); assert.deepEqual(two.dtekGroups, ['12.1']);
  assert.deepEqual(data.addresses.find(a => a.id === 'bulah_2').groups, ['id_415']);
  const lost = data.addresses.find(a => a.id === 'lost');
  assert.deepEqual(lost.groups, []); assert.equal(lost.entrance, '2');
  assert.deepEqual(data.polygons[0].coordinates[0], [50.47, 30.35]);
  assert.equal(data.polygons[0].group, 'sg80');
  assert.deepEqual(Object.keys(data.colors).sort(), ['id_415', 'sg10']);
});

test('summary windows conserve time and count addresses per subgroup', () => {
  const s = E.importData(store([[T('00:00'), 'sg10', 'on'], [T('02:00'), 'sg10', 'off'], [T('00:00') - 60 * 24 * E.HOUR, 'id_1', 'on']],
    new Date(T('06:00')).toISOString()), 's');
  const addresses = {source: {retrievedAt: '2026-02-01T00:00:00Z'}, addresses: [{groups: ['sg10']}, {groups: ['sg10', 'id_1']}]};
  const summary = buildSummary(s, addresses);
  assert.deepEqual(summary.counts, {groups: 2, active: 1, on: 0, off: 1});
  for (const g of summary.groups) {
    assert.ok(Math.abs(g.day.onHours + g.day.offHours + g.day.unknownHours - 24) < 1e-9);
    assert.ok(Math.abs(g.week.onHours + g.week.offHours + g.week.unknownHours - 168) < 1e-9);
  }
  const sg10 = summary.groups.find(g => g.id === 'sg10');
  assert.equal(sg10.addresses, 2); assert.equal(sg10.state, 'off'); assert.equal(sg10.since, new Date(T('02:00')).toISOString());
  assert.deepEqual(sg10.day.intervals.map(i => i[2]), ['unknown', 'on', 'off']);
  assert.equal(summary.groups.find(g => g.id === 'id_1').active, false);
  assert.deepEqual(compact([{start: 0, end: 1, state: 'on'}, {start: 1, end: 2, state: 'on'}, {start: 2, end: 3, state: 'off'}]), [[0, 2, 'on'], [2, 3, 'off']]);
});
