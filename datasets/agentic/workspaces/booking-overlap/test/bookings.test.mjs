import test from 'node:test';
import assert from 'node:assert/strict';
import { canBook } from '../src/bookings.mjs';
import { nights, overlaps } from '../src/range.mjs';

const stay = (checkIn, checkOut) => ({ checkIn, checkOut });

test('stays that share a night overlap', () => {
  assert.equal(overlaps(stay('2024-03-01', '2024-03-05'), stay('2024-03-04', '2024-03-08')), true);
});

test('a stay that ends the day another one starts does not overlap it', () => {
  assert.equal(overlaps(stay('2024-03-01', '2024-03-05'), stay('2024-03-05', '2024-03-08')), false);
});

test('nights counts the nights of a stay', () => {
  assert.equal(nights(stay('2024-02-27', '2024-03-01')), 3);
});

test('a free room can be booked', () => {
  assert.equal(canBook([], { id: 'x', room: 'r1', ...stay('2024-03-01', '2024-03-02'), status: 'active' }), true);
});
