// Causal delivery: which received operations are ready, which wait, and in which
// order they are applied. SPEC.md section 5.
export class CausalBuffer {
  size() {
    throw new Error('not implemented: CausalBuffer.size');
  }
}
