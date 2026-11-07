# HTTP/1.1 request parser

`RequestParser` turns a stream of bytes into HTTP/1.1 request messages. It takes the bytes in pieces of
any size (down to one byte), handles pipelined requests, fixed and chunked bodies, and refuses malformed
or oversized input with an exact error. The result must not depend on how the bytes were cut into pieces.
It is a strict parser: where this document says "error", the parser stops. Every rule is part of the contract.

```js
const parser = new RequestParser({ maxBodyBytes: 4096 });
const result = parser.push(Buffer.from('POST /x HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nhi'));
// { messages: [{ method: 'POST', target: '/x', version: '1.1', headers: [['host', 'a'], ['content-length', '2']],
//                body: Uint8Array [104, 105], trailers: [], keepAlive: true }], error: null, ignored: 0 }
```

## API

* `new RequestParser(options)`: `options` may set the limits below. Each limit is a positive integer, else `RangeError`.
  Unknown options are ignored.

  | option | default | meaning |
  |---|---|---|
  | `maxLineBytes` | 8192 | longest request line, header line, trailer line or chunk-size line, not counting its CRLF |
  | `maxHeaderBytes` | 16384 | longest header section, counting every byte from the first byte of the request line to the end of the blank line |
  | `maxHeaders` | 100 | most header fields (and also most trailer fields) |
  | `maxBodyBytes` | 1048576 | longest body (after removing the chunk framing) |

* `parser.push(bytes)`: `bytes` is a `Uint8Array` (a `Buffer` or a view with an offset is also one); anything else is a `TypeError`.
  Returns `{ messages, error, ignored }`:
  * `messages`: the messages that were completed by these bytes, in order.
  * `error`: `null`, or `{ code, status, message }` (see Errors). `message` is any text.
  * `ignored`: the number of bytes of this call that were not parsed because a message told the connection to close.
* `parser.end()`: the input ended. Returns `{ messages: [], error, ignored: 0 }`. If the input stopped in the middle of a message, the error is
  `incomplete`. Stopped between messages, after only empty lines, or after a closing message, there is no error.
* After an error the parser is dead: the bytes after the one that caused the error are dropped, and every later `push` or `end`
  returns `{ messages: [], error: <the same error object>, ignored: 0 }`. The `push` that finds the error still returns the messages
  completed before it, in the same call.
* A message is `{ method, target, version, headers, body, trailers, keepAlive }`, with exactly these keys:
  * `method`, `target`: strings as received (no case change).
  * `version`: `'1.0'` or `'1.1'`.
  * `headers`, `trailers`: arrays of `[name, value]` pairs in the order received. `name` is lower-cased (ASCII only). `value` is a string
    in which each byte is one character with the same code (latin-1), after removing spaces and tabs at both ends. Repeated fields are
    kept as separate pairs. `trailers` is `[]` when there are none.
  * `body`: a `Uint8Array` holding the body bytes, a copy that does not share memory with the input (empty when there is no body).
  * `keepAlive`: boolean, see Connection.

## Lines

* Lines end with CR LF. A LF that does not follow a CR, or a CR that is not followed by LF, is the error `bad-newline`,
  found at the byte that breaks the rule. This applies in the request line, header lines, the chunk framing and the trailers.
* Before a request line, any number of empty lines (CR LF alone) are skipped. They are not part of the header section for `maxHeaderBytes`.
* Limits are checked while bytes arrive, in stream order: the first rule broken decides the error, and when one byte breaks several rules
  the order is: header section size, newline, line length. A line longer than `maxLineBytes` is an error as soon as its
  `maxLineBytes + 1`th byte arrives (the error is `uri-too-long` for the request line, `headers-too-large` for a header or trailer line,
  `bad-chunk` for a chunk-size line). A header section longer than `maxHeaderBytes` is a `headers-too-large` error as soon as the byte
  that crosses the limit arrives. All other checks of a line happen when its CRLF arrives.

## Request line

`METHOD SP target SP HTTP/x.y CRLF`, with exactly one space between the three parts. The checks, in this order:

1. Shape, else `bad-request-line`: `method` is one or more token characters; `target` is one or more bytes in 0x21 to 0x7E; the
   version is `HTTP/`, a digit, `.`, a digit. Anything else (extra spaces, tabs, a missing part, other bytes) breaks the shape.
   Token characters: letters, digits and `` ! # $ % & ' * + - . ^ _ ` | ~ ``.
2. Version: `HTTP/1.0` and `HTTP/1.1` are accepted. Another well-formed version is `bad-version`.
3. Target, else `bad-target`: it must contain no `#`, and be one of: origin form (starts with `/`); absolute form (starts with
   `http://` or `https://`, then at least one byte that is not `/`, `?` or `#`, then anything); `*` when the method is exactly `OPTIONS`;
   authority form (`host:port`, host made of letters, digits, `.` and `-`, port 1 to 5 digits) when the method is exactly `CONNECT`.
   For `CONNECT` only the authority form is allowed.

## Header fields

`name ":" value CRLF`, up to the empty line. The checks of one line, in this order:

1. A line that starts with a space or a tab (a continuation line) is `bad-header`. So is a line without a colon, a name that
   is empty or has a non-token character (a space before the colon counts), and a value with a byte in 0x00 to 0x08, 0x0A to 0x1F or 0x7F.
   A tab, bytes 0x20 to 0x7E and bytes 0x80 to 0xFF are fine in a value.
2. If this is the (`maxHeaders` + 1)th field, `headers-too-large`.

When the empty line arrives the header section is complete. These checks follow, in this order:

3. `Host`: a `1.1` request needs exactly one `host` field with a value that is not empty, else `bad-host`. A `1.0` request needs none.
4. `Transfer-Encoding` (all `transfer-encoding` fields): if there is one, then
   * a `1.0` request, or a request that also has a `content-length` field, is `bad-length`;
   * join the values with `,`, split on `,`, trim each part; the result must be exactly one part equal to `chunked` ignoring case,
     else `unsupported-te`.
5. `Content-Length` (when there is no `transfer-encoding`): every `content-length` field must be one or more ASCII digits, nothing else (no
   sign, space inside, comma), else `bad-length`. If the fields do not all have the same number (`05` equals `5`), `bad-length`. If the
   number is greater than `maxBodyBytes`, `body-too-large`.

## Body

* With `chunked`: the chunked body below. With `content-length`: that many bytes. Otherwise: no body, the message is complete at the empty line.
* A `content-length` of 0 is a complete message with an empty body.

### Chunked body

Repeat: a chunk-size line `HEX [";" extension] CRLF`, then that many data bytes, then CRLF. `HEX` is 1 to 8 hex digits (any case, leading zeros count as digits);
anything else directly after the digits than `;` or CR is `bad-chunk`. The extension is the text from `;` to CR and is ignored, but it may not contain a byte in 0x00 to
0x08, 0x0A to 0x1F or 0x7F (`bad-chunk`). When the chunk-size line is complete: if the body so far plus this size is more than
`maxBodyBytes`, `body-too-large`. After the data, the next two bytes must be CR LF, else `bad-chunk` (found at the first wrong byte).
A size of 0 is the last chunk: it is followed by trailer fields and the empty line.

Trailer fields use the header rules (1 and 2 above, with the section limit counted from the first trailer byte over the trailer section)
but their errors are `bad-trailer` for rule 1, and `headers-too-large` for the count, the line length and the section size.
The names `content-length`, `transfer-encoding` and `host` are not allowed in trailers: `bad-trailer` (checked after rule 1, when the line is complete).

## Connection

After a message is complete, `keepAlive` is computed from all `connection` fields: join the values with `,`, split on `,`, trim, ignore case.
If one part is `close`, it is `false`. Else for `1.1` it is `true`; for `1.0` it is `true` only if a part is `keep-alive`.
After a message with `keepAlive` false the connection is closed: every byte after that message, in the same `push` and in later calls, is
not parsed and is counted in `ignored`. `end()` then has no error.

## Errors

| code | status |
|---|---|
| `bad-newline` | 400 |
| `bad-request-line` | 400 |
| `bad-version` | 505 |
| `bad-target` | 400 |
| `uri-too-long` | 414 |
| `bad-header` | 400 |
| `headers-too-large` | 431 |
| `bad-host` | 400 |
| `bad-length` | 400 |
| `unsupported-te` | 501 |
| `body-too-large` | 413 |
| `bad-chunk` | 400 |
| `bad-trailer` | 400 |
| `incomplete` | 400 |

`src/errors.mjs` holds this table (finished).

## Speed

Work is linear in the number of bytes. A body that arrives in many small pieces, and many pipelined requests in one call, must stay fast.

## Files

* `src/errors.mjs`, `src/limits.mjs`, `src/chars.mjs`: finished.
* `src/target.mjs`: the request line and target checks.
* `src/headers.mjs`: header and trailer lines, and the checks of the header section.
* `src/parser.mjs`: the state machine and `RequestParser`. `src/index.mjs` exports `RequestParser`, `DEFAULT_LIMITS`, `STATUS`.

The tests in `test/` show the shape of results. Do not edit them.
