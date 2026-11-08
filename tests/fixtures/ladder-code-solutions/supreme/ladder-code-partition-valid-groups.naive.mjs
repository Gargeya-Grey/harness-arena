function countValidPartitions(n, k, d, cap, seed) {
  const P = 67108859;
  let x = seed;
  const weight = [];
  for (let i = 0; i < n; i += 1) {
    x = (x * 48271 + 11) % 2147483647;
    weight.push(x % 1000);
  }
  // Every set partition, built item by item: join a group or open a new one.
  const groups = [];
  let count = 0;
  const place = (item) => {
    if (item === n) {
      if (groups.length === k && groups.every((g) => g.size <= cap && g.sum % d === 0)) count += 1;
      return;
    }
    for (const g of groups) {
      g.size += 1;
      g.sum += weight[item];
      place(item + 1);
      g.size -= 1;
      g.sum -= weight[item];
    }
    if (groups.length < k) {
      groups.push({ size: 1, sum: weight[item] });
      place(item + 1);
      groups.pop();
    }
  };
  place(0);
  return count % P;
}
