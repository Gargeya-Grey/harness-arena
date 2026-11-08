import { escapeHtml, isPunct, isSpace, normalizeLabel, unescapeMarks } from './text.mjs';
import { newStack, pushDelimiter, processEmphasis } from './emphasis.mjs';

const UNSAFE = /^javascript:/i;
const isBlankChar = (c) => c === ' ' || c === '\n' || c === '\t';

function skipBlanks(src, i) {
  while (i < src.length && isBlankChar(src[i])) i += 1;
  return i;
}

const escapes = (src, j) => src[j] === '\\' && j + 1 < src.length && isPunct(src[j + 1]);

function parseDestination(src, i) {
  if (src[i] === '<') {
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === '\n' || src[j] === '<') return null;
      if (src[j] === '>') return { dest: unescapeMarks(src.slice(i + 1, j)), end: j + 1 };
      j += escapes(src, j) ? 2 : 1;
    }
    return null;
  }
  let j = i;
  let depth = 0;
  while (j < src.length) {
    if (escapes(src, j)) {
      j += 2;
      continue;
    }
    const c = src[j];
    if (c <= ' ' || c === '\x7f') break;
    if (c === '(') depth += 1;
    else if (c === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
    j += 1;
  }
  return depth === 0 ? { dest: unescapeMarks(src.slice(i, j)), end: j } : null;
}

function parseTitle(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (escapes(src, j)) j += 2;
    else if (src[j] === quote) return { title: unescapeMarks(src.slice(i + 1, j)), end: j + 1 };
    else j += 1;
  }
  return null;
}

function parseInlineLink(src, open) {
  const destination = parseDestination(src, skipBlanks(src, open + 1));
  if (!destination) return null;
  let i = destination.end;
  let title = null;
  const next = skipBlanks(src, i);
  if (next > i && (src[next] === '"' || src[next] === "'")) {
    const parsed = parseTitle(src, next);
    if (!parsed) return null;
    title = parsed.title;
    i = skipBlanks(src, parsed.end);
  } else {
    i = next;
  }
  return src[i] === ')' ? { dest: destination.dest, title, end: i + 1 } : null;
}

function parseLabel(src, open) {
  let j = open + 1;
  while (j < src.length) {
    if (escapes(src, j)) j += 2;
    else if (src[j] === '[') return null;
    else if (src[j] === ']') return { label: src.slice(open + 1, j), end: j + 1 };
    else j += 1;
  }
  return null;
}

const plainOf = (node) => (node.delim ? node.ch.repeat(node.count) : node.plain);

export function renderInline(src, refs) {
  const out = [];
  const brackets = [];
  const sentinel = newStack();
  let tail = sentinel;
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) out.push({ html: escapeHtml(buf), plain: buf });
    buf = '';
  };
  const emit = (html, plain) => {
    flush();
    out.push({ html, plain });
  };

  while (i < src.length) {
    const c = src[i];

    if (c === '\\') {
      const next = src[i + 1];
      if (next === '\n') {
        emit('<br>\n', ' ');
        i += 2;
      } else if (next !== undefined && isPunct(next)) {
        buf += next;
        i += 2;
      } else {
        buf += c;
        i += 1;
      }
      continue;
    }

    if (c === '`') {
      let n = 0;
      while (src[i + n] === '`') n += 1;
      let close = -1;
      for (let j = i + n; j < src.length; ) {
        if (src[j] !== '`') {
          j += 1;
          continue;
        }
        let m = 0;
        while (src[j + m] === '`') m += 1;
        if (m === n) {
          close = j;
          break;
        }
        j += m;
      }
      if (close < 0) {
        buf += src.slice(i, i + n);
        i += n;
        continue;
      }
      let content = src.slice(i + n, close).replace(/\n/g, ' ');
            emit(`<code>${escapeHtml(content)}</code>`, content);
      i = close + n;
      continue;
    }

    if (c === '*' || c === '_') {
      let n = 0;
      while (src[i + n] === c) n += 1;
      const before = i > 0 ? src[i - 1] : ' ';
      const after = i + n < src.length ? src[i + n] : ' ';
      const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
      const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
      const canOpen = c === '*' ? left : left && (!right || isPunct(before));
      const canClose = c === '*' ? right : right && (!left || isPunct(after));
      flush();
      const node = { delim: true, ch: c, count: n, orig: n, canOpen, canClose, open: [], close: [] };
      out.push(node);
      if (canOpen || canClose) tail = pushDelimiter(tail, node);
      i += n;
      continue;
    }

    if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const image = c === '!';
      const text = image ? '![' : '[';
      emit(text, text);
      brackets.push({ idx: out.length - 1, image, active: true, bottom: tail, textStart: i + text.length });
      i += text.length;
      continue;
    }

    if (c === ']') {
      flush();
      const opener = brackets.pop();
      if (!opener || !opener.active) {
        buf += ']';
        i += 1;
        continue;
      }
      let link = src[i + 1] === '(' ? parseInlineLink(src, i + 1) : null;
      if (!link) {
        const second = src[i + 1] === '[' ? parseLabel(src, i + 1) : null;
        let label = src.slice(opener.textStart, i);
        let end = i + 1;
        if (second) {
          end = second.end;
          if (second.label.trim() !== '') label = second.label;
        }
        const ref = label.trim() === '' ? undefined : refs.get(normalizeLabel(label));
        if (ref) link = { dest: ref.dest, title: ref.title, end };
      }
      if (!link) {
        buf += ']';
        i += 1;
        continue;
      }
      processEmphasis(opener.bottom);
      opener.bottom.next = null;
      tail = opener.bottom;
      const dest = escapeHtml(UNSAFE.test(link.dest) ? '' : link.dest);
      const title = link.title === null ? '' : ` title="${escapeHtml(link.title)}"`;
      if (opener.image) {
        const alt = out.slice(opener.idx + 1).map(plainOf).join('');
        out.length = opener.idx;
        out.push({ html: `<img src="${dest}" alt="${escapeHtml(alt)}"${title}>`, plain: alt });
      } else {
        out[opener.idx] = { html: `<a href="${dest}"${title}>`, plain: '' };
        out.push({ html: '</a>', plain: '' });
      }
      i = link.end;
      continue;
    }

    if (c === '\n') {
      const spaces = / *$/.exec(buf)[0].length;
      buf = buf.slice(0, buf.length - spaces);
      emit(spaces >= 2 ? '<br>\n' : '\n', ' ');
      i += 1;
      continue;
    }

    buf += c;
    i += 1;
  }

  flush();
  processEmphasis(sentinel);
  return out.map((node) => (node.delim ? node.close.join('') + node.ch.repeat(node.count) + node.open.join('') : node.html)).join('');
}
