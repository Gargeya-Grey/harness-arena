export default {
  slug: "booking-overlap",
  tier: {
    level: 2,
    human_minutes: 7,
    basis: "Reference changes about 30 lines in 2 files; half-open date ranges, leap days and four small functions to repair.",
    origin: "agentic-booking-overlap",
  },
  tags: ["bugfix","dates","multi-file"],
  task: "The booking code in src/range.mjs and src/bookings.mjs has bugs, and `node --test` fails. Rules: a stay occupies the nights from check-in up to but not including check-out, so a stay that ends on 2024-03-05 and a stay that starts on 2024-03-05 do not overlap. nights(stay) is the number of nights. overlaps(a, b) is true when two stays share at least one night. findConflicts(bookings, request) returns the bookings of the same room that overlap the request, in input order; a booking with status 'cancelled' never conflicts. totalNights(bookings, room) adds up the nights of the room's bookings, without cancelled ones. canBook(bookings, request) is false when the request has conflicts, and also false when its check-out is not after its check-in. Fix the code so that all tests pass and the rules hold. Do not change the tests.",
};
