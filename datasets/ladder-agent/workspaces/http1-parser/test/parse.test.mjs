import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestParser } from '../src/index.mjs';

const bytes = (text) => Buffer.from(text, 'latin1');
const text = (body) => Buffer.from(body).toString('latin1');

test('a simple request', () => {
  const result = new RequestParser().push(bytes('GET /index?q=1 HTTP/1.1\r\nHost: example.test\r\nAccept:  text/html \r\n\r\n'));
  assert.equal(result.error, null);
  assert.equal(result.messages.length, 1);
  const [message] = result.messages;
  assert.equal(message.method, 'GET');
  assert.equal(message.target, '/index?q=1');
  assert.equal(message.version, '1.1');
  assert.deepEqual(message.headers, [['host', 'example.test'], ['accept', 'text/html']]);
  assert.equal(message.keepAlive, true);
  assert.equal(message.body.length, 0);
});

test('a body with a content length, in two pieces', () => {
  const parser = new RequestParser();
  const first = parser.push(bytes('POST /a HTTP/1.1\r\nHost: h\r\nContent-Length: 5\r\n\r\nhel'));
  assert.deepEqual(first.messages, []);
  const second = parser.push(bytes('lo'));
  assert.equal(text(second.messages[0].body), 'hello');
});

test('a chunked body with a trailer', () => {
  const result = new RequestParser().push(bytes('POST /a HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2;x=y\r\nde\r\n0\r\nX-Sum: 7\r\n\r\n'));
  assert.equal(result.error, null);
  assert.equal(text(result.messages[0].body), 'abcde');
  assert.deepEqual(result.messages[0].trailers, [['x-sum', '7']]);
});

test('pipelined requests in one push', () => {
  const one = 'GET /1 HTTP/1.1\r\nHost: h\r\n\r\n';
  const result = new RequestParser().push(bytes(one + one.replace('/1', '/2')));
  assert.deepEqual(result.messages.map((message) => message.target), ['/1', '/2']);
});

test('bytes one at a time give the same message', () => {
  const raw = bytes('PUT /k HTTP/1.1\r\nHost: h\r\nContent-Length: 3\r\n\r\nabc');
  const parser = new RequestParser();
  const messages = [];
  for (const byte of raw) messages.push(...parser.push(Uint8Array.of(byte)).messages);
  assert.equal(messages.length, 1);
  assert.equal(text(messages[0].body), 'abc');
});

test('Connection: close ends the connection', () => {
  const parser = new RequestParser();
  const result = parser.push(bytes('GET / HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\nGET /next HTTP/1.1\r\n'));
  assert.equal(result.messages[0].keepAlive, false);
  assert.equal(result.ignored, 20);
});

test('errors carry a code and a status', () => {
  const result = new RequestParser().push(bytes('GET / HTTP/2.0\r\n\r\n'));
  assert.equal(result.error.code, 'bad-version');
  assert.equal(result.error.status, 505);
  assert.deepEqual(result.messages, []);
});

test('input that stops in the middle of a message is incomplete', () => {
  const parser = new RequestParser();
  parser.push(bytes('GET / HTTP/1.1\r\nHost: h\r\n'));
  assert.equal(parser.end().error.code, 'incomplete');
});
