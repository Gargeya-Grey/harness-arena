import { normalizeLabel, trimBlanks, unescapeMarks } from './text.mjs';

const ATX = /^ {0,3}(#{1,6})(?:$| (.*)$)/;
const HR = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const SETEXT = /^ {0,3}(=+|-+) *$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const QUOTE = /^ {0,3}> ?/;
const DEFINITION = /^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:[ ]*(\S+)(?:[ ]+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))?[ ]*$/;
const MARKER = /^( {0,3})(?:([-+*])|(\d{1,9})([.)]))( +|$)/;

const isBlank = (line) => /^ *$/.test(line);
const spacesOf = (line) => /^ */.exec(line)[0].length;

function listMarker(line) {
  const m = MARKER.exec(line);
  if (!m) return null;
  const indent = m[1].length;
  const width = (m[2] ? 1 : m[3].length + 1);
  const rest = line.slice(m[0].length);
  const gap = m[5].length;
  const item = { indent, ordered: !m[2], kind: m[2] || m[4], number: m[3] || '', empty: rest === '' };
  if (item.empty) {
    item.contentCol = indent + width + 1;
    item.first = '';
  } else if (gap > 4) {
    item.contentCol = indent + width + 1;
    item.first = ' '.repeat(gap - 1) + rest;
  } else {
    item.contentCol = indent + width + gap;
    item.first = rest;
  }
  return item;
}

function interruptsParagraph(line) {
  if (spacesOf(line) >= 4) return false;
  const fence = FENCE.exec(line);
  if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) return true;
  if (ATX.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  const marker = listMarker(line);
  return Boolean(marker && !marker.empty && (!marker.ordered || Number(marker.number) === 1));
}

function parse(lines, refs) {
  let blocks = [];
  let para = null;
  let blank = false;

  const add = (block) => {
    block.blank = blank && blocks.length > 0;
    blocks = [...blocks, block];
    blank = false;
  };
  const flush = () => {
    if (!para) return;
    blocks.push({ type: 'p', text: para.lines.join('\n'), blank: para.blank });
    para = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      flush();
      blank = true;
      i += 1;
      continue;
    }
    if (para) {
      const under = SETEXT.exec(line);
      if (under) {
        blocks.push({ type: 'h', level: under[1][0] === '=' ? 1 : 2, text: para.lines.join('\n'), blank: para.blank });
        para = null;
        i += 1;
        continue;
      }
      if (!interruptsParagraph(line)) {
        para.lines.push(line.replace(/^ +/, ''));
        i += 1;
        continue;
      }
      flush();
    }

    if (spacesOf(line) >= 4) {
      let last = i;
      const body = [];
      for (let j = i; j < lines.length && (isBlank(lines[j]) || spacesOf(lines[j]) >= 4); j += 1) {
        body.push(lines[j].slice(4));
        if (!isBlank(lines[j])) last = j;
      }
      body.length = last - i + 1;
      add({ type: 'code', info: '', text: body.join('\n') + '\n' });
      i = last + 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      const [, lead, marks, info] = fence;
      const closing = new RegExp(`^ {0,3}${marks[0] === '`' ? '`' : '~'}{${marks.length},} *$`);
      const body = [];
      let j = i + 1;
      while (j < lines.length && !closing.test(lines[j])) {
        body.push(lines[j].replace(new RegExp(`^ {0,${lead.length}}`), ''));
        j += 1;
      }
      add({ type: 'code', info: trimBlanks(info), text: body.length ? body.join('\n') + '\n' : '' });
      i = j + 1;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      let text = trimBlanks(atx[2] || '');
      text = trimBlanks(text.replace(/(^|[ ]+)#+$/, ''));
      add({ type: 'h', level: atx[1].length, text });
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      add({ type: 'hr' });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner = [];
      let j = i;
      while (j < lines.length && QUOTE.test(lines[j])) {
        inner.push(lines[j].replace(QUOTE, ''));
        j += 1;
      }
      add({ type: 'quote', blocks: parse(inner, refs) });
      i = j;
      continue;
    }

    const first = listMarker(line);
    if (first) {
      const items = [];
      let j = i;
      let blankBefore = false;
      for (;;) {
        const marker = listMarker(lines[j]);
        const body = [marker.first];
        let k = j + 1;
        for (;;) {
          if (k >= lines.length) break;
          if (isBlank(lines[k])) {
            if (marker.empty && k === j + 1) break;
            let p = k;
            while (p < lines.length && isBlank(lines[p])) p += 1;
            if (p < lines.length && spacesOf(lines[p]) >= marker.contentCol) {
              for (; k < p; k += 1) body.push(lines[k].slice(marker.contentCol));
              continue;
            }
            break;
          }
          if (spacesOf(lines[k]) < marker.contentCol) break;
          body.push(lines[k].slice(marker.contentCol));
          k += 1;
        }
        items.push({ blocks: parse(body, refs), blank: blankBefore });
        let p = k;
        while (p < lines.length && isBlank(lines[p])) p += 1;
        const next = p < lines.length ? listMarker(lines[p]) : null;
        if (!next || next.ordered !== first.ordered || next.kind !== first.kind || HR.test(lines[p])) {
          j = k;
          break;
        }
        blankBefore = p > k;
        j = p;
      }
      i = j;
      const loose = items.some((item, n) => (n > 0 && item.blank) || item.blocks.some((b, m) => m > 0 && b.blank));
      add({ type: 'list', ordered: first.ordered, start: Number(first.number), items, loose });
      continue;
    }

    const def = DEFINITION.exec(line);
    if (def && normalizeLabel(def[1]) !== '') {
      const key = normalizeLabel(def[1]);
      let dest = def[2];
      if (dest.length > 1 && dest[0] === '<' && dest.endsWith('>')) dest = dest.slice(1, -1);
      if (!refs.has(key)) refs.set(key, { dest: unescapeMarks(dest), title: def[3] ? unescapeMarks(def[3].slice(1, -1)) : null });
      i += 1;
      continue;
    }

    para = { lines: [line.replace(/^ +/, '')], blank: blank && blocks.length > 0 };
    blank = false;
    i += 1;
  }
  flush();
  return blocks;
}

export function parseBlocks(lines) {
  const refs = new Map();
  return { blocks: parse(lines, refs), refs };
}
