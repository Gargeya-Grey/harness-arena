export function createStats() {
  const counts = { enqueued: 0, duplicates: 0, completed: 0, retried: 0, dead: 0, cancelled: 0 };
  return {
    count(name) {
      counts[name] += 1;
    },
    snapshot: () => ({ ...counts }),
  };
}
