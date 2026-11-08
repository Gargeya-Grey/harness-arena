export default {
  slug: 'sla-timer',
  tier: {
    level: 4,
    human_minutes: 45,
    basis: 'Estimate from the size of the work, not a timed solve: about 15 separate faults in 9 of 14 source files, in time-zone offsets, window rules, event history and the SLA flags; roughly 25 minutes to find them (several only show with an offset, a pause or a boundary) and 20 to fix and check them.',
  },
  tags: ['bugfix'],
  task: `Our support SLA timer gives wrong deadlines and wrong flags.
- A calendar that is ahead of UTC (an office at +05:30, for example) opens and closes at the wrong hours, and the holiday and weekday checks are off for it.
- Some calendar setups that should work are refused (an offset of +14:00, two windows that touch), and some that should be refused are accepted (a time like 09:75, a weekday key such as 7).
- A special day with no windows does not close the day. Asking for the next opening at the exact closing time of a window gives that closing time.
- Time that runs out exactly at the end of a window is moved to the next opening. Asking for the business time between two instants in the wrong order gives 0.
- Events at the same instant (a pause and a resume together) are refused. A stop while paused adds the paused time to the elapsed time.
- A ticket that used exactly its target is marked as breached. The warning flag turns on too late, or not at all, at the exact level, and its result depends on rounding.
- Once the target is passed, a running clock fails with an error instead of keeping the deadline. A paused clock gets a deadline as if it was running.
- The response clock stops for pauses, and a stop in the history can make it fail. A priority that names a calendar called toString or constructor is accepted.

The rules we agreed on:
- A calendar has an offset in minutes ahead of UTC: a whole number from -720 to 840. Hours, weekdays, holidays and special days are all those of the local date. A calendar never changes its offset (no daylight saving).
- week has the keys 0 to 6 (0 is Sunday); any other key is refused with CalendarError. A weekday that is not listed is closed. A window is [start, end] as HH:MM. Minutes are 00 to 59, hours are 00 to 24, and 24:00 is the end of the day. The end must be after the start. Windows in one list may touch (12:00 end, 12:00 start) but not overlap, and the list may be in any order. Dates are real YYYY-MM-DD dates. Holidays are closed all day. A special day replaces the weekly windows of its date, and an empty list closes the day. A date that is a holiday and a special day is refused. A bad calendar throws CalendarError.
- The end of a window is closed and its start is open. nextOpen(calendar, ms) is ms itself when it is open, else the next start of a window. It looks ahead 3660 days, then throws CalendarError; so does addBusinessTime on a calendar that is never open.
- addBusinessTime(calendar, start, duration): the duration is a whole number of ms, 0 or more, else RangeError. 0 gives start. Closed time does not count. When the duration is used up exactly at the end of a window, the answer is that end.
- businessTimeBetween(calendar, from, to) is the open time in ms between them; it throws RangeError when to is before from.
- An event history starts with a start. After a start or a resume only a pause or a stop may follow; after a pause only a resume or a stop; nothing follows a stop. Events may have the same time, times may not go back, and now may not be before the last event; the order of the list is kept. A stop while paused adds no time. Any other fault is a SlaError.
- computeSla: target is a whole number of ms, 1 or more; warnPercent is above 0 and at most 100 (default 80); both are SlaError otherwise. The clock runs from a start or resume to the next pause or stop, or to now. A ticket is breached when the elapsed open time is more than the target (equal is on time). It is at risk when it is not breached and elapsed times 100 is at least target times warnPercent, tested exactly. remaining is target minus elapsed.
- deadline is the instant at which the elapsed time reached the target, also when that is in the past. If it has not been reached it is null for a paused or stopped clock, and for a running clock it is the instant ahead at which the target will be reached.
- A policy rule names a calendar and gives response and resolution targets. The response clock runs from createdAt to firstResponseAt (or to now) and pauses do not stop it. The resolution clock follows the events as they are. Only own names count: an unknown priority, or a rule that names an unknown calendar (also at creation), is a SlaError, whatever the name, toString included.

Public exports stay as they are. The existing tests must keep passing and must not be edited; put any new tests in new files.`,
};
