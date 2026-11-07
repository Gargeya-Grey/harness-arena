import { CR, LF, isHexByte, latin1 } from './chars.mjs';
import { httpError } from './errors.mjs';
import { checkHeaderSection, keepAliveOf, parseFieldLine } from './headers.mjs';
import { resolveLimits } from './limits.mjs';
import { parseRequestLine } from './target.mjs';

const FORBIDDEN_TRAILERS = new Set(['content-length', 'transfer-encoding', 'host']);
const isExtensionByte = (b) => !(b <= 8 || (b >= 10 && b <= 31) || b === 127);

function concat(chunks, size) {
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export class RequestParser {
  #limits;
  #error = null;
  #closed = false;
  #state = 'start';
  #line = [];
  #pendingCR = false;
  #sectionBytes = 0;
  #trailerBytes = 0;
  #head = null;
  #headers = [];
  #trailers = [];
  #remaining = 0;
  #chunks = [];
  #bodySize = 0;
  #chunkLeft = 0;
  #out = [];

  constructor(options = {}) {
    this.#limits = resolveLimits(options);
  }

  #fail(code) {
    this.#error = httpError(code);
  }

  #reset() {
    this.#state = 'start';
    this.#line = [];
    this.#pendingCR = false;
    this.#sectionBytes = 0;
    this.#trailerBytes = 0;
    this.#head = null;
    this.#headers = [];
    this.#trailers = [];
    this.#chunks = [];
    this.#bodySize = 0;
  }

  #finish() {
    const keepAlive = keepAliveOf(this.#headers, this.#head.version);
    this.#out.push({
      method: this.#head.method,
      target: this.#head.target,
      version: this.#head.version,
      headers: this.#headers,
      body: concat(this.#chunks, this.#bodySize),
      trailers: this.#trailers,
      keepAlive,
    });
    if (!keepAlive) this.#closed = true;
    this.#reset();
  }

  #addBody(piece) {
    this.#chunks.push(new Uint8Array(piece));
    this.#bodySize += piece.length;
  }

  #endOfHeaders() {
    const result = checkHeaderSection(this.#headers, this.#head.version, this.#limits);
    if (result.code) return this.#fail(result.code);
    this.#line = [];
    if (result.kind === 'chunked') this.#state = 'chunk-size';
    else if (result.kind === 'length' && result.length > 0) {
      this.#state = 'body';
      this.#remaining = result.length;
    } else this.#finish();
  }

  #chunkSizeLine() {
    const line = this.#line;
    let k = 0;
    while (k < line.length && isHexByte(line[k])) k += 1;
    if (k < 1 || k > 8) return this.#fail('bad-chunk');
    if (k < line.length) {
      if (line[k] !== 59) return this.#fail('bad-chunk');
      for (let j = k + 1; j < line.length; j += 1) if (!isExtensionByte(line[j])) return this.#fail('bad-chunk');
    }
    const size = parseInt(latin1(line.slice(0, k)), 16);
    if (this.#bodySize + size > this.#limits.maxBodyBytes) return this.#fail('body-too-large');
    this.#line = [];
    if (size === 0) {
      this.#state = 'trailers';
      this.#trailerBytes = 0;
    } else {
      this.#chunkLeft = size;
      this.#state = 'chunk-data';
    }
  }

  #lineDone() {
    const state = this.#state;
    const bytes = this.#line;
    if (state === 'chunk-size') return this.#chunkSizeLine();
    if (state === 'start') {
      this.#line = [];
      if (bytes.length === 0) return;
      const head = parseRequestLine(latin1(bytes));
      if (head.code) return this.#fail(head.code);
      this.#head = head;
      this.#state = 'headers';
      return;
    }
    const trailer = state === 'trailers';
    if (bytes.length === 0) return trailer ? this.#finish() : this.#endOfHeaders();
    const field = parseFieldLine(bytes);
    this.#line = [];
    if (field.code) return this.#fail(trailer ? 'bad-trailer' : 'bad-header');
    if (trailer && FORBIDDEN_TRAILERS.has(field.name)) return this.#fail('bad-trailer');
    const list = trailer ? this.#trailers : this.#headers;
    if (list.length >= this.#limits.maxHeaders) return this.#fail('headers-too-large');
    list.push([field.name, field.value]);
  }

  #lineByte(b) {
    const state = this.#state;
    const limits = this.#limits;
    if (state === 'start') {
      const blank = this.#line.length === 0 && (b === CR || (this.#pendingCR && b === LF));
      if (!blank && (this.#sectionBytes += 1) > limits.maxHeaderBytes) return this.#fail('headers-too-large');
    } else if (state === 'headers') {
      if ((this.#sectionBytes += 1) > limits.maxHeaderBytes) return this.#fail('headers-too-large');
    } else if (state === 'trailers') {
      if ((this.#trailerBytes += 1) > limits.maxHeaderBytes) return this.#fail('headers-too-large');
    }
    if (this.#pendingCR) {
      if (b !== LF) return this.#fail('bad-newline');
      this.#pendingCR = false;
      return this.#lineDone();
    }
    if (b === LF) return this.#fail('bad-newline');
    if (b === CR) {
      this.#pendingCR = true;
      return;
    }
    this.#line.push(b);
    if (this.#line.length > limits.maxLineBytes) {
      return this.#fail(state === 'start' ? 'uri-too-long' : state === 'chunk-size' ? 'bad-chunk' : 'headers-too-large');
    }
  }

  push(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
    if (this.#error) return { messages: [], error: this.#error, ignored: 0 };
    this.#out = [];
    let ignored = 0;
    let i = 0;
    const n = bytes.length;
    while (i < n && this.#error === null) {
      if (this.#closed) {
        ignored += n - i;
        break;
      }
      const state = this.#state;
      if (state === 'body') {
        const take = Math.min(this.#remaining, n - i);
        this.#addBody(bytes.subarray(i, i + take));
        this.#remaining -= take;
        i += take;
        if (this.#remaining === 0) this.#finish();
      } else if (state === 'chunk-data') {
        const take = Math.min(this.#chunkLeft, n - i);
        this.#addBody(bytes.subarray(i, i + take));
        this.#chunkLeft -= take;
        i += take;
        if (this.#chunkLeft === 0) this.#state = 'chunk-end-cr';
      } else if (state === 'chunk-end-cr') {
        if (bytes[i] !== CR) this.#fail('bad-chunk');
        else this.#state = 'chunk-end-lf';
        i += 1;
      } else if (state === 'chunk-end-lf') {
        if (bytes[i] !== LF) this.#fail('bad-chunk');
        else this.#state = 'chunk-size';
        i += 1;
      } else {
        this.#lineByte(bytes[i]);
        i += 1;
      }
    }
    const messages = this.#out;
    this.#out = [];
    return { messages, error: this.#error, ignored };
  }

  end() {
    if (this.#error) return { messages: [], error: this.#error, ignored: 0 };
    if (!this.#closed) {
      const clean = this.#state === 'start' && this.#line.length === 0 && !this.#pendingCR;
      if (!clean) this.#fail('incomplete');
    }
    return { messages: [], error: this.#error, ignored: 0 };
  }
}
