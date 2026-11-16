// Counts the jobs that run at the same moment.
export function createPool(limit) {
  let used = 0;
  return {
    free: () => limit - used,
    take() {
      used += 1;
    },
    release() {
      used -= 1;
    },
  };
}
