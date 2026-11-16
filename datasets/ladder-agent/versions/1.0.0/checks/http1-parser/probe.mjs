// Hidden probes for ladder-agent-http1-parser; expected.json holds the answers.
// Most probes feed the same bytes whole, one byte at a time, in 7-byte pieces and in three cuts,
// and answer only when all four agree.
const lib = async (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};
const parserOf = async (load) => (await lib(load)).RequestParser;
const b = (text) => Buffer.from(text, 'latin1');
const view = (m) => ({ method: m.method, target: m.target, version: m.version, headers: m.headers, body: Buffer.from(m.body).toString('latin1'), trailers: m.trailers, keepAlive: m.keepAlive });
const brief = (acc) => ({ messages: acc.messages.map(view), error: acc.error ? { code: acc.error.code, status: acc.error.status } : null, ignored: acc.ignored });

function feed(P, opts, pieces) {
  const parser = new P(opts);
  const acc = { messages: [], error: null, ignored: 0 };
  for (const piece of pieces) {
    const r = parser.push(piece);
    acc.messages.push(...r.messages);
    if (r.error) acc.error = r.error;
    acc.ignored += r.ignored;
  }
  const e = parser.end();
  if (e.error) acc.error = e.error;
  return brief(acc);
}

function cuts(buf) {
  const n = buf.length;
  const a = Math.floor(n / 3);
  const c = Math.floor((2 * n) / 3);
  const sevens = [];
  for (let i = 0; i < n; i += 7) sevens.push(buf.subarray(i, i + 7));
  return [[buf], [...buf].map((x) => Uint8Array.of(x)), sevens, [buf.subarray(0, a), buf.subarray(a, c), buf.subarray(c)]];
}

async function go(load, raw, opts) {
  const P = await parserOf(load);
  const results = cuts(b(raw)).map((pieces) => JSON.stringify(feed(P, opts, pieces)));
  if (results.some((r) => r !== results[0])) return { splitDiffers: results.map((r) => r === results[0]) };
  return JSON.parse(results[0]);
}

const tag = (r) => (r.error ? r.error.code : r.messages.map((m) => `${m.method} ${m.target} ${m.version}`).join('|') || 'none');
async function tags(load, cases, opts) {
  const out = [];
  for (const raw of cases) out.push(tag(await go(load, raw, opts)));
  return out;
}

const req = (line, ...fields) => `${line}\r\n${fields.map((f) => `${f}\r\n`).join('')}\r\n`;
const HOST = 'Host: a';
const get = (target = '/') => req(`GET ${target} HTTP/1.1`, HOST);
const post = (len, body) => `POST /p HTTP/1.1\r\nHost: a\r\nContent-Length: ${len}\r\n\r\n${body}`;
const CHUNKED_HEAD = 'POST /p HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked\r\n\r\n';
const chunked = (...parts) => CHUNKED_HEAD + parts.join('');

/** Run pushes one by one and answer the error code (or null) after each. */
async function steps(load, opts, pieces) {
  const P = await parserOf(load);
  const parser = new P(opts);
  return pieces.map((piece) => parser.push(b(piece)).error?.code ?? null);
}

const probes = [
  {
    name: 'keeps the exports and default limits',
    run: async ({ load }) => {
      const m = await lib(load);
      return { limits: m.DEFAULT_LIMITS, statuses: Object.entries(m.STATUS).length, uri: m.STATUS['uri-too-long'], hasParser: typeof m.RequestParser };
    },
  },
  {
    name: 'fields are lowered, trimmed and kept in order',
    run: async ({ load }) => go(load, 'GET /a/b?c=d HTTP/1.1\r\nHOST:   q.r  \t\r\nX-Multi: 1\r\nx-multi:\t2\r\nX-Raw: caf\xe9 \x80\xff\r\nX-Empty:\r\nX-Tab: a\tb\r\nX-Edge: \t  \t\r\n\r\n'),
  },
  {
    name: 'every printable byte is allowed in a value',
    run: async ({ load }) => {
      let all = '';
      for (let c = 0x21; c <= 0x7e; c += 1) all += String.fromCharCode(c);
      return go(load, `GET / HTTP/1.1\r\nHost: a\r\nX-All: ${all}\r\n\r\n`);
    },
  },
  {
    name: 'the message object has its exact keys and owns its body',
    run: async ({ load }) => {
      const P = await parserOf(load);
      const raw = Buffer.from('xxPOST /own HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhelloyy', 'latin1');
      const parser = new P();
      const [message] = parser.push(raw.subarray(2, raw.length - 2)).messages;
      raw.fill(88);
      const bodyAfter = Buffer.from(message.body).toString('latin1');
      const c = new P().push(Buffer.from('POST /c HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nab\r\n0\r\n\r\n', 'latin1')).messages[0];
      return {
        keys: Object.keys(message).sort(),
        isBytes: message.body instanceof Uint8Array,
        bodyAfter,
        pairs: message.headers.every((p) => Array.isArray(p) && p.length === 2),
        trailersEmpty: Array.isArray(c.trailers) && c.trailers.length === 0,
        chunkedBody: Buffer.from(c.body).toString('latin1'),
        emptyBody: new P().push(b(get())).messages[0].body.length,
      };
    },
  },
  {
    name: 'a 1.0 request needs no Host and closes',
    run: async ({ load }) => [
      await go(load, 'GET / HTTP/1.0\r\n\r\ntail'),
      await go(load, 'GET / HTTP/1.0\r\nHost: a\r\nHost: b\r\n\r\n'),
      await go(load, 'GET / HTTP/1.0\r\nConnection: keep-alive\r\n\r\nGET /2 HTTP/1.0\r\n\r\n'),
    ],
  },
  {
    name: 'Connection parts decide keepAlive',
    run: async ({ load }) => {
      const cases = [
        ['1.1', []],
        ['1.1', ['close']],
        ['1.1', ['Close']],
        ['1.1', ['keep-alive']],
        ['1.1', ['upgrade , CLOSE']],
        ['1.1', ['upgrade', 'close']],
        ['1.1', ['closed']],
        ['1.1', ['x-close, upgrade']],
        ['1.0', []],
        ['1.0', ['Keep-Alive']],
        ['1.0', ['te, KEEP-ALIVE']],
        ['1.0', ['close, keep-alive']],
        ['1.0', ['te', 'keep-alive']],
        ['1.0', ['keepalive']],
      ];
      const out = [];
      for (const [version, fields] of cases) {
        const raw = req(`GET / HTTP/${version}`, ...(version === '1.1' ? [HOST] : []), ...fields.map((f) => `Connection: ${f}`)) + 'Z';
        const r = await go(load, raw);
        out.push([r.messages[0]?.keepAlive, r.ignored, r.error?.code ?? null]);
      }
      return out;
    },
  },
  {
    name: 'pipelined messages and empty lines between them',
    run: async ({ load }) => go(load, `\r\n\r\n${get('/one')}\r\n${post(3, 'a\r\n')}\r\n\r\n${chunked('4\r\ndata\r\n', '0\r\n\r\n')}${get('/four')}GET /five HT`),
  },
  {
    name: 'a body keeps every byte value',
    run: async ({ load }) => {
      let all = '';
      for (let c = 0; c < 256; c += 1) all += String.fromCharCode(c);
      return [await go(load, post(256, all) + get('/after')), await go(load, chunked('100\r\n', all, '\r\n0\r\n\r\n'))];
    },
  },
  {
    name: 'end() between messages and in the middle of them',
    run: async ({ load }) => tags(load, [
      '',
      '\r\n\r\n',
      get(),
      `${get()}\r\n`,
      'GET / HTTP/1.1\r\n',
      'GET / HT',
      'GET / HTTP/1.1\r\nHost: a\r\n\r',
      post(5, 'hel'),
      post(5, 'hello'),
      chunked('3\r\nabc\r\n'),
      chunked('3\r\nabc\r\n0\r\n'),
      chunked('3\r\nab'),
      chunked('0\r\nX: y\r\n'),
      'GET / HTTP/1.0\r\n\r\ngarbage that is never parsed',
    ]),
  },
  {
    name: 'request line shapes',
    run: async ({ load }) => tags(load, [
      'GET  / HTTP/1.1',
      'GET /',
      'GET / HTTP/1.1 ',
      ' GET / HTTP/1.1',
      'GET\t/ HTTP/1.1',
      'GET / http/1.1',
      'GET / HTTP/1.10',
      'GET / HTTP/1.',
      'GET / HTTP1.1',
      'G(T / HTTP/1.1',
      'GET /a\x80b HTTP/1.1',
      'GET /a b HTTP/1.1',
      'GET /a\x7f HTTP/1.1',
      'GET / HTTP/x.1',
      'GET HTTP/1.1',
      'M-SEARCH * HTTP/1.1',
      "x!#$%&'*+.^_`|~y /z HTTP/1.1",
      'get /lower HTTP/1.1',
    ].map((line) => req(line, HOST))),
  },
  {
    name: 'versions and their order against the target',
    run: async ({ load }) => tags(load, [
      'GET / HTTP/1.2',
      'GET / HTTP/0.9',
      'GET / HTTP/2.0',
      'GET / HTTP/9.9',
      'GET #x HTTP/2.0',
      'GET x HTTP/1.7',
      'GET #x HTTP/1.1',
      'GET / HTTP/1.0',
    ].map((line) => req(line, HOST))),
  },
  {
    name: 'targets that are accepted',
    run: async ({ load }) => tags(load, [
      'GET / HTTP/1.1',
      'GET /a?b=c&d=e%20f HTTP/1.1',
      'GET //x HTTP/1.1',
      'GET http://h.test HTTP/1.1',
      'GET https://h.test:81/p?q=1 HTTP/1.1',
      'GET http://h?x HTTP/1.1',
      'OPTIONS * HTTP/1.1',
      'OPTIONS /x HTTP/1.1',
      'CONNECT h.test:443 HTTP/1.1',
      'CONNECT 10.0.0.1:80 HTTP/1.1',
      'CONNECT a-b.c:1 HTTP/1.1',
      'connect /x HTTP/1.1',
      'options * HTTP/1.0',
    ].map((line) => req(line, HOST))),
  },
  {
    name: 'targets that are refused',
    run: async ({ load }) => tags(load, [
      'GET /a#b HTTP/1.1',
      'GET x HTTP/1.1',
      'GET http:// HTTP/1.1',
      'GET http:///p HTTP/1.1',
      'GET http://?q HTTP/1.1',
      'GET https://#f HTTP/1.1',
      'GET ftp://h/ HTTP/1.1',
      'GET HTTP://h/ HTTP/1.1',
      'GET * HTTP/1.1',
      'options * HTTP/1.1',
      'OPTIONS ** HTTP/1.1',
      'CONNECT /x HTTP/1.1',
      'CONNECT h HTTP/1.1',
      'CONNECT h: HTTP/1.1',
      'CONNECT h:123456 HTTP/1.1',
      'CONNECT h_x:80 HTTP/1.1',
      'CONNECT http://h:80 HTTP/1.1',
      'CONNECT :80 HTTP/1.1',
      'CONNECT * HTTP/1.1',
      'GET h:80 HTTP/1.1',
      'GET # HTTP/1.1',
    ].map((line) => req(line, HOST))),
  },
  {
    name: 'header lines that are refused',
    run: async ({ load }) => tags(load, [
      ' x: y',
      '\tx: y',
      'novalue',
      ': nameless',
      'bad name: x',
      'name : x',
      'na(me: x',
      'na@me: x',
      'caf\xe9: x',
      'x: a\x01b',
      'x: a\x7fb',
      'x: a\x0bb',
      'x: a\x00b',
      'x: a\x1fb',
    ].map((field) => `GET / HTTP/1.1\r\nHost: a\r\n${field}\r\n\r\n`).concat([
      'GET / HTTP/1.1\r\nHost: a\r\nx: y\r\n z\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: a\r\nx: y\r\n\tz\r\n\r\n',
      'GET / HTTP/1.1\r\n Host: a\r\n\r\n',
    ])),
  },
  {
    name: 'the header count',
    run: async ({ load }) => {
      const opts = { maxHeaders: 3 };
      const lines = (n) => Array.from({ length: n }, (_, i) => `H${i}: v`);
      return [
        await tags(load, [req('GET / HTTP/1.1', HOST, ...lines(2)), req('GET / HTTP/1.1', HOST, ...lines(3)), req('GET / HTTP/1.1', HOST, ...lines(5)), req('GET / HTTP/1.1', HOST, ...lines(2), 'bad name: x')], opts),
        await tags(load, [req('GET / HTTP/1.1', HOST, ...lines(2), 'bad name: x', 'a: b')], opts),
        await tags(load, [req('GET / HTTP/1.0', ...lines(3)), req('GET / HTTP/1.0', ...lines(4))], opts),
        await tags(load, [req('GET / HTTP/1.1', HOST, ...Array.from({ length: 99 }, (_, i) => `a${i}: b`)), req('GET / HTTP/1.1', HOST, ...Array.from({ length: 100 }, (_, i) => `a${i}: b`))]),
      ];
    },
  },
  {
    name: 'Host rules and the order of the section checks',
    run: async ({ load }) => tags(load, [
      'GET / HTTP/1.1\r\n\r\n',
      'GET / HTTP/1.1\r\nHost:\r\n\r\n',
      'GET / HTTP/1.1\r\nHost:  \t\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: a\r\nhost: b\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: a\r\nX: 1\r\n\r\n',
      'GET / HTTP/1.1\r\nContent-Length: x\r\n\r\n',
      'GET / HTTP/1.1\r\nTransfer-Encoding: gzip\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: gzip\r\nContent-Length: x\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: gzip\r\n\r\n',
      'GET / HTTP/1.0\r\nHost:\r\n\r\n',
    ]),
  },
  {
    name: 'Transfer-Encoding values',
    run: async ({ load }) => {
      const te = (fields, tail = '0\r\n\r\n', version = '1.1') => `POST /p HTTP/${version}\r\nHost: a\r\n${fields.map((f) => `Transfer-Encoding:${f}\r\n`).join('')}\r\n${tail}`;
      return tags(load, [
        te([' chunked']),
        te([' CHUNKED']),
        te(['  Chunked \t']),
        te([' chunked, chunked']),
        te([' gzip, chunked']),
        te([' chunked, gzip']),
        te([' ']),
        te([' identity']),
        te([' chunked', ' chunked']),
        te([' gzip', ' chunked']),
        te([' chunked,']),
        te([' chunked'], '0\r\n\r\n', '1.0'),
        te([' gzip'], '', '1.0'),
        `POST /p HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked\r\nContent-Length: 0\r\n\r\n0\r\n\r\n`,
        `POST /p HTTP/1.1\r\nHost: a\r\nContent-Length: 4\r\nTransfer-Encoding: gzip\r\n\r\n`,
      ]);
    },
  },
  {
    name: 'Content-Length values',
    run: async ({ load }) => {
      const cl = (fields, tail = '') => `POST /p HTTP/1.1\r\nHost: a\r\n${fields.map((f) => `Content-Length:${f}\r\n`).join('')}\r\n${tail}`;
      return [
        await tags(load, [
          cl([' 0']),
          cl([' 3'], 'abc'),
          cl([' 03'], 'abc'),
          cl([' 3', ' 3'], 'abc'),
          cl([' 3', ' 03'], 'abc'),
          cl([' 3', ' 4'], 'abc'),
          cl([' +3'], 'abc'),
          cl([' -0']),
          cl([' 3 3'], 'abc'),
          cl([' 3,3'], 'abc'),
          cl([' ']),
          cl([' 0x3'], 'abc'),
          cl([' 3a'], 'abc'),
          cl([' 3', ' x'], 'abc'),
          cl([' 1e1'], '0123456789'),
          cl([' 99999999999999999999999']),
        ]),
        await tags(load, [cl([' 4'], 'abcd'), cl([' 5']), cl([' 4', ' 5']), cl([' 004'], 'abcd'), cl([' 0000000000000000000000000'])], { maxBodyBytes: 4 }),
      ];
    },
  },
  {
    name: 'bare CR and bare LF',
    run: async ({ load }) => tags(load, [
      'GET / HTTP/1.1\nHost: a\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: a\n\r\n',
      'GET / HTTP/1.1\r\nHost: a\r\n\n',
      '\nGET / HTTP/1.1\r\nHost: a\r\n\r\n',
      'GET / HTTP/1.1\r\r\nHost: a\r\n\r\n',
      'GET / HTTP/1.1\rHost: a\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: a\r\nX: a\rb\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: a\r\n\rX\r\n',
      '\r\r\nGET / HTTP/1.1\r\nHost: a\r\n\r\n',
      `${post(2, 'ab')}\n`,
      chunked('3\nabc'),
      chunked('3\r\nabc\r\n0\r\nX: y\n\r\n'),
      chunked('3\r\nabc\r\n0\r\n\n'),
    ]),
  },
  {
    name: 'the line length limit in four places',
    run: async ({ load }) => {
      const N = 30;
      const opts = { maxLineBytes: N, maxHeaderBytes: 5000 };
      const reqLine = (len) => `GET /${'a'.repeat(len - 14)} HTTP/1.1`;
      const field = (len) => `X: ${'v'.repeat(len - 3)}`;
      const withTrailer = (len) => chunked('0\r\n', field(len), '\r\n\r\n');
      const sizeLine = (len) => chunked(`3;${'x'.repeat(len - 2)}\r\nabc\r\n0\r\n\r\n`);
      return tags(load, [
        req(reqLine(N), HOST),
        req(reqLine(N + 1), HOST),
        req('GET / HTTP/1.1', HOST, field(N)),
        req('GET / HTTP/1.1', HOST, field(N + 1)),
        withTrailer(N),
        withTrailer(N + 1),
        sizeLine(N),
        sizeLine(N + 1),
        req(reqLine(N + 8), HOST),
      ], opts);
    },
  },
  {
    name: 'the header section limit counts from the first byte',
    run: async ({ load }) => {
      const M = 120;
      const opts = { maxHeaderBytes: M };
      const section = (total) => `GET / HTTP/1.1\r\nHost: a\r\nX: ${'p'.repeat(total - 32)}\r\n\r\n`;
      const trailerSection = (total) => chunked('0\r\n', `X: ${'t'.repeat(total - 7)}\r\n\r\n`);
      return tags(load, [
        section(M),
        section(M + 1),
        section(M - 1),
        `${'\r\n'.repeat(60)}${section(M)}`,
        `${section(M)}${'\r\n'.repeat(60)}${section(M)}`,
        `${section(M)}${section(M + 1)}`,
        trailerSection(M),
        trailerSection(M + 1),
        `${trailerSection(M)}${trailerSection(M)}`,
      ], opts);
    },
  },
  {
    name: 'which limit wins when one byte breaks several rules',
    run: async ({ load }) => [
      await steps(load, { maxHeaderBytes: 30 }, ['GET / HTTP/1.1\r\nHost: a\r\nXXXXX', '\n']),
      await steps(load, { maxLineBytes: 20 }, ['GET /aaaaaa HTTP/1.1', '\r', 'x']),
      await steps(load, { maxLineBytes: 14, maxHeaderBytes: 14 }, ['GET / HTTP/1.1', 'x']),
      await steps(load, { maxLineBytes: 14 }, ['GET / HTTP/1.1', 'x']),
      await steps(load, { maxHeaderBytes: 14 }, ['GET / HTTP/1.1', '\r', '\n']),
      await steps(load, { maxHeaderBytes: 16 }, ['GET / HTTP/1.1\r', '\n', '\r']),
    ],
  },
  {
    name: 'each error shows at the byte that causes it',
    run: async ({ load }) => [
      await steps(load, undefined, ['GET / HTTP/1.1\r', 'x']),
      await steps(load, undefined, ['GET / HTTP/1.1\r\nHost: a\r\nX: 1\n']),
      await steps(load, { maxLineBytes: 10 }, ['GET /abcde', 'f']),
      await steps(load, { maxHeaderBytes: 40 }, ['GET / HTTP/1.1\r\nHost: a\r\nX: 1234567', 'abcde', 'f']),
      await steps(load, { maxBodyBytes: 10 }, [CHUNKED_HEAD, '6\r\nabcdef\r\n', 'B\r', '\n']),
      await steps(load, undefined, [CHUNKED_HEAD, '3\r\nabc', 'X']),
      await steps(load, undefined, [CHUNKED_HEAD, '3\r\nabc\r', 'X']),
      await steps(load, undefined, ['GET / HTTP/1.1\r\nX: 1\r\n', '\r', '\n']),
      await steps(load, { maxBodyBytes: 4 }, ['POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r', '\n']),
      await steps(load, undefined, ['GET / HTTP/1.1\r\nHost: a\r\nbad name: x', '\r', '\n']),
      await steps(load, undefined, ['GET  /', ' HTTP/1.1', '\r', '\n']),
      await steps(load, { maxHeaders: 2 }, ['GET / HTTP/1.1\r\nHost: a\r\nA: 1\r\nB: 2', '\r', '\n']),
      await steps(load, undefined, [CHUNKED_HEAD, '3x', '\r', '\n']),
      await steps(load, undefined, [CHUNKED_HEAD, '0\r\ncontent-length: 1', '\r', '\n']),
    ],
  },
  {
    name: 'chunked bodies that are accepted',
    run: async ({ load }) => [
      await go(load, chunked('3\r\nabc\r\n', 'A\r\n0123456789\r\n', 'a\r\nklmnopqrst\r\n', '0\r\n\r\n')),
      await go(load, chunked('00000003\r\nabc\r\n', '0;x=y\r\n\r\n')),
      await go(load, chunked('3;\r\nabc\r\n', '1;a="x y";b\r\nd\r\n', '2;caf\xe9=\x80\r\nef\r\n', '00000000\r\n\r\n')),
      await go(load, chunked('0\r\n\r\n') + get('/next')),
      await go(load, chunked('1\r\nx\r\n', '0\r\nA-Check: 1\r\nb:  two \r\n\r\n')),
    ],
  },
  {
    name: 'chunk framing that is refused',
    run: async ({ load }) => tags(load, [
      chunked('\r\n'),
      chunked('g\r\n'),
      chunked('3 \r\nabc\r\n0\r\n\r\n'),
      chunked('3x\r\nabc\r\n0\r\n\r\n'),
      chunked('000000003\r\nabc\r\n0\r\n\r\n'),
      chunked('-3\r\nabc\r\n0\r\n\r\n'),
      chunked('0x3\r\nabc\r\n0\r\n\r\n'),
      chunked(';ext\r\n'),
      chunked('3;a\x01b\r\nabc\r\n0\r\n\r\n'),
      chunked('3;a\x7fb\r\nabc\r\n0\r\n\r\n'),
      chunked('3;a\x0bb\r\nabc\r\n0\r\n\r\n'),
      chunked('3;a\x00b\r\nabc\r\n0\r\n\r\n'),
      chunked('3\r\nabcXY0\r\n\r\n'),
      chunked('3\r\nabc\rX0\r\n\r\n'),
      chunked('3\r\nabc\n0\r\n\r\n'),
      chunked('3\r\nabcd\r\n0\r\n\r\n'),
      chunked('3\r\nab\r\n\r\n0\r\n\r\n'),
      chunked('3\r\nabc\r\n \r\n'),
    ]),
  },
  {
    name: 'the body limit is checked when the size line is complete',
    run: async ({ load }) => {
      const opts = { maxBodyBytes: 8 };
      return [
        await tags(load, [chunked('4\r\nabcd\r\n4\r\nefgh\r\n0\r\n\r\n'), chunked('4\r\nabcd\r\n5\r\nefghi\r\n0\r\n\r\n'), chunked('9\r\nabcdefghi\r\n0\r\n\r\n'), chunked('8\r\nabcdefgh\r\n0\r\n\r\n'), chunked('ffffffff\r\n'), chunked('fffffffff\r\n'), chunked('8\r\nabcdefgh\r\n1\r\n')], opts),
        await tags(load, [chunked('0000000a\r\n'), chunked('00000008\r\nabcdefgh\r\n0\r\n\r\n'), chunked('1\r\na\r\n'.repeat(8) + '0\r\n\r\n'), chunked('1\r\na\r\n'.repeat(9) + '0\r\n\r\n')], opts),
      ];
    },
  },
  {
    name: 'trailers that are accepted, with names and values',
    run: async ({ load }) => [
      await go(load, chunked('2\r\nab\r\n', '0\r\nX-One: 1\r\nx-two:\t 2\r\nX-ONE: again\r\nTE: v\r\nx-content-length: 4\r\n\r\n') + get('/n')),
      await go(load, `${CHUNKED_HEAD}0\r\n\r\n`),
      await go(load, 'POST /p HTTP/1.1\r\nHost: a\r\nX: 1\r\nContent-Length: 1\r\n\r\nq'),
    ],
  },
  {
    name: 'trailer fields that are refused',
    run: async ({ load }) => tags(load, [
      'novalue',
      ' x: y',
      '\tx: y',
      'bad name: x',
      ': nameless',
      'x: a\x01b',
      'content-length: 1',
      'Content-Length: 0',
      'Transfer-Encoding: chunked',
      'HOST: a',
      'Host:',
      'host-x: 1',
    ].map((field) => chunked('0\r\n', `${field}\r\n\r\n`))),
  },
  {
    name: 'trailer counts and sizes stand apart from the headers',
    run: async ({ load }) => {
      const lines = (n) => Array.from({ length: n }, (_, i) => `T${i}: v`);
      const withTrailers = (n) => chunked('0\r\n', ...lines(n).map((l) => `${l}\r\n`), '\r\n');
      const opts = { maxHeaders: 3 };
      return [
        await tags(load, [withTrailers(2), withTrailers(3), withTrailers(4)], opts),
        await tags(load, [`POST /p HTTP/1.1\r\nHost: a\r\nX: 1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n${lines(3).join('\r\n')}\r\n\r\n`], opts),
        await tags(load, [chunked('0\r\nbad name: x', '\r\n\r\n').replace('bad name: x', `${lines(3).join('\r\n')}\r\nbad name: x`)], opts),
      ];
    },
  },
  {
    name: 'an error stays and keeps the messages before it',
    run: async ({ load }) => {
      const P = await parserOf(load);
      const parser = new P();
      const r1 = parser.push(b(`${get('/ok')}GET / HTTP/9.9\r\n`));
      const r2 = parser.push(b(get('/later')));
      const r3 = parser.push(b('more'));
      const e1 = parser.end();
      const e2 = parser.end();
      return {
        first: brief(r1),
        second: brief(r2),
        third: brief(r3),
        end: brief(e1),
        sameObject: [r2.error === r1.error, r3.error === r1.error, e1.error === r1.error, e2.error === r1.error],
        keys: Object.keys(r1.error).sort(),
        messageIsText: typeof r1.error.message === 'string' && r1.error.message.length > 0,
      };
    },
  },
  {
    name: 'every code carries its status',
    run: async ({ load }) => {
      const cases = [
        'GET / HTTP/1.1\nx',
        'GARBAGE\r\n',
        'GET / HTTP/3.0\r\n',
        'GET #x HTTP/1.1\r\n',
        `GET /${'a'.repeat(9000)} HTTP/1.1\r\n`,
        'GET / HTTP/1.1\r\nHost: a\r\nbroken\r\n',
        `GET / HTTP/1.1\r\nHost: a\r\nX: ${'a'.repeat(9000)}\r\n`,
        'GET / HTTP/1.1\r\n\r\n',
        post('x', ''),
        'POST / HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: zip\r\n\r\n',
        post(9999999, ''),
        chunked('zz\r\n'),
        chunked('0\r\nhost: a\r\n'),
        'GET / HTTP/1.1\r\n',
      ];
      const out = [];
      for (const raw of cases) {
        const r = await go(load, raw);
        out.push(r.error ? [r.error.code, r.error.status] : null);
      }
      return out;
    },
  },
  {
    name: 'bytes after a closing message are counted and not parsed',
    run: async ({ load }) => {
      const P = await parserOf(load);
      const parser = new P();
      const first = parser.push(b(`${get('/a')}GET /b HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\ntail-bytes`));
      const second = parser.push(b('more'));
      const third = parser.push(b(''));
      const ended = parser.end();
      return {
        first: [first.messages.map((m) => m.target), first.ignored, first.error],
        second: [second.messages.length, second.ignored, second.error],
        third: [third.ignored, third.error],
        ended: [ended.error, ended.ignored],
        wholeChunked: await go(load, chunked('1\r\nq\r\n', '0\r\nX: y\r\n\r\n').replace('chunked\r\n', 'chunked\r\nConnection: close\r\n') + '\x00\xff junk \r\n'),
        garbage: await go(load, `${post(1, 'z').replace('Content-Length', 'Connection: close\r\nContent-Length')}\n\n\n\r\r\r\x00`),
        closeOne: await go(load, 'GET / HTTP/1.0\r\n\r\nGET /two HTTP/1.0\r\n\r\n'),
      };
    },
  },
  {
    name: 'push accepts views and refuses other types',
    run: async ({ load }) => {
      const P = await parserOf(load);
      const kinds = [
        ['string', 'GET / HTTP/1.1\r\n'],
        ['array', [71, 69, 84]],
        ['arraybuffer', new ArrayBuffer(4)],
        ['null', null],
        ['undefined', undefined],
        ['number', 5],
        ['dataview', new DataView(new ArrayBuffer(2))],
      ];
      const out = {};
      for (const [name, value] of kinds) {
        try {
          new P().push(value);
          out[name] = 'accepted';
        } catch (error) {
          out[name] = error instanceof TypeError ? 'TypeError' : String(error?.name);
        }
      }
      const empty = new P().push(new Uint8Array(0));
      const wide = new P().push(new Uint8Array(b(get('/u8'))));
      return { out, empty: brief(empty), wide: wide.messages[0].target };
    },
  },
  {
    name: 'limit options are checked',
    run: async ({ load }) => {
      const P = await parserOf(load);
      const bad = [0, -1, 1.5, '5', NaN, Infinity, null, true, {}];
      const out = {};
      for (const name of ['maxLineBytes', 'maxHeaderBytes', 'maxHeaders', 'maxBodyBytes']) {
        out[name] = bad.map((value) => {
          try {
            new P({ [name]: value });
            return 'accepted';
          } catch (error) {
            return error instanceof RangeError ? 'RangeError' : String(error?.name);
          }
        });
      }
      let fine = 'ok';
      try {
        new P({ maxLineBytes: 1, maxHeaderBytes: 1, maxHeaders: 1, maxBodyBytes: 1, unknown: 'x', other: -1 });
        new P({});
        new P(undefined);
        new P({ maxHeaders: undefined });
      } catch (error) {
        fine = String(error);
      }
      return { out, fine };
    },
  },
  {
    name: 'the default limits',
    run: async ({ load }) => {
      const reqLine = (len) => `GET /${'a'.repeat(len - 14)} HTTP/1.1`;
      const field = (len) => `X: ${'v'.repeat(len - 3)}`;
      const sized = (total) => {
        const lines = [];
        let used = 16 + 9 + 2;
        while (total - used > 8192 + 2) {
          lines.push(field(8192));
          used += 8192 + 2;
        }
        lines.push(field(total - used - 2));
        return req('GET / HTTP/1.1', HOST, ...lines);
      };
      const short = (list) => list.map((t) => (t.length > 40 ? 'ok-long' : t));
      return short(await tags(load, [
        req(reqLine(8192), HOST),
        req(reqLine(8193), HOST),
        req('GET / HTTP/1.1', HOST, field(8192)),
        req('GET / HTTP/1.1', HOST, field(8193)),
        sized(16384),
        sized(16385),
        post(1048576, ''),
        post(1048577, ''),
      ]));
    },
  },
  {
    name: 'a body in one-byte pieces stays fast',
    run: async ({ load }) => {
      const P = await parserOf(load);
      const t0 = cpuMs();
      const size = 400000;
      const body = Buffer.alloc(size, 97);
      const parser = new P();
      parser.push(b(`POST /p HTTP/1.1\r\nHost: a\r\nContent-Length: ${size}\r\n\r\n`));
      const got = [];
      for (let i = 0; i < size; i += 1) {
        const r = parser.push(body.subarray(i, i + 1));
        if (r.messages.length) got.push(...r.messages);
        if ((i & 4095) === 0 && cpuMs() - t0 > 4000) break;
      }
      const chunkedParser = new P();
      chunkedParser.push(b(CHUNKED_HEAD));
      let chunkedMessages = 0;
      for (let i = 0; i < 100000; i += 1) {
        chunkedMessages += chunkedParser.push(b(i % 2 === 0 ? '2\r\naa\r\n' : '1\r\na\r\n')).messages.length;
        if ((i & 1023) === 0 && cpuMs() - t0 > 4500) break;
      }
      chunkedMessages += chunkedParser.push(b('0\r\n\r\n')).messages.length;
      return { count: got.length, size: got[0]?.body.length, chunkedMessages, fast: cpuMs() - t0 < 4000 };
    },
  },
  {
    name: 'many pipelined requests in one call stay fast',
    run: async ({ load }) => {
      const P = await parserOf(load);
      const t0 = cpuMs();
      const one = 'GET /p HTTP/1.1\r\nHost: a\r\nX-N: 1\r\n\r\n';
      const parser = new P();
      const r = parser.push(b(one.repeat(30000)));
      const tiny = 'GET /q HTTP/1.0\r\nConnection: keep-alive\r\n\r\n'.repeat(5000);
      const r2 = new P().push(b(tiny));
      return { count: r.messages.length, last: r.messages.at(-1)?.target, error: r.error, count2: r2.messages.length, fast: cpuMs() - t0 < 3000 };
    },
  },
  {
    name: 'a chunked body of tiny chunks in one call stays fast',
    run: async ({ load }) => {
      const P = await parserOf(load);
      const t0 = cpuMs();
      const parser = new P();
      const raw = b(`${CHUNKED_HEAD}${'1\r\nz\r\n'.repeat(100000)}0\r\nX-T: 1\r\n\r\n`);
      const whole = parser.push(raw);
      const second = new P();
      let found = 0;
      for (let i = 0; i < raw.length; i += 997) {
        found += second.push(raw.subarray(i, i + 997)).messages.length;
        if (cpuMs() - t0 > 3500) break;
      }
      return { count: whole.messages.length, size: whole.messages[0]?.body.length, trailers: whole.messages[0]?.trailers, pieces: found, fast: cpuMs() - t0 < 3000 };
    },
  },
  {
    name: 'long header sections in one-byte pieces stay fast',
    run: async ({ load }) => {
      const P = await parserOf(load);
      const t0 = cpuMs();
      const filler = Array.from({ length: 40 }, (_, i) => `X-F${i}: ${'v'.repeat(90)}`);
      const raw = b(req('GET /long HTTP/1.1', HOST, ...filler));
      const parser = new P();
      let count = 0;
      let pushes = 0;
      outer: for (let round = 0; round < 120; round += 1) {
        for (let i = 0; i < raw.length; i += 1) {
          count += parser.push(raw.subarray(i, i + 1)).messages.length;
          pushes += 1;
        }
        if (cpuMs() - t0 > 3500) break outer;
      }
      return { count, pushes, fast: cpuMs() - t0 < 3000 };
    },
  },
];

export { probes };
