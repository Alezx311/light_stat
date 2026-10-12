#!/usr/bin/env node
'use strict';
// A successful Pages deployment must also expose the new channel check to readers.
const fs = require('node:fs');
const path = require('node:path');
const SITE = 'https://alezx311.github.io/light_stat/';

async function verifyPublished(expected, {request = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), attempts = 12} = {}) {
  const minimum = Date.parse(expected);
  if (!Number.isFinite(minimum)) throw new Error('Invalid expected observedUntil');
  let reason = 'No response';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request(SITE + 'data/summary.json?verify=' + Date.now() + '-' + attempt,
        {cache: 'no-store', signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const summary = await response.json();
      const actual = typeof summary.observedUntil === 'string' ? Date.parse(summary.observedUntil) : NaN;
      if (Number.isFinite(actual) && actual >= minimum) return summary.observedUntil;
      reason = 'Published observedUntil is ' + String(summary.observedUntil) + ', expected at least ' + expected;
    } catch (error) { reason = error.message; }
    if (attempt + 1 < attempts) await sleep(10000);
  }
  throw new Error('Published data did not update: ' + reason);
}

if (require.main === module) {
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '../_site/data/summary.json'), 'utf8')).observedUntil;
  verifyPublished(expected).then(actual => console.log('Verified ' + SITE + ': channel checked at ' + actual))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {verifyPublished};
