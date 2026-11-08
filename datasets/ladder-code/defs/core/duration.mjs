import { t } from './_util.mjs';

export default {
  slug: 'duration',
  tier: { level: 2, human_minutes: 4, basis: 'estimated from the reference (one pattern with three optional groups, 6 lines) plus the missing-unit cases', origin: 'coding-duration' },
  name: 'parseDuration',
  signature: 'parseDuration(text) -> number',
  tags: ['parsing'],
  task: 'Parse a duration such as "1h30m", "45s" or "1h2m3s" into a total number of seconds. Units are h, m and s; each appears at most once, in that order, and any of them can be missing.',
  edges: {
    units: 'Units are h, m and s',
    'missing-unit': 'any of them can be missing',
  },
  tests: [
    t('units', ['1h30m'], 5400),
    t('missing-unit', ['45s'], 45),
    t('missing-unit', ['2h'], 7200),
    t('units', ['1h2m3s'], 3723),
    t('missing-unit', ['10m5s'], 605),
    t('missing-unit', ['1h1s']),
    t('units', ['100s']),
    t('units', ['12h34m56s']),
    t('missing-unit', ['0s']),
  ],
};
