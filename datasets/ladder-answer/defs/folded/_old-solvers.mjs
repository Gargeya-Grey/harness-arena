// Exhaustive solvers for the reasoning-hard suite. Each solver takes the instance
// stored in a case's metadata and returns { answers, ... } where `answers` lists
// every distinct final answer that is consistent with the instance. A case is
// valid only when that list holds exactly one entry, and, for the puzzles whose
// solution is a whole configuration (logic grid, knights and knaves), when exactly
// one configuration satisfies all clues. Nothing here is clever: each solver
// searches the whole space. The generator uses the same functions to accept or
// reject a draw, and the tests run them again on the stored instances.
//
// `fast*` functions are independent, faster methods (Kruskal, subset DP, a grid
// DP). The tests compare them with the exhaustive answer.

// ---- shared helpers --------------------------------------------------------

export function permutations(n) {
  const out = [];
  const used = new Array(n).fill(false);
  const cur = [];
  const rec = () => {
    if (cur.length === n) {
      out.push(cur.slice());
      return;
    }
    for (let i = 0; i < n; i += 1) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(i);
      rec();
      cur.pop();
      used[i] = false;
    }
  };
  rec();
  return out;
}

const unique = (list) => [...new Set(list)];

// ---- logic grid ------------------------------------------------------------
// instance: { seats: n, categories: [{ key, values: [...] }], clues: [...], ask: { cat, of: [cat, value] } }
// A clue names items as [category index, value index]. A solution gives every
// item a seat 0..n-1 (shown to the reader as seat 1..n, left to right).

export function holdsClue(clue, seat) {
  const at = (ref) => seat[ref[0]][ref[1]];
  const a = clue.a ? at(clue.a) : null;
  const b = clue.b ? at(clue.b) : null;
  switch (clue.type) {
    case 'same': return a === b;
    case 'notsame': return a !== b;
    case 'at': return a === clue.seat;
    case 'notat': return a !== clue.seat;
    case 'left': return a + 1 === b;
    case 'next': return Math.abs(a - b) === 1;
    case 'before': return a < b;
    case 'gap': return Math.abs(a - b) === 2;
    case 'either': return a === b || a === at(clue.c);
    case 'between': {
      const c = at(clue.c);
      return (b < a && a < c) || (c < a && a < b);
    }
    default: throw new Error(`unknown clue type ${clue.type}`);
  }
}

const clueCategories = (clue) => [clue.a, clue.b, clue.c].filter(Boolean).map((ref) => ref[0]);

export function logicGridSolutions(instance, limit = Infinity) {
  const { seats, categories, clues } = instance;
  const perms = permutations(seats);
  const nCats = categories.length;
  // Search order: start with the category that has most clues, then add the
  // category that completes the most clues. The order changes the speed only.
  const involvement = categories.map((_, c) => clues.filter((clue) => clueCategories(clue).includes(c)).length);
  const order = [];
  while (order.length < nCats) {
    let best = -1;
    let bestScore = [-1, -1];
    for (let c = 0; c < nCats; c += 1) {
      if (order.includes(c)) continue;
      const set = new Set([...order, c]);
      const done = clues.filter((clue) => clueCategories(clue).every((x) => set.has(x))).length;
      const score = [done, involvement[c]];
      if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
        best = c;
        bestScore = score;
      }
    }
    order.push(best);
  }
  const levels = order.map(() => []);
  for (const clue of clues) levels[Math.max(...clueCategories(clue).map((c) => order.indexOf(c)))].push(clue);
  const seat = new Array(nCats);
  const solutions = [];
  const rec = (level) => {
    if (solutions.length >= limit) return;
    if (level === nCats) {
      solutions.push(seat.map((row) => row.slice()));
      return;
    }
    const cat = order[level];
    for (const perm of perms) {
      seat[cat] = perm;
      if (levels[level].every((clue) => holdsClue(clue, seat))) rec(level + 1);
      if (solutions.length >= limit) return;
    }
    seat[cat] = undefined;
  };
  rec(0);
  return solutions;
}

export function solveLogicGrid(instance) {
  const solutions = logicGridSolutions(instance);
  const { ask } = instance;
  const answers = solutions.map((seat) => {
    const target = seat[ask.of[0]][ask.of[1]];
    const value = seat[ask.cat].indexOf(target);
    return instance.categories[ask.cat].values[value];
  });
  return { solutions: solutions.length, answers: unique(answers) };
}

// ---- knights and knaves ----------------------------------------------------
// instance: { people: [names], statements: [one per person, same order] }
// assign[i] is true when person i is a knight. A knight's statement is true; a
// knave's statement is false.

export function statementTruth(statement, assign) {
  const is = (i, kind) => assign[i] === (kind === 'knight');
  switch (statement.type) {
    case 'is': return is(statement.x, statement.kind);
    case 'same': return assign[statement.x] === assign[statement.y];
    case 'diff': return assign[statement.x] !== assign[statement.y];
    case 'any': return statement.set.some((i) => is(i, statement.kind));
    case 'all': return statement.set.every((i) => is(i, statement.kind));
    case 'count': {
      const n = statement.set.filter((i) => is(i, statement.kind)).length;
      if (statement.op === 'exactly') return n === statement.k;
      if (statement.op === 'atleast') return n >= statement.k;
      return n <= statement.k;
    }
    default: throw new Error(`unknown statement type ${statement.type}`);
  }
}

export function knightAssignments(instance) {
  const n = instance.people.length;
  const found = [];
  for (let mask = 0; mask < 1 << n; mask += 1) {
    const assign = [];
    for (let i = 0; i < n; i += 1) assign.push(Boolean(mask & (1 << i)));
    if (instance.statements.every((statement, i) => statementTruth(statement, assign) === assign[i])) found.push(assign);
  }
  return found;
}

export function solveKnights(instance) {
  const found = knightAssignments(instance);
  return { solutions: found.length, answers: unique(found.map((assign) => assign.map((x) => (x ? 'K' : 'N')).join(''))) };
}

// ---- network ---------------------------------------------------------------
// instance: { kind: 'mst' | 'route', nodes: [names], edges: [[u, v, w]], ... }

function makeFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x];
    return x;
  };
  return { parent, find };
}

// Cheapest set of cables that connects every town. `prebuilt` edges (indexes into
// `edges`) exist already and cost 0; `forced` edges must be built and cost their
// price. The search tries every subset of the other edges.
export function solveMst(instance) {
  const { nodes, edges } = instance;
  const n = nodes.length;
  const prebuilt = new Set(instance.prebuilt || []);
  const forced = new Set(instance.forced || []);
  const required = [...prebuilt, ...forced];
  const optional = edges.map((_, i) => i).filter((i) => !prebuilt.has(i) && !forced.has(i));
  const base = makeFind(n);
  let baseCost = 0;
  let components = n;
  for (const index of required) {
    const [u, v, w] = edges[index];
    const ru = base.find(u);
    const rv = base.find(v);
    if (ru === rv) throw new Error('required cables form a cycle');
    base.parent[ru] = rv;
    components -= 1;
    if (!prebuilt.has(index)) baseCost += w;
  }
  let best = Infinity;
  let bestCount = 0;
  const rec = (pos, cost, parent, comps) => {
    if (comps === 1) {
      if (cost < best) {
        best = cost;
        bestCount = 1;
      } else if (cost === best) bestCount += 1;
      return;
    }
    if (pos === optional.length || optional.length - pos < comps - 1) return;
    const [u, v, w] = edges[optional[pos]];
    const p = parent.slice();
    const find = (x) => {
      while (p[x] !== x) x = p[x];
      return x;
    };
    const ru = find(u);
    const rv = find(v);
    if (ru !== rv) {
      p[ru] = rv;
      rec(pos + 1, cost + w, p, comps - 1);
    }
    rec(pos + 1, cost, parent, comps);
  };
  rec(0, baseCost, base.parent.slice(), components);
  if (best === Infinity) throw new Error('the towns cannot be connected');
  return { answers: [best], optimal_networks: bestCount };
}

export function fastMst(instance) {
  const { nodes, edges } = instance;
  const prebuilt = new Set(instance.prebuilt || []);
  const forced = new Set(instance.forced || []);
  const { parent, find } = makeFind(nodes.length);
  let cost = 0;
  const join = (index, pay) => {
    const [u, v, w] = edges[index];
    const ru = find(u);
    const rv = find(v);
    if (ru === rv) return;
    parent[ru] = rv;
    if (pay) cost += w;
  };
  for (const i of prebuilt) join(i, false);
  for (const i of forced) join(i, true);
  edges.map((e, i) => [e[2], i]).sort((x, y) => x[0] - y[0]).forEach(([, i]) => join(i, !prebuilt.has(i)));
  return cost;
}

function adjacency(instance) {
  const adj = instance.nodes.map(() => []);
  for (const [u, v, w] of instance.edges) {
    adj[u].push([v, w]);
    adj[v].push([u, w]);
  }
  return adj;
}

// Shortest route from `from` to `to` that passes through `via` (when given),
// avoids the towns in `avoid`, and visits no town twice: every simple path is tried.
export function solveRoute(instance) {
  const adj = adjacency(instance);
  const avoid = new Set(instance.avoid || []);
  const { from, to, via } = instance;
  const seen = new Array(instance.nodes.length).fill(false);
  let best = Infinity;
  const walk = (node, length, viaSeen) => {
    if (length >= best) return;
    if (node === to) {
      if (via == null || viaSeen) best = length;
      return;
    }
    for (const [next, w] of adj[node]) {
      if (seen[next] || avoid.has(next)) continue;
      seen[next] = true;
      walk(next, length + w, viaSeen || next === via);
      seen[next] = false;
    }
  };
  seen[from] = true;
  walk(from, 0, from === via);
  if (best === Infinity) throw new Error('no route exists');
  return { answers: [best] };
}

// Subset DP over (set of visited towns, last town): independent of the DFS above.
export function fastRoute(instance) {
  const n = instance.nodes.length;
  const avoid = new Set(instance.avoid || []);
  const { from, to, via } = instance;
  const w = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (const [u, v, c] of instance.edges) {
    w[u][v] = Math.min(w[u][v], c);
    w[v][u] = Math.min(w[v][u], c);
  }
  const size = 1 << n;
  const dist = Array.from({ length: size }, () => new Array(n).fill(Infinity));
  dist[1 << from][from] = 0;
  let best = Infinity;
  for (let mask = 1; mask < size; mask += 1) {
    for (let last = 0; last < n; last += 1) {
      const d = dist[mask][last];
      if (d === Infinity) continue;
      if (last === to) {
        if (via == null || mask & (1 << via)) best = Math.min(best, d);
        continue;
      }
      for (let next = 0; next < n; next += 1) {
        if (mask & (1 << next) || avoid.has(next) || w[last][next] === Infinity) continue;
        const m = mask | (1 << next);
        if (d + w[last][next] < dist[m][next]) dist[m][next] = d + w[last][next];
      }
    }
  }
  return best;
}

// Shortest plain walk from -> via -> to (towns may repeat). Used by the generator
// to keep cases where this obvious two-leg answer is not the answer.
export function twoLegWalk(instance) {
  const n = instance.nodes.length;
  const adj = adjacency(instance);
  const avoid = new Set(instance.avoid || []);
  const dijkstra = (src) => {
    const d = new Array(n).fill(Infinity);
    const done = new Array(n).fill(false);
    d[src] = 0;
    for (let k = 0; k < n; k += 1) {
      let u = -1;
      for (let i = 0; i < n; i += 1) if (!done[i] && !avoid.has(i) && (u === -1 || d[i] < d[u])) u = i;
      if (u === -1 || d[u] === Infinity) break;
      done[u] = true;
      for (const [v, c] of adj[u]) if (!avoid.has(v) && d[u] + c < d[v]) d[v] = d[u] + c;
    }
    return d;
  };
  const a = dijkstra(instance.from);
  const b = dijkstra(instance.via);
  return a[instance.via] + b[instance.to];
}

export function solveNetwork(instance) {
  return instance.kind === 'mst' ? solveMst(instance) : solveRoute(instance);
}

// ---- scheduling ------------------------------------------------------------
// instance: { machines, tasks: [{ name, hours, needs: [indexes] }] }
// Smallest finishing time with `machines` identical workers, no interruption.

// Method 1: at time 0 and whenever a task ends, try every choice of ready tasks
// to start on the free workers, including starting none, and go to the next end.
export function scheduleSearch(instance) {
  const { tasks, machines } = instance;
  const n = tasks.length;
  const all = (1 << n) - 1;
  const memo = new Map();
  const solve = (time, done, started, running) => {
    if (done === all) return time;
    const key = `${time}|${done}|${started}|${running.map((r) => `${r[0]}:${r[1]}`).join(',')}`;
    if (memo.has(key)) return memo.get(key);
    const free = machines - running.length;
    const ready = [];
    for (let i = 0; i < n; i += 1) {
      if (started & (1 << i)) continue;
      if (tasks[i].needs.every((p) => done & (1 << p))) ready.push(i);
    }
    let best = Infinity;
    const choose = (from, picked) => {
      const nextRunning = running.concat(picked.map((i) => [time + tasks[i].hours, i]));
      if (nextRunning.length) {
        nextRunning.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
        const t = nextRunning[0][0];
        let nd = done;
        const rest = [];
        for (const r of nextRunning) {
          if (r[0] === t) nd |= 1 << r[1];
          else rest.push(r);
        }
        const ns = picked.reduce((s, i) => s | (1 << i), started);
        best = Math.min(best, solve(t, nd, ns, rest));
      }
      if (picked.length === free) return;
      for (let i = from; i < ready.length; i += 1) choose(i + 1, picked.concat(ready[i]));
    };
    choose(0, []);
    memo.set(key, best);
    return best;
  };
  return solve(0, 0, 0, []);
}

// Method 2: every precedence-feasible order of the tasks; each task goes at the
// earliest time at which its prerequisites are done and a worker is free (a worker
// may be idle before it). The best order gives the optimum. Branches that cannot
// beat the best finishing time found so far are cut.
export function scheduleOrders(instance) {
  const { tasks, machines } = instance;
  const n = tasks.length;
  const horizon = tasks.reduce((s, t) => s + t.hours, 0) + 1;
  let best = Infinity;
  let count = 0;
  const placed = new Array(n).fill(false);
  const finish = new Array(n).fill(0);
  const usage = new Array(horizon).fill(0);
  const rec = () => {
    if (count === n) {
      best = Math.min(best, Math.max(...finish));
      return;
    }
    for (let i = 0; i < n; i += 1) {
      if (placed[i] || !tasks[i].needs.every((p) => placed[p])) continue;
      let t = Math.max(0, ...tasks[i].needs.map((p) => finish[p]));
      for (;;) {
        let ok = true;
        for (let u = t; u < t + tasks[i].hours; u += 1) {
          if (usage[u] >= machines) {
            ok = false;
            t = u + 1;
            break;
          }
        }
        if (ok) break;
      }
      if (t + tasks[i].hours >= best) continue;
      placed[i] = true;
      count += 1;
      finish[i] = t + tasks[i].hours;
      for (let u = t; u < finish[i]; u += 1) usage[u] += 1;
      rec();
      for (let u = t; u < finish[i]; u += 1) usage[u] -= 1;
      count -= 1;
      placed[i] = false;
      finish[i] = 0;
    }
  };
  rec();
  return best;
}

export function criticalPath(instance) {
  const { tasks } = instance;
  const memo = [];
  const end = (i) => {
    if (memo[i] == null) memo[i] = tasks[i].hours + Math.max(0, ...tasks[i].needs.map(end));
    return memo[i];
  };
  return Math.max(...tasks.map((_, i) => end(i)));
}

export function solveSchedule(instance) {
  const a = scheduleSearch(instance);
  const b = scheduleOrders(instance);
  if (a !== b) throw new Error(`scheduling methods disagree: ${a} vs ${b}`);
  return { answers: [a] };
}

// ---- counting --------------------------------------------------------------

// instance: { kind: 'lattice', width, height, blocked: [[x, y]], via: [x, y] | null, maxRun: n | null }
// Paths from (0,0) to (width,height); each step goes east (x+1) or north (y+1).
// A closed intersection cannot be entered. `maxRun` caps equal moves in a row.
export function solveLattice(instance) {
  const { width, height, blocked, via, maxRun } = instance;
  const closed = new Set(blocked.map(([x, y]) => `${x},${y}`));
  let count = 0;
  const walk = (x, y, run, last, viaSeen) => {
    if (closed.has(`${x},${y}`)) return;
    const seen = viaSeen || (via != null && x === via[0] && y === via[1]);
    if (x === width && y === height) {
      if (via == null || seen) count += 1;
      return;
    }
    if (x < width) {
      const r = last === 'E' ? run + 1 : 1;
      if (maxRun == null || r <= maxRun) walk(x + 1, y, r, 'E', seen);
    }
    if (y < height) {
      const r = last === 'N' ? run + 1 : 1;
      if (maxRun == null || r <= maxRun) walk(x, y + 1, r, 'N', seen);
    }
  };
  walk(0, 0, 0, '', false);
  return { answers: [count] };
}

// Memoised counting over (cell, last direction, run length, via seen).
export function fastLattice(instance) {
  const { width, height, blocked, via, maxRun } = instance;
  const closed = new Set(blocked.map(([x, y]) => `${x},${y}`));
  const limit = maxRun == null ? width + height : maxRun;
  const memo = new Map();
  const f = (x, y, dir, run, seen) => {
    if (closed.has(`${x},${y}`)) return 0;
    const s = seen || (via != null && x === via[0] && y === via[1]);
    if (x === width && y === height) return via == null || s ? 1 : 0;
    const key = `${x},${y},${dir},${run},${s}`;
    if (memo.has(key)) return memo.get(key);
    let total = 0;
    if (x < width) {
      const r = dir === 'E' ? run + 1 : 1;
      if (r <= limit) total += f(x + 1, y, 'E', r, s);
    }
    if (y < height) {
      const r = dir === 'N' ? run + 1 : 1;
      if (r <= limit) total += f(x, y + 1, 'N', r, s);
    }
    memo.set(key, total);
    return total;
  };
  return f(0, 0, '', 0, false);
}

// instance: { kind: 'arrangement', people: [names], rules: [...] }
// Seats are 1..n from left to right; a rule names people by index.
export function ruleHolds(rule, seatOf, n) {
  const s = (i) => seatOf[i] + 1;
  switch (rule.t) {
    case 'notEnd': return s(rule.x) !== 1 && s(rule.x) !== n;
    case 'adjacent': return Math.abs(s(rule.x) - s(rule.y)) === 1;
    case 'notAdjacent': return Math.abs(s(rule.x) - s(rule.y)) !== 1;
    case 'left': return s(rule.x) < s(rule.y);
    case 'seat': return rule.seats.includes(s(rule.x));
    case 'notSeat': return !rule.seats.includes(s(rule.x));
    case 'between': return (s(rule.y) < s(rule.x) && s(rule.x) < s(rule.z)) || (s(rule.z) < s(rule.x) && s(rule.x) < s(rule.y));
    case 'apart': return Math.abs(s(rule.x) - s(rule.y)) >= 3;
    default: throw new Error(`unknown rule ${rule.t}`);
  }
}

export function solveArrangement(instance) {
  const n = instance.people.length;
  let count = 0;
  for (const seatOf of permutations(n)) if (instance.rules.every((rule) => ruleHolds(rule, seatOf, n))) count += 1;
  return { answers: [count] };
}

export function solveCounting(instance) {
  return instance.kind === 'lattice' ? solveLattice(instance) : solveArrangement(instance);
}

// ---- congruences -----------------------------------------------------------
// instance: { kind: 'smallest' | 'nth' | 'count', congruences: [{ mod, rem, ... }], ... }
// `rem` is the remainder after division by `mod`; the other fields only change
// how the condition is worded.

const satisfies = (instance, x) => instance.congruences.every(({ mod, rem }) => x % mod === rem);
const SCAN_LIMIT = 5_000_000;

export function solveCongruence(instance) {
  if (instance.kind === 'smallest') {
    for (let x = 1; x <= SCAN_LIMIT; x += 1) if (satisfies(instance, x)) return { answers: [x] };
    throw new Error('no solution below the scan limit');
  }
  if (instance.kind === 'nth') {
    let seen = 0;
    for (let x = instance.above + 1; x <= SCAN_LIMIT; x += 1) {
      if (satisfies(instance, x)) {
        seen += 1;
        if (seen === instance.nth) return { answers: [x] };
      }
    }
    throw new Error('no solution below the scan limit');
  }
  let count = 0;
  for (let x = instance.low; x <= instance.high; x += 1) {
    if (satisfies(instance, x) && x % instance.notDivisibleBy !== 0) count += 1;
  }
  return { answers: [count] };
}

// ---- calendar --------------------------------------------------------------
// instance: { kind: 'finish' | 'count', from: 'YYYY-MM-DD', need | to, holidays: [iso],
//             shutdown: [iso, iso] | null, inventory: boolean }
// A working day is Monday to Friday, not an observed holiday, not in the shutdown.
// A holiday on a Saturday is observed on the Friday before; on a Sunday, on the
// Monday after. With `inventory`, the last working day of each month (as defined
// so far) is an inventory day: nobody works on it and it does not count.

const DAY = 86400000;
const toTime = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const toIso = (time) => new Date(time).toISOString().slice(0, 10);
const weekday = (time) => new Date(time).getUTCDay();

export function observedHolidays(holidays) {
  return holidays.map((iso) => {
    const t = toTime(iso);
    const w = weekday(t);
    if (w === 6) return toIso(t - DAY);
    if (w === 0) return toIso(t + DAY);
    return iso;
  });
}

export function workingDayTest(instance) {
  const off = new Set(observedHolidays(instance.holidays));
  const shut = instance.shutdown ? [toTime(instance.shutdown[0]), toTime(instance.shutdown[1])] : null;
  const baseWorking = (time) => {
    const w = weekday(time);
    if (w === 0 || w === 6) return false;
    if (off.has(toIso(time))) return false;
    if (shut && time >= shut[0] && time <= shut[1]) return false;
    return true;
  };
  return (time) => {
    if (!baseWorking(time)) return false;
    if (!instance.inventory) return true;
    const month = new Date(time).getUTCMonth();
    for (let t = time + DAY; new Date(t).getUTCMonth() === month; t += DAY) if (baseWorking(t)) return true;
    return false;
  };
}

export function solveCalendar(instance) {
  const isWorking = workingDayTest(instance);
  const start = toTime(instance.from);
  if (instance.kind === 'count') {
    let count = 0;
    for (let t = start; t <= toTime(instance.to); t += DAY) if (isWorking(t)) count += 1;
    return { answers: [count] };
  }
  let done = 0;
  for (let t = start; ; t += DAY) {
    if (isWorking(t)) {
      done += 1;
      if (done === instance.need) return { answers: [toIso(t)] };
    }
  }
}

// ---- entry point -----------------------------------------------------------

export const SOLVERS = {
  'logic-grid': solveLogicGrid,
  knights: solveKnights,
  network: solveNetwork,
  schedule: solveSchedule,
  counting: solveCounting,
  congruence: solveCongruence,
  calendar: solveCalendar,
};

export function solveCase(testCase) {
  const { family, instance } = testCase.metadata;
  const solver = SOLVERS[family];
  if (!solver) throw new Error(`no solver for family ${family}`);
  return solver(instance);
}
