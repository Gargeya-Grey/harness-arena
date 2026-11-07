export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

// The local civil day of an instant, for a calendar that is `offsetMinutes` ahead of UTC.
export const localDay = (ms, offsetMinutes) => Math.floor((ms + offsetMinutes * MINUTE_MS) / DAY_MS);

// The instant at which local day `day` begins.
export const localMidnight = (day, offsetMinutes) => day * DAY_MS - offsetMinutes * MINUTE_MS;
