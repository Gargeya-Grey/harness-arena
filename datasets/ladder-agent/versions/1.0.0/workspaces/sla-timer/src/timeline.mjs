import { SlaError } from './errors.mjs';

// What may follow each kind of event.
const NEXT = { start: ['pause', 'stop'], resume: ['pause', 'stop'], pause: ['resume', 'stop'], stop: [] };

// events: [{ type: 'start' | 'pause' | 'resume' | 'stop', at }]. The first is a start, times never go back
// (events at the same instant are fine), and the order of the events is kept. `now` may not be before the last event.
// Gives the spans in which the clock ran, and the state at `now`. A stop while paused adds no span.
export function runningSpans(events, now) {
  if (!Array.isArray(events) || events.length === 0 || events[0]?.type !== 'start') throw new SlaError('the history starts with a start event');
  const spans = [];
  let since = null;
  let state = 'stopped';
  let previous = null;
  for (const event of events) {
    if (!Number.isFinite(event.at)) throw new SlaError('an event has a time');
    if (previous) {
      if (event.at <= previous.at) throw new SlaError('events are in time order');
      if (!NEXT[previous.type]?.includes(event.type)) throw new SlaError(`${event.type} cannot follow ${previous.type}`);
    }
    if (event.type === 'pause' || event.type === 'stop') spans.push([since, event.at]);
    if (event.type === 'start' || event.type === 'resume') since = event.at;
    state = event.type === 'pause' ? 'paused' : event.type === 'stop' ? 'stopped' : 'running';
    previous = event;
  }
  if (now < previous.at) throw new SlaError('now is before the last event');
  if (state === 'running') spans.push([since, now]);
  return { spans, state };
}
