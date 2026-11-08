import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, manualClock, rateLimit, toHeaders } from '../src/index.mjs';

test('headers of an allowed result', () => {
  const headers = toHeaders({ allowed: true, limit: 10, remaining: 7, retryAfterMs: 0, resetMs: 3000 });
  assert.deepEqual(headers, { 'ratelimit-limit': '10', 'ratelimit-remaining': '7', 'ratelimit-reset': '3' });
});

test('headers of a refused result carry retry-after in seconds', () => {
  const headers = toHeaders({ allowed: false, limit: 10, remaining: 0, retryAfterMs: 2000, resetMs: 5000 });
  assert.equal(headers['retry-after'], '2');
  assert.equal(headers['ratelimit-reset'], '5');
});

function fakeResponse() {
  const res = { headers: {}, statusCode: 200, body: null, setHeader(name, value) { res.headers[name] = value; }, end(body) { res.body = body; } };
  return res;
}

test('the middleware passes allowed requests on and answers 429 to the rest', () => {
  const limiter = createLimiter({ rules: [{ match: '*', burst: 1, perSecond: 1 }], clock: manualClock(0) });
  const middleware = rateLimit(limiter);
  let passed = 0;
  const first = fakeResponse();
  middleware({ ip: '1.1.1.1' }, first, () => { passed += 1; });
  const second = fakeResponse();
  middleware({ ip: '1.1.1.1' }, second, () => { passed += 1; });
  assert.equal(passed, 1);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(second.headers['retry-after'], '1');
});
