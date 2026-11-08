export default {
  slug: "slugify-bug",
  tier: {
    level: 1,
    human_minutes: 1.5,
    basis: "A one-line regex fix in a 4-line file; read the test, change one character class, run the tests.",
    origin: "agentic-slugify-bug",
  },
  tags: ["bugfix"],
  task: "src/slugify.mjs has a bug: `node --test` fails. Fix src/slugify.mjs so that all tests pass. A slug is lowercase, has no leading or trailing dashes, and joins each run of letters and digits with a single dash; every other character is a separator. Do not change the tests.",
};
