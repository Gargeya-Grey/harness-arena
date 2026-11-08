function typeset(text, options) {
  const opts = options || {};
  const totalWidth = opts.width;
  const columns = opts.columns || 1;
  const gutter = opts.gutter === undefined ? 2 : opts.gutter;
  const columnWidth = columns === 1 ? totalWidth : Math.floor((totalWidth - gutter * (columns - 1)) / columns);
  const baseStyle = {
    align: opts.align || 'left',
    indent: opts.indent || 0,
    hang: opts.hang || 0,
    hyphenate: Boolean(opts.hyphenate),
    marker: true,
    widow: true,
  };
  const exceptions = new Map();
  for (const entry of opts.exceptions || []) exceptions.set(entry.replace(/-/g, '').toLowerCase(), entry.toLowerCase());

  // ---------------------------------------------------------------- character widths

  function codeWidth(code) {
    if (code >= 0x0300 && code <= 0x036f) return 0;
    if (code >= 0x1100 && code <= 0x115f) return 2;
    if (code >= 0x2e80 && code <= 0xa4cf) return 2;
    if (code >= 0xac00 && code <= 0xd7a3) return 2;
    if (code >= 0xff01 && code <= 0xff60) return 2;
    if (code >= 0xffe0 && code <= 0xffe6) return 2;
    return 1;
  }

  function textWidth(string) {
    let sum = 0;
    for (const ch of string) sum += codeWidth(ch.codePointAt(0));
    return sum;
  }

  const spaces = (count) => ' '.repeat(Math.max(0, count));

  // ---------------------------------------------------------------- splitting the text into paragraphs and words

  function paragraphsOf(source) {
    const normal = String(source).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const result = [];
    let current = [];
    for (const line of normal.split('\n')) {
      if (/^[ \t]*$/.test(line)) {
        if (current.length > 0) result.push(current);
        current = [];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) result.push(current);
    return result.map((lines) => lines.join(' ').split(/[ \t]+/).filter((word) => word.length > 0));
  }

  // Closing punctuation on its own sticks to the word before it; opening brackets on their own stick to the word after them.
  function glue(tokens) {
    const out = [];
    let pending = '';
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const last = out.length - 1;
      if (/^[.,;:!?)]+$/.test(token) && last >= 0 && out[last] !== '//') {
        out[last] += token;
      } else if (/^\(+$/.test(token) && i + 1 < tokens.length && tokens[i + 1] !== '//') {
        pending += token;
      } else {
        out.push(pending + token);
        pending = '';
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- one word: pieces and break kinds

  const isAlnum = (ch) => ch !== undefined && /^[A-Za-z0-9]$/.test(ch);
  const isLetter = (ch) => /^[A-Za-z]$/.test(ch);

  function isVowel(core, index) {
    const ch = core[index].toLowerCase();
    if ('aeiou'.includes(ch)) return true;
    return ch === 'y' && index > 0;
  }

  const DIGRAPHS = new Set(['ch', 'sh', 'th', 'ph', 'ck']);
  const isDigraph = (core, index) => index >= 0 && index + 1 < core.length && DIGRAPHS.has(core.slice(index, index + 2).toLowerCase());

  // Break positions p of a plain letter word: a break falls between core[p - 1] and core[p].
  function autoBreaks(core) {
    const found = [];
    const lower = core.toLowerCase();
    if (exceptions.has(lower)) {
      let position = 0;
      for (const ch of exceptions.get(lower)) {
        if (ch === '-') found.push(position);
        else position += 1;
      }
      return found.filter((p) => p > 0 && p < core.length);
    }
    if (core.length < 7) return found;
    for (let p = 3; core.length - p >= 3; p += 1) {
      const before = isVowel(core, p - 1);
      const at = isVowel(core, p);
      let ok = false;
      if (before && !at && p + 1 < core.length && isVowel(core, p + 1)) {
        ok = true; // vowel, one consonant, vowel: break before the consonant
      } else if (before && isDigraph(core, p) && p + 2 < core.length && isVowel(core, p + 2)) {
        ok = true; // vowel, digraph, vowel: break before the digraph
      } else if (!before && !at && isVowel(core, p - 2) && p + 1 < core.length && isVowel(core, p + 1) && !isDigraph(core, p - 1)) {
        ok = true; // vowel, consonant | consonant, vowel
      }
      if (ok) found.push(p);
    }
    return found;
  }

  // The pieces of a word. pieces[i].brk is the kind of break after piece i: 'hard', 'soft' or 'auto' (null after the last piece).
  function piecesOf(word, hyphenate) {
    const marked = word.replace(/\\_/g, '\u0000');
    if (marked.includes('_')) {
      const joined = marked.replace(/_/g, ' ').replace(/~/g, '').replace(/\u0000/g, '_');
      return [{ text: joined, brk: null }];
    }
    const clean = marked.replace(/\u0000/g, '_');
    const pieces = [];
    let current = '';
    const chars = Array.from(clean);
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i];
      if (ch === '~') {
        const prev = chars[i - 1];
        const next = chars[i + 1];
        if (prev !== undefined && next !== undefined && prev !== '~' && next !== '~' && current.length > 0) {
          pieces.push({ text: current, brk: 'soft' });
          current = '';
        }
        continue;
      }
      current += ch;
      if (ch === '-' && isAlnum(chars[i - 1]) && isAlnum(chars[i + 1])) {
        pieces.push({ text: current, brk: 'hard' });
        current = '';
      }
    }
    pieces.push({ text: current, brk: null });

    if (hyphenate && pieces.length === 1 && !clean.includes('-') && !clean.includes('~')) {
      const lead = clean.match(/^[("']*/)[0].length;
      const tail = clean.match(/[.,;:!?)"']*$/)[0].length;
      const core = clean.slice(lead, clean.length - tail);
      if (core.length >= 4 && Array.from(core).every(isLetter)) {
        const cuts = autoBreaks(core);
        if (cuts.length > 0) {
          const result = [];
          let from = 0;
          for (const p of cuts) {
            result.push({ text: clean.slice(from, lead + p), brk: 'auto' });
            from = lead + p;
          }
          result.push({ text: clean.slice(from), brk: null });
          return result;
        }
      }
    }
    return pieces;
  }

  // ---------------------------------------------------------------- one paragraph: greedy lines

  const MARKER = /^(\d+[.)]|-|\+)$/;
  const sideAligned = (style) => style.align === 'left' || style.align === 'justify';

  function layoutParagraph(words, width, style) {
    const lines = [];
    let items = [];
    let used = 0;
    let marks = 0; // lines in a row, just before this one, that ended with a mark break
    let continuation = style.hang;
    if (style.marker && words.length > 1 && MARKER.test(words[0])) continuation = style.indent + textWidth(words[0]) + 1;

    const prefixOf = (isFirst) => (sideAligned(style) ? (isFirst ? style.indent : continuation) : 0);

    function flush(forced, markEnded) {
      lines.push({ items, forced, markEnded });
      items = [];
      used = 0;
      marks = markEnded ? marks + 1 : 0;
    }

    function place(piece, partial) {
      const gap = items.length > 0 ? 1 : 0;
      items.push({ text: piece, partial });
      used += gap + textWidth(piece);
    }

    for (const word of words) {
      if (word === '//') {
        flush(true, false);
        continue;
      }
      let pieces = piecesOf(word, style.hyphenate);
      if (pieces.every((piece) => piece.text.length === 0)) continue;
      for (;;) {
        const avail = width - prefixOf(lines.length === 0);
        const gap = items.length > 0 ? 1 : 0;
        const rest = pieces.map((piece) => piece.text).join('');
        if (used + gap + textWidth(rest) <= avail) {
          place(rest, false);
          break;
        }
        // The rightmost break inside the word that fits.
        let chosen = -1;
        for (let k = pieces.length - 1; k >= 1; k -= 1) {
          const kind = pieces[k - 1].brk;
          if (kind !== 'hard' && marks >= 2) continue;
          const head = pieces.slice(0, k).map((piece) => piece.text).join('');
          const extra = kind === 'hard' ? 0 : 1;
          if (used + gap + textWidth(head) + extra <= avail) {
            chosen = k;
            break;
          }
        }
        if (chosen > 0) {
          const kind = pieces[chosen - 1].brk;
          const head = pieces.slice(0, chosen).map((piece) => piece.text).join('');
          place(kind === 'hard' ? head : `${head}-`, true);
          flush(false, kind !== 'hard');
          pieces = pieces.slice(chosen);
          continue;
        }
        if (items.length > 0) {
          flush(false, false);
          continue;
        }
        // An empty line and nothing fits: cut the first piece by width, at least one character.
        const chars = Array.from(pieces[0].text);
        let take = 0;
        let sum = 0;
        while (take < chars.length) {
          const next = codeWidth(chars[take].codePointAt(0));
          if (take > 0 && sum + next > avail) break;
          sum += next;
          take += 1;
        }
        place(chars.slice(0, take).join(''), true);
        flush(false, false);
        const remainder = chars.slice(take).join('');
        pieces = remainder.length > 0 ? [{ text: remainder, brk: pieces[0].brk }, ...pieces.slice(1)] : pieces.slice(1);
        if (pieces.length === 0) break;
      }
    }
    if (items.length > 0) flush(false, false);
    return { lines, continuation, width, style };
  }

  // ---------------------------------------------------------------- widows

  function fixWidow(layout) {
    const lines = layout.lines;
    if (!layout.style.widow || lines.length < 3) return;
    const last = lines[lines.length - 1];
    const before = lines[lines.length - 2];
    if (last.items.length !== 1 || textWidth(last.items[0].text) > 3) return;
    if (before.forced || last.forced) return;
    if (before.items.length < 2) return;
    const moved = before.items[before.items.length - 1];
    if (moved.partial) return;
    const prefix = sideAligned(layout.style) ? layout.continuation : 0;
    if (textWidth(moved.text) + 1 + textWidth(last.items[0].text) > layout.width - prefix) return;
    before.items.pop();
    last.items.unshift(moved);
  }

  // ---------------------------------------------------------------- rendering a line

  const lineText = (items) => items.map((item) => item.text).join(' ');

  function gapWeight(item) {
    const stripped = item.text.replace(/["')\]]+$/, '');
    return /[.!?:]$/.test(stripped) ? 2 : 1;
  }

  function justifyLine(items, avail) {
    const extra = avail - textWidth(lineText(items));
    const gaps = items.length - 1;
    const weights = items.slice(0, gaps).map(gapWeight);
    const total = weights.reduce((a, b) => a + b, 0);
    const shares = weights.map((weight) => Math.floor((extra * weight) / total));
    let left = extra - shares.reduce((a, b) => a + b, 0);
    const order = weights
      .map((weight, index) => ({ index, rest: (extra * weight) % total }))
      .sort((a, b) => b.rest - a.rest || a.index - b.index);
    for (let i = 0; left > 0; i += 1, left -= 1) shares[order[i].index] += 1;
    let out = '';
    items.forEach((item, index) => {
      out += item.text;
      if (index < gaps) out += spaces(1 + shares[index]);
    });
    return out;
  }

  function renderLines(layout) {
    const { style, width } = layout;
    const out = [];
    layout.lines.forEach((line, index) => {
      if (line.items.length === 0) {
        out.push('');
        return;
      }
      const prefix = index === 0 ? style.indent : layout.continuation;
      const body = lineText(line.items);
      const bodyWidth = textWidth(body);
      if (style.align === 'left') {
        out.push(spaces(prefix) + body);
      } else if (style.align === 'right') {
        out.push(spaces(width - bodyWidth) + body);
      } else if (style.align === 'center') {
        out.push(spaces(Math.floor((width - bodyWidth) / 2)) + body);
      } else if (index === layout.lines.length - 1 || line.forced || line.items.length < 2) {
        out.push(spaces(prefix) + body);
      } else {
        out.push(spaces(prefix) + justifyLine(line.items, width - prefix));
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- one paragraph of any kind

  function typesetParagraph(tokens) {
    let kind = 'plain';
    let words = tokens;
    if (tokens.length > 1 && (tokens[0] === '#' || tokens[0] === '##' || tokens[0] === '>')) {
      kind = tokens[0];
      words = tokens.slice(1);
    }
    words = glue(words);

    if (kind === '#' || kind === '##') {
      const style = { align: kind === '#' ? 'center' : 'left', indent: 0, hang: 0, hyphenate: false, marker: false, widow: false };
      const shown = kind === '#' ? words.map((word) => word.toUpperCase()) : words;
      const layout = layoutParagraph(shown, columnWidth, style);
      const lines = renderLines(layout);
      const widest = Math.max(0, ...lines.map((line) => textWidth(line.trim())));
      if (kind === '#') {
        lines.push(spaces(Math.floor((columnWidth - widest) / 2)) + '='.repeat(widest));
      } else {
        lines.push('-'.repeat(widest));
      }
      return lines;
    }

    const quoted = kind === '>';
    const width = quoted ? columnWidth - 2 : columnWidth;
    const layout = layoutParagraph(words, width, baseStyle);
    fixWidow(layout);
    const lines = renderLines(layout);
    return quoted ? lines.map((line) => `> ${line}`.replace(/ +$/, '')) : lines;
  }

  // ---------------------------------------------------------------- the whole text

  const flat = [];
  paragraphsOf(text).forEach((tokens, index) => {
    if (index > 0) flat.push('');
    flat.push(...typesetParagraph(tokens));
  });

  if (columns === 1) return flat;

  // ---------------------------------------------------------------- columns

  const count = flat.length;
  const base = Math.floor(count / columns);
  const extra = count % columns;
  const stacks = [];
  let from = 0;
  for (let c = 0; c < columns; c += 1) {
    const size = base + (c < extra ? 1 : 0);
    const stack = flat.slice(from, from + size);
    from += size;
    while (stack.length > 0 && stack[0] === '') stack.shift();
    stacks.push(stack);
  }
  const height = Math.max(0, ...stacks.map((stack) => stack.length));
  const rows = [];
  for (let r = 0; r < height; r += 1) {
    const cells = stacks.map((stack) => {
      const cell = r < stack.length ? stack[r] : '';
      return cell + spaces(columnWidth - textWidth(cell));
    });
    rows.push(cells.join(spaces(gutter)).replace(/ +$/, ''));
  }
  return rows;
}
