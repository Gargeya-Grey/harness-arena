// Evaluators turn one raw row plus its case into a score in 0..1. Each has an
// id and a version; changing what one computes means a new version, never an
// edit, because stored scores name the version that produced them.
// `score` returns null when the evaluator does not apply to the case.

function exactMatch({ text, expected }) {
  const actual = String(text ?? '').trim();
  const want = String(expected ?? '').trim();
  const value = actual === want ? 1 : 0;
  return { value, passed: value === 1, details: { expected, actual, normalization: 'trim' } };
}

export function normalizeAnswer(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’“”"'`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s.,;:!?()[\]{}-]+|[\s.,;:!?()[\]{}-]+$/g, '');
}

function normalizedMatch({ text, expected }) {
  const actual = normalizeAnswer(text);
  const accepted = (Array.isArray(expected) ? expected : [expected]).map(normalizeAnswer);
  const value = accepted.includes(actual) ? 1 : 0;
  return { value, passed: value === 1, details: { expected, actual: text, normalized: actual, normalization: 'nfkc, lowercase, strip quotes, collapse spaces, trim punctuation' } };
}

export function extractSvg(text) {
  const match = /<svg[\s>][\s\S]*<\/svg>/i.exec(String(text ?? ''));
  return match ? match[0] : null;
}

function svgStructure({ text, input }) {
  const svg = extractSvg(text);
  const checks = {};
  checks.has_svg_root = Boolean(svg);
  const source = svg || '';
  const open = /<svg\b([^>]*)>/i.exec(source)?.[1] || '';
  const attr = (name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(open)?.[1] ?? null;
  if (input?.width != null && input?.height != null) {
    checks.size_matches = attr('width') === String(input.width) && attr('height') === String(input.height);
    checks.viewbox_matches = (attr('viewBox') || '').trim().split(/[\s,]+/).join(' ') === `0 0 ${input.width} ${input.height}`;
  }
  checks.no_script = !/<script\b/i.test(source);
  checks.no_foreign_object = !/<foreignObject\b/i.test(source);
  checks.no_event_handlers = !/\son[a-z]+\s*=/i.test(source);
  checks.no_external_refs = !/(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:)/i.test(source) && !/url\(\s*["']?\s*https?:/i.test(source);
  const tags = [...source.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)];
  const stack = [];
  let balanced = Boolean(svg);
  for (const [, closing, name, selfClosing] of tags) {
    if (selfClosing) continue;
    if (!closing) stack.push(name);
    else if (stack.pop() !== name) balanced = false;
  }
  checks.tags_balanced = balanced && stack.length === 0;
  checks.only_svg_in_response = Boolean(svg) && String(text).trim() === svg.trim();
  const required = Object.entries(checks).filter(([key]) => key !== 'only_svg_in_response');
  const passedCount = required.filter(([, ok]) => ok).length;
  const value = Number((passedCount / required.length).toFixed(4));
  return { value, passed: passedCount === required.length, details: { checks } };
}

export const EVALUATORS = {
  'exact-match@1': { id: 'exact-match', version: '1', dimension: 'quality', score: ({ raw, testCase }) => (testCase.expected == null ? null : exactMatch({ text: raw.response?.text, expected: testCase.expected })) },
  'normalized-match@1': { id: 'normalized-match', version: '1', dimension: 'quality', score: ({ raw, testCase }) => (testCase.expected == null ? null : normalizedMatch({ text: raw.response?.text, expected: testCase.expected })) },
  'svg-structure@1': { id: 'svg-structure', version: '1', dimension: 'format', score: ({ raw, testCase }) => svgStructure({ text: raw.response?.text, input: testCase.input }) },
};

export function getEvaluator(id, version) {
  return EVALUATORS[`${id}@${version}`] || null;
}
