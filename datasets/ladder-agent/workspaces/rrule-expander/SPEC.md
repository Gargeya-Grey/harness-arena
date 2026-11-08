# RRULE expander

This library reads a small calendar recurrence in the style of iCalendar (RFC 5545) and lists its occurrences. It
supports a subset, and where this file and the RFC differ, this file is right. Everything is UTC. There are no time
zones, no daylight saving time and no leap seconds.

The public API is in `src/index.mjs`:

- `parse(text)` reads the text and returns the normalized rule (section 3).
- `expand(text, options)` returns the occurrences as an array of strings (sections 4 and 5).
- `RRuleError` is the one error class. Every rejected input throws `RRuleError` with the exact message this file
  gives. Nothing else may be thrown for a bad input.

`src/dates.mjs` and `src/errors.mjs` are done. `src/rule.mjs` (`parse`) and `src/expand.mjs` (`expand`) are stubs.
Add more modules if you want them.

## 1. Calendar and time format

- The calendar is proleptic Gregorian. A year is a leap year when it divides by 4, except when it divides by 100
  and not by 400. February has 29 days in a leap year.
- Valid years are 1970 to 2999. A date or time outside them is not valid. `29991231T235959Z` is the last valid
  moment.
- A date-time is written `YYYYMMDDTHHMMSSZ`: eight digits, `T`, six digits, `Z`. Month 01 to 12, a day that exists in
  that month, hour 00 to 23, minute and second 00 to 59. A date is written `YYYYMMDD`. Other forms are invalid.
- Weeks are named `MO TU WE TH FR SA SU`. A week starts on its WKST day (default `MO`).
- `readBasic`, `formatBasic`, `daysFromCivil`, `civilFromDays` and `weekdayOf` in `src/dates.mjs` do the date
  arithmetic. They can be used as they are.

## 2. Input text

The input is a string of lines. A line ends with LF or CRLF. An empty line is skipped, but it still counts for line
numbers. The first line is line 1. Every other line must be `NAME:VALUE`, where NAME is one or more capital letters
and VALUE is everything after the first colon.

| Property | Times | Value |
|---|---|---|
| `DTSTART` | exactly 1 | a date-time. The first moment the recurrence can use, and the time of day of every occurrence. |
| `RRULE` | exactly 1 | rule parts joined with `;` (section 3) |
| `EXDATE` | any number | date-times or dates joined with `,` that are removed from the result |

Errors are found line by line, in line order, and the first one is thrown. A line is checked in this order: its
shape, then its property name, then a repeated property, then its value. After the last line come the checks for
a missing property, then the rule checks of section 3.3.

| Cause | Message |
|---|---|
| the input is not a string | `input must be a string` |
| a line is not `NAME:VALUE` | `line N: expected NAME:VALUE` |
| any other property name | `line N: unknown property NAME` |
| a second DTSTART line | `line N: duplicate DTSTART` |
| a second RRULE line | `line N: duplicate RRULE` |
| DTSTART is not a valid date-time | `line N: bad DTSTART "VALUE"` |
| an EXDATE item is not a valid date-time or date (an empty item too) | `line N: bad EXDATE "ITEM"` |
| no DTSTART line | `missing DTSTART` |
| no RRULE line | `missing RRULE` |

`NAME` and `VALUE` in a message are the text from the input. Property names are case-sensitive, so `rrule:` is not
`NAME:VALUE` at all. The text has no spaces: a space makes a value invalid.

## 3. The rule

### 3.1 Rule parts

The value of RRULE is a list of `NAME=VALUE` parts separated by `;`. The parts may come in any order. Each part is
checked in this order: it has a `=` after at least one character, its name is known, its name is new, its value
is valid. The messages use the line number of the RRULE line.

| Part | Value | Message when bad |
|---|---|---|
| `FREQ` | `DAILY`, `WEEKLY`, `MONTHLY` or `YEARLY` | `line N: bad FREQ "VALUE"` |
| `INTERVAL` | integer 1 to 9999 | `line N: bad INTERVAL "VALUE"` |
| `COUNT` | integer 1 to 999999999 | `line N: bad COUNT "VALUE"` |
| `UNTIL` | a date-time or a date | `line N: bad UNTIL "VALUE"` |
| `BYMONTH` | list of integers 1 to 12 | `line N: bad BYMONTH "VALUE"` |
| `BYMONTHDAY` | list of signed integers, 1 to 31 in size | `line N: bad BYMONTHDAY "VALUE"` |
| `BYDAY` | list of `[ordinal]weekday` (section 3.2) | `line N: bad BYDAY "VALUE"` |
| `BYSETPOS` | list of signed integers, 1 to 366 in size | `line N: bad BYSETPOS "VALUE"` |
| `WKST` | a weekday name | `line N: bad WKST "VALUE"` |

- Other messages of this level are `line N: bad rule part "PART"` (no `=`, or nothing before it, or the part is
  empty, for example after a `;` at the end), `line N: unknown rule part NAME` and `line N: duplicate rule part NAME`.
- An integer is decimal digits without a leading zero (`0` alone is a number, `01` is not) and at most 9 digits. A
  signed integer may start with one `+` or `-`. Its size is the value without the sign, and zero is never valid in
  a signed list.
- A list is items joined with `,`. An empty item makes the list bad. Spaces are not allowed.
- Values are capital letters only: `freq=daily` is bad.

### 3.2 BYDAY

An item is an optional ordinal and a weekday name: `MO`, `2TU`, `-1FR`, `+3SU`. The ordinal is a sign (optional)
and one or two digits without a leading zero, with size 1 to 53. A sign without a number (`+MO`) is bad, and so is
an ordinal of `0`. An item without an ordinal has the ordinal `0` in the parsed result and means every such
weekday. Section 4.3 says what an ordinal means.

### 3.3 Checks on the whole rule

After all parts are read, in this order (the first failure is thrown, without a line number):

1. no FREQ: `FREQ is required`
2. both COUNT and UNTIL: `COUNT and UNTIL cannot both be set`
3. BYMONTHDAY with FREQ=WEEKLY: `BYMONTHDAY cannot be used with FREQ=WEEKLY`
4. a BYDAY ordinal that is not 0 with FREQ=DAILY or FREQ=WEEKLY: `BYDAY ordinals need FREQ=MONTHLY or FREQ=YEARLY`
5. a BYDAY ordinal with a size above 5, when FREQ=MONTHLY or when FREQ=YEARLY with a BYMONTH part, or above 53
   for FREQ=YEARLY without BYMONTH: `BYDAY ordinal out of range`
6. BYSETPOS and none of BYMONTH, BYMONTHDAY and BYDAY (the defaults of section 4.2 do not count): `BYSETPOS needs another BY part`
7. UNTIL before DTSTART: `UNTIL is before DTSTART`. A date UNTIL is before DTSTART when its day is before the day
   of DTSTART; a date-time UNTIL is compared as a moment. An UNTIL equal to DTSTART is allowed.

### 3.4 The parse result

`parse(text)` returns this plain object:

```
{
  dtstart: 'YYYYMMDDTHHMMSSZ',              // as written
  rule: {
    freq: 'MONTHLY',                         // string
    interval: 1,                             // number, 1 when absent
    count: null,                             // number or null
    until: null,                             // the text as written, or null
    bymonth: [],                             // numbers, ascending, no duplicates
    bymonthday: [],                          // numbers, ascending (-1 comes before 1), no duplicates
    byday: [],                               // { ordinal: number, day: 'MO' } objects, see below
    bysetpos: [],                            // numbers, ascending, no duplicates
    wkst: 'MO',                              // 'MO' when absent
  },
  exdates: [],                               // the EXDATE items as written, no duplicates, sorted as plain text
}
```

`byday` is sorted by weekday (`MO` first) and then by ordinal ascending, with no duplicates. `+2TU` and `2TU` are
the same item and give `ordinal: 2`. All the keys are always there. Absent values are `null` or an empty list, never
`undefined`.

## 4. What a rule means

### 4.1 Periods

DTSTART opens period 0. The other periods follow it every INTERVAL steps of FREQ:

- DAILY: a period is one day. Period k is the day of DTSTART plus k times INTERVAL days.
- WEEKLY: a period is a week of seven days that starts on the WKST day. Period 0 is the week that holds DTSTART. Period
  k starts k times INTERVAL weeks later.
- MONTHLY: a period is a calendar month. Period k is the month of DTSTART plus k times INTERVAL months.
- YEARLY: a period is a calendar year. Period k is the year of DTSTART plus k times INTERVAL years.

A period can hold days before DTSTART (a week or month usually does). A period with no matching day gives nothing
and the next period is tried. The periods stop when one starts after the last valid day, `29991231`. A rule that
can never match gives an empty result, and it must end without a long wait.

### 4.2 Defaults from DTSTART

A BY part that is empty gets a default, only in these cases. The default is not part of the parse result.

- WEEKLY and no BYDAY: BYDAY is the weekday of DTSTART (without an ordinal).
- MONTHLY and no BYMONTHDAY and no BYDAY: BYMONTHDAY is the day of the month of DTSTART.
- YEARLY and no BYMONTHDAY and no BYDAY: BYMONTHDAY is the day of the month of DTSTART, and when BYMONTH is empty
  too, BYMONTH is the month of DTSTART.

DAILY has no default. A day of the month that a month does not have (31 in April, 30 in February, 29 in February of
a common year) is never moved or shortened. That month simply gives no occurrence for it, and the day that
FREQ=MONTHLY takes from DTSTART is no exception. An occurrence on 29 February exists only in leap years.

### 4.3 The days of a period

A day of a period is selected when it passes every non-empty BY part (the default parts too):

- BYMONTH: its month is in the list.
- BYMONTHDAY: its day of the month equals a positive item, or `days in the month + item + 1` for a negative one
  (`-1` is the last day, `-2` the one before it).
- BYDAY: some item has the weekday of the day and either the ordinal 0, or an ordinal that gives the position of the
  day among days of that weekday in the scope. The position counts from the start of the scope for a positive
  ordinal (`1` is the first) and from its end for a negative one (`-1` is the last). The scope is the month of the
  day when FREQ=MONTHLY, or FREQ=YEARLY with a BYMONTH part. It is the whole year when FREQ=YEARLY without
  BYMONTH. (`20MO` is then the 20th Monday of the year, `-1FR` the last Friday of the year.) Without an ordinal
  the scope does not matter.

The selected days of the period, in ascending order, are the set of the period. The day of DTSTART is not selected
by default: it is an occurrence only if it passes the parts like any other day.

### 4.4 BYSETPOS

When BYSETPOS is not empty, it picks days from the set of the period, in the order of the set. `1` is the first day
of the set, `-1` the last. A position that the set does not have picks nothing, and the same day picked twice
counts once. The set is the one of section 4.3 for the whole period, so it still holds days before DTSTART.
Example: `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1` is the last working day of each month.

### 4.5 Cutting the sequence

The days of all periods, in order, become moments by adding the time of day of DTSTART. Then:

1. A moment before DTSTART is dropped. It does not count for COUNT.
2. UNTIL ends the sequence. A moment up to UNTIL is kept (UNTIL is inclusive). A date UNTIL keeps every moment
   on that day. No moment after the last valid moment `29991231T235959Z` exists.
3. COUNT ends the sequence after that many moments. EXDATE does not change this: the moments of step 4
   count for COUNT, although they are not in the result.
4. EXDATE removes moments. A date-time item removes the moment that equals it. A date item removes every moment on that day.
   An item that matches nothing is ignored.

The result of the rule is this sequence, ascending, without duplicates.

## 5. expand

`expand(text, options)` calls `parse(text)` first, so parse errors win. `options` is an object (`{}` by default)
with these optional fields. They are checked in this order, after parse. Other fields are ignored.

| Field | Value | Meaning | Message when bad |
|---|---|---|---|
| `limit` | integer 1 to 100000, default 1000 | the result has at most this many items | `bad limit` |
| `from` | a date-time string | the result has only moments at or after it | `bad from` |
| `to` | a date-time string | the result has only moments at or before it | `bad to` |

An `options` that is not an object (`null`, a number, a string and a boolean) throws `options must be an object`. A
field whose value is `undefined` counts as absent. Any other value that is not allowed, `null` too, throws the
message of that field. A `limit` that is not an integer number throws `bad limit`.

- The result is an array of date-time strings in ascending order, each moment once.
- `from` and `to` only cut the final result. Moments before `from` still count for COUNT. `limit` counts the
  moments that are in the result, so removed and cut moments never use it up.
- A `from` after `to` gives `[]`.
- The array can be empty, and no error is thrown for that.

## 6. Examples

```
DTSTART:20240131T090000Z
RRULE:FREQ=MONTHLY;COUNT=4
```
gives 31 Jan, 31 Mar, 31 May and 31 Jul 2024 (each at 09:00:00): February, April and June have no 31st.

```
DTSTART:20240229T100000Z
RRULE:FREQ=YEARLY;COUNT=3
```
gives 29 Feb 2024, 2028 and 2032. The year 2100 would be skipped, because it is not a leap year.

```
DTSTART:20240101T090000Z
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;COUNT=4
```
gives Mon 1 Jan, Sun 7 Jan, Mon 15 Jan and Sun 21 Jan: with the default WKST=MO, 1 Jan and 7 Jan are in period 0.
With `WKST=SU` the first period starts on Sun 31 Dec, and the result is 1 Jan, 14 Jan, 15 Jan and 28 Jan.

```
DTSTART:20240115T090000Z
RRULE:FREQ=MONTHLY;BYMONTHDAY=15;BYDAY=MO
```
holds only months where the 15th is a Monday. Both parts must pass.

## 7. Files and limits

- Do not edit `SPEC.md`, `src/dates.mjs`, `src/errors.mjs`, `src/index.mjs` or the existing files in `test/`.
- Node 20 or newer, ES modules, no dependencies.
- `expand` must not need more than a few seconds for a rule that never matches, for a result of 100000 moments,
  or for 40000 EXDATE items.
