// Plausible mistakes: expiry runs only for packets that pass the check and the flag rules; only a packet with a new byte refreshes the stream;
// a later byte replaces a stored (not yet delivered) byte; a later F moves the end; the window follows the delivery inside one packet.
function reassemble(config, packets) {
  const { window, timeout } = config;
  const streams = [];
  const open = new Map();
  const drops = { check: 0, orphan: 0, restart: 0, flags: 0, old: 0, badend: 0 };

  for (const [time, id, seq, flags, payload, check] of packets) {
    let sum = 31 * seq;
    for (const ch of payload) sum += ch.charCodeAt(0);
    for (const ch of flags) sum += ch.charCodeAt(0);
    if (sum % 251 !== check) {
      drops.check += 1;
      continue;
    }
    const letters = new Set(flags);
    const hasS = letters.has('S');
    const hasF = letters.has('F');
    const hasR = letters.has('R');
    if ([...letters].some((ch) => ch !== 'S' && ch !== 'F' && ch !== 'R') || (hasR && letters.size > 1)) {
      drops.flags += 1;
      continue;
    }
    for (const [key, s] of [...open]) {
      if (time - s.last >= timeout) {
        s.status = 'timeout';
        open.delete(key);
      }
    }
    let s = open.get(id);
    if (hasS) {
      if (s) {
        drops.restart += 1;
        continue;
      }
      s = { id, base: seq, text: '', next: 0, buf: new Map(), end: null, conflicts: 0, last: time, status: 'open' };
      open.set(id, s);
      streams.push(s);
    } else if (!s) {
      drops.orphan += 1;
      continue;
    }
    if (hasR) {
      s.status = 'reset';
      open.delete(id);
      continue;
    }
    const pos = seq - s.base;
    if (pos < 0) {
      drops.old += 1;
      continue;
    }
    if (hasF && pos + payload.length < s.next) {
      drops.badend += 1;
      continue;
    }
    if (hasF) s.end = pos + payload.length;
    let fresh = false;
    const deliver = () => {
      while (s.buf.has(s.next) && (s.end === null || s.next < s.end)) {
        s.text += s.buf.get(s.next);
        s.buf.delete(s.next);
        s.next += 1;
      }
    };
    for (let i = 0; i < payload.length; i += 1) {
      const p = pos + i;
      if (s.end !== null && p >= s.end) continue;
      if (p >= s.next + window) continue;
      const known = p < s.next ? s.text[p] : s.buf.get(p);
      if (known === undefined) {
        s.buf.set(p, payload[i]);
        fresh = true;
        deliver();
      } else if (known !== payload[i]) {
        s.conflicts += 1;
        if (p >= s.next) s.buf.set(p, payload[i]);
      }
    }
    if (fresh || payload.length === 0) s.last = time;
    deliver();
    if (s.end !== null && s.next === s.end) {
      s.status = 'done';
      open.delete(id);
    }
  }
  return { streams: streams.map((s) => [s.id, s.text, s.status, s.conflicts]), drops };
}
