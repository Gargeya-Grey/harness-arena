// Splits a template into tokens.
//   {{x}} escaped value      {{{x}}} raw value        {{! note }} comment
//   {{#name arg}} block open  {{else}}                 {{/name}} block close
//   {{> partial arg}} partial
const TAG = /\{\{\{([\s\S]*?)\}\}\}|\{\{([\s\S]*?)\}\}/g;

function nameAndArg(body) {
  const [name, ...rest] = body.trim().split(/\s+/);
  return { name, arg: rest.join(' ') };
}

export function tokenize(source) {
  const tokens = [];
  let last = 0;
  for (const match of source.matchAll(TAG)) {
    if (match.index > last) tokens.push({ type: 'text', value: source.slice(last, match.index) });
    last = match.index + match[0].length;
    const triple = match[1] !== undefined;
    const body = (triple ? match[1] : match[2]).trim();
    if (triple) tokens.push({ type: 'var', raw: true, expr: body });
    else if (body.startsWith('!')) tokens.push({ type: 'comment' });
    else if (body.startsWith('#')) tokens.push({ type: 'open', ...nameAndArg(body.slice(1)) });
    else if (body.startsWith('/')) tokens.push({ type: 'close', name: body.slice(1).trim() });
    else if (body === 'else') tokens.push({ type: 'else' });
    else if (body.startsWith('>')) tokens.push({ type: 'partial', ...nameAndArg(body.slice(1)) });
    else tokens.push({ type: 'var', raw: false, expr: body });
  }
  if (last < source.length) tokens.push({ type: 'text', value: source.slice(last) });
  return tokens;
}
