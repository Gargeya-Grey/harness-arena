# Replicated text (an RGA sequence CRDT)

Several sites edit one text at the same time, each on its own `Replica`, and send each other the
operations they produce. Whatever the order in which operations arrive, every replica that has applied
the same operations must show the same text. You build the replica: `createReplica(site)` in
`src/index.mjs`. `src/stamp.mjs` is done. `src/index.mjs` re-exports from `src/replica.mjs`. The other
modules (`ops.mjs`, `sequence.mjs`, `causal.mjs`, `replica.mjs`) are stubs; you may split or merge them.

## 1. Sites, ids and stamps

- A site name is a non-empty string of `A-Z a-z 0-9 _ -` only. `createReplica` with any other value
  throws a `TypeError`. Every such name is a site like any other, including `constructor` and `__proto__`: a
  state vector is looked up by own property, so `{}` has no entry for them.
- Every operation has `site`, `seq` (1, 2, 3 … per site, counting inserts and deletes together) and
  `clock` (a Lamport clock, section 2).
- An insert creates an element with the id `"<site>@<seq>"` (for example `"ann@4"`). A delete refers to an
  element by this id.
- The **stamp** of an element is `(clock, site)`. Stamps are compared by `clock` as numbers, then by `site`
  as strings in code unit order (`<`). `compareStamps` in `src/stamp.mjs` does it.

## 2. Operations

Operations are plain JSON objects with exactly these keys:

```
{ type: 'insert', site, seq, clock, after, char }    after: an element id, or null for "the start"
{ type: 'delete', site, seq, clock, target }         target: an element id
```

`char` is a string of exactly one code point. A text is a sequence of code points, not of UTF-16 code
units: `"a😀"` has length 2 and index 1 is the emoji.

The Lamport clock of a replica is the highest `clock` of any operation it has **applied** (its own or a
remote one); it starts at 0. Every local operation gets `clock = replica clock + 1`, and then the replica
clock is that value. Operations that are still waiting (section 5) do not count.

## 3. The sequence

The document is a sequence of elements, kept even after a delete (a deleted element is a *tombstone*; it
stays in the sequence but is not part of the text). The order of the sequence is defined like this:

> Build a tree: the root is "the start"; the parent of an inserted element is the element named by its
> `after` (the root when `after` is `null`). Walk the tree depth first, parent before children. Children of
> one parent are visited in **descending stamp order**: the element with the greater stamp comes first.

So `a` typed after the start, then `b` after `a`, then `c` after `b` reads `abc`; an element inserted later
after `a` has a greater clock than `b` and lands between `a` and `b`; and the whole subtree of a child moves
with it, which is why two people typing `abc` and `xyz` at the same spot never interleave their letters.

A tombstone keeps its place and its children: an insert whose `after` is a deleted element is valid.
Deleting an element that is already deleted changes nothing (the operation is still applied and counted).

## 4. The replica API

`createReplica(site)` returns a replica. `restoreReplica(data)` is in section 7.

| Member | Behaviour |
|---|---|
| `site` | the site name |
| `text()` | the visible text, a string |
| `length` | getter: the number of visible code points |
| `insertAt(index, text)` | inserts the code points of `text` at visible position `index` (0 to `length`). Returns the new operations, one per code point, in order. The first has `after` = the id of the visible element at `index - 1` (or `null` when `index` is 0); each next one has `after` = the id of the one before it. Empty `text` returns `[]`. |
| `deleteAt(index, count = 1)` | deletes the visible code points `index … index + count - 1`. The targets are chosen before any is deleted. Returns one delete operation per target, in increasing index order. `count` 0 returns `[]`. |
| `receive(ops)` | applies remote operations (section 5). Returns the operations that were **applied by this call**, in the order they were applied, as new objects. |
| `stateVector()` | `{ [site]: highest seq applied for that site }`, only for sites with an applied operation |
| `opsSince(vector = {})` | every applied operation with `seq` greater than `vector[site]` (0 when absent), in the order this replica applied them, as new objects |
| `merge(other)` | `receive(other.opsSince(this.stateVector()))`; returns what `receive` returns. `other` that is not a replica throws a `TypeError` |
| `pendingCount()` | the number of operations waiting |
| `elements()` | `[{ id, char, deleted }]` for every element, tombstones included, in sequence order |
| `tombstoneCount()` | the number of deleted elements |
| `serialize()` | a JSON-safe object (section 7) |

Errors: `insertAt` with an index that is not an integer from 0 to `length`, or `deleteAt` with an index and
count that are not integers with `0 <= index` and `index + count <= length` and `count >= 0`, throws a
`RangeError`. `insertAt` with a text that is not a string throws a `TypeError`. Nothing changes when a call
throws.

Objects that go in or out are never shared: changing an operation returned by the replica, or one you
passed to `receive`, must not change the replica.

## 5. Receiving operations: causal delivery

`receive(ops)` takes an array (a `TypeError` otherwise). It first checks every operation; if any is
invalid it throws a `TypeError` and applies nothing. An operation is valid when: it is a plain object (its prototype is `Object.prototype` or `null`);
`type` is `'insert'` or `'delete'`; `site` is a valid site name; `seq` and `clock` are integers of at least
1; an insert has `after` null or a valid element id (`<site>@<positive integer>`) and a `char` of exactly one
code point; a delete has `target` that is a valid element id. Other keys are ignored and not kept.

A valid operation is **ready** when both hold:
1. its `seq` is exactly one more than the highest `seq` applied for its `site` (so each site's operations
   are applied in order, with no gap); and
2. the element it names (`after` when it is not null, or `target`) exists in the sequence (as a visible
   element or a tombstone).

- An operation whose `seq` is at most the highest applied for its site is a duplicate: ignored.
- An operation that is not ready waits. A second copy of a waiting operation (same `site` and `seq`) is
  ignored.
- Ready operations are applied. Applying one can make waiting operations ready. The rule that picks the
  next one is: **among all ready operations, apply the one that was received first** (operations in one
  `receive` call count in array order, earlier calls count before later ones). Repeat until no operation is
  ready. An operation that never becomes ready (for example its `after` never arrives) stays waiting.

To apply an insert: add the element to the sequence by section 3. To apply a delete: mark the element as
deleted. Then record the operation in the log, update the highest `seq` for its site, and update the clock.

## 6. Convergence checks

Two replicas that applied the same set of operations have the same `elements()` and so the same text, in
whatever order the operations arrived, and however they were split into `receive` calls. After
`a.merge(b)` and `b.merge(a)` both show the same text.

## 7. Saving and restoring

`serialize()` returns `{ site, ops, pending }`: `ops` is `opsSince({})`, `pending` is the waiting operations
in the order they were received; both are arrays of new objects, and the result survives
`JSON.parse(JSON.stringify(x))`. `restoreReplica(data)` builds a replica of site `data.site`, receives
`data.ops` and then `data.pending` (so it is equal to the saved replica: same text, same elements, same state
vector, same waiting operations, same clock). A `data` that is not an object with a valid `site` and arrays
`ops` and `pending` throws a `TypeError`.

## 8. Limits

A replica must handle 10 000 local inserts, 3 000 inserts in the middle of the text and a delivery of 5 000
operations one by one in reverse order (the last one frees all the others), each in well under a second.
Waiting operations must not be rescanned over and over.

## Files

- `src/stamp.mjs`: done.
- `src/index.mjs`: done (re-exports).
- `src/ops.mjs`, `src/sequence.mjs`, `src/causal.mjs`, `src/replica.mjs`: yours.
- `test/`: the visible tests. Add new test files; do not edit the existing ones.
