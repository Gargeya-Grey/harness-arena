export const systemClock = { now: () => Date.now() };

export function manualClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    set(ms) {
      time = ms;
      return time;
    },
  };
}
