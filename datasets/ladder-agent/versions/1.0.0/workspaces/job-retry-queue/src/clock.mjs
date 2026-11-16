export const systemClock = { now: () => Date.now() };

// A clock the caller moves by hand. Used by tests and by the demo scripts.
export function manualClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    advance(ms) {
      time += ms;
      return time;
    },
    set(ms) {
      time = ms;
      return time;
    },
  };
}
