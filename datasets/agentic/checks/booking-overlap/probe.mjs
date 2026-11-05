// Hidden probes for agentic-booking-overlap; expected.json holds the answers.
const range = (load) => load('src/range.mjs');
const bookings = (load) => load('src/bookings.mjs');
const stay = (checkIn, checkOut) => ({ checkIn, checkOut });
const booking = (id, room, checkIn, checkOut, status = 'active') => ({ id, room, checkIn, checkOut, status });

export const probes = [
  { name: 'a one night stay is 1 night', run: async ({ load }) => (await range(load)).nights(stay('2024-05-01', '2024-05-02')) },
  { name: 'nights across a leap day', run: async ({ load }) => (await range(load)).nights(stay('2024-02-27', '2024-03-01')) },
  { name: 'nights across new year', run: async ({ load }) => (await range(load)).nights(stay('2023-12-30', '2024-01-02')) },
  {
    name: 'back to back stays do not overlap, in either order',
    run: async ({ load }) => {
      const { overlaps } = await range(load);
      const a = stay('2024-03-01', '2024-03-05');
      const b = stay('2024-03-05', '2024-03-08');
      return [overlaps(a, b), overlaps(b, a)];
    },
  },
  {
    name: 'partly shared, nested and identical stays overlap',
    run: async ({ load }) => {
      const { overlaps } = await range(load);
      return [
        overlaps(stay('2024-03-01', '2024-03-05'), stay('2024-03-04', '2024-03-08')),
        overlaps(stay('2024-03-04', '2024-03-08'), stay('2024-03-01', '2024-03-05')),
        overlaps(stay('2024-03-01', '2024-03-10'), stay('2024-03-03', '2024-03-04')),
        overlaps(stay('2024-03-01', '2024-03-05'), stay('2024-03-01', '2024-03-05')),
      ];
    },
  },
  {
    name: 'separate stays do not overlap',
    run: async ({ load }) => (await range(load)).overlaps(stay('2024-03-01', '2024-03-05'), stay('2024-03-06', '2024-03-08')),
  },
  {
    name: 'a one night stay overlaps the stay that holds its night',
    run: async ({ load }) => {
      const { overlaps } = await range(load);
      return [overlaps(stay('2024-03-02', '2024-03-03'), stay('2024-03-01', '2024-03-05')), overlaps(stay('2024-03-05', '2024-03-06'), stay('2024-03-01', '2024-03-05'))];
    },
  },
  {
    name: 'findConflicts keeps the same room and the input order',
    run: async ({ load }) => {
      const { findConflicts } = await bookings(load);
      const all = [
        booking('b1', 'r1', '2024-03-01', '2024-03-05'),
        booking('b2', 'r2', '2024-03-01', '2024-03-05'),
        booking('b3', 'r1', '2024-03-04', '2024-03-07'),
        booking('b4', 'r1', '2024-03-10', '2024-03-12'),
        booking('b5', 'r1', '2024-02-20', '2024-03-03'),
      ];
      return findConflicts(all, booking('x', 'r1', '2024-03-03', '2024-03-06')).map((item) => item.id);
    },
  },
  {
    name: 'a cancelled booking never conflicts',
    run: async ({ load }) => {
      const { findConflicts, canBook } = await bookings(load);
      const all = [booking('b1', 'r1', '2024-03-01', '2024-03-05', 'cancelled')];
      const request = booking('x', 'r1', '2024-03-02', '2024-03-03');
      return [findConflicts(all, request).length, canBook(all, request)];
    },
  },
  {
    name: 'a booking can start the day another one ends',
    run: async ({ load }) => (await bookings(load)).canBook([booking('b1', 'r1', '2024-03-01', '2024-03-05')], booking('x', 'r1', '2024-03-05', '2024-03-07')),
  },
  {
    name: 'a clash in the same room blocks the booking',
    run: async ({ load }) => (await bookings(load)).canBook([booking('b1', 'r1', '2024-03-01', '2024-03-05')], booking('x', 'r1', '2024-03-04', '2024-03-07')),
  },
  {
    name: 'a clash in another room does not block it',
    run: async ({ load }) => (await bookings(load)).canBook([booking('b1', 'r2', '2024-03-01', '2024-03-05')], booking('x', 'r1', '2024-03-02', '2024-03-04')),
  },
  {
    name: 'a request with no nights or reversed dates is refused',
    run: async ({ load }) => {
      const { canBook } = await bookings(load);
      return [canBook([], booking('x', 'r1', '2024-03-10', '2024-03-10')), canBook([], booking('y', 'r1', '2024-03-10', '2024-03-08'))];
    },
  },
  {
    name: 'totalNights skips cancelled bookings and other rooms',
    run: async ({ load }) => {
      const { totalNights } = await bookings(load);
      const all = [
        booking('b1', 'r1', '2024-03-01', '2024-03-05'),
        booking('b2', 'r1', '2024-04-01', '2024-04-10', 'cancelled'),
        booking('b3', 'r2', '2024-05-01', '2024-05-03'),
        booking('b4', 'r1', '2024-03-10', '2024-03-11'),
      ];
      return [totalNights(all, 'r1'), totalNights(all, 'r2'), totalNights(all, 'r3')];
    },
  },
];
