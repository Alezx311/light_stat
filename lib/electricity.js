/* Shared, dependency-free analysis for Node.js and the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LightStat = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const HOUR = 3600000;
  const ZONE = 'Europe/Kyiv';
  // A live event log extends its last state to the last check, but not across long silence.
  const SILENCE_LIMIT = 30 * 24 * HOUR;
  const EVENT_PATTERN = /^(?:✅\s+(sg\d+|ID_\d+)\s+увімкнено|🔴\s+(sg\d+|ID_\d+)\s+(?:\d{2}:\d{2}:\d{2}\s*)?вимкнено)/i;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  function parts(time) {
    return Object.fromEntries(formatter.formatToParts(new Date(time))
      .filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  }
  function dateKey(time) {
    const p = parts(time);
    return p.year + '-' + p.month + '-' + p.day;
  }
  function localStamp(time) {
    const p = parts(time);
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second;
  }
  function addDays(key, count) {
    const date = new Date(key + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
  }
  function parseTime(value) {
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8640000000000000) return value;
    if (typeof value !== 'string') throw new Error('Некоректна часова мітка');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
      const fields = value.slice(0,19).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
      const validDay = fields && new Date(Date.UTC(+fields[1], +fields[2]-1, +fields[3])).toISOString().slice(0,10) === value.slice(0,10);
      const result = Date.parse(value);
      if (validDay && +fields[4] < 24 && +fields[5] < 60 && +(fields[6] || 0) < 60 && Number.isFinite(result)) return result;
      throw new Error('Некоректна дата або час');
    }
    // Resolve local wall time explicitly. Ambiguous/nonexistent DST times require an offset.
    const m = value.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) throw new Error('Час має бути ISO 8601 або датою YYYY-MM-DD');
    const stamp = m[1] + 'T' + (m[2] || '00') + ':' + (m[3] || '00') + ':' + (m[4] || '00');
    const utc = Date.parse(stamp + 'Z');
    if (!Number.isFinite(utc)) throw new Error('Некоректна дата');
    const candidates = [];
    // Modern Kyiv offsets. Historical local input before 1992 is intentionally unsupported.
    if (+m[1].slice(0, 4) < 1992) throw new Error('Для історичних дат потрібен явний часовий пояс');
    for (const offset of [2, 3]) {
      const time = utc - offset * HOUR;
      if (localStamp(time) === stamp) candidates.push(time);
    }
    if (candidates.length !== 1) throw new Error('Неоднозначний або відсутній місцевий час: додайте UTC-зсув');
    return candidates[0];
  }
  function textOf(message) {
    if (typeof message.text === 'string') return message.text.trim();
    const fragments = Array.isArray(message.text) ? message.text : message.text_entities;
    return Array.isArray(fragments) ? fragments.map(p => typeof p === 'string' ? p : p.text || '').join('').trim() : '';
  }
  function parseTelegramEvent(text) {
    const match = String(text || '').trim().match(EVENT_PATTERN);
    return match ? {pointId: (match[1] || match[2]).toLowerCase(), state: match[1] ? 'on' : 'off'} : null;
  }
  function pointKey(sourceId, pointId) { return JSON.stringify([sourceId, pointId]); }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  function normalizedPoint(point, sourceId) {
    const id = String(point.id || '');
    if (!id) throw new Error('Точка не має id');
    const coordinates = point.coordinates;
    const validCoordinates = coordinates && typeof coordinates.lat === 'number' && typeof coordinates.lon === 'number' &&
      Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lon) && Math.abs(coordinates.lat) <= 90 && Math.abs(coordinates.lon) <= 180;
    return { id, sourceId, key: pointKey(sourceId, id), name: String(point.name || id),
      address: typeof point.address === 'string' ? point.address : null,
      district: typeof point.district === 'string' ? point.district : null,
      supplyLine: typeof point.supplyLine === 'string' ? point.supplyLine : null,
      coordinates: validCoordinates ? {lat: coordinates.lat, lon: coordinates.lon} : null };
  }
  function importData(data, filename) {
    if (!data || typeof data !== 'object') throw new Error('Очікується JSON-об’єкт');
    const result = { sources: [], points: [], events: [], warnings: [], schedules: [] };
    if (Array.isArray(data.messages)) {
      const sourceId = 'telegram:' + (data.id != null ? String(data.id) : hash(String(data.name || 'archive') + ':' + String(filename || 'archive')));
      result.sources.push({id: sourceId, name: String(data.name || filename || 'Telegram'), kind: 'event-log', method: 'telegram', filename: filename || null});
      const pointIds = new Set();
      for (const message of data.messages) {
        if (message.type !== 'message') continue;
        const text = textOf(message);
        const parsed = parseTelegramEvent(text);
        if (!parsed) continue;
        try {
          const id = parsed.pointId;
          const timestamp = message.date_unixtime != null ? Number(message.date_unixtime) * 1000 : parseTime(message.date);
          if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8640000000000000) throw new Error('Некоректна дата події');
          pointIds.add(id);
          result.events.push({ sourceId, pointId: id, timestamp, state: parsed.state, evidence: 'reconstructed',
            method: 'telegram', eventId: message.id == null ? null : String(message.id), validUntil: null });
        } catch (error) { result.warnings.push('Повідомлення ' + (message.id || '?') + ': ' + error.message); }
      }
      result.points = [...pointIds].map(id => normalizedPoint({id}, sourceId));
    } else if (data.schemaVersion === 1 && Array.isArray(data.sources) && Array.isArray(data.events)) {
      const sources = new Map();
      for (const source of data.sources) {
        const id = String(source.id || '');
        if (!id || sources.has(id) || !['event-log', 'observations'].includes(source.kind)) throw new Error('Некоректне або повторне джерело');
        const maxAgeSeconds = source.maxAgeSeconds == null ? 120 : Number(source.maxAgeSeconds);
        if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0 || maxAgeSeconds > 86400) throw new Error('maxAgeSeconds має бути від 1 до 86400');
        sources.set(id, {...source, id, name: String(source.name || id), maxAgeSeconds});
      }
      result.sources = [...sources.values()];
      const points = new Map();
      for (const point of data.points || []) {
        const sourceId = String(point.sourceId || '');
        if (!sources.has(sourceId)) throw new Error('Точка посилається на невідоме джерело');
        const normalized = normalizedPoint(point, sourceId);
        if (points.has(normalized.key)) throw new Error('Повторний ідентифікатор точки');
        if (point.coordinates && !normalized.coordinates) result.warnings.push('Координати точки ' + normalized.name + ' відхилено');
        points.set(normalized.key, normalized);
      }
      for (const event of data.events) {
        try {
          const sourceId = String(event.sourceId || '');
          const pointId = String(event.pointId || '');
          const source = sources.get(sourceId);
          if (!source || !pointId) throw new Error('Невідоме джерело або відсутня точка');
          if (!['on', 'off', 'unknown'].includes(event.state)) throw new Error('Невідомий стан');
          const timestamp = parseTime(event.timestamp);
          const evidence = event.evidence || (source.kind === 'event-log' ? 'reconstructed' : null);
          if (!['measured', 'reconstructed', 'connectivity'].includes(evidence)) throw new Error('Потрібен спосіб спостереження evidence');
          if (source.kind === 'event-log' && evidence === 'measured') throw new Error('Для вимірювання потрібне джерело observations');
          const validUntil = source.kind === 'observations' ? (event.validUntil == null ? timestamp + source.maxAgeSeconds * 1000 : parseTime(event.validUntil)) : null;
          if (validUntil !== null && validUntil <= timestamp) throw new Error('validUntil має бути після події');
          const key = pointKey(sourceId, pointId);
          if (!points.has(key)) points.set(key, normalizedPoint({id: pointId}, sourceId));
          result.events.push({sourceId, pointId, timestamp, state: event.state, evidence, validUntil,
            method: String(event.method || source.method || evidence), eventId: event.id == null ? null : String(event.id)});
        } catch (error) { result.warnings.push('Подію пропущено: ' + error.message); }
      }
      result.points = [...points.values()];
      // Retained for future comparison; schedules never enter the observation stream.
      result.schedules = Array.isArray(data.schedules) ? data.schedules : [];
    } else throw new Error('Потрібен Telegram-експорт або архів Light Stat schemaVersion: 1');
    if (!result.events.length) throw new Error('Файл не містить придатних подій увімкнення / вимкнення');
    return result;
  }
  function mergeArchives(archives) {
    const sources = new Map(), points = new Map(), events = [], warnings = [], schedules = [];
    for (const archive of archives) {
      for (const source of archive.sources) {
        const old = sources.get(source.id);
        if (old && (old.kind !== source.kind || old.maxAgeSeconds !== source.maxAgeSeconds)) throw new Error('Конфлікт конфігурації джерела ' + source.id);
        sources.set(source.id, source);
      }
      for (const point of archive.points) {
        const old = points.get(point.key);
        points.set(point.key, old ? {...point, address: point.address || old.address, district: point.district || old.district,
          coordinates: point.coordinates || old.coordinates, supplyLine: point.supplyLine || old.supplyLine} : point);
      }
      events.push(...archive.events); warnings.push(...archive.warnings); schedules.push(...archive.schedules);
    }
    return {sources: [...sources.values()], points: [...points.values()], events, warnings, schedules};
  }
  function extent(archive) {
    let start = Infinity, end = -Infinity;
    for (const e of archive.events) { start = Math.min(start, e.timestamp); end = Math.max(end, e.validUntil || e.timestamp); }
    for (const s of archive.sources || []) if (s.observedUntil != null && Number.isFinite(start)) end = Math.max(end, parseTime(s.observedUntil));
    return Number.isFinite(start) ? {start, end} : null;
  }
  function defaultWindow(archive, days) {
    const bounds = extent(archive);
    if (!bounds) throw new Error('Немає подій');
    const end = bounds.end;
    const start = days ? parseTime(addDays(dateKey(Math.max(bounds.start, end - 1)), 1 - days)) : bounds.start;
    return {start, end: end > start ? end : start + 1};
  }
  function prepareEvents(events) {
    const sorted = [...events].sort((a,b) => a.timestamp - b.timestamp);
    const grouped = [];
    let duplicates = 0, conflicts = 0;
    for (let i = 0; i < sorted.length;) {
      let j = i + 1;
      while (j < sorted.length && sorted[j].timestamp === sorted[i].timestamp) j++;
      const slice = sorted.slice(i,j);
      const unique = new Map(slice.map(e => [JSON.stringify([e.state,e.evidence,e.validUntil,e.method]), e]));
      duplicates += slice.length - unique.size;
      if (unique.size > 1 && new Set([...unique.values()].map(e => e.state + ':' + e.evidence)).size > 1) {
        grouped.push({...slice[0], state: 'unknown', evidence: 'conflict', validUntil: null}); conflicts++;
      } else {
        // Conservative expiry when same-time sensor records disagree about freshness.
        grouped.push({...slice[0], validUntil: slice[0].validUntil == null ? null : Math.min(...slice.map(e => e.validUntil))});
      }
      i = j;
    }
    return {events: grouped, duplicates, conflicts};
  }
  function tailFor(source, events) {
    const last = events[events.length - 1];
    if (!last || !source || source.kind !== 'event-log' || source.observedUntil == null || last.validUntil !== null || last.evidence === 'conflict') return null;
    const until = Math.min(parseTime(source.observedUntil), last.timestamp + SILENCE_LIMIT);
    return until > last.timestamp ? until : null;
  }
  function intervalsFor(events, start, end, tail) {
    const intervals = [];
    function push(from, to, state, evidence, method) {
      if (to <= from) return;
      const last = intervals[intervals.length - 1];
      if (last && last.end === from && last.state === state && last.evidence === evidence && last.method === method) last.end = to;
      else intervals.push({start: from, end: to, state, evidence, method});
    }
    let cursor = start;
    for (let i = 0; i < events.length; i++) {
      const e = events[i], next = events[i+1];
      if (e.timestamp >= end) break;
      const naturalEnd = e.validUntil !== null ? Math.min(e.validUntil, next ? next.timestamp : Infinity) : (next ? next.timestamp : tail || e.timestamp);
      const from = Math.max(start, e.timestamp), to = Math.min(end, naturalEnd);
      if (to <= from) continue;
      if (from > cursor) push(cursor, from, 'unknown', 'missing', '');
      const state = e.evidence === 'connectivity' || e.evidence === 'conflict' ? 'unknown' : e.state;
      push(from, to, state, e.evidence, e.method);
      cursor = to;
    }
    if (cursor < end) push(cursor, end, 'unknown', 'missing', '');
    return intervals;
  }
  function totals(intervals) {
    let onMs = 0, offMs = 0, unknownMs = 0, measuredMs = 0, reconstructedMs = 0;
    for (const i of intervals) {
      const ms = i.end - i.start;
      if (i.state === 'on') onMs += ms;
      else if (i.state === 'off') offMs += ms;
      else unknownMs += ms;
      if (i.state !== 'unknown' && i.evidence === 'measured') measuredMs += ms;
      if (i.state !== 'unknown' && i.evidence === 'reconstructed') reconstructedMs += ms;
    }
    const duration = onMs + offMs + unknownMs, known = onMs + offMs;
    return {onHours: onMs / HOUR, offHours: offMs / HOUR, unknownHours: unknownMs / HOUR,
      measuredHours: measuredMs / HOUR, reconstructedHours: reconstructedMs / HOUR,
      coverage: duration ? known / duration : 0, availability: known ? onMs / known : null,
      avgHoursPerDay: duration ? 24 * onMs / duration : null};
  }
  function outageStats(intervals, events, start, end) {
    let longest = 0, run = 0, previousEnd = null;
    for (const interval of intervals) {
      if (interval.state === 'off') {
        run = previousEnd === interval.start ? run + interval.end - interval.start : interval.end - interval.start;
        previousEnd = interval.end; longest = Math.max(longest, run);
      } else { run = 0; previousEnd = null; }
    }
    // Count only a known on -> off transition, not first-seen off or stale sensors.
    let outageCount = 0;
    for (let i = 1; i < events.length; i++) {
      const e = events[i], prior = events[i-1];
      if (e.timestamp < start || e.timestamp >= end) continue;
      if (e.state === 'off' && prior.state === 'on' && !['connectivity','conflict'].includes(e.evidence) &&
        !['connectivity','conflict'].includes(prior.evidence) && (prior.validUntil === null || prior.validUntil >= e.timestamp)) outageCount++;
    }
    return {outageCount, longestOutageHours: longest / HOUR};
  }
  function analyze(archive, options) {
    options = options || {};
    const defaultRange = defaultWindow(archive, options.days);
    const start = options.start == null ? defaultRange.start : parseTime(options.start);
    const end = options.end == null ? defaultRange.end : parseTime(options.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Кінець періоду має бути після початку');
    if (end - start > 3660 * 24 * HOUR) throw new Error('Оберіть період до 10 років');
    const byPoint = new Map(archive.points.map(p => [p.key, []]));
    for (const event of archive.events) {
      const key = pointKey(event.sourceId, event.pointId);
      if (byPoint.has(key)) byPoint.get(key).push(event);
    }
    let duplicates = 0, conflicts = 0;
    const sources = new Map(archive.sources.map(s => [s.id, s]));
    const groups = archive.points.map(point => {
      const prepared = prepareEvents(byPoint.get(point.key));
      duplicates += prepared.duplicates; conflicts += prepared.conflicts;
      const events = prepared.events;
      const intervals = intervalsFor(events, start, end, tailFor(sources.get(point.sourceId), events));
      return {...point, groupId: point.id, totalEvents: events.filter(e => e.timestamp >= start && e.timestamp < end).length,
        firstEvent: events.length ? new Date(events[0].timestamp).toISOString() : null,
        lastEvent: events.length ? new Date(events[events.length - 1].timestamp).toISOString() : null,
        totalDays: (end-start) / (24*HOUR), ...totals(intervals), ...outageStats(intervals, events, start, end), intervals};
    });
    const count = groups.length;
    return {schemaVersion: 2, timeZone: ZONE, generatedAt: new Date().toISOString(),
      dateRange: {from: new Date(start).toISOString(), to: new Date(end).toISOString()},
      archiveRange: extent(archive), sources: archive.sources, warnings: archive.warnings,
      diagnostics: {duplicates, conflicts, skipped: archive.warnings.length},
      summary: {totalGroups: count, coverage: count ? groups.reduce((s,g) => s+g.coverage,0)/count : 0,
        averageAcrossAllGroups: count ? groups.reduce((s,g) => s+g.avgHoursPerDay,0)/count : null,
        scope: 'observed-points-only'}, groups};
  }
  function currentState(archive, now) {
    const sources = new Map(archive.sources.map(s => [s.id, s]));
    const byPoint = new Map(archive.points.map(p => [p.key, []]));
    for (const event of archive.events) byPoint.get(pointKey(event.sourceId, event.pointId))?.push(event);
    return archive.points.map(point => {
      const events = prepareEvents(byPoint.get(point.key)).events.filter(e => e.timestamp <= now);
      const last = events[events.length - 1];
      const tail = tailFor(sources.get(point.sourceId), events);
      const fresh = !!last && (last.validUntil !== null ? last.validUntil >= now : tail !== null && tail >= now);
      const state = fresh && !['connectivity', 'conflict'].includes(last.evidence) ? last.state : 'unknown';
      let i = events.length - 1;
      while (state !== 'unknown' && i > 0 && events[i - 1].state === state && events[i - 1].evidence === last.evidence) i--;
      return {key: point.key, id: point.id, sourceId: point.sourceId, state, active: fresh,
        since: state === 'unknown' ? null : events[i].timestamp, lastEvent: last ? last.timestamp : null};
    });
  }
  function calendar(group, start, end) {
    const days = [];
    let key = dateKey(start);
    const endKey = dateKey(end - 1);
    while (key <= endKey) {
      const dayStart = parseTime(key), dayEnd = parseTime(addDays(key, 1));
      const from = Math.max(start, dayStart), to = Math.min(end, dayEnd);
      const dayIntervals = group.intervals.filter(i => i.end > from && i.start < to)
        .map(i => ({...i, start: Math.max(from,i.start), end: Math.min(to,i.end)}));
      const hours = Array.from({length:24}, (_, hour) => ({hour, elapsedHours:0, intervals:[]}));
      for (let t = dayStart; t < dayEnd; t += HOUR) {
        const h = hours[+parts(t).hour];
        h.elapsedHours++;
        const a = Math.max(t,from), b = Math.min(t+HOUR,to);
        if (a < b) h.intervals.push(...dayIntervals.filter(i => i.end > a && i.start < b)
          .map(i => ({...i,start:Math.max(a,i.start),end:Math.min(b,i.end)})));
      }
      for (const hour of hours) Object.assign(hour, totals(hour.intervals));
      days.push({date:key, elapsedHours:(dayEnd-dayStart)/HOUR, ...totals(dayIntervals), hours});
      key = addDays(key, 1);
    }
    return days;
  }
  return {ZONE, HOUR, SILENCE_LIMIT, parseTime, parseTelegramEvent, currentState, dateKey, addDays, localStamp, importData, mergeArchives, extent, defaultWindow,
    analyze, calendar, pointKey, totals};
});
