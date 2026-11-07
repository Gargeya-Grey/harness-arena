import { RegexSyntaxError } from './errors.mjs';
import { parse } from './parser.mjs';
import { build } from './compiler.mjs';
import { search } from './matcher.mjs';

class Regex {
  #program;

  constructor(source, flags, program, groupCount, names) {
    this.source = source;
    this.flags = flags;
    this.groupCount = groupCount;
    this.names = names;
    this.#program = program;
  }

  exec(text, from = 0) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    if (!Number.isInteger(from) || from < 0 || from > text.length) throw new RangeError('from must be an integer inside the text');
    const slots = search(this.#program, text, from);
    if (slots === null) return null;
    const spans = [];
    for (let g = 0; g <= this.groupCount; g += 1) {
      spans.push(slots[2 * g] >= 0 && slots[2 * g + 1] >= 0 ? [slots[2 * g], slots[2 * g + 1]] : null);
    }
    return { start: slots[0], end: slots[1], spans };
  }

  matchAll(text) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    const out = [];
    let at = 0;
    while (at <= text.length) {
      const match = this.exec(text, at);
      if (match === null) break;
      out.push(match);
      at = match.end > match.start ? match.end : match.end + 1;
    }
    return out;
  }

  replace(text, replacement, all = false) {
    if (typeof text !== 'string' || typeof replacement !== 'string') throw new TypeError('text and replacement must be strings');
    const matches = all ? this.matchAll(text) : [this.exec(text)].filter(Boolean);
    let out = '';
    let last = 0;
    for (const match of matches) {
      out += text.slice(last, match.start) + this.#expand(replacement, text, match);
      last = match.end;
    }
    return out + text.slice(last);
  }

  #expand(template, text, match) {
    const group = (n) => (match.spans[n] ? text.slice(...match.spans[n]) : '');
    let out = '';
    for (let i = 0; i < template.length; i += 1) {
      const c = template[i];
      const next = template[i + 1];
      if (c !== '$' || next === undefined) out += c;
      else if (next === '$') {
        out += '$';
        i += 1;
      } else if (next === '&') {
        out += group(0);
        i += 1;
      } else if (next >= '1' && next <= '9' && Number(next) <= this.groupCount) {
        out += group(Number(next));
        i += 1;
      } else if (next === '<') {
        const close = template.indexOf('>', i + 2);
        const name = close < 0 ? null : template.slice(i + 2, close);
        if (name !== null && Object.hasOwn(this.names, name)) {
          out += group(this.names[name]);
          i = close;
        } else out += c;
      } else out += c;
    }
    return out;
  }
}

export function compile(pattern, flags = '') {
  if (typeof pattern !== 'string' || typeof flags !== 'string') throw new TypeError('pattern and flags must be strings');
  if (!/^[ims]*$/.test(flags) || new Set(flags).size !== flags.length) throw new RegexSyntaxError('bad-flags', flags);
  const { tree, groupCount, names } = parse(pattern);
  return new Regex(pattern, flags, build(tree, groupCount, flags), groupCount, names);
}
