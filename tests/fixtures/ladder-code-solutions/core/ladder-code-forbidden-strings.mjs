function countAvoiding(k, patterns, n) {
  const MOD = 1000000007;
  const letters = 'abcd'.slice(0, k);
  const used = patterns.filter((p) => [...p].every((c) => letters.includes(c)));
  if (used.includes('')) return '0';

  // Aho-Corasick automaton: a state is bad when a pattern ends at it or at a state on its failure chain.
  const go = [new Array(k).fill(-1)];
  const bad = [false];
  for (const p of used) {
    let s = 0;
    for (const c of p) {
      const i = letters.indexOf(c);
      if (go[s][i] === -1) {
        go.push(new Array(k).fill(-1));
        bad.push(false);
        go[s][i] = go.length - 1;
      }
      s = go[s][i];
    }
    bad[s] = true;
  }
  const fail = new Array(go.length).fill(0);
  const queue = [];
  for (let i = 0; i < k; i += 1) {
    if (go[0][i] === -1) go[0][i] = 0;
    else queue.push(go[0][i]);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const s = queue[head];
    if (bad[fail[s]]) bad[s] = true;
    for (let i = 0; i < k; i += 1) {
      const t = go[s][i];
      if (t === -1) go[s][i] = go[fail[s]][i];
      else {
        fail[t] = go[fail[s]][i];
        queue.push(t);
      }
    }
  }

  const S = go.length;
  let matrix = new Float64Array(S * S);
  for (let s = 0; s < S; s += 1) {
    if (bad[s]) continue;
    for (let i = 0; i < k; i += 1) if (!bad[go[s][i]]) matrix[s * S + go[s][i]] += 1;
  }
  const mulmod = (x, y) => (((x * (y >>> 15)) % MOD) * 32768 + x * (y & 32767)) % MOD;
  const square = (m) => {
    const out = new Float64Array(S * S);
    for (let i = 0; i < S; i += 1) {
      for (let t = 0; t < S; t += 1) {
        const x = m[i * S + t];
        if (x === 0) continue;
        for (let j = 0; j < S; j += 1) out[i * S + j] += mulmod(x, m[t * S + j]);
      }
      for (let j = 0; j < S; j += 1) out[i * S + j] %= MOD;
    }
    return out;
  };
  let vector = new Float64Array(S);
  vector[0] = 1;
  let e = BigInt(n);
  while (e > 0n) {
    if (e & 1n) {
      const next = new Float64Array(S);
      for (let t = 0; t < S; t += 1) {
        if (vector[t] === 0) continue;
        for (let j = 0; j < S; j += 1) next[j] += mulmod(vector[t], matrix[t * S + j]);
      }
      for (let j = 0; j < S; j += 1) next[j] %= MOD;
      vector = next;
    }
    e >>= 1n;
    if (e > 0n) matrix = square(matrix);
  }
  let total = 0;
  for (let s = 0; s < S; s += 1) total = (total + vector[s]) % MOD;
  return String(total);
}
