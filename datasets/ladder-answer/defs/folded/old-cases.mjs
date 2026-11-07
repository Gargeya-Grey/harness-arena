import { FOLDED } from './_data.mjs';

// Ten older cases for tiers 1 to 3. question, answer and origin are fixed in _data.mjs.
export default FOLDED.map((entry) => ({
  slug: entry.slug,
  tier: { level: entry.level, human_minutes: entry.human_minutes, basis: entry.basis, origin: entry.origin },
  tags: entry.tags,
  question: entry.question,
  answer: entry.answer,
  metadata: entry.metadata,
}));
