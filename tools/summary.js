'use strict';
/* Precomputed overview for the public atlas: current state and rolling windows per subgroup. */
const E = require('../lib/electricity');

const WINDOWS = {day: 1, week: 7, month: 30};
const iso = time => time == null ? null : new Date(time).toISOString();

// Adjacent intervals with the same state are merged; evidence detail stays in the full archive.
function compact(intervals) {
  const out = [];
  for (const i of intervals) {
    const last = out[out.length - 1];
    if (last && last[1] === i.start && last[2] === i.state) last[1] = i.end;
    else out.push([i.start, i.end, i.state]);
  }
  return out;
}
function metrics(g) {
  return {onHours: g.onHours, offHours: g.offHours, unknownHours: g.unknownHours, coverage: g.coverage,
    availability: g.availability, outageCount: g.outageCount, longestOutageHours: g.longestOutageHours};
}

function buildSummary(archive, addresses) {
  const source = archive.sources[0];
  const now = E.parseTime(source.observedUntil);
  const states = new Map(E.currentState(archive, now).map(s => [s.key, s]));
  const windows = {}, results = {};
  for (const [name, days] of Object.entries(WINDOWS)) {
    windows[name] = {from: iso(now - days * 24 * E.HOUR), to: iso(now)};
    results[name] = new Map(E.analyze(archive, {start: now - days * 24 * E.HOUR, end: now}).groups.map(g => [g.key, g]));
  }
  const addressCount = {};
  for (const a of addresses ? addresses.addresses : []) for (const g of a.groups) addressCount[g] = (addressCount[g] || 0) + 1;
  const groups = archive.points.map(point => {
    const s = states.get(point.key);
    const day = results.day.get(point.key), week = results.week.get(point.key), month = results.month.get(point.key);
    return {id: point.id, label: point.id.toUpperCase(), state: s.state, active: s.active, since: iso(s.since),
      lastEvent: iso(s.lastEvent), addresses: addressCount[point.id] || 0,
      day: {...metrics(day), intervals: compact(day.intervals)},
      week: {...metrics(week), intervals: compact(week.intervals)},
      month: metrics(month)};
  }).sort((a, b) => a.id.localeCompare(b.id, 'en', {numeric: true}));
  const active = groups.filter(g => g.active);
  return {schemaVersion: 1, generatedAt: new Date().toISOString(), observedUntil: iso(now), timeZone: E.ZONE,
    source: {name: source.name, url: source.url},
    addressesSource: addresses ? addresses.source : null,
    windows,
    counts: {groups: groups.length, active: active.length, on: active.filter(g => g.state === 'on').length,
      off: active.filter(g => g.state === 'off').length},
    groups};
}

module.exports = {buildSummary, compact};
