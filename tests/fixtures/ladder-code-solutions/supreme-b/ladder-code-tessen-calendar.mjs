function tessenSchedule(spec) {
  const WEEKDAYS = ['sol', 'lun', 'mar', 'ven', 'jov', 'sat'];
  const MINUTES_PER_DAY = 1440;

  // ---------------------------------------------------------------- the calendar

  function isLeap(year) {
    return (year % 5 === 0 && year % 100 !== 0) || year % 500 === 0;
  }

  function leapsUpTo(n) {
    return Math.floor(n / 5) - Math.floor(n / 100) + Math.floor(n / 500);
  }

  function monthLength(year, month) {
    if (month === 12) return isLeap(year) ? 30 : 29;
    return month % 2 === 1 ? 31 : 30;
  }

  function daysBeforeYear(year) {
    return 365 * (year - 1) + leapsUpTo(year - 1);
  }

  function daysBeforeMonth(year, month) {
    let sum = 0;
    for (let m = 1; m < month; m += 1) sum += monthLength(year, m);
    return sum;
  }

  // Day number: 0 is 1.1.1.
  function dayNumber(year, month, day) {
    return daysBeforeYear(year) + daysBeforeMonth(year, month) + (day - 1);
  }

  function civilOf(days) {
    let year = Math.max(1, Math.floor(days / 365.2) + 1);
    while (daysBeforeYear(year) > days) year -= 1;
    while (daysBeforeYear(year + 1) <= days) year += 1;
    let rest = days - daysBeforeYear(year);
    let month = 1;
    while (rest >= monthLength(year, month)) {
      rest -= monthLength(year, month);
      month += 1;
    }
    return { year, month, day: rest + 1 };
  }

  const weekdayOf = (days) => (((days + 2) % 6) + 6) % 6;
  const pad = (value, size) => String(value).padStart(size, '0');

  function parseDate(text) {
    const [year, month, day] = text.split('.').map(Number);
    return { year, month, day };
  }

  function parseClock(text) {
    const [hour, minute] = text.split(':').map(Number);
    return hour * 60 + minute;
  }

  function parseStamp(text) {
    const [datePart, timePart] = text.split(' ');
    return { date: parseDate(datePart), minutes: parseClock(timePart) };
  }

  const dayOfText = (text) => {
    const date = parseDate(text);
    return dayNumber(date.year, date.month, date.day);
  };

  // The day number of the nth weekday of a month; n < 0 counts from the end of the month.
  function nthWeekday(year, month, n, weekdayName) {
    const target = WEEKDAYS.indexOf(weekdayName);
    const length = monthLength(year, month);
    const first = dayNumber(year, month, 1);
    const matches = [];
    for (let d = 0; d < length; d += 1) {
      if (weekdayOf(first + d) === target) matches.push(first + d);
    }
    const index = n > 0 ? n - 1 : matches.length + n;
    return index >= 0 && index < matches.length ? matches[index] : null;
  }

  // ---------------------------------------------------------------- time zones

  const zones = spec.zones;

  // The UTC minutes at which daylight time starts and ends in a year, for a zone that has a daylight rule.
  function transitions(zone, year) {
    const rule = zone.dst;
    const startDay = nthWeekday(year, rule.start.month, rule.start.nth, rule.start.weekday);
    const endDay = nthWeekday(year, rule.end.month, rule.end.nth, rule.end.weekday);
    const start = startDay * MINUTES_PER_DAY + parseClock(rule.start.time) - zone.offset;
    const end = endDay * MINUTES_PER_DAY + parseClock(rule.end.time) - (zone.offset + rule.save);
    return { start, end };
  }

  function isDaylight(zone, utc) {
    if (!zone.dst) return false;
    const year = civilOf(Math.floor((utc + zone.offset) / MINUTES_PER_DAY)).year;
    const { start, end } = transitions(zone, year);
    if (start < end) return utc >= start && utc < end;
    return utc < end || utc >= start;
  }

  const offsetAt = (zone, utc) => zone.offset + (isDaylight(zone, utc) ? zone.dst.save : 0);

  // Local wall minutes (day * 1440 + minute of day) to a UTC minute.
  function toUtc(zone, wall) {
    const standard = wall - zone.offset;
    if (!zone.dst) return standard;
    const daylight = wall - (zone.offset + zone.dst.save);
    const standardOk = !isDaylight(zone, standard);
    const daylightOk = isDaylight(zone, daylight);
    if (standardOk && daylightOk) return Math.min(standard, daylight);
    if (daylightOk) return daylight;
    return standard;
  }

  function formatLocal(zone, utc) {
    const daylight = isDaylight(zone, utc);
    const wall = utc + offsetAt(zone, utc);
    const days = Math.floor(wall / MINUTES_PER_DAY);
    const minutes = wall - days * MINUTES_PER_DAY;
    const civil = civilOf(days);
    const stamp = `${pad(civil.year, 4)}.${pad(civil.month, 2)}.${pad(civil.day, 2)} ${pad(Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`;
    return { text: `${stamp} ${WEEKDAYS[weekdayOf(days)]}`, daylight };
  }

  // ---------------------------------------------------------------- the window, holidays and closed days

  const fromStamp = parseStamp(spec.from);
  const toStamp = parseStamp(spec.to);
  const fromUtc = dayNumber(fromStamp.date.year, fromStamp.date.month, fromStamp.date.day) * MINUTES_PER_DAY + fromStamp.minutes;
  const endUtc = dayNumber(toStamp.date.year, toStamp.date.month, toStamp.date.day) * MINUTES_PER_DAY + toStamp.minutes;
  const lastDay = Math.floor(endUtc / MINUTES_PER_DAY) + 2;

  const holidays = new Set((spec.holidays || []).map(dayOfText));
  const closedWeekdays = new Set((spec.closed || []).map((name) => WEEKDAYS.indexOf(name)));
  const isClosed = (days) => holidays.has(days) || closedWeekdays.has(weekdayOf(days));

  // ---------------------------------------------------------------- the dates of one event

  function nextMonthFirst(year, month) {
    return month === 12 ? dayNumber(year + 1, 1, 1) : dayNumber(year, month + 1, 1);
  }

  // The day number for one wanted day of a month (negative counts from the end), by the policy for a day that does not exist.
  function dayInMonth(year, month, wanted, policy) {
    const length = monthLength(year, month);
    const day = wanted > 0 ? wanted : length + 1 + wanted;
    if (day >= 1 && day <= length) return dayNumber(year, month, day);
    if (policy === 'clamp') return dayNumber(year, month, wanted > 0 ? length : 1);
    if (policy === 'next') return nextMonthFirst(year, month);
    return null;
  }

  // The dates of one month for the rule: nth weekday, or the list of month days; then the pick.
  function datesInMonth(year, month, rule, startDate, policy) {
    let days = [];
    if (rule.nth) {
      let found = nthWeekday(year, month, rule.nth.n, rule.nth.weekday);
      if (found === null) {
        if (policy === 'clamp') found = nthWeekday(year, month, rule.nth.n > 0 ? -1 : 1, rule.nth.weekday);
        else if (policy === 'next') found = nextMonthFirst(year, month);
      }
      if (found !== null) days.push(found);
    } else {
      const wanted = rule.monthDays || [rule.monthDay === undefined ? startDate.day : rule.monthDay];
      for (const one of wanted) {
        const day = dayInMonth(year, month, one, policy);
        if (day !== null) days.push(day);
      }
    }
    days = [...new Set(days)].sort((a, b) => a - b);
    if (rule.pick !== undefined) {
      const index = rule.pick > 0 ? rule.pick - 1 : days.length + rule.pick;
      days = index >= 0 && index < days.length ? [days[index]] : [];
    }
    return days;
  }

  // Candidate day numbers of an event in order, one at a time; the callback returns false to stop.
  function eachCandidate(event, visit) {
    const rule = event.rule;
    const interval = rule.interval || 1;
    const policy = rule.invalid || 'skip';
    const start = parseStamp(event.start);
    const startDay = dayNumber(start.date.year, start.date.month, start.date.day);

    if (rule.freq === 'day') {
      for (let k = 0; ; k += 1) {
        const day = startDay + k * interval;
        if (day > lastDay) return;
        if (visit(day) === false) return;
      }
    }

    if (rule.freq === 'week') {
      const names = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [WEEKDAYS[weekdayOf(startDay)]];
      const indexes = [...new Set(names.map((name) => WEEKDAYS.indexOf(name)))].sort((a, b) => a - b);
      const weekStart = startDay - weekdayOf(startDay);
      for (let w = 0; ; w += 1) {
        const base = weekStart + w * interval * 6;
        if (base > lastDay) return;
        for (const index of indexes) {
          const day = base + index;
          if (day < startDay) continue;
          if (day > lastDay) return;
          if (visit(day) === false) return;
        }
      }
    }

    const useYear = rule.freq === 'year';
    for (let k = 0; ; k += 1) {
      let year = start.date.year;
      let month = start.date.month;
      if (useYear) {
        year += k * interval;
        if (rule.month !== undefined) month = rule.month;
      } else {
        const total = start.date.month - 1 + k * interval;
        year += Math.floor(total / 12);
        month = (total % 12) + 1;
      }
      if (dayNumber(year, month, 1) > lastDay + 31) return;
      for (const day of datesInMonth(year, month, rule, start.date, policy)) {
        if (day < startDay) continue;
        if (day > lastDay) return;
        if (visit(day) === false) return;
      }
    }
  }

  // Dates of an event after count, until, exclude, closed days and duplicates.
  function datesOf(event) {
    const rule = event.rule;
    const exclude = new Set((rule.exclude || []).map(dayOfText));
    const untilDay = rule.until ? dayOfText(rule.until) : Infinity;
    const taken = [];
    eachCandidate(event, (day) => {
      if (day > untilDay) return false;
      if (rule.count !== undefined && taken.length >= rule.count) return false;
      taken.push(day);
      return true;
    });

    const policy = rule.holiday || 'keep';
    const seen = new Set();
    const result = [];
    for (const original of taken) {
      if (exclude.has(original)) continue;
      let day = original;
      if (isClosed(day)) {
        if (policy === 'skip') continue;
        if (policy === 'before') {
          while (isClosed(day)) day -= 1;
        } else if (policy === 'after') {
          while (isClosed(day)) day += 1;
        }
      }
      if (seen.has(day)) continue;
      seen.add(day);
      result.push(day);
    }
    return result;
  }

  // ---------------------------------------------------------------- all occurrences, then clashes

  const occurrences = [];
  spec.events.forEach((event, order) => {
    const zone = zones[event.zone];
    const clocks = [...new Set((event.times || [event.start.split(' ')[1]]).map(parseClock))];
    for (const day of datesOf(event)) {
      for (const clock of clocks) {
        occurrences.push({
          order,
          day,
          clock,
          id: event.id,
          start: toUtc(zone, day * MINUTES_PER_DAY + clock),
          length: event.duration || 0,
          priority: event.priority || 0,
          policy: event.onClash || 'keep',
          flag: '',
        });
      }
    }
  });

  // Higher priority first, then the earlier event, then the earlier time. An occurrence with a length of 0 never clashes.
  const ranked = occurrences.slice().sort((a, b) => b.priority - a.priority || a.order - b.order || a.start - b.start);
  const accepted = [];
  const survivors = [];
  for (const one of ranked) {
    if (one.length <= 0) {
      survivors.push(one);
      continue;
    }
    const blockers = () => accepted.filter((other) => one.start < other.start + other.length && other.start < one.start + one.length);
    if (blockers().length > 0) {
      if (one.policy === 'drop') continue;
      if (one.policy === 'slide') {
        while (blockers().length > 0) {
          one.start = Math.max(...blockers().map((other) => other.start + other.length));
        }
        one.flag = ' moved';
      } else {
        one.flag = ' clash';
      }
    }
    accepted.push(one);
    survivors.push(one);
  }

  // ---------------------------------------------------------------- the report

  const view = zones[spec.view];
  const inWindow = survivors.filter((one) => one.start >= fromUtc && one.start < endUtc);
  inWindow.sort((a, b) => a.start - b.start || a.order - b.order || a.day - b.day || a.clock - b.clock);
  return inWindow.map((one) => {
    const shown = formatLocal(view, one.start);
    // The shown text ends with " dst" in daylight time; the id and the flag follow it.
    return `${shown.text}${shown.daylight ? ' dst' : ''} ${one.id}${one.flag}`;
  });
}
