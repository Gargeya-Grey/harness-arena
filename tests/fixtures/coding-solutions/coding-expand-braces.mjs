function expandBraces(s) {
  const open = s.indexOf('{');
  if (open === -1) return [s];
  let depth = 0;
  let close = -1;
  const cuts = [open];
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    } else if (s[i] === ',' && depth === 1) cuts.push(i);
  }
  cuts.push(close);
  const prefix = s.slice(0, open);
  const suffixes = expandBraces(s.slice(close + 1));
  const out = [];
  for (let c = 0; c + 1 < cuts.length; c += 1) {
    for (const alt of expandBraces(s.slice(cuts[c] + 1, cuts[c + 1]))) {
      for (const suffix of suffixes) out.push(prefix + alt + suffix);
    }
  }
  return out;
}
