// Hidden probes for ladder-agent-diff-patch; expected.json holds the answers.
const lib = async (load) => load('src/index.mjs');
// Speed verdicts use the CPU time of this process (user + system, ms), never the wall clock:
// a busy machine slows the clock but not the CPU time that the code itself needs.
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};

const MARK = { equal: '=', delete: '-', insert: '+' };
const show = (ops) => ops.map((op) => `${MARK[op.type]}${op.line}`).join('|');
const ls = (...names) => names;
const body = (...lines) => lines.map((line) => `${line}\n`).join('');

// A small deterministic generator, so the probes need no data files.
function rng(seed) {
  let state = seed >>> 0;
  return (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) % n;
  };
}

function lcsLength(a, b) {
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const up = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(row[j], row[j - 1]);
      diag = up;
    }
  }
  return row[b.length];
}

function randomPair(next, alphabet, maxLen) {
  const a = Array.from({ length: next(maxLen + 1) }, () => `l${next(alphabet)}`);
  const b = a.filter(() => next(4) !== 0);
  for (let i = next(4); i > 0; i -= 1) b.splice(next(b.length + 1), 0, `l${next(alphabet)}`);
  if (next(5) === 0) b.reverse();
  return [a, b];
}

function randomText(next, maxLines, endsWithNewline) {
  const lines = Array.from({ length: 1 + next(maxLines) }, () => `row ${next(9)}`);
  return lines.join('\n') + (endsWithNewline ? '\n' : '');
}

async function attempt(fn) {
  try {
    return await fn();
  } catch (error) {
    return `!${error.code ?? error.name}`;
  }
}

const timed = async (fn, limit = 3000) => {
  const t0 = cpuMs();
  const value = await fn();
  return { value, fast: cpuMs() - t0 < limit };
};

const compact = (patch) => JSON.parse(JSON.stringify(patch));
const summary = (result) => (result.ok ? { text: result.text, hunks: result.hunks } : result);

const probes = [
  {
    name: 'keeps the exports and the line helpers',
    run: async ({ load }) => {
      const m = await lib(load);
      return {
        names: Object.keys(m).sort(),
        split: m.splitLines('a\nb\n\nc'),
        join: m.joinLines(['a\n', 'b']),
        empty: m.splitLines(''),
        codes: m.PATCH_CODES,
        isError: new m.PatchError('bad-header') instanceof Error,
      };
    },
  },
  {
    name: 'a small edit script, line by line',
    run: async ({ load }) => {
      const { diffLines } = await lib(load);
      const cases = [
        [[], []],
        [[], ls('a', 'b')],
        [ls('a', 'b'), []],
        [ls('a', 'b'), ls('a', 'b')],
        [ls('a', 'b', 'c'), ls('a', 'c')],
        [ls('a', 'c'), ls('a', 'b', 'c')],
        [ls('a', 'b', 'c'), ls('a', 'X', 'c')],
        [ls('x'), ls('y')],
        [ls('x', 'y'), ls('y', 'x')],
        [ls('a', 'b'), ls('b', 'a')],
        [ls('a', 'a', 'a'), ls('a', 'a')],
        [ls('a', 'a'), ls('a', 'a', 'a')],
        [ls('a', 'b', 'a'), ls('b', 'a', 'b')],
        [ls('p', 'q'), ls('r', 's')],
        [ls('A', 'B', 'C', 'A', 'B', 'B', 'A'), ls('C', 'B', 'A', 'B', 'A', 'C')],
        [ls('a', 'b', 'c', 'd', 'e', 'f'), ls('x', 'b', 'c', 'y', 'e', 'z')],
        [ls('k', 'l', 'm', 'n'), ls('n', 'm', 'l', 'k')],
        [ls('a', 'b', 'a', 'b', 'a'), ls('b', 'a', 'b')],
      ];
      return cases.map(([a, b]) => show(diffLines(a, b)));
    },
  },
  {
    name: 'a change run lists deletes before inserts',
    run: async ({ load }) => {
      const { diffLines } = await lib(load);
      const cases = [
        [ls('a', 'p', 'q', 'z'), ls('a', 'r', 's', 'z')],
        [ls('p', 'q', 'r'), ls('s', 'q', 't')],
        [ls('1', '2', '3', '4'), ls('3', '4', '1', '2')],
        [ls('x', 'a', 'y', 'b', 'z'), ls('a', 'q', 'b', 'w')],
        [ls('m', 'n', 'o'), ls('o', 'n', 'm')],
      ];
      return cases.map(([a, b]) => {
        const ops = diffLines(a, b);
        let ordered = true;
        for (let i = 1; i < ops.length; i += 1) if (ops[i - 1].type === 'insert' && ops[i].type === 'delete') ordered = false;
        return [show(ops), ordered];
      });
    },
  },
  {
    name: 'every script rebuilds both lists with the fewest edits',
    run: async ({ load }) => {
      const { diffLines } = await lib(load);
      const next = rng(7);
      let valid = 0;
      let minimal = 0;
      let ordered = 0;
      const total = 150;
      for (let n = 0; n < total; n += 1) {
        const [a, b] = randomPair(next, n % 3 === 0 ? 2 : n % 3 === 1 ? 4 : 9, 14);
        const ops = diffLines(a, b);
        const left = ops.filter((op) => op.type !== 'insert').map((op) => op.line);
        const right = ops.filter((op) => op.type !== 'delete').map((op) => op.line);
        if (JSON.stringify(left) === JSON.stringify(a) && JSON.stringify(right) === JSON.stringify(b)) valid += 1;
        if (ops.filter((op) => op.type !== 'equal').length === a.length + b.length - 2 * lcsLength(a, b)) minimal += 1;
        let ok = true;
        for (let i = 1; i < ops.length; i += 1) if (ops[i - 1].type === 'insert' && ops[i].type === 'delete') ok = false;
        if (ok) ordered += 1;
      }
      return { total, valid, minimal, ordered };
    },
  },
  {
    name: 'random scripts follow the tie rule exactly',
    run: async ({ load }) => {
      const { diffLines } = await lib(load);
      const next = rng(99);
      const out = [];
      for (let n = 0; n < 25; n += 1) {
        const [a, b] = randomPair(next, n % 2 === 0 ? 3 : 5, 9);
        out.push(show(diffLines(a, b)));
      }
      return out;
    },
  },
  {
    name: 'long lists with a few edits are fast',
    run: async ({ load }) => {
      const { diffLines } = await lib(load);
      return timed(async () => {
        const a = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
        const b = [];
        for (let i = 0; i < a.length; i += 1) {
          if (i % 97 === 5) continue;
          b.push(a[i]);
          if (i % 131 === 7) b.push(`added ${i}`);
          if (i % 211 === 9) b[b.length - 1] = `changed ${i}`;
        }
        const ops = diffLines(a, b);
        const counts = { equal: 0, delete: 0, insert: 0 };
        for (const op of ops) counts[op.type] += 1;
        const none = diffLines(a, a.slice());
        const wide = diffLines(Array.from({ length: 1000 }, (_, i) => `a${i}`), Array.from({ length: 1000 }, (_, i) => `b${i}`));
        return { counts, same: none.length, sameTypes: none.every((op) => op.type === 'equal'), wide: wide.length, first: show(ops.slice(0, 8)) };
      });
    },
  },
  {
    name: 'the header of a unified diff and a single change',
    run: async ({ load }) => {
      const { unifiedDiff } = await lib(load);
      return [
        unifiedDiff('1\n2\n3\n', '1\n2\nthree\n'),
        unifiedDiff('1\n2\n3\n', '1\n2\nthree\n', { oldName: 'a/file.txt', newName: 'b/file.txt' }),
        unifiedDiff('x\n', 'y\n', { oldName: 'old name with spaces', newName: '' }),
        unifiedDiff('same\ntext\n', 'same\ntext\n'),
        unifiedDiff('', ''),
        unifiedDiff('no end', 'no end'),
        unifiedDiff('k\n', 'k\nm\n'),
      ];
    },
  },
  {
    name: 'hunk numbering at the top, the end and the empty file',
    run: async ({ load }) => {
      const { unifiedDiff } = await lib(load);
      return [
        unifiedDiff('', 'n\no\np\n'),
        unifiedDiff('n\no\np\n', ''),
        unifiedDiff('', 'single\n'),
        unifiedDiff('single\n', ''),
        unifiedDiff('b\nc\n', 'a\nb\nc\n', { context: 0 }),
        unifiedDiff('a\nb\n', 'a\nb\nc\nd\n', { context: 0 }),
        unifiedDiff('a\nb\nc\nd\n', 'a\nd\n', { context: 0 }),
        unifiedDiff('a\nb\nc\nd\n', 'b\nc\n', { context: 0 }),
        unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', { context: 0 }),
        unifiedDiff('a\nb\nc\n', 'x\ny\n', { context: 0 }),
        unifiedDiff('only\n', 'ONLY\n'),
      ];
    },
  },
  {
    name: 'context size and when hunks merge',
    run: async ({ load }) => {
      const { unifiedDiff } = await lib(load);
      const a = body('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12');
      const change = (...at) => body(...['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map((s, i) => (at.includes(i + 1) ? `${s}!` : s)));
      return [
        unifiedDiff(a, change(6)),
        unifiedDiff(a, change(6), { context: 1 }),
        unifiedDiff(a, change(6), { context: 0 }),
        unifiedDiff(a, change(6), { context: 20 }),
        unifiedDiff(a, change(2, 11), { context: 1 }),
        unifiedDiff(a, change(2, 5), { context: 1 }),
        unifiedDiff(a, change(2, 6), { context: 1 }),
        unifiedDiff(a, change(2, 6), { context: 2 }),
        unifiedDiff(a, change(2, 7), { context: 2 }),
        unifiedDiff(a, change(1, 12), { context: 3 }),
        unifiedDiff(a, change(1, 5, 9, 12), { context: 1 }),
        unifiedDiff(a, change(3, 4), { context: 0 }),
        unifiedDiff(a, change(3, 5), { context: 0 }),
      ];
    },
  },
  {
    name: 'a missing final newline is marked and compared',
    run: async ({ load }) => {
      const { unifiedDiff } = await lib(load);
      return [
        unifiedDiff('p\nq', 'p\nq\n'),
        unifiedDiff('p\nq\n', 'p\nq'),
        unifiedDiff('p\nq', 'p\nq'),
        unifiedDiff('p\nq', 'p\nr'),
        unifiedDiff('p\nq', 'x\nq'),
        unifiedDiff('p\nq', 'p\nq\nr'),
        unifiedDiff('p\nq\nr', 'p\nq'),
        unifiedDiff('', 'z'),
        unifiedDiff('z', ''),
        unifiedDiff('z', 'z\n'),
        unifiedDiff('a\nb\nc', 'a\nB\nc', { context: 1 }),
      ];
    },
  },
  {
    name: 'odd line content passes through unchanged',
    run: async ({ load }) => {
      const { unifiedDiff } = await lib(load);
      return [
        unifiedDiff('a\n\nb\n', 'a\n\nB\n'),
        unifiedDiff('a\r\nb\r\n', 'a\r\nc\r\n'),
        unifiedDiff('--- x\n+++ y\n@@ -1 +1 @@\n', '--- x\n+++ z\n@@ -1 +1 @@\n'),
        unifiedDiff('\\ No newline at end of file\n', 'x\n'),
        unifiedDiff('éè\n😀\n', 'éè\n😁\n'),
        unifiedDiff('\n', '\n\n'),
        unifiedDiff('\n\n', '\n'),
        unifiedDiff(' lead\n', '\tlead\n'),
        unifiedDiff('tab\there\n', 'tab\tthere\n'),
      ];
    },
  },
  {
    name: 'unifiedDiff checks its arguments',
    run: async ({ load }) => {
      const { unifiedDiff } = await lib(load);
      return [
        await attempt(() => unifiedDiff(5, 'a')),
        await attempt(() => unifiedDiff('a', null)),
        await attempt(() => unifiedDiff('a', undefined)),
        await attempt(() => unifiedDiff('a\n', 'b\n', { context: -1 })),
        await attempt(() => unifiedDiff('a\n', 'b\n', { context: 1.5 })),
        await attempt(() => unifiedDiff('a\n', 'b\n', { context: '3' })),
        await attempt(() => unifiedDiff('a\n', 'b\n', { context: NaN })),
        await attempt(() => unifiedDiff('a\n', 'a\n', { context: -1 })),
        await attempt(() => unifiedDiff('a\n', 'b\n', { context: 0 }).length),
        await attempt(() => unifiedDiff('a\n', 'b\n', {}).length),
        await attempt(() => unifiedDiff('a\n', 'b\n').length),
        await attempt(() => unifiedDiff('a\n', 'b\n', { oldName: 'x' }).split('\n').slice(0, 2)),
      ];
    },
  },
  {
    name: 'a large diff has the right hunks and is fast',
    run: async ({ load }) => {
      const { unifiedDiff } = await lib(load);
      return timed(async () => {
        const lines = Array.from({ length: 20000 }, (_, i) => `value ${i}`);
        const edited = lines.slice();
        for (let i = 100; i < 20000; i += 500) edited[i] = `edited ${i}`;
        edited.splice(10000, 3);
        edited.push('tail');
        const text = unifiedDiff(body(...lines), body(...edited), { context: 2 });
        const heads = text.split('\n').filter((line) => line.startsWith('@@'));
        return { size: text.length, hunks: heads.length, firstHeads: heads.slice(0, 3), lastHead: heads.at(-1), lines: text.split('\n').length };
      });
    },
  },
  {
    name: 'parsePatch reads a generated patch',
    run: async ({ load }) => {
      const { parsePatch, unifiedDiff } = await lib(load);
      return [
        compact(parsePatch(unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', { oldName: 'one', newName: 'two' }))),
        compact(parsePatch(unifiedDiff('p\nq', 'p\nq\n'))),
        compact(parsePatch(unifiedDiff('', 'new\n'))),
        compact(parsePatch(unifiedDiff('gone\n', ''))),
        compact(parsePatch(unifiedDiff(body('1', '2', '3', '4', '5', '6', '7', '8', '9', '10'), body('1', 'x', '3', '4', '5', '6', '7', '8', 'y', '10'), { context: 1 }))),
        compact(parsePatch(unifiedDiff('same\n', 'same\n'))),
      ];
    },
  },
  {
    name: 'parsePatch reads patches written by hand',
    run: async ({ load }) => {
      const { parsePatch } = await lib(load);
      const cases = [
        '',
        'nothing to see\n',
        '--- a\n+++ b\n',
        '--- a\n+++ b',
        'diff --git a/x b/x\nindex 12..34 100644\n--- a/x\t2024-01-01 10:00:00\n+++ b/x\t2024-01-02 10:00:00 +0000\n@@ -1 +1 @@ func name\n-old\n+new\n',
        '--- a\n+++ b\n@@ -1,2 +1,2 @@\n keep\n-gone\n\\ No newline at end of file\n+here\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n-x\n\\ anything at all\n+y\n\\ No newline at end of file\n',
        '--- a\n+++ b\n@@ -0,0 +1,2 @@\n+one\n+two\n',
        '--- a\n+++ b\n@@ -01 +001 @@\n-a\n+b\n',
        '--- file with spaces\n+++ other name\n@@ -1 +1 @@\n x\n',
        '--- a\n+++ b\n@@ -1,0 +0,0 @@\n@@ -5 +5 @@\n z\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n x\n@@ -3 +3 @@\n y\n',
        '--- a\n+++ b\n@@ -1 +1 @@ \n x\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n x',
        '--- a\n+++ b\n@@ -1 +1 @@\n x\n\\ No newline at end of file',
        '--- first\n+++ second\n@@ -1 +1 @@\n--- not a header\n',
      ];
      const out = [];
      for (const text of cases) out.push(await attempt(() => compact(parsePatch(text))));
      return out;
    },
  },
  {
    name: 'parsePatch refuses broken patches with the right code',
    run: async ({ load }) => {
      const { parsePatch } = await lib(load);
      const cases = [
        '--- a\n',
        '--- a',
        '--- a\nfoo\n',
        '--- a\n--- b\n',
        '+++ b\n--- a\n',
        '--- a\n+++ b\nxx\n',
        '--- a\n+++ b\n\n',
        '--- a\n+++ b\n@@ -1 +1\n',
        '--- a\n+++ b\n@@ -1,x +1 @@\n',
        '--- a\n+++ b\n@@ -1 +1 @@x\n',
        '--- a\n+++ b\n@@ -a +1 @@\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n',
        '--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\n',
        '--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\n@@ -5 +5 @@\n z\n',
        '--- a\n+++ b\n@@ -1,1 +1,2 @@\n a\n-x\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n-a\n-b\n+c\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n a\n b\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n a\n+b\n',
        '--- a\n+++ b\n@@ -1 +1 @@\nxfoo\n',
        '--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\n\n',
        '--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\nb\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n\\ No newline at end of file\n a\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n a\n\\ one\n\\ two\n',
        '--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\n\\ one\n\\ two\n b\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n--- c\n+++ d\n@@ -1 +1 @@\n-a\n+b\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n-- \n2.30.0\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n x\n\n',
        '--- a\n+++ b\n@@ -1 +1 @@\n x\n@@ nonsense\n',
      ];
      const out = [];
      for (const text of cases) out.push(await attempt(() => compact(parsePatch(text)).hunks.length));
      return out;
    },
  },
  {
    name: 'parsePatch checks its argument',
    run: async ({ load }) => {
      const { parsePatch } = await lib(load);
      const out = [];
      for (const value of [5, null, undefined, ['--- a'], { hunks: [] }]) out.push(await attempt(() => parsePatch(value)));
      return out;
    },
  },
  {
    name: 'applying a generated patch rebuilds the new text',
    run: async ({ load }) => {
      const { unifiedDiff, applyPatch } = await lib(load);
      const next = rng(31);
      let forward = 0;
      let backward = 0;
      let metadata = 0;
      const total = 120;
      for (let n = 0; n < total; n += 1) {
        const a = randomText(next, 12, next(4) !== 0);
        const b = next(5) === 0 ? randomText(next, 12, next(2) === 0) : a.split('\n').filter(() => next(5) !== 0).join('\n') + (next(2) === 0 ? '\n' : '');
        const context = next(4);
        const patch = unifiedDiff(a, b, { context });
        const fwd = applyPatch(a, patch);
        if (fwd.ok && fwd.text === b) forward += 1;
        const back = applyPatch(b, patch, { reverse: true });
        if (back.ok && back.text === a) backward += 1;
        if (fwd.ok && fwd.hunks.every((h) => h.offset === 0 && h.fuzz === 0)) metadata += 1;
      }
      return { total, forward, backward, metadata };
    },
  },
  {
    name: 'a hunk is found where it moved to',
    run: async ({ load }) => {
      const { unifiedDiff, applyPatch } = await lib(load);
      const original = body('a', 'b', 'c', 'd', 'e', 'f', 'g');
      const patch = unifiedDiff(original, body('a', 'b', 'c', 'D', 'e', 'f', 'g'), { context: 1 });
      return [
        summary(applyPatch(original, patch)),
        summary(applyPatch(body('n1', 'n2') + original, patch)),
        summary(applyPatch(body('n1') + original, patch)),
        summary(applyPatch(body('n1', 'n2', 'n3', 'n4', 'n5', 'n6') + original, patch)),
        summary(applyPatch(body('a', 'b', 'c', 'd', 'e'), patch)),
        summary(applyPatch(body('c', 'd', 'e'), patch)),
        summary(applyPatch(body('x', 'c', 'd', 'e'), patch)),
        summary(applyPatch(body('b', 'c', 'x', 'd'), patch)),
      ];
    },
  },
  {
    name: 'the nearest place wins and the later place wins a tie',
    run: async ({ load }) => {
      const { applyPatch, parsePatch } = await lib(load);
      const patch = parsePatch('--- a\n+++ b\n@@ -5,3 +5,3 @@\n k\n-t\n+T\n k2\n');
      const file = (marks) => {
        const lines = Array.from({ length: 12 }, (_, i) => `f${i}`);
        for (const at of marks) lines.splice(at, 3, 'k', 't', 'k2');
        return body(...lines);
      };
      const here = (text) => {
        const r = applyPatch(text, patch);
        return r.ok ? [r.hunks[0].start, r.hunks[0].offset] : r;
      };
      return [
        here(file([3])),
        here(file([5])),
        here(file([6])),
        here(file([2, 8])),
        here(file([1, 7])),
        here(file([0, 9])),
        here(file([3, 8])),
        here(file([2, 6])),
      ];
    },
  },
  {
    name: 'a learned shift moves the next hunk and hunks cannot overlap',
    run: async ({ load }) => {
      const { unifiedDiff, applyPatch, parsePatch } = await lib(load);
      const lines = Array.from({ length: 30 }, (_, i) => `r${i % 5}`);
      const old = body(...lines);
      const edited = lines.slice();
      edited[3] = 'X3';
      edited[18] = 'X18';
      const patch = unifiedDiff(old, body(...edited), { context: 1 });
      const shifted = body('new1', 'new2', 'new3', ...lines);
      const twice = body('x', 'x', ...lines.slice(0, 10), 'ins', ...lines.slice(10));
      const same = body('d', 'd', 'd', 'e', 'e', 'e');
      const dup = unifiedDiff(same, body('d', 'd', 'd', 'e', 'E', 'e'), { context: 1 });
      const twin = parsePatch('--- a\n+++ b\n@@ -2,3 +2,3 @@\n k\n-t\n+T\n k2\n@@ -8,3 +8,3 @@\n k\n-t\n+T\n k2\n');
      return [
        summary(applyPatch(shifted, patch)),
        summary(applyPatch(twice, patch)),
        summary(applyPatch(old, patch)),
        summary(applyPatch(body('d', 'd', 'e', 'E', 'e', 'e'), dup)),
        applyPatch(body('q', 'e', 'e', 'e'), dup),
        summary(applyPatch(body('d', 'd', 'd', 'e', 'e', 'e', 'e', 'e'), dup)),
        applyPatch(body('f', 'k', 't', 'k2', 'g', 'g', 'g'), twin),
        summary(applyPatch(body('f', 'k', 't', 'k2', 'g', 'k', 't', 'k2'), twin)),
        summary(applyPatch(body('k', 't', 'k2', 'k', 't', 'k2'), twin)),
      ];
    },
  },
  {
    name: 'a patch that does not fit changes nothing and names the hunk',
    run: async ({ load }) => {
      const { unifiedDiff, applyPatch } = await lib(load);
      const old = body('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j');
      const patch = unifiedDiff(old, body('a', 'B', 'c', 'd', 'e', 'f', 'g', 'h', 'I', 'j'), { context: 1 });
      return [
        applyPatch(old, patch),
        applyPatch(body('a', 'x', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'), patch),
        applyPatch(body('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'x', 'j'), patch).hunk,
        applyPatch('', patch),
        applyPatch(body('a', 'b'), patch),
        applyPatch(body('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'), patch),
        applyPatch(body('b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'), patch),
      ].map((value) => (value.ok ? value.hunks.length : value));
    },
  },
  {
    name: 'insert-only hunks are placed after the stated line',
    run: async ({ load }) => {
      const { unifiedDiff, applyPatch } = await lib(load);
      const old = body('a', 'b', 'c', 'd');
      const top = unifiedDiff(old, body('new', 'a', 'b', 'c', 'd'), { context: 0 });
      const middle = unifiedDiff(old, body('a', 'b', 'new', 'c', 'd'), { context: 0 });
      const end = unifiedDiff(old, body('a', 'b', 'c', 'd', 'new'), { context: 0 });
      const emptyFile = unifiedDiff('', body('x', 'y'));
      return [
        summary(applyPatch(old, top)),
        summary(applyPatch(old, middle)),
        summary(applyPatch(old, end)),
        summary(applyPatch('', emptyFile)),
        summary(applyPatch(body('z'), emptyFile)),
        summary(applyPatch(body('a', 'b'), middle)),
        summary(applyPatch(body('a'), middle)),
        summary(applyPatch('', middle)),
        summary(applyPatch(old, end, { reverse: true })),
        summary(applyPatch(body('a', 'b', 'new', 'c', 'd'), middle, { reverse: true })),
        summary(applyPatch(body('p', 'q', 'a', 'b', 'new', 'c', 'd'), middle, { reverse: true })),
      ];
    },
  },
  {
    name: 'fuzz skips context lines at the edges of a hunk',
    run: async ({ load }) => {
      const { unifiedDiff, applyPatch } = await lib(load);
      const old = body('c1', 'c2', 'c3', 'old', 'd1', 'd2', 'd3');
      const patch = unifiedDiff(old, body('c1', 'c2', 'c3', 'new', 'd1', 'd2', 'd3'));
      const variants = [
        body('c1', 'c2', 'c3', 'old', 'd1', 'd2', 'd3'),
        body('X1', 'c2', 'c3', 'old', 'd1', 'd2', 'd3'),
        body('c1', 'c2', 'c3', 'old', 'd1', 'd2', 'X3'),
        body('X1', 'c2', 'c3', 'old', 'd1', 'd2', 'X3'),
        body('X1', 'X2', 'c3', 'old', 'd1', 'd2', 'd3'),
        body('X1', 'X2', 'X3', 'old', 'd1', 'd2', 'd3'),
        body('c1', 'X2', 'c3', 'old', 'd1', 'd2', 'd3'),
        body('c1', 'c2', 'c3', 'old', 'X1', 'X2', 'X3'),
        body('c1', 'c2', 'c3', 'old', 'd1', 'X2', 'd3'),
      ];
      const out = [];
      for (const text of variants) {
        const row = [];
        for (const fuzz of [0, 1, 2, 3, 4]) {
          const r = applyPatch(text, patch, { fuzz });
          row.push(r.ok ? `${r.hunks[0].fuzz}:${r.text.split('\n').join(',')}` : 'fail');
        }
        out.push(row);
      }
      return out;
    },
  },
  {
    name: 'exact places are tried at every shift before any fuzz',
    run: async ({ load }) => {
      const { applyPatch, parsePatch } = await lib(load);
      const patch = parsePatch('--- a\n+++ b\n@@ -3,3 +3,3 @@\n k\n-t\n+T\n k2\n');
      const fuzzedHere = body('f0', 'f1', 'k', 't', 'Z', 'f5', 'f6', 'k', 't', 'k2');
      const other = body('f0', 'f1', 'X', 't', 'k2', 'f5', 'f6', 'k', 't', 'k2');
      const onlyFuzz = body('f0', 'f1', 'X', 't', 'k2', 'f5');
      const show2 = (r) => (r.ok ? [r.hunks[0].start, r.hunks[0].offset, r.hunks[0].fuzz, r.text.split('\n').join(',')] : r);
      return [
        show2(applyPatch(fuzzedHere, patch, { fuzz: 1 })),
        show2(applyPatch(other, patch, { fuzz: 1 })),
        show2(applyPatch(other, patch, { fuzz: 0 })),
        show2(applyPatch(onlyFuzz, patch, { fuzz: 1 })),
        show2(applyPatch(onlyFuzz, patch, { fuzz: 0 })),
        show2(applyPatch(body('f0', 'f1', 'k', 'x', 'k2'), patch, { fuzz: 1 })),
        show2(applyPatch(body('f0', 'f1', 'k', 'x', 'k2'), patch, { fuzz: 5 })),
      ];
    },
  },
  {
    name: 'fuzz with more context than the hunk has',
    run: async ({ load }) => {
      const { applyPatch, parsePatch } = await lib(load);
      const lead2 = parsePatch('--- a\n+++ b\n@@ -2,3 +2,3 @@\n u\n v\n-t\n+T\n');
      const trail1 = parsePatch('--- a\n+++ b\n@@ -2,2 +2,2 @@\n-t\n+T\n w\n');
      const none = parsePatch('--- a\n+++ b\n@@ -2 +2 @@\n-t\n+T\n');
      const onlyContext = parsePatch('--- a\n+++ b\n@@ -2,2 +2,2 @@\n u\n v\n');
      const cases = [
        [lead2, body('f', 'X', 'v', 't', 'g')],
        [lead2, body('f', 'X', 'Y', 't', 'g')],
        [lead2, body('f', 'X', 'Y', 'Z', 'g')],
        [trail1, body('f', 't', 'X', 'g')],
        [trail1, body('f', 'X', 'w', 'g')],
        [none, body('f', 't', 'g')],
        [none, body('f', 'x', 'g')],
        [onlyContext, body('f', 'X', 'v', 'g')],
        [onlyContext, body('f', 'X', 'Y', 'g')],
      ];
      return cases.map(([patch, text]) => [0, 1, 2, 3].map((fuzz) => {
        const r = applyPatch(text, patch, { fuzz });
        return r.ok ? `${r.hunks[0].fuzz}@${r.hunks[0].start}:${r.text.split('\n').join(',')}` : 'fail';
      }));
    },
  },
  {
    name: 'a missing final newline must match on both sides',
    run: async ({ load }) => {
      const { unifiedDiff, applyPatch } = await lib(load);
      const p1 = unifiedDiff('x\ny', 'x\nz');
      const p2 = unifiedDiff('x\ny', 'x\ny\n');
      const p3 = unifiedDiff('x\ny\n', 'x\ny');
      const p4 = unifiedDiff('a\nb', 'A\nb', { context: 1 });
      return [
        summary(applyPatch('x\ny', p1)),
        summary(applyPatch('x\ny\n', p1)),
        summary(applyPatch('x\ny', p2)),
        summary(applyPatch('x\ny\n', p2)),
        summary(applyPatch('x\ny\n', p3)),
        summary(applyPatch('x\ny', p3)),
        summary(applyPatch('x\ny\n', p2, { reverse: true })),
        summary(applyPatch('a\nb', p4)),
        summary(applyPatch('a\nb\n', p4)),
        summary(applyPatch('A\nb', p4, { reverse: true })),
      ];
    },
  },
  {
    name: 'applying backwards swaps the sides, offsets and counts',
    run: async ({ load }) => {
      const { unifiedDiff, applyPatch, parsePatch } = await lib(load);
      const old = body('one', 'two', 'three', 'four', 'five', 'six');
      const next = body('one', 'two', 'three', 'extra', 'four', 'five', 'six2');
      const patch = unifiedDiff(old, next, { context: 1 });
      const moved = body('top', 'one', 'two', 'three', 'extra', 'four', 'five', 'six2');
      return [
        summary(applyPatch(next, patch, { reverse: true })),
        summary(applyPatch(moved, patch, { reverse: true })),
        summary(applyPatch(old, patch, { reverse: true })),
        summary(applyPatch(old, parsePatch(patch), { reverse: false })),
        summary(applyPatch(moved, parsePatch(patch), { reverse: true, fuzz: 1 })),
        summary(applyPatch(next, unifiedDiff(next, old), { reverse: true })),
      ];
    },
  },
  {
    name: 'applyPatch checks its arguments and does not change the patch',
    run: async ({ load }) => {
      const { applyPatch, parsePatch, unifiedDiff } = await lib(load);
      const text = 'a\nb\nc\n';
      const patchText = unifiedDiff(text, 'a\nB\nc\n');
      const parsed = parsePatch(patchText);
      const frozen = JSON.stringify(parsed);
      const deep = (value) => {
        for (const child of Object.values(value)) if (child && typeof child === 'object') deep(child);
        return Object.freeze(value);
      };
      deep(parsed);
      const results = [
        await attempt(() => applyPatch(5, patchText)),
        await attempt(() => applyPatch(text, 5)),
        await attempt(() => applyPatch(text, null)),
        await attempt(() => applyPatch(text, patchText, { fuzz: -1 })),
        await attempt(() => applyPatch(text, patchText, { fuzz: 1.5 })),
        await attempt(() => applyPatch(text, patchText, { fuzz: '1' })),
        await attempt(() => applyPatch(text, patchText, { fuzz: NaN })),
        await attempt(() => applyPatch(text, 'garbage in the patch\n--- a\n')),
        await attempt(() => applyPatch(text, '--- a\n+++ b\n@@ -1 +1 @@\n')),
        await attempt(() => applyPatch(text, patchText, undefined).text),
        await attempt(() => applyPatch(text, patchText, { fuzz: 0, reverse: false }).text),
      ];
      const viaObject = await attempt(() => summary(applyPatch(text, parsed)));
      const reversed = await attempt(() => summary(applyPatch('a\nB\nc\n', parsed, { reverse: true })));
      return { results, viaObject, reversed, unchanged: JSON.stringify(parsed) === frozen };
    },
  },
  {
    name: 'a patch without hunks and a text without lines',
    run: async ({ load }) => {
      const { applyPatch, parsePatch } = await lib(load);
      return [
        summary(applyPatch('keep\nme', '')),
        summary(applyPatch('keep\nme', '--- a\n+++ b\n')),
        summary(applyPatch('keep\nme', { oldName: null, newName: null, hunks: [] })),
        summary(applyPatch('', parsePatch('--- a\n+++ b\n'))),
        summary(applyPatch('', '--- a\n+++ b\n@@ -0,0 +1 @@\n+first\n')),
        summary(applyPatch('', '--- a\n+++ b\n@@ -1 +0,0 @@\n-first\n')),
        summary(applyPatch('first\n', '--- a\n+++ b\n@@ -1 +0,0 @@\n-first\n')),
        summary(applyPatch('a\n', '--- a\n+++ b\n@@ -1,2 +1,2 @@\n a\n b\n')),
      ];
    },
  },
  {
    name: 'a patch from one version applies to a changed version',
    run: async ({ load }) => {
      const { unifiedDiff, applyPatch } = await lib(load);
      const v1 = body(
        'function total(items) {',
        '  let sum = 0;',
        '  for (const item of items) {',
        '    sum += item.price;',
        '  }',
        '  return sum;',
        '}',
        '',
        'function names(items) {',
        '  return items.map((item) => item.name);',
        '}',
        '',
        'module.exports = { total, names };',
      );
      const v2 = body(
        'function total(items) {',
        '  let sum = 0;',
        '  for (const item of items) {',
        '    sum += item.price * item.qty;',
        '  }',
        '  return sum;',
        '}',
        '',
        'function names(items) {',
        '  return items.map((item) => item.name).sort();',
        '}',
        '',
        'module.exports = { total, names };',
      );
      const patch = unifiedDiff(v1, v2, { oldName: 'a/cart.js', newName: 'b/cart.js', context: 2 });
      const local = body(
        "'use strict';",
        '// local header',
        'function total(items) {',
        '  let sum = 0;',
        '  for (const item of items) {',
        '    sum += item.price;',
        '  }',
        '  return sum;',
        '}',
        '',
        'function names(items) {',
        '  // local note',
        '  return items.map((item) => item.name);',
        '}',
        '',
        'module.exports = { total, names };',
      );
      const rows = [];
      for (const fuzz of [0, 1, 2]) {
        const r = applyPatch(local, patch, { fuzz });
        rows.push(r.ok ? { hunks: r.hunks, text: r.text } : r);
      }
      return { patch, rows };
    },
  },
  {
    name: 'many hunks in a large file are fast',
    run: async ({ load }) => {
      const { unifiedDiff, applyPatch, parsePatch } = await lib(load);
      return timed(async () => {
        const lines = Array.from({ length: 20000 }, (_, i) => `line ${i % 700} of the file`);
        const edited = lines.slice();
        for (let i = 40; i < 20000; i += 100) edited[i] = `edited line ${i}`;
        const oldText = body(...lines);
        const newText = body(...edited);
        const patch = unifiedDiff(oldText, newText, { context: 1 });
        const parsed = parsePatch(patch);
        const shifted = body('extra', 'extra2', ...lines);
        const forward = applyPatch(shifted, parsed);
        const back = applyPatch(newText, parsed, { reverse: true });
        const miss = applyPatch(oldText, '--- a\n+++ b\n@@ -5,2 +5,2 @@\n nothing like it\n-nor this\n+x\n', { fuzz: 3 });
        return {
          hunks: parsed.hunks.length,
          ok: forward.ok,
          offsets: forward.ok ? [...new Set(forward.hunks.map((h) => h.offset))] : null,
          length: forward.ok ? forward.text.length - 2 * 'extra\n'.length : null,
          backSame: back.ok && back.text === oldText,
          miss,
        };
      });
    },
  },
];

export { probes };
