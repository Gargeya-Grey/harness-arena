export default {
  slug: "ttl-size-cache",
  tier: {
    level: 3,
    human_minutes: 28,
    basis: "Seven cache faults (units, expiry edges, byte accounting, eviction order, stats, async loader) across 14 files; reference rewrites about 220 lines in 5 files.",
    origin: "agentic-hard-ttl-size-cache",
  },
  tags: ["bugfix"],
  task: "The cache behaves oddly under load.\n- ttl: '30s' lasts 30 milliseconds. Durations written as text must be converted to milliseconds ('500ms', '30s', '5m', '2h', '1d', '1.5s', '1h30m'); a number is milliseconds, and text without a unit (such as '5') is an error.\n- An entry set at time 0 with a ttl of 100 is still returned at time 100. It must expire exactly at set time + ttl, for get, has, peek, ttlOf, keys, size and bytes alike. ttlOf must answer in milliseconds (Infinity when the entry never expires).\n- With maxBytes, setting the same key again a few times makes the cache evict everything.\n- Expired entries still count towards maxBytes and push live entries out. Expired entries must go before any live entry is evicted (an expired entry that goes counts as an expiration, never as an eviction), and size() and bytes() never count them.\n- A value that is bigger than maxBytes by itself wipes the whole cache. It must not be stored (set returns false), nothing else is evicted for it, and an older value under the same key is removed (that removal is not an eviction and does not count in the stats).\n- has() and peek() change the recency order and the hit and miss statistics. Only get() may.\n- The default size of a string must be its UTF-8 length in bytes.\n- getOrLoad: after a loader has failed once, every later call for that key rejects with the same error. A failed load must not be remembered: callers that were waiting for it all get the rejection, and the next call tries again. The existing tests must keep passing and must not be edited; put any new tests in new files. The public exports stay as they are.",
};
