// A clock answers now() in milliseconds. Tests use manualClock.
export const systemClock = { now: () => Date.now() };

export function manualClock(start = 0) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
      return clock;
    },
    set(ms) {
      clock.time = ms;
      return clock;
    },
  };
  return clock;
}
