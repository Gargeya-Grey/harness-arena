export function checkOps(ops) {
  if (!Array.isArray(ops)) throw new TypeError('ops must be an array');
}

export function copyOp(op) {
  const base = { type: op.type, site: op.site, seq: op.seq, clock: op.clock };
  return op.type === 'insert' ? { ...base, after: op.after, char: op.char } : { ...base, target: op.target };
}
