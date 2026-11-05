function businessDays(start, end) {
  const toDay = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  const from = toDay(start);
  const to = toDay(end);
  let count = 0;
  for (let day = from; day < to; day += 1) {
    const weekday = new Date(day * 86400000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}
