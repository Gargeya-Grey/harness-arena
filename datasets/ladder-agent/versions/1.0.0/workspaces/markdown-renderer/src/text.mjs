// Helpers that SPEC.md describes as given. Do not change their behaviour.

/** The four characters that SPEC.md section 1 says are escaped in text and in attribute values. */
export function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** ASCII punctuation: one of !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~ (a single character). */
export function isPunct(ch) {
  return /^[!-/:-@[-`{-~]$/.test(ch);
}

/** Whitespace as JavaScript's \s sees it (a single character). */
export function isSpace(ch) {
  return /^\s$/.test(ch);
}

/** Removes a backslash that stands before ASCII punctuation: `\*` becomes `*`. */
export function unescapeMarks(text) {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/** The key under which a link label is stored and found. */
export function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Spaces and tabs only (String.prototype.trim also removes other whitespace). */
export function trimBlanks(text) {
  return text.replace(/^[ \t]+|[ \t]+$/g, '');
}

/**
 * Line ends become \n, then the source is cut into lines. Each tab in the leading whitespace of a line
 * becomes four spaces. A tab anywhere else stays a tab. The result always has at least one line.
 */
export function splitLines(source) {
  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[ \t]+/, (lead) => lead.replace(/\t/g, '    ')));
}
