export default {
  slug: 'log-kv-store',
  tier: {
    level: 5,
    human_minutes: 270,
    basis: 'Reference is about 330 lines in 3 modules (record codec, recovery, store with compaction); an experienced engineer needs about 4.5 h to build the byte format, the recovery rules and the crash-safe compaction, and to test torn and corrupt files.',
  },
  tags: ['build', 'spec'],
  task: 'Build the log-structured key-value store that SPEC.md describes. openStore(disk, options) works on an injected synchronous disk: it writes append-only segment files in an exact byte format, recovers from torn tails, corrupt records, a half-finished compaction and missing segments, and compacts without losing data at any crash point. The stubs in src/codec.mjs, src/recovery.mjs and src/store.mjs throw "not implemented"; src/crc32.mjs, src/errors.mjs and src/memdisk.mjs are finished. Damage that cannot be repaired raises CorruptionError, and segment files are named like seg-000001.log and seg-000007.log. The hidden check writes and damages the segment bytes itself, so the format, the order of disk calls and the error rules in SPEC.md must be followed exactly. The files in test/ must pass and must not be edited.',
};
