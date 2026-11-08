export const systemClock = { now: () => Date.now() };

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
