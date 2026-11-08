// A speed probe in a `maybe` list may fail only on time: it ran to the end, and what it returned is right apart
// from the speed verdict. The evaluator gives a failed probe as text and cuts the value at 200 characters.

export function onlyTiming(item, want) {
  const prefix = `expected ${JSON.stringify(want)}, got `;
  if (!item.error?.startsWith(prefix)) return false;
  const got = item.error.slice(prefix.length);
  if (got === '{"slow":true}') return true;
  if (!Array.isArray(want)) return JSON.stringify({ ...want, fast: false }).startsWith(got);
  const text = JSON.stringify(want);
  let same = 0;
  while (same < got.length && got[same] === text[same]) same += 1;
  return same === got.length || /^,?"?too slow"\]$/.test(got.slice(same));
}
