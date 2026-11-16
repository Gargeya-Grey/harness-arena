import { clusters } from './graphemes.mjs';
import { clusterWidth } from './width.mjs';

// Colour codes (ESC [ ... m).
export const SGR = /(\u001b\[[0-9;]*m)/;

// A line as tokens, one per shown character.
export function tokenize(line) {
  return clusters(line).map((cluster) => ({ esc: false, text: cluster, width: clusterWidth(cluster) }));
}

export const displayWidth = (line) => tokenize(line).reduce((sum, token) => sum + token.width, 0);
export const joinTokens = (tokens) => tokens.map((token) => token.text).join('');
