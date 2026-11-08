export default {
  slug: "rga-text-crdt",
  tier: {
    level: 5,
    human_minutes: 180,
    basis: "Estimated from the size of the reference: an RGA sequence, a causal delivery buffer with a stated apply order, operation validation, state vectors and save/restore, about 310 lines in 4 files, from a 132-line spec. An expert reads the spec, builds the four modules and debugs the delivery order and ordering rules.",
  },
  tags: ["spec", "build"],
  task: "This project is a replicated text editor core: several sites edit one text at the same time, each on its own replica, and exchange operations. Whatever the order in which operations arrive, replicas that have applied the same operations must show the same text. The stamp helpers (src/stamp.mjs) and the public entry point (src/index.mjs) are done. The operation checks (src/ops.mjs), the sequence (src/sequence.mjs), the causal delivery buffer (src/causal.mjs) and the replica (src/replica.mjs) are stubs.\n\nBuild createReplica(site) and restoreReplica(data) as SPEC.md in the project root specifies: the RGA ordering of elements with tombstones, the operation shape and Lamport clocks, the local editing calls on code points, receive with its validation and its causal delivery rules (sequence order per site, element must exist, the stated rule for which ready operation is applied next), state vectors, merge, serialize and restore. Follow the spec to the letter, including the error types and the order in which waiting operations are applied. Large inputs must stay fast: do not rescan waiting operations again and again.\n\nRead the stamp helpers and the visible tests in test/ first. The visible tests cover only the basics; the hidden check covers every rule of the spec. Do not edit SPEC.md or the existing files in test/; put any new tests in new files. Do not install packages.",
};
