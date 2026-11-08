function playCairn(setup, actions) {
  const CAPACITY = { '.': 4, '~': 4, '*': 4, '^': 2, '=': 3, '#': 0 };
  const rows = setup.rows.map(String);
  const boardHeight = rows.length;
  const boardWidth = rows[0].length;
  const other = (player) => (player === 'A' ? 'B' : 'A');

  // The board: one array of discs (bottom to top) for each cell.
  const towers = [];
  for (let y = 0; y < boardHeight; y += 1) {
    const line = [];
    for (let x = 0; x < boardWidth; x += 1) line.push([]);
    towers.push(line);
  }

  const reserve = { A: setup.reserve, B: setup.reserve };
  const faultCount = { A: 0, B: 0 };
  const faultLog = [];
  const harvest = { A: 0, B: 0 };
  const monuments = new Set();
  let touched = [];
  const relics = new Set(setup.relics || []);
  const forts = new Map();
  const cellKey = (cell) => `${cell.x},${cell.y}`;
  const fortOwner = (cell) => forts.get(cellKey(cell)) || null;

  // ---------------------------------------------------------------- cells and towers

  const CELL_PATTERN = /^[a-z][1-9][0-9]*$/;
  const NUMBER_PATTERN = /^[1-9][0-9]{0,5}$/;

  function parseCell(token) {
    if (!CELL_PATTERN.test(token)) return null;
    return { x: token.charCodeAt(0) - 97, y: Number(token.slice(1)) - 1 };
  }

  const onBoard = (cell) => cell.x >= 0 && cell.x < boardWidth && cell.y >= 0 && cell.y < boardHeight;
  const terrain = (cell) => rows[cell.y][cell.x];
  const capacityOf = (cell) => CAPACITY[terrain(cell)];
  const towerAt = (cell) => towers[cell.y][cell.x];
  const heightAt = (cell) => towerAt(cell).length;

  function controllerOf(tower) {
    return tower.length === 0 ? null : tower[tower.length - 1];
  }

  function topRun(tower) {
    if (tower.length === 0) return 0;
    const top = tower[tower.length - 1];
    let run = 0;
    for (let i = tower.length - 1; i >= 0 && tower[i] === top; i -= 1) run += 1;
    return run;
  }

  function isSealed(cell) {
    const tower = towerAt(cell);
    if (tower.length === 0) return false;
    if (tower.length !== capacityOf(cell)) return false;
    return tower.every((disc) => disc === tower[0]);
  }

  const isRelic = (cell) => relics.has(String.fromCharCode(97 + cell.x) + (cell.y + 1));
  const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

  function neighbours(cell) {
    const found = [];
    const steps = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of steps) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      if (onBoard(next)) found.push(next);
    }
    return found;
  }

  function sink(cell) {
    if (terrain(cell) !== '~') return;
    const tower = towerAt(cell);
    while (tower.length > 2) tower.shift();
  }

  // A bridge that carries three discs of more than one owner collapses: all of its discs are removed from the game.
  function collapse(cell) {
    if (terrain(cell) !== '=') return;
    const tower = towerAt(cell);
    if (tower.length === 3 && !tower.every((disc) => disc === tower[0])) tower.length = 0;
  }

  function settle(cell) {
    sink(cell);
    collapse(cell);
  }

  // The enemy disc that a successful assault covers changes owner: the top disc of the target before the landing.
  function convert(target, player) {
    target[target.length - 1] = player;
  }

  // ---------------------------------------------------------------- parsing an action

  function parseAction(text) {
    if (typeof text !== 'string' || text.length === 0) return null;
    const tokens = text.split(' ');
    if (tokens.some((token) => token.length === 0)) return null;
    const verb = tokens[0];
    if (verb === 'pass') {
      return tokens.length === 1 ? { verb } : null;
    }
    if (verb === 'put' || verb === 'lift' || verb === 'fort') {
      if (tokens.length !== 2) return null;
      const cell = parseCell(tokens[1]);
      return cell ? { verb, a: cell } : null;
    }
    if (verb === 'swap') {
      if (tokens.length !== 3) return null;
      const a = parseCell(tokens[1]);
      const b = parseCell(tokens[2]);
      return a && b ? { verb, a, b } : null;
    }
    if (verb === 'run') {
      if (tokens.length < 4 || tokens.length > 6) return null;
      const path = tokens.slice(1).map(parseCell);
      return path.every(Boolean) ? { verb, path } : null;
    }
    if (verb === 'go') {
      if (tokens.length !== 4) return null;
      const a = parseCell(tokens[1]);
      const b = parseCell(tokens[2]);
      if (!a || !b || !NUMBER_PATTERN.test(tokens[3])) return null;
      return { verb, a, b, count: Number(tokens[3]) };
    }
    return null;
  }

  // ---------------------------------------------------------------- the actions
  // Each returns null when the action is legal (and then it has happened), or a reason.

  function doPut(player, action) {
    const cell = action.a;
    if (!onBoard(cell)) return 'off-board';
    if (terrain(cell) === '#') return 'wall';
    if (terrain(cell) === '=') return 'no-build';
    if (reserve[player] === 0) return 'no-reserve';
    const tower = towerAt(cell);
    if (controllerOf(tower) === other(player)) return 'enemy-held';
    if (tower.length === capacityOf(cell)) return 'full';
    if (tower.length === 0) {
      for (const next of neighbours(cell)) {
        const near = towerAt(next);
        if (controllerOf(near) === other(player) && near.length >= 3) return 'guarded';
      }
    }
    reserve[player] -= 1;
    tower.push(player);
    settle(cell);
    touched.push(cell);
    return null;
  }

  function doGo(player, action) {
    const from = action.a;
    const to = action.b;
    if (!onBoard(from) || !onBoard(to)) return 'off-board';
    if (!adjacent(from, to)) return 'not-adjacent';
    if (terrain(from) === '#' || terrain(to) === '#') return 'wall';
    const source = towerAt(from);
    const target = towerAt(to);
    if (source.length === 0) return 'empty';
    if (controllerOf(source) !== player) return 'not-yours';
    if (isSealed(from)) return 'sealed';
    if (action.count > source.length) return 'too-many';
    if (target.length + action.count > capacityOf(to)) return 'full';
    if (controllerOf(target) === other(player)) {
      if (isSealed(to)) return 'sealed';
      const needed = topRun(target) + (terrain(to) === '*' ? 1 : 0) + (fortOwner(to) === other(player) ? 1 : 0);
      if (action.count < needed) return 'too-weak';
    }
    const moved = source.splice(source.length - action.count, action.count);
    if (controllerOf(target) === other(player)) convert(target, player);
    for (const disc of moved) target.push(disc);
    settle(to);
    touched.push(to);
    return null;
  }

  function doSwap(player, action) {
    const first = action.a;
    const second = action.b;
    if (!onBoard(first) || !onBoard(second)) return 'off-board';
    if (!adjacent(first, second)) return 'not-adjacent';
    if (terrain(first) === '#' || terrain(second) === '#') return 'wall';
    const left = towerAt(first);
    const right = towerAt(second);
    if (left.length === 0 || right.length === 0) return 'empty';
    if (controllerOf(left) !== player || controllerOf(right) !== player) return 'not-yours';
    if (isSealed(first) || isSealed(second)) return 'sealed';
    if (left.length > capacityOf(second) || right.length > capacityOf(first)) return 'full';
    const copyLeft = left.slice();
    const copyRight = right.slice();
    left.splice(0, left.length, ...copyRight);
    right.splice(0, right.length, ...copyLeft);
    settle(first);
    settle(second);
    touched.push(first, second);
    return null;
  }

  function doRun(player, action) {
    const path = action.path;
    if (path.some((cell) => !onBoard(cell))) return 'off-board';
    for (let i = 1; i < path.length; i += 1) {
      if (!adjacent(path[i - 1], path[i])) return 'not-adjacent';
    }
    if (path.some((cell) => terrain(cell) === '#')) return 'wall';
    const start = path[0];
    const source = towerAt(start);
    if (source.length === 0) return 'empty';
    if (controllerOf(source) !== player) return 'not-yours';
    if (isSealed(start)) return 'sealed';
    const names = new Set(path.map((cell) => `${cell.x},${cell.y}`));
    if (names.size !== path.length) return 'repeat';
    for (let i = 1; i < path.length - 1; i += 1) {
      const tower = towerAt(path[i]);
      if (controllerOf(tower) === other(player) || tower.length === capacityOf(path[i])) return 'blocked';
    }
    const end = path[path.length - 1];
    const target = towerAt(end);
    if (target.length === capacityOf(end)) return 'full';
    if (controllerOf(target) === other(player)) {
      if (isSealed(end)) return 'sealed';
      const needed = topRun(target) + (terrain(end) === '*' ? 1 : 0) + (fortOwner(end) === other(player) ? 1 : 0);
      if (needed > 1) return 'too-weak';
    }
    const disc = source.pop();
    const wet = path.slice(1).filter((cell) => terrain(cell) === '~').length;
    if (wet >= 2) return null;
    if (controllerOf(target) === other(player)) convert(target, player);
    target.push(disc);
    settle(end);
    touched.push(end);
    return null;
  }

  function doFort(player, action) {
    const cell = action.a;
    if (!onBoard(cell)) return 'off-board';
    if (terrain(cell) === '#') return 'wall';
    if (terrain(cell) === '=') return 'no-build';
    if (reserve[player] < 2) return 'no-reserve';
    const tower = towerAt(cell);
    if (tower.length === 0) return 'empty';
    if (controllerOf(tower) !== player) return 'not-yours';
    if (fortOwner(cell)) return 'fortified';
    let owned = 0;
    for (const owner of forts.values()) if (owner === player) owned += 1;
    if (owned >= 2) return 'too-many-forts';
    reserve[player] -= 2;
    forts.set(cellKey(cell), player);
    return null;
  }

  function doLift(player, action) {
    const cell = action.a;
    if (!onBoard(cell)) return 'off-board';
    if (terrain(cell) === '#') return 'wall';
    const tower = towerAt(cell);
    if (tower.length === 0) return 'empty';
    if (controllerOf(tower) !== player) return 'not-yours';
    if (isSealed(cell)) return 'sealed';
    if (tower.length < 2) return 'too-low';
    tower.pop();
    reserve[player] += 1;
    return null;
  }

  // ---------------------------------------------------------------- events after a legal action that is not a pass

  function eachCell(visit) {
    for (let y = 0; y < boardHeight; y += 1) {
      for (let x = 0; x < boardWidth; x += 1) visit({ x, y });
    }
  }

  function tide() {
    eachCell((cell) => {
      if (terrain(cell) !== '~' || fortOwner(cell)) return;
      const tower = towerAt(cell);
      if (tower.length >= 2) tower.shift();
    });
  }

  function gather() {
    eachCell((cell) => {
      if (terrain(cell) !== '*' && !isRelic(cell)) return;
      const owner = controllerOf(towerAt(cell));
      if (owner) harvest[owner] += 1;
    });
  }

  // Supply: a player who controls 3 or more towers gets one more disc in the reserve.
  function supply() {
    const held = { A: 0, B: 0 };
    eachCell((cell) => {
      const owner = controllerOf(towerAt(cell));
      if (owner) held[owner] += 1;
    });
    for (const player of ['A', 'B']) {
      if (held[player] >= 3) reserve[player] += 1;
    }
  }

  function storm() {
    eachCell((cell) => {
      if (terrain(cell) !== '^' || fortOwner(cell)) return;
      if (towerAt(cell).length === 0 || isSealed(cell)) return;
      towerAt(cell).pop();
    });
  }

  // ---------------------------------------------------------------- the game loop

  let turn = setup.first === 'B' ? 'B' : 'A';
  let legalCount = 0;
  let passStreak = 0;
  let played = 0;
  let ended = 'actions';
  let forfeiter = null;

  for (let index = 0; index < actions.length; index += 1) {
    const actor = turn;
    played += 1;
    touched = [];
    const action = parseAction(actions[index]);
    let reason = null;
    if (!action) {
      reason = 'bad-format';
    } else if (action.verb === 'pass') {
      passStreak += 1;
    } else if (action.verb === 'put') {
      reason = doPut(actor, action);
    } else if (action.verb === 'go') {
      reason = doGo(actor, action);
    } else if (action.verb === 'swap') {
      reason = doSwap(actor, action);
    } else if (action.verb === 'run') {
      reason = doRun(actor, action);
    } else if (action.verb === 'fort') {
      reason = doFort(actor, action);
    } else {
      reason = doLift(actor, action);
    }

    if (reason) {
      faultCount[actor] += 1;
      faultLog.push(`${index + 1}:${reason}`);
      turn = other(actor);
      if (faultCount[actor] === 3) {
        ended = 'forfeit';
        forfeiter = actor;
        break;
      }
      continue;
    }

    if (action.verb !== 'pass') {
      passStreak = 0;
      for (const cell of touched) {
        const key = `${cell.x},${cell.y}`;
        if (isSealed(cell) && !monuments.has(key)) {
          monuments.add(key);
          reserve[controllerOf(towerAt(cell))] += 1;
        }
      }
      legalCount += 1;
      if (legalCount % 4 === 0) tide();
      if (legalCount % 6 === 0) gather();
      if (legalCount % 8 === 0) supply();
      if (legalCount % 10 === 0) storm();
    }
    turn = other(actor);
    if (passStreak === 2) {
      ended = 'passes';
      break;
    }
  }

  // ---------------------------------------------------------------- scoring

  function largestGroup(player) {
    const seen = new Set();
    let best = 0;
    eachCell((start) => {
      const key = (cell) => `${cell.x},${cell.y}`;
      if (seen.has(key(start)) || controllerOf(towerAt(start)) !== player) return;
      let size = 0;
      const queue = [start];
      seen.add(key(start));
      while (queue.length > 0) {
        const cell = queue.shift();
        size += 1;
        for (const next of neighbours(cell)) {
          if (seen.has(key(next)) || controllerOf(towerAt(next)) !== player) continue;
          seen.add(key(next));
          queue.push(next);
        }
      }
      if (size > best) best = size;
    });
    return best;
  }

  function towerPoints(cell) {
    const tower = towerAt(cell);
    let points = tower.length;
    const ground = terrain(cell);
    if (ground === '*') points *= 2;
    else if (ground === '~') points = Math.floor(points / 2);
    else if (ground === '^') points += 1;
    else if (ground === '=') points = Math.max(0, points - 1);
    if (isSealed(cell)) points += 3;
    if (isRelic(cell)) points += 2;
    if (fortOwner(cell) === controllerOf(tower)) points += 2;
    return points;
  }

  const score = { A: 0, B: 0 };
  const controlled = { A: 0, B: 0 };
  eachCell((cell) => {
    const owner = controllerOf(towerAt(cell));
    if (!owner) return;
    score[owner] += towerPoints(cell);
    controlled[owner] += 1;
  });
  for (const zone of setup.zones || []) {
    const held = { A: 0, B: 0 };
    for (const name of zone.cells) {
      const cell = parseCell(name);
      const owner = controllerOf(towerAt(cell));
      if (owner) held[owner] += 1;
    }
    if (held.A === held.B) continue;
    const winnerOfZone = held.A > held.B ? 'A' : 'B';
    const everything = held[winnerOfZone] === zone.cells.length && zone.cells.length >= 2;
    score[winnerOfZone] += everything ? 2 * zone.bonus : zone.bonus;
  }
  for (const player of ['A', 'B']) {
    const group = largestGroup(player);
    if (group >= 2) score[player] += 2 * (group - 1);
    score[player] += Math.floor(reserve[player] / 2);
    score[player] += harvest[player];
    score[player] -= 2 * faultCount[player];
  }

  let winner;
  if (forfeiter) winner = other(forfeiter);
  else if (score.A !== score.B) winner = score.A > score.B ? 'A' : 'B';
  else if (controlled.A !== controlled.B) winner = controlled.A > controlled.B ? 'A' : 'B';
  else winner = 'draw';

  const report = [];
  for (let y = 0; y < boardHeight; y += 1) {
    const cells = [];
    for (let x = 0; x < boardWidth; x += 1) {
      const cell = { x, y };
      if (terrain(cell) === '#') cells.push('#');
      else if (heightAt(cell) === 0) cells.push('-');
      else cells.push(towerAt(cell).join(''));
    }
    report.push(cells.join('|'));
  }

  return {
    rows: report,
    reserve: { A: reserve.A, B: reserve.B },
    score: { A: score.A, B: score.B },
    faults: faultLog,
    played,
    ended,
    winner,
  };
}
