# Log-structured key-value store

`openStore(disk, options)` opens a key-value store whose data lives in append-only segment
files on a `disk`. It recovers from a crash: a torn tail, a corrupt tail, a half-finished compaction.
The disk is injected and every call is synchronous, so a test can break the files at any byte.
Every rule below is part of the contract; the file format is exact because tests write and damage
the bytes themselves.

## The disk

`disk` is any object with exactly these methods (the store uses no other):

| method | meaning |
|---|---|
| `read(name)` | the whole file as a `Uint8Array` (a `Buffer` is fine), or `undefined` if there is no such file |
| `append(name, bytes)` | add bytes at the end; create the file if it is missing |
| `write(name, bytes)` | replace the whole file (create it if missing) |
| `rename(from, to)` | move a file; an existing `to` is replaced; one atomic step |
| `remove(name)` | delete a file; no error if it is missing |
| `list()` | all file names, any order |

`src/memdisk.mjs` is an in-memory disk with these methods (finished; tests may use another one).
A disk method can throw at any moment: after it threw, the store object is not used again, and a new
store is opened on the files as they are.

## API

```js
const store = openStore(disk, { maxSegmentBytes: 4096 });
store.put('user:1', 'ann');      // returns undefined
store.get('user:1');             // 'ann'; undefined for a missing key
store.has('user:1');             // true
store.delete('user:1');          // true if the key existed (then a record is written), else false (nothing is written)
store.batch([{ op: 'put', key: 'a', value: '1' }, { op: 'delete', key: 'b' }]); // all or nothing
store.keys('user:');             // keys that start with the prefix, sorted; no argument: all keys
store.entries('user:');          // [[key, value], ...] sorted the same way
store.compact();                 // see Compaction
store.stats();                   // { keys, segments, bytes, active }
```

* Keys and values are strings. They are stored as UTF-8. Keys are sorted by UTF-16 code unit
  (the default `Array.prototype.sort()` order).
* `delete(key)` checks its key like `put` does (also when the key is missing). `put(key, value)`: a key is a non-empty string of at most 255 UTF-8 bytes, else `RangeError`; a key or value that is
  not a string is a `TypeError`. A string with a lone surrogate (it is not well formed UTF-16) is a `RangeError`, for a key or a value. A bad argument writes
  nothing and changes nothing. (Check the type first, then the surrogates, then the size.)
* `batch(ops)`: `ops` is an array with 1 to 65535 operations (else `RangeError`), each `{ op: 'put', key, value }`
  or `{ op: 'delete', key }` (any other shape or `op` is a `TypeError`; keys as above). All operations are
  checked before anything is written. The operations apply in order, so a later one sees an earlier one. A
  batch is one record in the log, with every given operation in it, also a delete of a missing key.
* `keys(prefix)` and `entries(prefix)` need a string prefix when one is given (`TypeError` otherwise).
* `options.maxSegmentBytes`: integer >= 64, default `1048576`, else `RangeError`.
* `stats()`: `keys` is the number of live keys; `segments` the number of segment files the store has; `bytes` their total
  size; `active` the number of the segment the next write goes to, after the move described in "Writing" (1 if there is no segment).
* The store keeps all data in memory. `get`, `has`, `keys`, `entries` and `stats` never call the disk. `openStore` calls
  `read` at most once for each segment file, and never reads another file.

## Files and records

Segment files are named `seg-` + six digits + `.log`, for example `seg-000007.log` (numbers 1 to 999999). A file whose
name has another form is not part of the store: the store never reads, writes or removes it (except `compact.tmp`, below).

A segment is a sequence of records. A record is

```
crc    4 bytes, big endian: CRC-32 of the body (src/crc32.mjs: the zlib/IEEE one)
length 4 bytes, big endian: number of bytes in the body
body   `length` bytes
```

The body starts with a type byte:

| type | body after the type byte |
|---|---|
| 1 put | `keyLen` (2 bytes BE), key bytes, then the value bytes (all the rest; may be empty) |
| 2 delete | `keyLen` (2 bytes BE), key bytes; nothing more |
| 3 batch | `count` (2 bytes BE, at least 1), then `count` items, each: `op` (1 byte: 1 put or 2 delete), `keyLen` (2 bytes BE), key bytes, and for a put only: `valueLen` (4 bytes BE), value bytes. The items use the body exactly. |
| 4 supersede | `through` (4 bytes BE); nothing more |

A record is **valid** if its 8 header bytes and its whole body are in the file, `length` is at most 16777216, the CRC
matches, and the body follows the table exactly (a known type; every length inside fits in the body; no byte is left over; a key is
1 to 255 bytes; keys and values are valid UTF-8; a value that starts with the bytes of U+FEFF keeps that character). A type 4 record is valid only as the first record of a segment.

## Writing

* A write (`put`, a `delete` of an existing key, `batch`) appends exactly one record with one `disk.append` call.
* Before it appends, if the size of the active segment is at least `maxSegmentBytes`, the store moves on: the active segment
  becomes the next number and its size 0. (A record is never split over two segments, and a segment may be larger than the
  limit by the size of one record.) With no segment yet, the active segment is number 1.
* A record whose body would be longer than 16777216 bytes is a `RangeError`, and nothing is written. If moving on to the next
  segment would pass number 999999, the write throws `RangeError` and writes nothing.
* The memory is changed after `append` returned, so a throwing disk leaves the store object as it was (and it is not used again anyway).

## Opening and recovery

`openStore(disk, options)` does this, in this order:

1. If `compact.tmp` exists, `remove` it.
2. Take the segment files; sort them by number. For the segment with the highest number whose first record is a valid
   type 4 record with `through = N`: `remove` every segment with a number `<= N` that is also lower than the number of that segment, lowest first. (That is a compaction that
   did not finish removing its old segments.) Only the highest such segment counts.
3. The remaining segment numbers must follow one another without a gap (the first one may be any number). If one
   is missing, throw `CorruptionError` with `reason: 'gap'` and `segment` the first missing number.
4. Read each remaining segment and apply its records in order (a type 1, 2 or 3 record changes the data; a type 4 record
   changes nothing). At the first invalid record (or at trailing bytes that do not make a record):
   * in a segment that is not the last one: throw `CorruptionError` with `reason: 'invalid'`, the `segment` number and the
     `offset` of that record in the file.
   * in the last segment: stop there and drop everything from that record on, also later records that would have been
     valid. If a byte of the segment is dropped, call `disk.write(name, bytes up to the offset)` once for that segment.
5. The active segment is the last one, with its size after step 4; with no segment it is number 1 and size 0.

`CorruptionError` (exported) has `name 'CorruptionError'`, `reason`, `segment` and, for `invalid`, `offset`. `openStore` never
changes a file apart from the steps above. Nothing is written for a store that opens clean.

## Compaction

`compact()` rewrites the live data into one new segment and removes the old ones:

1. Let `N` be the highest segment number the store has. Build the new segment: first a type 4 record with `through = N`, then one type 1
   record for each live key, in key order.
2. `disk.write('compact.tmp', bytes)`.
3. `disk.rename('compact.tmp', <segment N+1>)`.
4. `disk.remove(<segment>)` for each segment the store has, lowest number first (all of them have a number `<= N`).
5. The active segment is N+1, its size the size of the new file.

It returns `{ segmentsBefore, bytesBefore, bytesAfter }`: the number of segments and their total size before, and the size
of the new segment after. With no segment at all (nothing was ever written) `compact()` does nothing and returns zeros.
If `N` is 999999 it throws `RangeError` before any disk call.

A crash between any two of these calls must leave files that `openStore` turns back into the same data as before the compaction.

## Files in this project

* `src/crc32.mjs`, `src/errors.mjs`, `src/memdisk.mjs`: finished.
* `src/codec.mjs`: records to bytes and back.
* `src/recovery.mjs`: steps 1 to 5 of "Opening and recovery".
* `src/store.mjs`: the API and compaction. `src/index.mjs` exports `openStore`, `CorruptionError`, `MemDisk`, `crc32`.

The tests in `test/` show the shape of the API. Do not edit them.
