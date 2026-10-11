'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('../assets/live-status');
const checked = '2026-10-11T02:34:00+03:00';
const time = Date.parse(checked);

test('a successfully downloaded old snapshot never becomes a fresh power status', () => {
  const group = {active: true, state: 'on'};
  assert.equal(live.groupState(group, checked, time + live.STALE_AFTER - 1), 'on');
  assert.equal(live.groupState(group, checked, time + live.STALE_AFTER), 'unknown');
  assert.equal(live.groupState(group, checked, Date.parse('2026-10-11T08:49:00+03:00')), 'unknown');
  assert.equal(live.groupState({...group, state: 'off'}, checked, time + live.STALE_AFTER), 'unknown');
  assert.equal(group.state, 'on', 'historical snapshot is preserved');
});

test('only a new channel check restores the reported state', () => {
  const later = '2026-10-11T08:50:00+03:00', wall = Date.parse(later);
  assert.equal(live.groupState({active: true, state: 'off'}, later, wall), 'off');
  assert.equal(live.groupState({active: false, state: 'on'}, later, wall), 'unknown');
  assert.equal(live.groupState({active: true, state: 'unknown'}, later, wall), 'unknown');
  assert.equal(live.groupState(null, later, wall), 'unknown');
});

test('missing, invalid and implausibly future check times fail closed', () => {
  for (const checkedAt of [undefined, null, '', 'invalid', new Date(time + 120000).toISOString()]) {
    assert.equal(live.freshness(checkedAt, time).stale, true);
    assert.equal(live.groupState({active: true, state: 'on'}, checkedAt, time), 'unknown');
  }
  assert.equal(live.freshness(checked, time + 5 * 60000).age, 5 * 60000);
});
