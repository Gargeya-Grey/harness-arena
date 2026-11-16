import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, RRuleError } from '../src/index.mjs';

const message = (text) => {
  try {
    parse(text);
  } catch (error) {
    assert.ok(error instanceof RRuleError, `not an RRuleError: ${error}`);
    return error.message;
  }
  return null;
};

test('parse returns the normalized rule with all keys', () => {
  const result = parse('DTSTART:20240115T093000Z\nRRULE:FREQ=WEEKLY;BYDAY=FR,MO,FR;COUNT=3\nEXDATE:20240122T093000Z');
  assert.deepEqual(result, {
    dtstart: '20240115T093000Z',
    rule: { freq: 'WEEKLY', interval: 1, count: 3, until: null, bymonth: [], bymonthday: [], byday: [{ ordinal: 0, day: 'MO' }, { ordinal: 0, day: 'FR' }], bysetpos: [], wkst: 'MO' },
    exdates: ['20240122T093000Z'],
  });
});

test('number lists are sorted and ordinals lose their plus sign', () => {
  const { rule } = parse('DTSTART:20240101T000000Z\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=15,-1,1,15;BYDAY=-1FR,+2TU,2TU;BYMONTH=12,3\r\n');
  assert.deepEqual(rule.bymonthday, [-1, 1, 15]);
  assert.deepEqual(rule.bymonth, [3, 12]);
  assert.deepEqual(rule.byday, [{ ordinal: 2, day: 'TU' }, { ordinal: -1, day: 'FR' }]);
});

test('the shape of a line and the property are checked first, with line numbers', () => {
  assert.equal(message('DTSTART:20240101T000000Z\n\nrrule:FREQ=DAILY'), 'line 3: expected NAME:VALUE');
  assert.equal(message('DTSTART:20240101T000000Z\nRRULE:FREQ=DAILY\nDURATION:PT1H'), 'line 3: unknown property DURATION');
  assert.equal(message('RRULE:FREQ=DAILY'), 'missing DTSTART');
  assert.equal(message('DTSTART:20240101T000000Z'), 'missing RRULE');
});

test('rule parts are checked one by one', () => {
  const rule = (value) => message(`DTSTART:20240101T000000Z\nRRULE:${value}`);
  assert.equal(rule('FREQ=HOURLY'), 'line 2: bad FREQ "HOURLY"');
  assert.equal(rule('FREQ=DAILY;INTERVAL=0'), 'line 2: bad INTERVAL "0"');
  assert.equal(rule('FREQ=DAILY;BYHOUR=3'), 'line 2: unknown rule part BYHOUR');
  assert.equal(rule('FREQ=DAILY;COUNT=2;COUNT=3'), 'line 2: duplicate rule part COUNT');
  assert.equal(rule('FREQ=DAILY;'), 'line 2: bad rule part ""');
});

test('checks on the whole rule come last, in the order of the spec', () => {
  const rule = (value) => message(`DTSTART:20240101T000000Z\nRRULE:${value}`);
  assert.equal(rule('COUNT=2'), 'FREQ is required');
  assert.equal(rule('FREQ=DAILY;COUNT=2;UNTIL=20250101'), 'COUNT and UNTIL cannot both be set');
  assert.equal(rule('FREQ=WEEKLY;BYDAY=1MO'), 'BYDAY ordinals need FREQ=MONTHLY or FREQ=YEARLY');
  assert.equal(rule('FREQ=MONTHLY;BYDAY=6MO'), 'BYDAY ordinal out of range');
  assert.equal(rule('FREQ=MONTHLY;BYSETPOS=1'), 'BYSETPOS needs another BY part');
  assert.equal(rule('FREQ=DAILY;UNTIL=20231231'), 'UNTIL is before DTSTART');
});
