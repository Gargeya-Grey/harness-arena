// A strict YAML subset parser: block maps and lists, flow lists and maps,
// quoted and plain scalars, block scalars (| and >), and comments. Anchors,
// tags, multi-document streams and multi-line plain scalars are refused with
// an error that names the line, so a config never parses into the wrong shape.

export class YamlError extends Error {
  constructor(message, file, line) {
    super(`${file}:${line}: ${message}`);
    this.line = line;
  }
}

const INT = /^[-+]?\d+$/;
const FLOAT = /^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/;

export function parseYaml(text, file = '<yaml>') {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  let index = 0;
  let seenContent = false;

  const fail = (message, at = index) => {
    throw new YamlError(message, file, at + 1);
  };
  const indentOf = (line) => line.length - line.trimStart().length;
  const isBlank = (line) => {
    const trimmed = line.trim();
    return trimmed === '' || trimmed.startsWith('#');
  };

  function peek() {
    while (index < lines.length && isBlank(lines[index])) index += 1;
    if (index >= lines.length) return null;
    const line = lines[index];
    if (line.slice(0, indentOf(line)).includes('\t')) fail('Tabs are not allowed for indentation');
    const content = stripComment(line.trim());
    if (content === '---' || content === '...') {
      if (seenContent) fail('Multiple documents are not supported');
      index += 1;
      return peek();
    }
    seenContent = true;
    return { indent: indentOf(line), content };
  }

  function stripComment(value) {
    let quote = null;
    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      if (quote) {
        if (quote === '"' && char === '\\') i += 1;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        if (i === 0 || /[\s[{,:]/.test(value[i - 1])) quote = char;
      } else if (char === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
        return value.slice(0, i).trimEnd();
      }
    }
    return value;
  }

  function isSeqItem(content) {
    return content === '-' || content.startsWith('- ');
  }

  function splitKey(content) {
    let key;
    let rest;
    if (content.startsWith('"') || content.startsWith("'")) {
      const { value, end } = readQuoted(content, 0);
      if (content[end] !== ':') return null;
      key = value;
      rest = content.slice(end + 1);
    } else {
      const match = /^([^\s:#[\]{},][^:#]*?|[^\s:#[\]{},]):(\s|$)/.exec(content);
      if (!match) return null;
      key = match[1].trim();
      rest = content.slice(match[0].length - match[2].length);
    }
    if (rest !== '' && !/^\s/.test(rest)) return null;
    return { key, rest: rest.trim() };
  }

  function parseNode(minIndent) {
    const next = peek();
    if (!next || next.indent < minIndent) return null;
    return isSeqItem(next.content) ? parseSeq(next.indent) : parseMap(next.indent);
  }

  function parseMap(indent) {
    const map = {};
    for (;;) {
      const next = peek();
      if (!next || next.indent < indent) break;
      if (next.indent > indent) fail('Unexpected indentation');
      if (isSeqItem(next.content)) break;
      const pair = splitKey(next.content);
      if (!pair) fail(`Expected "key: value", found "${next.content}"`);
      if (Object.prototype.hasOwnProperty.call(map, pair.key)) fail(`Duplicate key "${pair.key}"`);
      const line = index;
      index += 1;
      map[pair.key] = parseValue(pair.rest, indent, line, true);
    }
    return map;
  }

  function parseSeq(indent) {
    const list = [];
    for (;;) {
      const next = peek();
      if (!next || next.indent < indent) break;
      if (next.indent > indent) fail('Unexpected indentation');
      if (!isSeqItem(next.content)) break;
      const body = next.content.slice(1).trim();
      const line = index;
      if (body && !body.startsWith('"') && !body.startsWith("'") && !body.startsWith('[') && !body.startsWith('{') && splitKey(body)) {
        // "- key: value" starts a map whose keys sit two columns in.
        const column = indent + (lines[index].trimStart().length - lines[index].trimStart().slice(1).trimStart().length);
        lines[index] = ' '.repeat(column) + body;
        list.push(parseMap(column));
      } else {
        index += 1;
        list.push(parseValue(body, indent, line, false));
      }
    }
    return list;
  }

  function parseValue(rest, parentIndent, line, inMap) {
    if (rest === '') {
      const next = peek();
      if (!next) return null;
      if (next.indent > parentIndent) return parseNode(parentIndent + 1);
      // YAML allows a list at the same indent as its parent key.
      if (inMap && next.indent === parentIndent && isSeqItem(next.content)) return parseSeq(parentIndent);
      return null;
    }
    if (/^[|>][-+]?$/.test(rest)) return parseBlockScalar(rest, parentIndent);
    if (rest.startsWith('&') || rest.startsWith('*') || rest.startsWith('!')) {
      fail('Anchors, aliases and tags are not supported', line);
    }
    const value = parseScalar(rest, line);
    const next = peek();
    if (next && next.indent > parentIndent) {
      fail('Multi-line plain scalars are not supported; use | or >', index);
    }
    return value;
  }

  function parseBlockScalar(indicator, parentIndent) {
    const folded = indicator[0] === '>';
    const chomp = indicator[1] || '';
    const body = [];
    let blockIndent = null;
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === '') {
        body.push('');
        index += 1;
        continue;
      }
      const indent = indentOf(line);
      if (indent <= parentIndent) break;
      if (blockIndent === null) blockIndent = indent;
      if (indent < blockIndent) break;
      body.push(line.slice(blockIndent));
      index += 1;
    }
    let trailing = 0;
    while (body.length && body[body.length - 1] === '') {
      body.pop();
      trailing += 1;
    }
    let text;
    if (folded) {
      text = '';
      body.forEach((part, i) => {
        if (i === 0) text = part;
        else if (part === '') text += '\n';
        else if (body[i - 1] === '' || /^\s/.test(part)) text += part;
        else text += ` ${part}`;
      });
    } else {
      text = body.join('\n');
    }
    if (chomp === '-' || body.length === 0) return text;
    if (chomp === '+') return `${text}\n${'\n'.repeat(trailing)}`;
    return `${text}\n`;
  }

  function readQuoted(source, start) {
    const quote = source[start];
    let value = '';
    let i = start + 1;
    while (i < source.length) {
      const char = source[i];
      if (quote === "'" && char === "'") {
        if (source[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        return { value, end: i + 1 };
      }
      if (quote === '"' && char === '"') {
        return { value: JSON.parse(`"${value}"`), end: i + 1 };
      }
      if (quote === '"' && char === '\\') {
        value += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      value += quote === '"' && char === '\n' ? '\\n' : char;
      i += 1;
    }
    fail('Unterminated quoted string');
  }

  function plain(token) {
    if (token === '' || token === '~' || token === 'null' || token === 'Null' || token === 'NULL') return null;
    if (token === 'true' || token === 'True' || token === 'TRUE') return true;
    if (token === 'false' || token === 'False' || token === 'FALSE') return false;
    if (INT.test(token)) return Number.parseInt(token, 10);
    if (FLOAT.test(token)) return Number.parseFloat(token);
    return token;
  }

  function parseFlow(source, start, line) {
    let i = start;
    const skip = () => {
      while (i < source.length && /\s/.test(source[i])) i += 1;
    };
    const item = (stops) => {
      skip();
      const char = source[i];
      if (char === '[' || char === '{') {
        const result = parseFlow(source, i, line);
        i = result.end;
        return result.value;
      }
      if (char === '"' || char === "'") {
        const result = readQuoted(source, i);
        i = result.end;
        return result.value;
      }
      let token = '';
      while (i < source.length && !stops.includes(source[i])) token += source[i++];
      return plain(token.trim());
    };
    const open = source[i];
    i += 1;
    if (open === '[') {
      const list = [];
      skip();
      if (source[i] === ']') return { value: list, end: i + 1 };
      for (;;) {
        list.push(item(',]'));
        skip();
        if (source[i] === ',') i += 1;
        else if (source[i] === ']') return { value: list, end: i + 1 };
        else fail('Malformed flow list', line);
      }
    }
    const map = {};
    skip();
    if (source[i] === '}') return { value: map, end: i + 1 };
    for (;;) {
      const key = item(':,}');
      skip();
      if (source[i] !== ':') fail('Malformed flow map', line);
      i += 1;
      map[String(key)] = item(',}');
      skip();
      if (source[i] === ',') i += 1;
      else if (source[i] === '}') return { value: map, end: i + 1 };
      else fail('Malformed flow map', line);
    }
  }

  function parseScalar(token, line) {
    if (token.startsWith('[') || token.startsWith('{')) {
      const { value, end } = parseFlow(token, 0, line);
      if (token.slice(end).trim()) fail('Unexpected text after flow collection', line);
      return value;
    }
    if (token.startsWith('"') || token.startsWith("'")) {
      const { value, end } = readQuoted(token, 0);
      if (token.slice(end).trim()) fail('Unexpected text after quoted string', line);
      return value;
    }
    return plain(token);
  }

  const first = peek();
  if (!first) return null;
  const result = parseNode(0);
  if (peek()) fail('Unexpected content after document');
  return result;
}
