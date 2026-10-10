'use strict';
/* Parsers for the public sources. No network access here, so they are testable on fixtures. */

const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
function decode(html) {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
      if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
      return entities[code.toLowerCase()] ?? all;
    }).trim();
}

// Public web preview of a channel: https://t.me/s/<channel>[?before=<id>]
function parseChannelPage(html, channel) {
  const marker = 'data-post="' + channel + '/';
  const chunks = html.split(marker).slice(1);
  const messages = [];
  for (const chunk of chunks) {
    const id = Number(chunk.slice(0, chunk.indexOf('"')));
    const time = chunk.match(/<time[^>]*datetime="([^"]+)"/);
    if (!Number.isInteger(id) || !time) continue;
    const textMatch = chunk.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    messages.push({id, date: time[1], text: textMatch ? decode(textMatch[1]) : ''});
  }
  return messages;
}

// eh-map.napruha.top embeds its data as `const name = <json>;` lines in the page.
function embedded(html, name) {
  const match = html.match(new RegExp('const ' + name + ' = (.*);\\s*\\n'));
  if (!match) throw new Error('eh-map: не знайдено ' + name);
  return JSON.parse(match[1]);
}
function groupId(value) {
  const id = String(value || '').trim().toLowerCase();
  return id && id !== 'unknown' ? id : null;
}
function parseEhMap(html) {
  const features = [...embedded(html, 'points').features, ...embedded(html, 'points2').features];
  const seen = new Set();
  const addresses = [];
  for (const feature of features) {
    const p = feature.properties || {};
    const [lon, lat] = feature.geometry && feature.geometry.coordinates || [];
    if (!p.id || seen.has(p.id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    seen.add(p.id);
    addresses.push({id: String(p.id), title: String(p.title || p.id), entrance: p.entrance ? String(p.entrance) : null,
      description: p.description ? String(p.description) : null,
      groups: [...new Set([groupId(p.group), groupId(p.group2)].filter(Boolean))],
      dtekGroups: Array.isArray(p.global_groups_eh) && p.global_groups_eh.length ? p.global_groups_eh.map(String) :
        Array.isArray(p.global_groups) ? p.global_groups.map(String) : [],
      lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6});
  }
  const polygons = embedded(html, 'polygons').filter(p => Array.isArray(p.coordinates))
    .map(p => ({id: String(p.id), group: groupId(p.group), coordinates: p.coordinates.map(([lon, lat]) => [lat, lon])}));
  const colors = {};
  for (const [key, value] of Object.entries(embedded(html, 'groupColors'))) if (groupId(key)) colors[groupId(key)] = value;
  return {addresses, polygons, colors};
}

module.exports = {decode, parseChannelPage, parseEhMap};
