/* global L, LightStat */
'use strict';
(() => {
  const E = LightStat;
  const $ = id => document.getElementById(id);
  const HOUR = E.HOUR;
  const state = {summary: null, addresses: null, groups: new Map(), range: 'day', sort: 'state', map: null,
    markers: [], markersByGroup: new Map(), polygonsByGroup: new Map(), archive: null, archivePromise: null};
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const timeFmt = new Intl.DateTimeFormat('uk-UA', {timeZone: E.ZONE, hour: '2-digit', minute: '2-digit'});
  const dayFmt = new Intl.DateTimeFormat('uk-UA', {timeZone: E.ZONE, day: '2-digit', month: '2-digit'});
  const fullFmt = new Intl.DateTimeFormat('uk-UA', {timeZone: E.ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
  const pct = v => v == null ? '—' : Math.round(v * 100) + '%';
  const stateName = {on: 'Є світло', off: 'Немає світла', unknown: 'Невідомо'};
  const now = () => Date.parse(state.summary.observedUntil);

  function when(time) {
    if (time == null) return '—';
    return E.dateKey(time) === E.dateKey(now()) ? timeFmt.format(time) : dayFmt.format(time) + ' ' + timeFmt.format(time);
  }
  function duration(ms) {
    const minutes = Math.round(ms / 60000);
    if (minutes < 1) return '<1 хв';
    if (minutes < 60) return minutes + ' хв';
    const hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
    if (days) return days + ' дн ' + (hours % 24) + ' год';
    return hours + ' год' + (minutes % 60 ? ' ' + (minutes % 60) + ' хв' : '');
  }
  function groupState(id) {
    const g = state.groups.get(id);
    return g && g.active ? g.state : 'unknown';
  }
  function dotHtml(ids) {
    const states = ids.length ? ids.map(groupState) : ['unknown'];
    if (states.length === 1) return '<i class="dot s-' + states[0] + '"></i>';
    return '<i class="dot split">' + states.map(s => '<i class="s-' + s + '"></i>').join('') + '</i>';
  }
  function notice(text) { $('notice').textContent = text || ''; $('notice').hidden = !text; }

  // --- strips -------------------------------------------------------------
  function ticks(from, to) {
    const out = [];
    const week = to - from > 2 * 24 * HOUR;
    for (let t = Math.ceil(from / HOUR) * HOUR; t < to; t += HOUR) {
      const hour = +E.localStamp(t).slice(11, 13);
      if (week ? hour === 0 : hour % 3 === 0) out.push({t, label: week ? dayFmt.format(t) : String(hour).padStart(2, '0')});
    }
    return out;
  }
  function stripHtml(intervals, from, to, label) {
    const span = to - from;
    const parts = intervals.filter(([s, e]) => e > from && s < to).map(([s, e, st]) => {
      const a = Math.max(s, from), b = Math.min(e, to);
      return '<span class="s-' + st + '" style="left:' + ((a - from) / span * 100).toFixed(3) + '%;width:' + ((b - a) / span * 100).toFixed(3) + '%"></span>';
    });
    const marks = ticks(from, to).map(t => '<span class="tick" style="left:' + ((t.t - from) / span * 100).toFixed(3) + '%"></span>');
    return '<div class="strip" role="img" aria-label="' + esc(label) + '">' + parts.join('') + marks.join('') + '</div>';
  }
  function stripLabel(g, w) {
    const m = g[w];
    return 'За ' + (w === 'day' ? '24 години' : '7 днів') + ': світло ' + Math.round(m.onHours) + ' год, без світла ' + Math.round(m.offHours) + ' год, невідомо ' + Math.round(m.unknownHours) + ' год';
  }

  // --- list ---------------------------------------------------------------
  function nowHtml(g) {
    if (!g.active) return '<div class="now"><i class="dot s-unknown"></i><span><b>Невідомо</b> <small>останнє: ' + esc(g.lastEvent ? dayFmt.format(Date.parse(g.lastEvent)) + '.' + E.dateKey(Date.parse(g.lastEvent)).slice(0, 4) : '—') + '</small></span></div>';
    const since = Date.parse(g.since);
    return '<div class="now' + (g.state === 'off' ? ' s-off-text' : '') + '"><i class="dot s-' + g.state + '"></i><span><b>' + stateName[g.state] + '</b> <small>з ' + esc(when(since)) + ' · ' + esc(duration(now() - since)) + '</small></span></div>';
  }
  function rowHtml(g) {
    const w = state.summary.windows[state.range];
    return '<div class="row" data-sg="' + esc(g.id) + '"><button class="name" type="button" data-open="' + esc(g.id) + '">' + esc(g.label) +
      '<small>' + (g.addresses ? g.addresses + ' адрес' : 'адреси не прив’язані') + '</small></button>' + nowHtml(g) +
      stripHtml(g[state.range].intervals, Date.parse(w.from), Date.parse(w.to), stripLabel(g, state.range)) +
      '<span class="num">' + pct(g.week.availability) + '</span></div>';
  }
  function renderRows() {
    const all = state.summary.groups;
    const byName = (a, b) => a.id.localeCompare(b.id, 'en', {numeric: true});
    const rank = {off: 0, unknown: 1, on: 2};
    const sorters = {
      state: (a, b) => rank[a.state] - rank[b.state] || (a.state === 'off' ? Date.parse(a.since) - Date.parse(b.since) : 0) || byName(a, b),
      availability: (a, b) => (a.week.availability ?? 2) - (b.week.availability ?? 2) || byName(a, b),
      name: byName};
    const active = all.filter(g => g.active).sort(sorters[state.sort]);
    const inactive = all.filter(g => !g.active).sort(byName);
    $('rows').innerHTML = active.map(rowHtml).join('') || '<p class="note">Немає активних підгруп.</p>';
    $('inactiveRows').innerHTML = inactive.map(rowHtml).join('');
    $('inactiveBox').hidden = !inactive.length;
    $('inactiveTitle').textContent = 'Без повідомлень понад 30 днів (' + inactive.length + ')';
    const w = state.summary.windows[state.range], from = Date.parse(w.from), to = Date.parse(w.to);
    $('axis').innerHTML = ticks(from, to).map(t => '<span style="left:' + ((t.t - from) / (to - from) * 100).toFixed(3) + '%">' + esc(t.label) + '</span>').join('');
  }
  function renderStatus() {
    const s = state.summary, c = s.counts;
    $('status').classList.toggle('has-off', c.off > 0);
    $('statusText').innerHTML = 'Зараз без світла: <strong>' + c.off + ' з ' + c.active + '</strong> підгруп · перевірено ' + esc(when(now()));
    $('footerTime').textContent = 'Канал перевірено ' + fullFmt.format(now()) + ' · час Києва';
    if (state.addresses) $('addressesDate').textContent = fullFmt.format(Date.parse(state.addresses.source.retrievedAt)).slice(0, 10);
  }

  // --- map ----------------------------------------------------------------
  function popupHtml(a) {
    const meta = [a.entrance ? 'під’їзд ' + a.entrance : null, a.description, a.dtekGroups.length ? 'черга ДТЕК ' + a.dtekGroups.join(', ') : null].filter(Boolean);
    const day = state.summary.windows.day;
    const groups = a.groups.map(id => {
      const g = state.groups.get(id);
      if (!g) return '<div class="sg"><div class="sg-head"><b>' + esc(id.toUpperCase()) + '</b><span>немає в каналі</span></div></div>';
      const status = g.active ? stateName[g.state] + ' з ' + when(Date.parse(g.since)) : 'немає свіжих повідомлень';
      return '<div class="sg"><div class="sg-head"><a href="#sg=' + esc(id) + '">' + esc(g.label) + '</a><span>' + dotHtml([id]) + ' ' + esc(status) + '</span></div>' +
        stripHtml(g.day.intervals, Date.parse(day.from), Date.parse(day.to), stripLabel(g, 'day')) + '</div>';
    }).join('');
    return '<div class="pop"><h3>' + esc(a.title) + '</h3>' + (meta.length ? '<div class="meta">' + esc(meta.join(' · ')) + '</div>' : '') +
      (groups || '<div class="sg">Підгрупу на мапі джерела не визначено.</div>') +
      (a.groups.length > 1 ? '<div class="meta">Два вводи: світло може бути, поки одна з підгруп вимкнена.</div>' : '') + '</div>';
  }
  function iconFor(a) {
    const size = a.groups.length > 1 ? 16 : 13;
    return L.divIcon({className: 'addr', html: dotHtml(a.groups), iconSize: [size, size]});
  }
  function initMap() {
    const map = state.map = L.map('map', {zoomSnap: 0.5, minZoom: 10, maxZoom: 19});
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · адреси: <a href="https://eh-map.napruha.top/">eh-map</a>'}).addTo(map);
    for (const p of state.addresses.polygons) {
      const layer = L.polygon(p.coordinates, {className: 'quarter', weight: 1.5, fillOpacity: 0.3});
      layer.addTo(map);
      if (p.group) { if (!state.polygonsByGroup.has(p.group)) state.polygonsByGroup.set(p.group, []); state.polygonsByGroup.get(p.group).push({layer, group: p.group}); }
      layer.bindTooltip(p.group ? p.group.toUpperCase() : 'Підгрупу не визначено');
    }
    for (const a of state.addresses.addresses) {
      const marker = L.marker([a.lat, a.lon], {icon: iconFor(a), title: a.title + (a.groups.length ? ' · ' + a.groups.map(g => g.toUpperCase()).join(', ') : ''), alt: a.title, riseOnHover: true});
      marker.bindPopup(() => popupHtml(a), {maxWidth: 320});
      marker.addTo(map);
      state.markers.push({marker, address: a});
      for (const g of a.groups) { if (!state.markersByGroup.has(g)) state.markersByGroup.set(g, []); state.markersByGroup.get(g).push(marker); }
    }
    const points = state.addresses.addresses.map(a => [a.lat, a.lon]);
    if (points.length) map.fitBounds(points, {padding: [24, 24]}); else map.setView([50.45, 30.52], 11);
    paintMap();
  }
  function paintMap() {
    if (!state.map) return;
    for (const {marker, address} of state.markers) marker.setIcon(iconFor(address));
    const colors = {on: getComputedStyle(document.documentElement).getPropertyValue('--on').trim() || '#5fae7f', off: '#d0603f', unknown: '#9aa59f'};
    for (const list of state.polygonsByGroup.values()) for (const {layer, group} of list) {
      const s = groupState(group);
      layer.setStyle({color: colors[s], fillColor: colors[s], dashArray: s === 'unknown' ? '4 4' : null});
    }
  }
  function highlight(id) {
    const el = $('map');
    el.classList.toggle('focusing', !!id);
    for (const {marker} of state.markers) marker.getElement()?.classList.remove('hl');
    for (const list of state.polygonsByGroup.values()) for (const {layer} of list) layer.getElement()?.classList.remove('hl');
    if (!id) return;
    for (const marker of state.markersByGroup.get(id) || []) marker.getElement()?.classList.add('hl');
    for (const {layer} of state.polygonsByGroup.get(id) || []) layer.getElement()?.classList.add('hl');
  }
  function focusAddress(a) {
    const entry = state.markers.find(m => m.address === a);
    if (!entry) return;
    $('map').scrollIntoView({behavior: 'smooth', block: 'center'});
    state.map.setView([a.lat, a.lon], 17);
    entry.marker.openPopup();
  }

  // --- search -------------------------------------------------------------
  const norm = text => String(text).toLocaleLowerCase('uk').replace(/[’ʼ'`"«»]/g, '').replace(/\b(вул|вулиця|просп|проспект|пров|провулок|бул|бульвар)\b\.?/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let results = [], cursor = -1;
  function search(query) {
    const tokens = norm(query).split(' ').filter(Boolean);
    if (!tokens.length) return [];
    const groups = state.summary.groups.filter(g => tokens.every(t => norm(g.label).includes(t))).map(g => ({kind: 'group', g}));
    const addresses = (state.addresses ? state.addresses.addresses : []).filter(a => { const n = norm(a.title + ' ' + (a.description || '')); return tokens.every(t => n.includes(t)); })
      .map(a => ({kind: 'address', a}));
    return [...groups, ...addresses].slice(0, 12);
  }
  function renderResults() {
    const list = $('searchResults');
    list.hidden = !results.length;
    $('search').setAttribute('aria-expanded', String(!!results.length));
    list.innerHTML = results.map((r, i) => '<li role="option" id="opt' + i + '" aria-selected="' + (i === cursor) + '" data-i="' + i + '">' +
      (r.kind === 'group' ? '<span>Підгрупа ' + esc(r.g.label) + '</span><small>' + esc(r.g.active ? stateName[r.g.state] : 'неактивна') + '</small>'
        : '<span>' + esc(r.a.title) + (r.a.entrance ? ' (п.' + esc(r.a.entrance) + ')' : '') + '</span><small>' + esc(r.a.groups.map(g => g.toUpperCase()).join(' + ') || 'без підгрупи') + '</small>') + '</li>').join('');
    if (cursor >= 0) $('search').setAttribute('aria-activedescendant', 'opt' + cursor); else $('search').removeAttribute('aria-activedescendant');
  }
  function choose(r) {
    if (!r) return;
    results = []; cursor = -1; renderResults();
    if (r.kind === 'group') location.hash = 'sg=' + r.g.id;
    else { $('search').value = r.a.title; focusAddress(r.a); }
  }

  // --- detail -------------------------------------------------------------
  function loadArchive() {
    if (!state.archivePromise) state.archivePromise = fetch('data/events.json').then(r => { if (!r.ok) throw new Error('Архів подій недоступний'); return r.json(); })
      .then(data => (state.archive = E.importData(data, 'events.json')));
    return state.archivePromise;
  }
  async function openDetail(id) {
    const g = state.groups.get(id);
    const box = $('detail');
    if (!g) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="panel-head"><div><div class="eyebrow">ПІДГРУПА</div><h2 id="detailTitle">' + esc(g.label) + '</h2></div><button type="button" class="close" id="closeDetail">Закрити ✕</button></div>' +
      '<div class="stats">' + [
        ['Зараз', g.active ? stateName[g.state] + ' · ' + duration(now() - Date.parse(g.since)) : 'Невідомо'],
        ['Світло за 30 днів', pct(g.month.availability)],
        ['Вимкнень за 30 днів', String(g.month.outageCount)],
        ['Найдовше без світла', Math.round(g.month.longestOutageHours * 10) / 10 + ' год']
      ].map(([k, v]) => '<div class="stat"><span>' + esc(k) + '</span><strong>' + esc(v) + '</strong></div>').join('') + '</div>' +
      '<h3>Останні 30 днів за годинами</h3><div id="heat" class="heat" role="grid" aria-label="Календар світла: дні та години"><p class="note">Завантажуємо історію…</p></div><div id="cellInfo" class="cell-info" aria-live="polite"></div>' +
      addressesHtml(id);
    $('closeDetail').onclick = () => { history.pushState('', '', location.pathname + location.search); closeDetail(); };
    box.scrollIntoView({behavior: 'smooth', block: 'start'});
    highlight(id);
    try {
      const archive = await loadArchive();
      if (location.hash !== '#sg=' + id) return;
      renderHeat(archive, id);
    } catch (error) { $('heat').innerHTML = '<p class="note">' + esc(error.message) + '</p>'; }
  }
  function addressesHtml(id) {
    const list = (state.addresses ? state.addresses.addresses : []).filter(a => a.groups.includes(id));
    if (!list.length) return '<p class="note">Для цієї підгрупи у знімку мапи немає адрес.</p>';
    return '<h3 style="margin-top:16px">Адреси (' + list.length + ')</h3><ul class="addr-list">' + list.map(a => '<li><button type="button" data-address="' + esc(a.id) + '">' + esc(a.title) + (a.entrance ? ' (п.' + esc(a.entrance) + ')' : '') + '</button>' + (a.groups.length > 1 ? ' <small>+ ' + esc(a.groups.filter(x => x !== id).map(x => x.toUpperCase()).join(', ')) + '</small>' : '') + '</li>').join('') + '</ul>';
  }
  function closeDetail() { $('detail').hidden = true; $('detail').innerHTML = ''; highlight(null); }
  function renderHeat(archive, id) {
    const end = now(), start = E.parseTime(E.addDays(E.dateKey(end - 1), -29));
    const group = E.analyze(archive, {start, end}).groups.find(g => g.id === id);
    if (!group) { $('heat').innerHTML = '<p class="note">Немає подій для цієї підгрупи.</p>'; return; }
    const days = E.calendar(group, start, end).reverse();
    const cells = [];
    let html = '<div class="heat-row" aria-hidden="true"><span></span>' + Array.from({length: 24}, (_, h) => '<span>' + (h % 3 ? '' : String(h).padStart(2, '0')) + '</span>').join('') + '</div>';
    for (const day of days) {
      html += '<div class="heat-row" role="row"><span role="rowheader">' + esc(day.date.slice(8) + '.' + day.date.slice(5, 7)) + '</span>';
      for (const cell of day.hours) {
        const total = cell.onHours + cell.offHours + cell.unknownHours;
        let kind = !total ? 'outside' : cell.onHours === total ? 'on' : cell.offHours === total ? 'off' : cell.unknownHours === total ? 'unknown' : 'mixed';
        let style = '';
        if (kind === 'mixed') {
          let pos = 0; const stops = [];
          for (const i of cell.intervals) {
            const next = pos + (i.end - i.start) / (total * HOUR) * 100;
            const color = i.state === 'on' ? 'var(--on)' : i.state === 'off' ? 'var(--off)' : '#d5dbd8';
            stops.push(color + ' ' + pos.toFixed(1) + '%', color + ' ' + next.toFixed(1) + '%'); pos = next;
          }
          style = ' style="background:linear-gradient(90deg,' + stops.join(',') + ')"';
        }
        const label = day.date + ' ' + String(cell.hour).padStart(2, '0') + ':00 — ' + (!total ? 'поза періодом' :
          'світло ' + Math.round(cell.onHours * 60) + ' хв, без світла ' + Math.round(cell.offHours * 60) + ' хв, невідомо ' + Math.round(cell.unknownHours * 60) + ' хв');
        const i = cells.length; cells.push({cell, label});
        html += '<button type="button" role="gridcell" class="cell ' + kind + '" data-cell="' + i + '" tabindex="' + (i ? -1 : 0) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' + style + '></button>';
      }
      html += '</div>';
    }
    const heat = $('heat');
    heat.innerHTML = html;
    const show = button => {
      const entry = cells[+button.dataset.cell]; if (!entry) return;
      $('cellInfo').innerHTML = '<strong>' + esc(entry.label) + '</strong>' + (entry.cell.intervals.length ? '<br>' + entry.cell.intervals.map(i => esc(timeFmt.format(i.start) + '–' + timeFmt.format(i.end) + ' ' + stateName[i.state].toLowerCase())).join(' · ') : '');
    };
    heat.onclick = e => { const b = e.target.closest('[data-cell]'); if (b) show(b); };
    heat.addEventListener('focusin', e => { const b = e.target.closest('[data-cell]'); if (b) { heat.querySelector('[tabindex="0"]')?.setAttribute('tabindex', '-1'); b.tabIndex = 0; show(b); } });
    heat.onkeydown = e => {
      const b = e.target.closest('[data-cell]'); const d = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -24, ArrowDown: 24}[e.key];
      if (!b || d == null) return;
      e.preventDefault(); heat.querySelector('[data-cell="' + Math.max(0, Math.min(cells.length - 1, +b.dataset.cell + d)) + '"]')?.focus();
    };
  }
  function route() {
    const match = location.hash.match(/^#sg=([\w-]+)$/);
    if (match) openDetail(match[1]); else if (!$('detail').hidden) closeDetail();
  }

  // --- data ---------------------------------------------------------------
  async function loadSummary() {
    const response = await fetch('data/summary.json', {cache: 'no-cache'});
    if (!response.ok) throw new Error('Не вдалося завантажити дані (' + response.status + ')');
    state.summary = await response.json();
    state.groups = new Map(state.summary.groups.map(g => [g.id, g]));
  }
  function renderAll() { renderStatus(); renderRows(); paintMap(); }
  async function start() {
    try {
      const [, addresses] = await Promise.all([loadSummary(), fetch('data/addresses.json').then(r => r.ok ? r.json() : null).catch(() => null)]);
      state.addresses = addresses || {source: null, polygons: [], addresses: [], colors: {}};
      if (!addresses) notice('Адреси недоступні: показано лише підгрупи.');
      initMap();
      renderAll();
      route();
    } catch (error) { notice(error.message); $('statusText').textContent = 'Дані недоступні'; }
  }

  // --- events -------------------------------------------------------------
  document.querySelectorAll('[data-range]').forEach(b => b.onclick = () => {
    state.range = b.dataset.range;
    document.querySelectorAll('[data-range]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderRows();
  });
  $('sort').onchange = () => { state.sort = $('sort').value; renderRows(); };
  for (const id of ['rows', 'inactiveRows']) {
    const el = $(id);
    el.addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) location.hash = 'sg=' + b.dataset.open; });
    el.addEventListener('mouseover', e => { const r = e.target.closest('.row'); if (r && r.dataset.sg !== state.hovered) { state.hovered = r.dataset.sg; highlight(r.dataset.sg); } });
    el.addEventListener('mouseleave', () => { state.hovered = null; highlight(location.hash.startsWith('#sg=') ? location.hash.slice(4) : null); });
    el.addEventListener('focusin', e => { const r = e.target.closest('.row'); if (r) highlight(r.dataset.sg); });
  }
  $('detail').addEventListener('click', e => {
    const b = e.target.closest('[data-address]');
    if (b) focusAddress(state.addresses.addresses.find(a => a.id === b.dataset.address));
  });
  $('search').addEventListener('input', () => { results = state.summary ? search($('search').value) : []; cursor = -1; renderResults(); });
  $('search').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!results.length) return; cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; renderResults(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[cursor < 0 ? 0 : cursor]); }
    else if (e.key === 'Escape') { results = []; cursor = -1; renderResults(); }
  });
  $('searchResults').addEventListener('mousedown', e => { const li = e.target.closest('[data-i]'); if (li) { e.preventDefault(); choose(results[+li.dataset.i]); } });
  $('search').addEventListener('blur', () => setTimeout(() => { results = []; renderResults(); }, 150));
  window.addEventListener('hashchange', route);
  // The data is rebuilt hourly; refresh an open page quietly.
  setInterval(() => { if (document.visibilityState === 'visible') loadSummary().then(renderAll).catch(() => {}); }, 15 * 60 * 1000);
  start();
})();
