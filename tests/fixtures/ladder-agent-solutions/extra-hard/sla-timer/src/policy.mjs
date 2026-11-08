import { SlaError } from './errors.mjs';
import { computeSla } from './sla.mjs';

const has = (object, key) => Object.hasOwn(object, key);

// createSlaPolicy({ calendars: { name: calendar }, priorities: { P1: { calendar: name, response: ms, resolution: ms } } })
//   evaluate({ priority, createdAt, firstResponseAt, events }, now) -> { response, resolution }
// The response clock runs from creation to the first response, and pauses do not stop it.
// The resolution clock follows `events` (start, pauses, resumes, stop) as they are.
export function createSlaPolicy({ calendars, priorities }) {
  for (const [name, rule] of Object.entries(priorities)) {
    if (!has(calendars, rule.calendar)) throw new SlaError(`priority ${name} uses the unknown calendar ${String(rule.calendar)}`);
  }
  return {
    evaluate(ticket, now, warnPercent) {
      if (!has(priorities, ticket.priority)) throw new SlaError(`unknown priority ${String(ticket.priority)}`);
      const rule = priorities[ticket.priority];
      const calendar = calendars[rule.calendar];
      const response = [{ type: 'start', at: ticket.createdAt }];
      if (ticket.firstResponseAt !== undefined) response.push({ type: 'stop', at: ticket.firstResponseAt });
      return {
        response: computeSla({ calendar, target: rule.response, events: response, now, warnPercent }),
        resolution: computeSla({ calendar, target: rule.resolution, events: ticket.events, now, warnPercent }),
      };
    },
  };
}
