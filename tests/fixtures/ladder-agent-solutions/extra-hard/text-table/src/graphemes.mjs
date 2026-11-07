const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

// Splits text into clusters: a letter with its accents, an emoji with its joiners, a flag.
export function clusters(text) {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}
