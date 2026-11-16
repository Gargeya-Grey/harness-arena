import { t, lcg, draw, reference } from './_util.mjs';

const spec = [
  'Implement playCairn(setup, actions), the referee of a two-player stacking game called Cairn. It plays a list of attempted actions and returns the final report. Players are "A" and "B". setup is an object { rows, reserve, first, relics, zones }. rows is an array of 1 to 8 strings of the same length (1 to 8 characters): the board. reserve is a whole number from 0 to 12: the number of discs each player holds in reserve at the start. first is "A" or "B": the player who acts first. relics is an optional array of cell names (see BOARD); when it is missing there are no relics. zones is an optional array of objects { cells, bonus }: cells is an array of 1 or more cell names (none of them a wall, all on the board) and bonus is a whole number from 1 to 9; when it is missing there are no zones. actions is an array of strings, one attempted action each.',
  '',
  'BOARD. A cell is named by one lowercase column letter followed by a row number without leading zeros. Column "a" is the first character of each string of rows and row 1 is the first string of rows, so "c2" is the character with index 2 of rows[1]. A cell name that is well formed but lies outside the board is off-board. The character of a cell gives its terrain and its capacity (the largest height a tower may have there): "." plain, capacity 4; "~" marsh, capacity 4; "*" shrine, capacity 4; "^" ridge, capacity 2; "=" bridge, capacity 3; "#" wall, capacity 0 (a wall never holds a disc). All cells start empty. Every relic named in setup.relics is a cell that is not a wall.',
  '',
  'TOWERS. A cell holds a tower: a list of discs from bottom to top, each owned by A or B. The height is the number of discs. The controller of a tower is the owner of its top disc (an empty cell has no controller). The top run of a tower is the number of discs, counted from the top down, that have the same owner as the top disc. A tower is sealed when its height equals the capacity of its cell and all its discs have the same owner (so two discs of one owner on a ridge are sealed; an empty cell is never sealed). A disc that is "removed from the game" is gone for good and is not returned to a reserve.',
  '',
  'ACTION TEXT. An action string consists of tokens separated by exactly one space, with no space at the start or the end. A cell token is one lowercase letter a-z followed by a number without leading zeros and at least 1 (so "a0", "a01", "A1", "aa1" and "a1x" are not cell tokens). A count token is a whole number from 1 to 999999 without leading zeros. The forms are: "put CELL", "go CELL CELL COUNT", "swap CELL CELL", "run CELL CELL CELL" with 3, 4 or 5 cell tokens in all, "lift CELL", "fort CELL" and "pass". Any other string is bad-format: an unknown verb, a wrong number of tokens, a token that is not well formed, an extra or a missing space, a letter in the wrong case. A string with the right form whose cell is outside the board is not bad-format; it fails the off-board check below.',
  '',
  'TURNS. Actions are played in the order of the array. The player named by first acts first. After every action that is played, whether it was legal or not, the turn passes to the other player. The player whose turn it is is the actor of the action.',
  '',
  'LEGAL ACTIONS. An action that is not bad-format is legal when it passes every check listed for its verb. The checks are made in the order given, and the first check that fails is the reason of the fault. A legal action then has its effect.',
  '- put CELL (the actor places one disc from the actor\'s reserve). Checks: (1) off-board; (2) wall: the cell is a wall; (3) no-build: the cell is a bridge; (4) no-reserve: the actor\'s reserve is 0; (5) enemy-held: the controller of the cell is the opponent; (6) full: the height equals the capacity; (7) guarded: the cell is empty and at least one of its orthogonal neighbours (up, down, left, right; those that exist) has the opponent as controller and a height of at least 3. Effect: the reserve of the actor falls by 1 and a disc of the actor is placed on top of the tower.',
  '- go FROM TO COUNT (the actor moves the top COUNT discs of one tower onto the tower of a neighbouring cell). Checks: (1) off-board: either cell is outside the board; (2) not-adjacent: FROM and TO are not orthogonal neighbours (the same cell twice is not adjacent); (3) wall: either cell is a wall; (4) empty: FROM holds no disc; (5) not-yours: the controller of FROM is the opponent; (6) sealed: FROM is sealed; (7) too-many: COUNT is more than the height of FROM; (8) full: height(TO) + COUNT is more than the capacity of TO; (9) if the controller of TO is the opponent: (9a) sealed: TO is sealed; (9b) too-weak: COUNT is less than the top run of TO, plus 1 more when TO is a shrine, plus 1 more when TO has a fort that belongs to the opponent (see fort). Effect: the top COUNT discs leave FROM as one block. If the controller of TO is the opponent, this is an assault and the top disc of TO (the one under the landing block, taken before the block lands) is converted: it now belongs to the actor. Then the block is put on top of TO in the same order (the disc that was on top of FROM is on top of TO).',
  '- swap FIRST SECOND (the actor exchanges two whole towers). Checks: (1) off-board; (2) not-adjacent; (3) wall; (4) empty: either cell holds no disc; (5) not-yours: either tower has the opponent as controller; (6) sealed: either tower is sealed; (7) full: the height of one tower is more than the capacity of the other cell. Effect: the two lists of discs change places.',
  '- run C1 C2 ... Ck (the actor sends the top disc of the first tower along a path of k cells, 3 <= k <= 5). Checks: (1) off-board: any cell; (2) not-adjacent: two cells that follow each other in the path are not orthogonal neighbours; (3) wall: any cell; (4) empty: C1 holds no disc; (5) not-yours: the controller of C1 is the opponent; (6) sealed: C1 is sealed; (7) repeat: a cell occurs twice in the path; (8) blocked: some cell strictly between C1 and Ck has the opponent as controller or has a height equal to its capacity; (9) full: Ck has a height equal to its capacity; (10) if the controller of Ck is the opponent: (10a) sealed: Ck is sealed; (10b) too-weak: the top run of Ck, plus 1 more when Ck is a shrine, plus 1 more when Ck has a fort that belongs to the opponent, is more than 1. Effect: the top disc of C1 is taken off. Let w be the number of marsh cells among C2 ... Ck. If w is 2 or more the disc drowns: it is removed from the game and nothing else changes. Otherwise, if the controller of Ck is the opponent, the top disc of Ck is converted (it now belongs to the actor) as in an assault by go; then the disc is put on top of Ck. The cells between are not changed.',
  '- lift CELL (the actor takes the top disc back). Checks: (1) off-board; (2) wall; (3) empty; (4) not-yours; (5) sealed; (6) too-low: the height is less than 2. Effect: the top disc is removed from the tower and the reserve of the actor rises by 1.',
  '- fort CELL (the actor builds a fort on a tower). Checks: (1) off-board; (2) wall; (3) no-build: the cell is a bridge; (4) no-reserve: the reserve of the actor is less than 2; (5) empty; (6) not-yours; (7) fortified: the cell already has a fort (of either player); (8) too-many-forts: the actor already owns 2 forts. Effect: the reserve of the actor falls by 2 (those discs are removed from the game) and the cell gets a fort that belongs to the actor for the rest of the game, whoever controls the tower later. A fort changes no tower, so no sinking, collapse or monument step follows it, but it is a legal action that counts for the EVENTS below. A tide or a storm does nothing to a cell that has a fort.',
  '- pass is always legal and has no effect.',
  '',
  'FAULTS. An action that is bad-format or has a failed check is a fault of its actor. It changes nothing on the board. The fault is logged as the text "N:reason", where N is the 1-based position of the action in the array and reason is the name used above (for example "7:wall"; "bad-format" for the case of the ACTION TEXT section). The faults of a player are counted.',
  '',
  'AFTER A LEGAL PUT, GO, SWAP OR RUN. Let the changed cells be: for put, the cell; for go, TO; for swap, FIRST and then SECOND; for run, Ck when the disc was put there (none when it drowned). Step 1, sinking: for every changed cell that is a marsh, while the height is more than 2 the bottom disc is removed from the game. Step 2, collapse: for every changed cell that is a bridge, if the height is 3 and the three discs do not all have the same owner, all three discs are removed from the game (a bridge with three discs of one owner stays; it is sealed). Step 3, monuments: for every changed cell in the order above, if the tower is sealed and that cell has not been a monument before, the cell becomes a monument and the reserve of the controller rises by 1 (a cell can be a monument once in the whole game, even if it is sealed again later). Steps 1 and 2 are done for all changed cells (in the order above) before step 3 starts, and step 3 uses the towers as they are after steps 1 and 2.',
  'A lift and a fort change no cell for these steps: neither sinking nor collapse nor monuments happen after them.',
  '',
  'EVENTS. Count the legal actions that are not a pass, over both players, starting with 1 (a fault and a pass are not counted). After the steps above, for the legal action with count c: if c is a multiple of 4, the tide happens: every marsh tower of height 2 or more loses its bottom disc (removed from the game). Then, if c is a multiple of 6, the harvest happens: for every cell that is a shrine or a relic (a cell that is both counts once) whose tower has a controller, the harvest score of that controller rises by 1. Then, if c is a multiple of 8, the supply happens: each player who controls 3 or more towers gets 1 more disc in the reserve. Then, if c is a multiple of 10, the storm happens: on every ridge whose tower is not empty and not sealed, the top disc is removed from the game. Several events at one count happen in this order: tide, harvest, supply, storm. (The tide and the storm skip a cell that has a fort.)',
  '',
  'END OF THE GAME. A legal pass makes the pass streak one higher, and any other legal action sets the streak to 0; faults do not change the streak. The game ends at once, with the action just played as the last one, in these cases: when the streak is 2 (ended "passes"); when the fault just logged is the third fault of its actor (ended "forfeit", and that actor is the forfeiter). When the actions are used up, the game ends with ended "actions". Actions after the end are not played and not counted.',
  '',
  'SCORING. The score of a player is the sum of: (a) tower points for every tower that the player controls: let h be the height; the base is h; on a shrine it is 2h; on a marsh it is floor(h / 2); on a ridge it is h + 1; on a bridge it is max(0, h - 1); on plain it is h. Then add 3 if the tower is sealed, then add 2 if the cell is a relic, then add 2 if the cell has a fort that belongs to the controller of the tower. (b) The chain bonus: consider the cells whose tower the player controls; two such cells are connected when they are orthogonal neighbours; let s be the size of the largest connected group of such cells; the bonus is 2 * (s - 1) when s >= 2, else 0. (c) floor(reserve / 2) for the reserve the player has at the end. (d) the harvest score of the player. (e) minus 2 for every fault of the player. (f) the zone bonuses: for each zone, count for each player how many cells of the zone hold a tower that the player controls; if the counts are equal, nobody gets the bonus; otherwise the player with the larger count gets the bonus of the zone, doubled when that count is equal to the number of cells of the zone and the zone has at least 2 cells. The score can be negative. The winner is: when the game ended by forfeit, the player who is not the forfeiter, whatever the scores are; otherwise the player with the higher score; with equal scores the player who controls more towers; if that is equal too, "draw".',
  '',
  'RESULT. Return an object with these keys: rows: an array of strings, one per row of the board; in a row the cells are written from the first column to the last and joined by "|"; a wall is "#", an empty cell that is not a wall is "-", any other cell is its discs from bottom to top as letters (for example "ABB"). reserve: { A, B } the reserves at the end. score: { A, B } the final scores. faults: the array of fault texts in order. played: the number of actions played. ended: "passes", "forfeit" or "actions". winner: "A", "B" or "draw".',
].join('\n');

// A random game that stays legal for most actions: the reference tells whether a candidate action is a fault.
const playCairn = reference('cairn-rules', 'playCairn');

function randomSetup(seed) {
  const next = lcg(seed);
  const width = 4 + draw(next, 3);
  const height = 4 + draw(next, 2);
  const kinds = '.......~~**^^==#';
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = '';
    for (let x = 0; x < width; x += 1) row += kinds[draw(next, kinds.length)];
    rows.push(row);
  }
  const relics = [];
  for (let i = 0; i < 2; i += 1) {
    const x = draw(next, width);
    const y = draw(next, height);
    const name = String.fromCharCode(97 + x) + (y + 1);
    if (rows[y][x] !== '#' && !relics.includes(name)) relics.push(name);
  }
  return { rows, reserve: 7 + draw(next, 5), first: draw(next, 2) === 0 ? 'A' : 'B', relics };
}

function randomGame(seed, length) {
  const setup = randomSetup(seed);
  const next = lcg(seed * 7 + 3);
  const width = setup.rows[0].length;
  const height = setup.rows.length;
  const cellName = (x, y) => String.fromCharCode(97 + x) + (y + 1);
  const actions = [];
  let state = playCairn(setup, actions);
  let actor = setup.first;
  const other = (p) => (p === 'A' ? 'B' : 'A');
  const mine = () => {
    const cells = [];
    state.rows.forEach((row, y) => row.split('|').forEach((cell, x) => {
      if (cell !== '#' && cell !== '-' && cell.endsWith(actor)) cells.push([x, y]);
    }));
    return cells;
  };
  const neighbour = ([x, y]) => {
    const steps = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const [dx, dy] = steps[draw(next, 4)];
    return [x + dx, y + dy];
  };
  const inside = ([x, y]) => x >= 0 && y >= 0 && x < width && y < height;
  const anyCell = () => [draw(next, width), draw(next, height)];
  for (let step = 0; step < length; step += 1) {
    let chosen = null;
    for (let attempt = 0; attempt < 60 && !chosen; attempt += 1) {
      const own = mine();
      const pick = draw(next, 100);
      let candidate;
      if (pick < 38 || own.length === 0) {
        const cell = pick < 20 || own.length === 0 ? anyCell() : own[draw(next, own.length)];
        candidate = `put ${cellName(...cell)}`;
      } else if (pick < 66) {
        const from = own[draw(next, own.length)];
        const to = neighbour(from);
        if (!inside(to)) continue;
        candidate = `go ${cellName(...from)} ${cellName(...to)} ${1 + draw(next, 3)}`;
      } else if (pick < 78) {
        const from = own[draw(next, own.length)];
        const path = [from];
        for (let i = 0; i < 2 + draw(next, 3); i += 1) path.push(neighbour(path[path.length - 1]));
        if (!path.every(inside)) continue;
        candidate = `run ${path.map((cell) => cellName(...cell)).join(' ')}`;
      } else if (pick < 88) {
        const from = own[draw(next, own.length)];
        const to = neighbour(from);
        if (!inside(to)) continue;
        candidate = `swap ${cellName(...from)} ${cellName(...to)}`;
      } else if (pick < 92) {
        candidate = `lift ${cellName(...own[draw(next, own.length)])}`;
      } else if (pick < 96) {
        candidate = `fort ${cellName(...own[draw(next, own.length)])}`;
      } else if (pick < 98) {
        candidate = 'pass';
      } else if (pick < 99) {
        const bad = ['put', 'put  a1', 'go a1 a2', 'lift a1 ', 'swap A1 b1', 'run a1 b1', 'go a1 b1 0', 'put a01', 'jump a1', 'go a1 b1 1000000'];
        candidate = bad[draw(next, bad.length)];
      } else {
        candidate = `put ${cellName(width + draw(next, 2), draw(next, height + 1))}`;
      }
      const trial = playCairn(setup, [...actions, candidate]);
      const faulty = trial.faults.length > state.faults.length;
      const faultsOfActor = state.faults.length;
      if (trial.ended !== 'actions') continue;
      if (faulty && !(draw(next, 9) === 0 && faultsOfActor < 5)) continue;
      chosen = { candidate, trial };
    }
    if (!chosen) break;
    actions.push(chosen.candidate);
    state = chosen.trial;
    actor = other(actor);
  }
  return [setup, actions];
}

// Hand-derived (worked out from the task text; the reference has to agree). The five longest, which use many rules at once, are
// hidden tests; the others are small worked examples of single rules that tests/ladder-code-supreme-b.test.mjs checks against the reference.
const worked = [
  // Board 3 x 2 of plain cells, reserve 3, A first. 1 A puts a1 [A]. 2 B puts a2 [B]. 3 A puts a1 [A,A]. 4 B passes (streak 1).
  // 5 A passes (streak 2): ended "passes", played 5. Scores: A controls a1 (height 2) = 2, reserve 1 gives 0, so 2.
  // B controls a2 = 1, reserve 2 gives 1, so 2. Equal; both control 1 tower: draw.
  t('end-passes', [{ rows: ['...', '...'], reserve: 3, first: 'A' }, ['put a1', 'put a2', 'put a1', 'pass', 'pass']], {
    rows: ['AA|-|-', 'B|-|-'], reserve: { A: 1, B: 2 }, score: { A: 2, B: 2 }, faults: [], played: 5, ended: 'passes', winner: 'draw',
  }),
  // Board "#." / "..", reserve 1, B first. 1 B "put  a1" (two spaces): bad-format. 2 A put a1: a wall. 3 B put c1: off-board.
  // 4 A put b2: legal, A reserve 0, b2 = [A]. 5 B "put a0": bad-format, the third fault of B: forfeit, A wins.
  // Scores: A has b2 = 1, reserve 0, one fault (-2): -1. B has nothing, reserve 1 gives 0, three faults (-6): -6.
  t('forfeit', [{ rows: ['#.', '..'], reserve: 1, first: 'B' }, ['put  a1', 'put a1', 'put c1', 'put b2', 'put a0', 'put b1']], {
    rows: ['#|-', '-|A'], reserve: { A: 0, B: 1 }, score: { A: -1, B: -6 }, faults: ['1:bad-format', '2:wall', '3:off-board', '5:bad-format'], played: 5, ended: 'forfeit', winner: 'A',
  }),
  // Board "*.~" / "..^", reserve 6, A first.
  // 1 A put b1 [A]. 2 B put b2 [B]. 3 A put b1 [A,A]. 4 B go b2 b1 1: b1 is held by A with top run 2, so 1 < 2: too-weak (fault).
  // 5 A go b1 a1 2: both discs move to the shrine a1 [A,A]. 6 B put a2 [B]. 7 A put a1 [A,A,A]: that is the 6th legal action,
  // so the harvest gives A 1 (shrine a1 controlled by A). 8 B put a2 [B,B]. 9 A go a1 a2 3: height(a2) + 3 = 5 > 4: full (the full
  // check comes before the too-weak check). 10 B pass, 11 A pass: ended "passes".
  // A: a1 = 3 * 2 = 6, reserve 3 gives 1, harvest 1, one fault -2: 6. B: a2 = 2 and b2 = 1 (group of 2 gives +2) = 5, reserve 3 gives 1, one fault -2: 4.
  t('assault-weak', [{ rows: ['*.~', '..^'], reserve: 6, first: 'A' }, ['put b1', 'put b2', 'put b1', 'go b2 b1 1', 'go b1 a1 2', 'put a2', 'put a1', 'put a2', 'go a1 a2 3', 'pass', 'pass', 'put c1']], {
    rows: ['AAA|-|-', 'BB|B|-'], reserve: { A: 3, B: 3 }, score: { A: 6, B: 4 }, faults: ['4:too-weak', '9:full'], played: 11, ended: 'passes', winner: 'A',
  }),
  // Board "~~" / "^.", reserve 5, A first.
  // 1 A put a1 [A] (marsh). 2 B put a1: enemy-held. 3 A put a1 [A,A]. 4 B put b1 [B] (marsh). 5 A put a1 [A,A,A]: the marsh sinks the bottom
  // disc, [A,A]; this is the 4th legal action, so the tide removes the bottom disc of every marsh tower with 2 or more discs: a1 = [A].
  // 6 B put a2 [B] (ridge). 7 A put a2: enemy-held. 8 B put a2 [B,B]: sealed, a monument: B reserve +1. 9 A lift a1: too-low.
  // 10 B swap a2 b1: not adjacent. 11 A run a1 b1 b2: b1 is held by B and lies between: blocked; third fault of A: forfeit.
  // A: a1 = floor(1/2) = 0, reserve 2 gives 1, three faults: -5. B: a2 = 2 + 1 + 3 = 6, b1 = 0 (marsh, floor(1/2)), reserve 3 gives 1, two faults: 3.
  t('sinking', [{ rows: ['~~', '^.'], reserve: 5, first: 'A' }, ['put a1', 'put a1', 'put a1', 'put b1', 'put a1', 'put a2', 'put a2', 'put a2', 'lift a1', 'swap a2 b1', 'run a1 b1 b2', 'pass']], {
    rows: ['A|B', 'BB|-'], reserve: { A: 2, B: 3 }, score: { A: -5, B: 3 }, faults: ['2:enemy-held', '7:enemy-held', '9:too-low', '10:not-adjacent', '11:blocked'], played: 11, ended: 'forfeit', winner: 'B',
  }),
  // Board ".~." / "~=*", reserve 4, B first, relic c1.
  // 1 B put a1 [B]. 2 A put c1 [A]. 3 B put b2: no-build (bridge). 4 A put a1: enemy-held.
  // 5 B run a1 b1 c1: b1 is marsh (w = 1), so the disc lands on c1, which A holds with top run 1 on plain: the A disc is converted, c1 = [B,B]. 6 A put c2 [A] (shrine).
  // 7 B put c1 [B,B,B]. 8 A put b1: guarded (c1 is held by B, height 3). 9 B go c1 c2 2: c2 is held by A, top run 1, shrine: needs 2; ok.
  // The A disc of c2 is converted, then the block lands: c2 = [B,B,B], c1 = [B]. That is the 6th legal action: harvest. c2 (shrine) and c1 (relic)
  // are both held by B: B +2. 10 A pass. 11 B pass: ended "passes". Zone c1, c2 (bonus 3): B holds both cells: doubled, +6.
  // A: no tower, reserve 2 gives 1, two faults -4: -3. B: c2 = 3 * 2 = 6, c1 = 1 + 2 (relic) = 3, group of 2 gives +2, reserve 2 gives 1,
  // harvest 2, one fault -2, zone 6: 18.
  t('relic-run', [{ rows: ['.~.', '~=*'], reserve: 4, first: 'B', relics: ['c1'], zones: [{ cells: ['c1', 'c2'], bonus: 3 }] }, ['put a1', 'put c1', 'put b2', 'put a1', 'run a1 b1 c1', 'put c2', 'put c1', 'put b1', 'go c1 c2 2', 'pass', 'pass']], {
    rows: ['-|-|B', '-|-|BBB'], reserve: { A: 2, B: 2 }, score: { A: -3, B: 18 }, faults: ['3:no-build', '4:enemy-held', '8:guarded'], played: 11, ended: 'passes', winner: 'B',
  }),
  // Board "=.." / "..." / "...", reserve 7, A first, zones: a1 (bonus 4) and b1 + b2 (bonus 2). A makes filler puts on row 3.
  // 1 A put b1 [A]. 2 B put c1 [B]. 3 A put b1 [A,A]. 4 B put c1 [B,B]. 5 A put a3. 6 B go c1 b1 2: an assault (top run 2 needs 2): the top A disc is
  // converted and the block lands: b1 = [A,B,B,B]. 7 A put b3. 8 B go b1 b2 1: b2 = [B], b1 = [A,B,B]. 9 A put c3. 10 B put a2 [B].
  // 11 A put a3 [A,A]. 12 B go a2 a1 1: a1 is a bridge, a1 = [B]. 13 A put b3 [A,A]. 14 B swap b1 a1: a1 = [A,B,B] has 3 discs of two owners on a bridge:
  // it collapses and all three discs are removed, b1 = [B]. 15 A pass, 16 B pass: ended "passes".
  // A: a3 = 2, b3 = 2, c3 = 1, group of 3 gives +4, reserve 0: 9. B: b1 = 1, b2 = 1, group of 2 gives +2, reserve 4 gives 2, zone b1 + b2 held by B in full: 2 * 2 = 4: 10.
  // The zone a1 has no controlled cell: nobody gets its bonus.
  t('bridge-collapse', [{ rows: ['=..', '...', '...'], reserve: 7, first: 'A', zones: [{ cells: ['a1'], bonus: 4 }, { cells: ['b1', 'b2'], bonus: 2 }] }, ['put b1', 'put c1', 'put b1', 'put c1', 'put a3', 'go c1 b1 2', 'put b3', 'go b1 b2 1', 'put c3', 'put a2', 'put a3', 'go a2 a1 1', 'put b3', 'swap b1 a1', 'pass', 'pass']], {
    rows: ['-|B|-', '-|B|-', 'AA|AA|A'], reserve: { A: 0, B: 4 }, score: { A: 9, B: 10 }, faults: [], played: 16, ended: 'passes', winner: 'B',
  }),
  // Board "~~~." / "....", reserve 3, A first. 1 A put a1. 2 B pass. 3 A run a1 b1 c1 d1: b1 and c1 are marsh (w = 2): the disc drowns.
  // 4 B pass (streak 1; the legal run reset it). 5 A put d1 [A]. The actions end: ended "actions". A: d1 = 1, reserve 1 gives 0: 1. B: reserve 3 gives 1: 1.
  // Equal scores; A controls 1 tower, B none: A wins.
  t('drown', [{ rows: ['~~~.', '....'], reserve: 3, first: 'A' }, ['put a1', 'pass', 'run a1 b1 c1 d1', 'pass', 'put d1']], {
    rows: ['-|-|-|A', '-|-|-|-'], reserve: { A: 1, B: 3 }, score: { A: 1, B: 1 }, faults: [], played: 5, ended: 'actions', winner: 'A',
  }),
  // Board "..." / "*..", reserve 6, A first. 1 A put a1. 2 B put a2 (the shrine). 3 A put a1 [A,A]. 4 B fort a2: B reserve 5 - 2 = 3, the fort belongs to B.
  // 5 A go a1 a2 2: a2 needs top run 1 + shrine 1 + opponent fort 1 = 3 and COUNT is 2: too-weak. 6 B pass. 7 A fort a1: A reserve 4 - 2 = 2.
  // 8 B put b2 [B]: the 6th legal action: harvest, the shrine a2 is controlled by B: B +1. 9 A fort a1: fortified (A still has 2 discs, so no-reserve does not apply).
  // 10 B fort a1: the tower is controlled by A: not-yours. 11 A pass, 12 B pass: ended "passes".
  // A: a1 = 2 + 2 (own fort) = 4, reserve 2 gives 1, two faults -4: 1. B: a2 = 1 * 2 + 2 (own fort) = 4, b2 = 1, group of 2 gives +2,
  // reserve 2 gives 1, harvest 1, one fault -2: 7.
  t('fort', [{ rows: ['...', '*..'], reserve: 6, first: 'A' }, ['put a1', 'put a2', 'put a1', 'fort a2', 'go a1 a2 2', 'pass', 'fort a1', 'put b2', 'fort a1', 'fort a1', 'pass', 'pass']], {
    rows: ['AA|-|-', 'B|B|-'], reserve: { A: 2, B: 2 }, score: { A: 1, B: 7 }, faults: ['5:too-weak', '9:fortified', '10:not-yours'], played: 12, ended: 'passes', winner: 'B',
  }),
  // Board 2 x 2 plain, reserve 5, A first. 1 A "Put a1" (capital P), 2 B "put a1 " (trailing space), 3 A "put A1" (capital column),
  // 4 B "put aa1" (two letters): four faults, bad-format. 5 A put b2 [A], reserve 4. 6 B "go a1 b1 0" (count 0): the third fault of B: forfeit.
  // A: b2 = 1, reserve 4 gives 2, two faults -4: -1. B: reserve 5 gives 2, three faults -6: -4.
  t('bad-format', [{ rows: ['..', '..'], reserve: 5, first: 'A' }, ['Put a1', 'put a1 ', 'put A1', 'put aa1', 'put b2', 'go a1 b1 0', 'pass']], {
    rows: ['-|-', '-|A'], reserve: { A: 4, B: 5 }, score: { A: -1, B: -4 }, faults: ['1:bad-format', '2:bad-format', '3:bad-format', '4:bad-format', '6:bad-format'], played: 6, ended: 'forfeit', winner: 'A',
  }),
  // Board "#." / "..", reserve 1, A first. 1 A "go a1 a1 1": the same cell twice is not-adjacent (this check comes before the wall check). 2 B "go a1 b1 1":
  // a1 is a wall. 3 A put b1 [A], reserve 0. 4 B "go b1 b2 1": the tower belongs to A: not-yours. 5 A "go b1 b2 2": too-many.
  // 6 B put b2 [B]. 7 A pass: the actions end. A: b1 = 1, two faults -4: -3. B: b2 = 1, two faults -4: -3. Equal scores, one tower each: draw.
  t('check-order', [{ rows: ['#.', '..'], reserve: 1, first: 'A' }, ['go a1 a1 1', 'go a1 b1 1', 'put b1', 'go b1 b2 1', 'go b1 b2 2', 'put b2', 'pass']], {
    rows: ['#|A', '-|B'], reserve: { A: 0, B: 0 }, score: { A: -3, B: -3 }, faults: ['1:not-adjacent', '2:wall', '4:not-yours', '5:too-many'], played: 7, ended: 'actions', winner: 'draw',
  }),
  // Board "..." / "...", reserve 3, A first. 1 A put a1. 2 B put b2. 3 A put b1. 4 B pass. 5 A put b1 [A,A]. 6 B pass (streak 1).
  // 7 A swap a1 b1: a1 = [A,A], b1 = [A]. 8 B pass (streak 1; the swap reset it): the actions end.
  // A: a1 = 2, b1 = 1, group of 2 gives +2, reserve 0: 5. B: b2 = 1, reserve 2 gives 1: 2.
  t('swap', [{ rows: ['...', '...'], reserve: 3, first: 'A' }, ['put a1', 'put b2', 'put b1', 'pass', 'put b1', 'pass', 'swap a1 b1', 'pass']], {
    rows: ['AA|A|-', '-|B|-'], reserve: { A: 0, B: 2 }, score: { A: 5, B: 2 }, faults: [], played: 8, ended: 'actions', winner: 'A',
  }),
];

const HIDDEN = new Set(['assault-weak', 'sinking', 'relic-run', 'bridge-collapse', 'fort']);
const hand = worked.filter((one) => HIDDEN.has(one.edge));
const examples = worked.filter((one) => !HIDDEN.has(one.edge));

const computed = [];
const seeds = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const lengths = [60, 70, 80, 90, 100, 110, 120, 90, 80, 100, 70, 110];
seeds.forEach((seed, index) => computed.push(t('mixed-play', randomGame(seed, lengths[index]))));

export default {
  slug: 'cairn-rules',
  tier: {
    level: 5,
    human_minutes: 420,
    basis: 'A referee for an invented stacking game: an action parser, five verbs with ordered legality checks (about 40 reasons), sinking, monuments, tide, harvest and storm events counted over legal actions, a scoring rule with four terrain formulas, a connected-group bonus and a forfeit rule. The reference is about 450 lines. An expert needs a full working day to read about 60 stated rules closely, write the referee and check it against worked examples.',
  },
  tags: ['spec'],
  name: 'playCairn',
  signature: 'playCairn(setup, actions) -> object',
  task: spec,
  edges: {
    'assault-weak': 'plus 1 more when to is a shrine',
    sinking: 'while the height is more than 2 the bottom disc is removed from the game',
    'relic-run': 'a cell that is both counts once',
    'bridge-collapse': 'all three discs are removed from the game',
    fort: 'the actor already owns 2 forts',
    'mixed-play': 'several events at one count happen in this order',
    'action-whitespace': 'tokens separated by exactly one space, with no space at the start or the end',
  },
  examples,
  tests: [...hand, ...computed, t('action-whitespace', [{ rows: ['.'], reserve: 1, first: 'A' }, [' put a1', 'put  a1', 'put\ta1', 'put a1 ']], {
    rows: ['-'], reserve: { A: 1, B: 1 }, score: { A: -4, B: -4 }, faults: ['1:bad-format', '2:bad-format', '3:bad-format', '4:bad-format'], played: 4, ended: 'actions', winner: 'draw',
  })],
};
