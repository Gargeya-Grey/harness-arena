import test from 'node:test';
import assert from 'node:assert/strict';
import { expand, RRuleError } from '../src/index.mjs';

const days = (text, options) => expand(text, options).map((moment) => `${moment.slice(0, 8)}`);

test('a daily rule with COUNT keeps the time of day of DTSTART', () => {
  assert.deepEqual(expand('DTSTART:20240301T083015Z\nRRULE:FREQ=DAILY;COUNT=3'), ['20240301T083015Z', '20240302T083015Z', '20240303T083015Z']);
});

test('INTERVAL steps over periods', () => {
  assert.deepEqual(days('DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;INTERVAL=10;COUNT=4'), ['20240101', '20240111', '20240121', '20240131']);
});

test('a weekly rule without BYDAY uses the weekday of DTSTART', () => {
  assert.deepEqual(days('DTSTART:20240103T090000Z\nRRULE:FREQ=WEEKLY;COUNT=3'), ['20240103', '20240110', '20240117']);
});

test('a monthly rule on the 31st skips the months without it', () => {
  assert.deepEqual(days('DTSTART:20240131T090000Z\nRRULE:FREQ=MONTHLY;COUNT=4'), ['20240131', '20240331', '20240531', '20240731']);
});

test('a yearly rule on 29 February only has leap years', () => {
  assert.deepEqual(days('DTSTART:20240229T090000Z\nRRULE:FREQ=YEARLY;COUNT=3'), ['20240229', '20280229', '20320229']);
});

test('UNTIL is inclusive and a date UNTIL keeps the whole day', () => {
  assert.deepEqual(days('DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;UNTIL=20240103T090000Z'), ['20240101', '20240102', '20240103']);
  assert.deepEqual(days('DTSTART:20240101T230000Z\nRRULE:FREQ=DAILY;UNTIL=20240102'), ['20240101', '20240102']);
});

test('EXDATE removes moments but COUNT still counts them', () => {
  assert.deepEqual(days('DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;COUNT=5\nEXDATE:20240102T090000Z\nEXDATE:20240104'), ['20240101', '20240103', '20240105']);
});

test('BYDAY with an ordinal and BYSETPOS select days inside a month', () => {
  assert.deepEqual(days('DTSTART:20240101T090000Z\nRRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3'), ['20240109', '20240213', '20240312']);
  assert.deepEqual(days('DTSTART:20240101T090000Z\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3'), ['20240131', '20240229', '20240329']);
});

test('from, to and limit shape the result; bad options throw RRuleError', () => {
  const text = 'DTSTART:20240101T090000Z\nRRULE:FREQ=DAILY;COUNT=30';
  assert.deepEqual(days(text, { from: '20240110T090000Z', to: '20240112T090000Z' }), ['20240110', '20240111', '20240112']);
  assert.equal(expand(text, { limit: 4 }).length, 4);
  assert.throws(() => expand(text, { limit: 0 }), RRuleError);
});
