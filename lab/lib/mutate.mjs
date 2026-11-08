// Mutation sites for JavaScript source: where a small, plausible bug can be planted.
// node lab audit uses them to test the hidden checks (a check that lets a mutant of the
// reference pass has a gap). Pure: no files, no processes.
//
//   mutationSites(source)        every place an operator applies, in source order
//   applyMutation(source, site)  the source with that one change
//   pickSites(sites, n)          n sites spread evenly over the list

// [pattern, replacement]. The patterns skip the arrow `=>`, `<<`, `>>` and the other
// operators that share a character.
const OPERATORS = [
  [/<=/g, '<'],
  [/>=/g, '>'],
  [/(?<![<=>!-])<(?![<=])/g, '<='],
  [/(?<![=>-])>(?![>=])/g, '>='],
  [/===/g, '!=='],
  [/!==/g, '==='],
  [/&&/g, '||'],
  [/\|\|/g, '&&'],
  [/\+=/g, '-='],
  [/-=/g, '+='],
  [/\+ 1\b/g, '+ 2'],
  [/- 1\b/g, '- 2'],
  [/\bMath\.min\b/g, 'Math.max'],
  [/\bMath\.max\b/g, 'Math.min'],
  [/\btrue\b/g, 'false'],
  [/\bfalse\b/g, 'true'],
  [/\bcontinue\b/g, 'break'],
];

// A `/` starts a regular expression, not a division, after one of these.
const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await']);
const REGEX_AFTER_CHARS = '(,=:[!&|?{};+-*%<>~^';

/**
 * The source with every comment, string, template text and regular expression literal replaced by
 * spaces (line breaks kept), so each character keeps its offset. The code inside a template's
 * ${ } stays visible.
 */
function maskNonCode(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let i = from; i < to; i += 1) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
  };
  const templates = []; // brace depth of each open ${ }
  let braces = 0;
  let previous = ''; // the last code character that is not a space, or the last word
  let i = 0;

  // From just after a backtick or a closing brace of ${ }: blank the text up to the next ${ or backtick.
  const scanTemplate = (start) => {
    let j = start;
    while (j < src.length) {
      if (src[j] === '\\') j += 2;
      else if (src[j] === '`') {
        blank(start, j + 1);
        return j + 1;
      } else if (src[j] === '$' && src[j + 1] === '{') {
        blank(start, j + 2);
        templates.push(braces);
        braces += 1;
        return j + 2;
      } else j += 1;
    }
    blank(start, src.length);
    return src.length;
  };

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? src.length : e;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? src.length : e + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      blank(i, Math.min(j + 1, src.length));
      i = j + 1;
      previous = 'x';
      continue;
    }
    if (c === '`') {
      blank(i, i + 1);
      i = scanTemplate(i + 1);
      previous = 'x';
      continue;
    }
    if (c === '{') braces += 1;
    if (c === '}') {
      braces -= 1;
      if (templates.length && templates.at(-1) === braces) {
        templates.pop();
        blank(i, i + 1);
        i = scanTemplate(i + 1);
        previous = 'x';
        continue;
      }
    }
    if (c === '/' && (previous === '' || REGEX_AFTER_CHARS.includes(previous) || REGEX_AFTER_WORDS.has(previous))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') j += 2;
        else if (src[j] === '[') { inClass = true; j += 1; }
        else if (src[j] === ']') { inClass = false; j += 1; }
        else if (src[j] === '/' && !inClass) break;
        else j += 1;
      }
      if (src[j] === '/') {
        j += 1;
        while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
        blank(i, j);
        i = j;
        previous = 'x';
        continue;
      }
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j])) j += 1;
      previous = src.slice(i, j);
      i = j;
      continue;
    }
    previous = c;
    i += 1;
  }
  return out.join('');
}

/**
 * Every place where an operator applies, in source order. Strings, comments, template text and
 * regular expression literals are never mutated.
 * Each site: { at (offset), from, to, line (1-based), code (that source line, trimmed), operator ('<= -> <') }.
 */
export function mutationSites(source) {
  const text = String(source);
  const masked = maskNonCode(text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (at) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= at) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  const found = [];
  for (const [pattern, to] of OPERATORS) {
    for (const match of masked.matchAll(pattern)) {
      const line = lineOf(match.index);
      const end = text.indexOf('\n', lineStarts[line]);
      const code = text.slice(lineStarts[line], end < 0 ? undefined : end).replace(/\r$/, '').trim().slice(0, 110);
      found.push({ at: match.index, from: match[0], to, line: line + 1, code, operator: `${match[0]} -> ${to}` });
    }
  }
  return found.sort((a, b) => a.at - b.at || a.operator.localeCompare(b.operator));
}

/** The source with one site changed. The site must belong to this source. */
export function applyMutation(source, site) {
  const text = String(source);
  if (text.slice(site.at, site.at + site.from.length) !== site.from) throw new Error(`the site at offset ${site.at} (${JSON.stringify(site.from)}) is not in this source`);
  return text.slice(0, site.at) + site.to + text.slice(site.at + site.from.length);
}

/** n sites spread evenly over the list (all of them when there are n or fewer). Deterministic. */
export function pickSites(sites, n) {
  if (sites.length <= n) return sites;
  return Array.from({ length: n }, (_, i) => sites[Math.floor((i * sites.length) / n)]);
}
