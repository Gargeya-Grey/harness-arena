export default {
  slug: "rrule-expander",
  tier: {
    level: 5,
    human_minutes: 180,
    basis: "Estimated from the size of the reference: a strict line and rule-part parser with over 30 exact error messages in a fixed order, a period generator for four frequencies, and a day selector with BYMONTH, BYMONTHDAY, ordinal BYDAY, BYSETPOS, WKST, COUNT, UNTIL and EXDATE, about 265 lines in 3 files, from a 255-line spec. An expert reads the spec, writes the three modules and debugs month-end and leap-day skipping, ordinal scope, week starts, and the order of cuts.",
  },
  tags: ["spec", "calendar"],
  task: "This project expands calendar recurrence rules in the style of iCalendar (RRULE, DTSTART, EXDATE), in UTC. The date helpers (src/dates.mjs), the error class and the public entry point (src/index.mjs) are done. The parser (parse in src/rule.mjs) and the expander (expand in src/expand.mjs) are stubs.\n\nBuild them so that parse(text) and expand(text, options) behave exactly as SPEC.md in the project root defines: the line format and the exact error messages in their fixed order, the rule parts and the normalized parse result, the periods of the four frequencies, the defaults taken from DTSTART, month-end and leap-day days that do not exist, BYMONTH, BYMONTHDAY with negative values, BYDAY with ordinals and their scope, BYSETPOS, WKST, COUNT, UNTIL, EXDATE, and the from, to and limit options. A rule that never matches must end quickly, and a result of 100000 moments or 40000 EXDATE items must be fast. Follow the spec to the letter.\n\nRead the date helpers and the visible tests in test/ first. The visible tests cover only the basics; the hidden check covers every rule of the spec. Do not edit SPEC.md or the existing files in test/; put any new tests in new files. Do not install packages.",
};
