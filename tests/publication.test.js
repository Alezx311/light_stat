'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {verifyPublished} = require('../tools/verify-published');
const expected = '2026-10-12T20:00:00.000Z';
const response = observedUntil => new Response(JSON.stringify({observedUntil}));

test('publication verification waits for the deployed check instead of accepting a cached summary', async () => {
  let calls = 0;
  const delays = [];
  const actual = await verifyPublished(expected, {
    request: async (_url, options) => {
      assert.equal(options.cache, 'no-store');
      return response(++calls === 1 ? '2026-10-12T16:55:00Z' : expected);
    }, sleep: async ms => delays.push(ms)
  });
  assert.equal(actual, expected); assert.equal(calls, 2); assert.deepEqual(delays, [10000]);
});

test('verification accepts a later successful publication and reports persistent stale or invalid data', async () => {
  const newer = '2026-10-12T20:05:00.000Z';
  assert.equal(await verifyPublished(expected, {request: async () => response(newer)}), newer);
  for (const old of ['2026-10-12T16:55:00Z', null, 'broken']) {
    let calls = 0;
    await assert.rejects(verifyPublished(expected, {
      attempts: 2, request: async () => { calls++; return response(old); }, sleep: async () => {}
    }), /Published data did not update/);
    assert.equal(calls, 2);
  }
});

test('publication HTTP and network failures are retried and eventually fail visibly', async () => {
  let calls = 0;
  assert.equal(await verifyPublished(expected, {
    request: async () => {
      calls++;
      if (calls === 1) throw new Error('offline');
      if (calls === 2) return new Response('', {status: 503});
      return response(expected);
    }, sleep: async () => {}
  }), expected);
  await assert.rejects(verifyPublished(expected, {attempts: 1, request: async () => new Response('', {status: 503})}), /HTTP 503/);
  await assert.rejects(verifyPublished('invalid', {request: async () => assert.fail('no request for invalid time')}), /Invalid expected/);
});
