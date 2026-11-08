import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarError, addBusinessTime, businessTimeBetween, createCalendar, nextOpen } from '../src/index.mjs';

const HOUR = 3_600_000;
const at = (text) => Date.parse(`${text}Z`);
const office = (extra = {}) =>
  createCalendar({
    week: Object.fromEntries([1, 2, 3, 4, 5].map((day) => [day, [['09:00', '12:00'], ['13:00', '17:00']]])),
    ...extra,
  });

test('time inside one window just adds up', () => {
  assert.equal(addBusinessTime(office(), at('2024-03-04T09:30:00'), 2 * HOUR), at('2024-03-04T11:30:00'));
});

test('the lunch break is skipped', () => {
  assert.equal(addBusinessTime(office(), at('2024-03-04T11:00:00'), 2 * HOUR), at('2024-03-04T14:00:00'));
});

test('the evening and the weekend are skipped', () => {
  assert.equal(addBusinessTime(office(), at('2024-03-08T16:00:00'), 2 * HOUR), at('2024-03-11T10:00:00'));
});

test('a start outside the hours begins at the next opening', () => {
  assert.equal(addBusinessTime(office(), at('2024-03-09T12:00:00'), HOUR), at('2024-03-11T10:00:00'));
});

test('a holiday is skipped', () => {
  const calendar = office({ holidays: ['2024-12-25'] });
  assert.equal(addBusinessTime(calendar, at('2024-12-24T16:00:00'), 2 * HOUR), at('2024-12-26T10:00:00'));
});

test('a duration used up exactly at the end of a window ends there', () => {
  assert.equal(addBusinessTime(office(), at('2024-03-04T16:00:00'), HOUR), at('2024-03-04T17:00:00'));
});

test('business time between two instants', () => {
  assert.equal(businessTimeBetween(office(), at('2024-03-04T10:00:00'), at('2024-03-05T10:00:00')), 7 * HOUR);
});

test('nextOpen gives the instant itself when it is open', () => {
  assert.equal(nextOpen(office(), at('2024-03-04T10:00:00')), at('2024-03-04T10:00:00'));
  assert.equal(nextOpen(office(), at('2024-03-04T12:30:00')), at('2024-03-04T13:00:00'));
});

test('a calendar with overlapping windows is refused', () => {
  assert.throws(() => createCalendar({ week: { 1: [['09:00', '12:00'], ['11:00', '13:00']] } }), CalendarError);
});
