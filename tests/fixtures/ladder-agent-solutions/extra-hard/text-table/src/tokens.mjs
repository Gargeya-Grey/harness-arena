import { clusters } from './graphemes.mjs';
import { clusterWidth } from './width.mjs';

// A line as tokens. Colour codes (ESC [ ... m) are tokens of width 0 and never split;
// the rest is one token per cluster.
export const SGR = /(\u001b\[[0-9;]*m)/;

export function tokenize(line) {
  const tokens = [];
  line.split(SGR).forEach((part, index) => {
    if (index % 2 === 1) tokens.push({ esc: true, text: part, width: 0 });
    else for (const cluster of clusters(part)) tokens.push({ esc: false, text: cluster, width: clusterWidth(cluster) });
  });
  return tokens;
}

export const displayWidth = (line) => tokenize(line).reduce((sum, token) => sum + token.width, 0);
export const joinTokens = (tokens) => tokens.map((token) => token.text).join('');
