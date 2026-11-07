import { nights, overlaps } from './range.mjs';

// A booking is { id, room, checkIn, checkOut, status }; status is 'active' or 'cancelled'.

// The bookings that clash with `request` (same room, a shared night), in input order.
export function findConflicts(bookings, request) {
  return bookings.filter((booking) => booking.room === request.room && overlaps(booking, request));
}

// True when `request` can be booked.
export function canBook(bookings, request) {
  return findConflicts(bookings, request).length === 0;
}

// The nights booked in one room.
export function totalNights(bookings, room) {
  return bookings.filter((booking) => booking.room === room).reduce((sum, booking) => sum + nights(booking), 0);
}
