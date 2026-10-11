/* Freshness of the published channel snapshot, separate from historical reconstruction. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LightStatLive = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const REFRESH_INTERVAL = 60 * 1000;
  const STALE_AFTER = 15 * 60 * 1000;
  function freshness(observedUntil, now = Date.now()) {
    const checkedAt = typeof observedUntil === 'string' ? Date.parse(observedUntil) : NaN;
    const age = now - checkedAt;
    return {checkedAt: Number.isFinite(checkedAt) ? checkedAt : null,
      age: Number.isFinite(age) ? Math.max(0, age) : null,
      stale: !Number.isFinite(age) || age < -60000 || age >= STALE_AFTER};
  }
  function groupState(group, observedUntil, now = Date.now()) {
    return !freshness(observedUntil, now).stale && group?.active && ['on', 'off'].includes(group.state)
      ? group.state : 'unknown';
  }
  return {REFRESH_INTERVAL, STALE_AFTER, freshness, groupState};
});
