import { t, rng, randInt, pick } from './_util.mjs';

const task = [
  'Write the receiver of a small packet protocol, "slip". reassemble(config, packets) returns { streams, drops }. config is { window, timeout }: both are integers of 1 or more. packets is an array of packets, processed in the given order; the times in it never decrease.',
  'A packet is [time, stream, seq, flags, payload, check]: time and seq are integers, stream is a string, flags is a string, payload is a string of printable ASCII characters (it may be empty), and check is an integer. The flags are letters: "S" (start), "F" (final) and "R" (reset). flags may be empty, and a letter may repeat. Every packet carries bytes: payload byte i has the position pos + i, where pos = seq - base, and base is the seq of the packet that started the stream.',
  'Step 1, expiry. Before a packet is looked at, every open stream that has had no accepted packet for timeout time units or more (packet time - last accepted time >= timeout) times out: its status becomes "timeout", it is closed, and its bytes that are not delivered yet are discarded. This happens for every packet, also for one that is dropped later.',
  'Step 2, check. The sum of the character codes of payload, plus the character codes of flags, plus 31 * seq, modulo 251, must equal check. A packet that fails is dropped, counted under "check", and has no other effect.',
  'Step 3, flags. A packet is dropped, counted under "flags", when flags has a letter other than S, F and R, or when it has R together with any other letter.',
  'Step 4, stream. Streams are found by their id, among the open ones. A packet with S for a stream that is open is dropped and counted under "restart". A packet with S for a stream that is not open opens a new stream with base = seq, delivered text "", status "open", 0 conflicts, and its last accepted time is time. Every stream that is opened is listed in streams, in the order it was opened, so one id can appear several times. A packet without S for a stream that is not open (never opened, done, reset or timed out) is dropped and counted under "orphan". A packet with R resets the open stream: its status becomes "reset", it is closed, the payload is ignored, and what was delivered so far stays as its text.',
  'Step 5, position. A packet with pos below 0 is dropped and counted under "old". A packet with F whose end position pos + payload length is smaller than the number of bytes already delivered is dropped and counted under "badend". Every other packet is accepted: the stream\'s last accepted time becomes time, also when the packet adds nothing new.',
  'Step 6, bytes. The end of the stream is unknown until a packet with F is accepted; then the end is pos + payload length of that packet. If the end is already known, the F flag of a later packet is ignored. A byte at a position that is the end or more is ignored. Let next be the number of bytes delivered so far; a byte at a position of next + window or more is also ignored (next is taken before this packet delivers anything). A byte that is not ignored is stored. If a byte for that position was already received (delivered or stored), the first one stays; if the new byte differs from it, the conflicts of the stream grow by 1.',
  'Step 7, delivery. After the bytes of a packet are handled, stored bytes are delivered while the byte at position next exists and next is below the end (if the end is known): each one is appended to the text of the stream, and next grows by 1. When the end is known and next equals the end, the status becomes "done" and the stream is closed. A packet with S and F and an empty payload therefore gives a done stream with an empty text at once.',
  'The result: streams is an array of [id, text, status, conflicts] for every stream that was opened; a stream that is still open at the end of packets has status "open" (no expiry is run at the end). drops is { check, orphan, restart, flags, old, badend } with the number of packets dropped for each reason, in this key order.',
].join(' ');

const sumOf = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
// A packet with the check of the task text; bad = true gives a wrong check.
const pk = (time, stream, seq, flags, payload, bad = false) => [time, stream, seq, flags, payload, (sumOf(payload) + 31 * seq + sumOf(flags) + (bad ? 1 : 0)) % 251];
const zero = { check: 0, orphan: 0, restart: 0, flags: 0, old: 0, badend: 0 };

// A seeded run of several streams with lost, repeated, reordered, corrupted and late packets.
function scenario(seed, streamCount, config) {
  const rand = rng(seed);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, streamCount);
  const lists = ids.map((id) => {
    const message = Array.from({ length: randInt(rand, 8, 26) }, () => 'abcdefghij'[randInt(rand, 0, 9)]).join('');
    const base = randInt(rand, 0, 900);
    const chunks = [];
    for (let at = 0; at < message.length;) {
      const len = randInt(rand, 1, 6);
      chunks.push([at, message.slice(at, at + len)]);
      at += len;
    }
    const list = chunks.map(([at, text], i) => {
      let flags = i === 0 ? 'S' : '';
      if (i === chunks.length - 1) flags += 'F';
      return pk(0, id, base + at, flags, text, rand() < 0.06);
    });
    const extra = [];
    list.forEach((packet, i) => {
      if (rand() < 0.15) extra.push(packet.slice());
      if (rand() < 0.12) {
        const text = packet[4] || 'a';
        const changed = (text[0] === 'j' ? 'a' : String.fromCharCode(text.charCodeAt(0) + 1)) + text.slice(1);
        extra.push(pk(0, id, packet[2], packet[3].replace('S', ''), changed));
      }
      if (i === 0 && rand() < 0.2) extra.push(pk(0, id, packet[2], 'S', 'zz'));
    });
    const all = [...list, ...extra];
    for (let i = all.length - 1; i > 0; i -= 1) {
      if (rand() < 0.45) {
        const j = Math.max(0, i - randInt(rand, 1, 3));
        [all[i], all[j]] = [all[j], all[i]];
      }
    }
    if (rand() < 0.2) all.splice(randInt(rand, 1, all.length - 1), 0, pk(0, id, base + randInt(rand, 0, message.length), 'R', ''));
    if (rand() < 0.12) all.splice(randInt(rand, 0, all.length), 0, pk(0, id, base - 1, '', 'q'));
    if (rand() < 0.1) all.splice(randInt(rand, 0, all.length), 0, pk(0, id, base, 'SR', ''));
    if (rand() < 0.25) all.push(pk(0, id, base + 3, '', 'k'));
    return all;
  });
  // Interleave the streams, then give the packets rising times with a few long gaps.
  const merged = [];
  while (lists.some((list) => list.length)) {
    const live = lists.filter((list) => list.length);
    merged.push(pick(rand, live).shift());
  }
  let time = 0;
  const packets = merged.map((packet) => {
    time += rand() < 0.04 ? randInt(rand, 6, 11) : randInt(rand, 0, 1);
    return [time, ...packet.slice(1)];
  });
  // A late packet that fails the check: it still expires the streams that have been quiet for long enough.
  if (rand() < 0.7) packets.push([time + randInt(rand, 2, 12), 'zz', 0, '', '', 17]);
  return [config, packets];
}

export default {
  slug: 'slip-reassembly',
  tier: {
    level: 4,
    human_minutes: 90,
    basis: 'estimated from the reference (about 80 lines): a receiver with seven fixed steps, a window measured before delivery, first-byte-wins conflicts, an end that is set once, expiry that runs on dropped packets and a new stream for a reused id; the time is the careful reading of about 25 rules and the checks of the order in which they apply',
  },
  tags: ['spec', 'protocol'],
  name: 'reassemble',
  signature: 'reassemble(config, packets) -> {streams, drops}',
  task,
  edges: {
    expiry: 'packet time - last accepted time >= timeout',
    'expiry-on-drop': 'also for one that is dropped later',
    check: 'must equal check',
    'flag-rules': 'together with any other letter',
    restart: 'is dropped and counted under "restart"',
    reset: 'what was delivered so far stays as its text',
    generation: 'so one id can appear several times',
    badend: 'smaller than the number of bytes already delivered',
    refresh: 'also when the packet adds nothing new',
    'end-once': 'the F flag of a later packet is ignored',
    'beyond-end': 'the end or more is ignored',
    window: 'next is taken before this packet delivers anything',
    conflict: 'the first one stays',
    delivery: 'while the byte at position next exists',
    'open-at-end': 'no expiry is run at the end',
  },
  tests: [
    // Out of order: "o!" waits at positions 4 and 5, "ll" fills 2 and 3, and the end 6 is reached.
    t('delivery', [{ window: 8, timeout: 10 }, [pk(1, 'a', 100, 'S', 'he'), pk(2, 'a', 104, 'F', 'o!'), pk(3, 'a', 102, '', 'll')]], { streams: [['a', 'hello!', 'done', 0]], drops: zero }),
    // The repeat of position 1 holds "x" where "b" was delivered: one conflict, the first byte stays. The repeat of "c" is the same byte.
    t('conflict', [{ window: 8, timeout: 10 }, [pk(1, 'a', 0, 'S', 'abc'), pk(2, 'a', 1, '', 'xc'), pk(3, 'a', 3, 'F', 'd')]], { streams: [['a', 'abcd', 'done', 1]], drops: zero }),
    // Window 4: after "ab" next is 2, so positions below 6 are kept: of "fghij" at 5 only "f" is stored. "cde" arrives and "f" follows at once.
    // "gh" is sent again with F: positions 6 and 7 are below 6 + 4.
    t('window', [{ window: 4, timeout: 10 }, [pk(1, 'a', 0, 'S', 'ab'), pk(2, 'a', 5, '', 'fghij'), pk(3, 'a', 2, '', 'cde'), pk(4, 'a', 6, 'F', 'gh')]], { streams: [['a', 'abcdefgh', 'done', 0]], drops: zero }),
    // Timeout 5: the repeat at 4 refreshes (4 - 0 < 5, accepted, adds nothing); at 7 the gap is 3; the bad check at 9 does not refresh;
    // at 12 the gap is 12 - 7 = 5 >= 5, so "a" times out before the packet, which is then an orphan.
    t('expiry', [{ window: 8, timeout: 5 }, [pk(0, 'a', 0, 'S', 'ab'), pk(4, 'a', 1, '', 'b'), pk(7, 'a', 2, '', 'c'), pk(9, 'a', 3, '', 'dd', true), pk(12, 'a', 3, '', 'd')]], {
      streams: [['a', 'abc', 'timeout', 0]],
      drops: { ...zero, check: 1, orphan: 1 },
    }),
    // restart (S while open), orphan (b never opened), reset keeps "xy", orphan (a is closed), a new stream for a, flags SR and FX, then F at pos 2 repeats "w" and ends the stream at 3.
    t('reset', [{ window: 8, timeout: 50 }, [
      pk(1, 'a', 10, 'S', 'xy'), pk(2, 'a', 10, 'S', 'zz'), pk(3, 'b', 0, '', 'q'), pk(4, 'a', 12, 'R', ''), pk(5, 'a', 12, '', 'z'),
      pk(6, 'a', 50, 'S', 'new'), pk(7, 'a', 53, 'SR', ''), pk(8, 'a', 53, 'FX', ''), pk(9, 'a', 52, 'F', 'w'),
    ]], {
      streams: [['a', 'xy', 'reset', 0], ['a', 'new', 'done', 0]],
      drops: { ...zero, orphan: 2, restart: 1, flags: 2 },
    }),
    // old: seq 99 is below the base 100. badend: F at pos 1 with 2 bytes ends at 3, but 4 bytes are delivered. Then F at 104 ends the stream at 6.
    t('badend', [{ window: 16, timeout: 50 }, [pk(1, 'a', 100, 'S', 'abcd'), pk(2, 'a', 99, '', 'z'), pk(3, 'a', 101, 'F', 'bc'), pk(4, 'a', 104, 'F', 'ef')]], {
      streams: [['a', 'abcdef', 'done', 0]],
      drops: { ...zero, old: 1, badend: 1 },
    }),
    // a: S+F with no payload is done at once. b: "pq" waits; the end is 6. c: the repeat "cdghij" conflicts at positions 4 and 5 (2 conflicts); positions 6 and 7 are at the end or beyond.
    // d: the second F (end 3) is ignored because the end 4 is known; the text is "abcd".
    t('end-once', [{ window: 8, timeout: 50 }, [
      pk(1, 'a', 0, 'SF', ''), pk(2, 'b', 5, 'S', 'mn'), pk(3, 'b', 9, 'F', 'pq'), pk(4, 'b', 7, '', 'xy'), pk(5, 'c', 0, 'S', 'ab'), pk(6, 'c', 4, 'F', 'ef'), pk(7, 'c', 2, '', 'cdghij'),
      pk(8, 'd', 0, 'S', 'a'), pk(9, 'd', 3, 'F', 'd'), pk(10, 'd', 1, 'F', 'bc'),
    ]], {
      streams: [['a', '', 'done', 0], ['b', 'mnxypq', 'done', 0], ['c', 'abcdef', 'done', 2], ['d', 'abcd', 'done', 0]],
      drops: zero,
    }),
    // Timeout 3: b times out at time 4 (4 - 1 = 3) while a is alive (4 - 2); the S at time 5 opens a second stream b; the stream a is done at time 4.
    t('generation', [{ window: 8, timeout: 3 }, [pk(0, 'a', 0, 'S', 'x'), pk(1, 'b', 0, 'S', 'y'), pk(2, 'a', 1, '', 'z'), pk(4, 'a', 2, 'F', 'w'), pk(5, 'b', 0, 'S', 'n'), pk(7, 'b', 1, 'F', 'm')]], {
      streams: [['a', 'xzw', 'done', 0], ['b', 'y', 'timeout', 0], ['b', 'nm', 'done', 0]],
      drops: zero,
    }),
    // Still open at the end, nothing is expired afterwards.
    t('open-at-end', [{ window: 8, timeout: 2 }, [pk(0, 'a', 0, 'S', 'ab'), pk(1, 'a', 3, '', 'd')]], { streams: [['a', 'ab', 'open', 0]], drops: zero }),
    // Timeout 3: the packet with the wrong check at time 5 is dropped, but it expires the stream a first (5 - 0 >= 3).
    t('expiry-on-drop', [{ window: 8, timeout: 3 }, [pk(0, 'a', 0, 'S', 'ab'), pk(5, 'b', 0, '', 'q', true)]], { streams: [['a', 'ab', 'timeout', 0]], drops: { ...zero, check: 1 } }),
    // The repeat at time 2 adds nothing and still refreshes the stream (4 - 2 = 2 < 3); without it 4 - 0 >= 3 would expire it. F at 3 ends the stream at 4.
    t('refresh', [{ window: 8, timeout: 3 }, [pk(0, 'a', 0, 'S', 'ab'), pk(2, 'a', 0, '', 'ab'), pk(4, 'a', 2, '', 'c'), pk(5, 'a', 3, 'F', 'd')]], { streams: [['a', 'abcd', 'done', 0]], drops: zero }),
    // "d" is stored at position 3 and 4 holds "x"; "ey" conflicts twice and changes nothing (the first byte stays); the end 4 is reached, "x" is beyond it. Text "abcd".
    t('conflict', [{ window: 8, timeout: 10 }, [pk(0, 'a', 0, 'S', 'a'), pk(1, 'a', 3, '', 'dx'), pk(2, 'a', 3, '', 'ey'), pk(3, 'a', 1, 'F', 'bcd')]], { streams: [['a', 'abcd', 'done', 2]], drops: zero }),
    t('expiry-on-drop', scenario(8101, 3, { window: 8, timeout: 9 })),
    t('check', scenario(8102, 3, { window: 6, timeout: 10 })),
    t('window', scenario(8103, 4, { window: 5, timeout: 8 })),
    t('conflict', scenario(8104, 4, { window: 10, timeout: 12 })),
    t('restart', scenario(8105, 4, { window: 7, timeout: 9 })),
    t('refresh', scenario(8106, 5, { window: 6, timeout: 7 })),
    t('flag-rules', scenario(8107, 5, { window: 9, timeout: 11 })),
    t('beyond-end', scenario(8108, 4, { window: 12, timeout: 10 })),
  ],
};
