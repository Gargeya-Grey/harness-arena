import { t, rng, randInt, pick } from './_util.mjs';

const task = [
  'Build the table of a football league. standings(rules, teams, events) returns the teams in table order. rules is { win, draw, goals, bonus }: win and draw are the points for a win and a draw, goals is the number of goals that earns a bonus, and bonus is the number of points for each bonus (all are integers of 0 or more). teams is an array of unique team names. events is an array that is read in order; the table is built from the matches that are stored at the end.',
  'Events: ["match", id, home, away, homeGoals, awayGoals]; ["award", id, home, away, side], where side is "H" or "A" and the match counts as a 3-0 win for that side; ["void", id]; ["deduct", team, points]; ["card", team, points].',
  'Matches. A match or award event stores the match under its id; a later match or award event with the same id replaces the stored one, and a void event removes it (a void for an id that is not stored does nothing). A stored match that names a team that is not in teams is ignored. A deduct or card event for a team that is not in teams is ignored. A team has played one game for each stored match it takes part in.',
  'Points of a match. A team gets win points for a win, draw points for a draw and 0 for a loss. For a match event (not for an award) it also gets bonus points when it scored goals goals or more, and bonus points again when it lost by exactly one goal; both can apply to the same team in one match. An award counts as 3 goals for and 0 goals against for the winner, 0 for and 3 against for the other team, and gives no bonus points.',
  'Totals. The total of a team is the sum of its points from all its matches minus the sum of the points of all its deduct events (it can be below 0). The card points of a team are the sum of its card events. GD is goals for minus goals against over all its matches, and GF is its goals for.',
  'Order. Teams are ordered by total, the most first. Teams with equal totals form a group, and each group is ordered like this. Take only the matches between two teams of the group (a mini-league; deductions do not count there) and, for each team, the points of those matches, the GD of those matches and the GF of those matches. Order the group by mini-league points, then mini-league GD, then mini-league GF, the most first. Teams that are equal on all three stay together as a subgroup. If the mini-league splits the group into more than one subgroup, every subgroup of two or more teams is ordered again in the same way, with the mini-league of that subgroup only (its own matches). If it does not split the group (all teams are equal on all three), the group is ordered by overall GD, then overall GF, the most first, then by fewer card points, then by team name in plain character order (a < b), the first first.',
  'The result is an array with one row [team, played, total, GD, GF] per team, in table order. A team with no matches has the row [team, 0, its total, 0, 0].',
].join(' ');

const rulesA = { win: 3, draw: 1, goals: 3, bonus: 1 };
const noBonus = { win: 3, draw: 1, goals: 3, bonus: 0 };
const m = (id, home, away, hg, ag) => ['match', id, home, away, hg, ag];

// A seeded league: a partial double round robin with low scores (many ties), corrections, voids, awards, deductions and cards.
function league(seed, size, rules, fill, top = 3) {
  const rand = rng(seed);
  const names = ['Ash', 'Birch', 'Cedar', 'Dune', 'Elm', 'Fern', 'Gorse', 'Heath', 'Ivy', 'Juno'].slice(0, size);
  const events = [];
  let n = 0;
  for (const home of names) {
    for (const away of names) {
      if (home === away || rand() > fill) continue;
      n += 1;
      const id = `r${n}`;
      const r = rand();
      if (r < 0.06) events.push(['award', id, home, away, rand() < 0.5 ? 'H' : 'A']);
      else events.push(m(id, home, away, randInt(rand, 0, top) + (rand() < 0.08 ? 2 : 0), randInt(rand, 0, top - 1)));
      if (rand() < 0.08) events.push(m(id, home, away, randInt(rand, 0, top - 1), randInt(rand, 0, top)));
      if (rand() < 0.05) events.push(['void', id]);
      if (rand() < 0.03) events.push(['void', `none${n}`]);
      if (rand() < 0.03) events.push(m(`x${n}`, home, 'Nobody', 2, 1));
    }
  }
  for (const team of names) {
    if (rand() < 0.25) events.push(['deduct', team, randInt(rand, 1, 3)]);
    if (rand() < 0.6) events.push(['card', team, randInt(rand, 1, 4)]);
  }
  // The events are read in order, so corrections come late: move a few events to the end.
  for (let i = 0; i < 4; i += 1) {
    const at = randInt(rand, 0, events.length - 1);
    events.push(events.splice(at, 1)[0]);
  }
  return [rules, pick(rand, [names, names.slice().reverse()]), events];
}


export default {
  slug: 'league-standings',
  tier: {
    level: 4,
    human_minutes: 70,
    basis: 'estimated from the reference (about 85 lines): replaced and voided matches, two kinds of bonus point, awards, deductions kept out of the mini-league, and an ordering that repeats the mini-league on the subgroups it leaves; the repeat rule and the fixed fallback order are where an expert spends the time',
  },
  tags: ['spec', 'simulation'],
  name: 'standings',
  signature: 'standings(rules, teams, events) -> array',
  task,
  edges: {
    bonus: 'both can apply to the same team in one match',
    award: 'gives no bonus points',
    replace: 'replaces the stored one',
    void: 'a void for an id that is not stored does nothing',
    'unknown-team': 'names a team that is not in teams is ignored',
    deduct: 'minus the sum of the points of all its deduct events',
    'mini-league': 'deductions do not count there',
    recursion: 'ordered again in the same way',
    'no-split': 'If it does not split the group',
    cards: 'then by fewer card points',
    name: 'in plain character order',
    unplayed: 'A team with no matches',
  },
  tests: [
    // m1 4-3: A 3 + 1 (4 goals) = 4; B 0 + 1 (3 goals) + 1 (lost by one) = 2. m2 1-1: 1 each. m3 0-2: C 3 (2 goals is under 3); A 0. C is deducted 2.
    // Totals A 4, B 2 + 1 = 3, C 1 + 3 - 2 = 2. GD: A (1) + (-2) = -1, B (-1) + 0 = -1, C 0 + 2 = 2. GF: A 4, B 3 + 1 = 4, C 1 + 2 = 3.
    t('bonus', [rulesA, ['A', 'B', 'C'], [m('m1', 'A', 'B', 4, 3), m('m2', 'B', 'C', 1, 1), m('m3', 'A', 'C', 0, 2), ['deduct', 'C', 2]]], [['A', 2, 4, -1, 4], ['B', 2, 4 - 1, -1, 4], ['C', 2, 2, 2, 3]]),
    // m1 is replaced by a 0-0 draw; m2 is voided, and a void of "zz" does nothing; m3 names X, which is not a team; the award m4 gives A 3 points (3 goals, no bonus) and C nothing.
    // m5 3-2 for B: 3 + 1 (3 goals); C lost by one: 0 + 1. Totals: A 1 + 3 = 4, B 1 + 4 = 5, C 1. GD: A 0 + 3 = 3, B 0 + 1 = 1, C -3 - 1 = -4. GF: A 3, B 3, C 2.
    t('award', [rulesA, ['A', 'B', 'C'], [m('m1', 'A', 'B', 2, 0), m('m1', 'A', 'B', 0, 0), m('m2', 'B', 'C', 1, 0), ['void', 'm2'], ['void', 'zz'], m('m3', 'A', 'X', 5, 0), ['award', 'm4', 'C', 'A', 'A'], m('m5', 'B', 'C', 3, 2)]], [['B', 2, 5, 1, 3], ['A', 2, 4, 3, 3], ['C', 2, 1, -4, 2]]),
    // A, B and C each win once and lose once against each other by 1-0, and all beat D: 6 points each. The mini-league is equal for the three (3 points, GD 0, GF 1),
    // so the order is the overall GD: A (+1 -1 +5) = 5, B (-1 +1 +2) = 2, C (+1 -1 +1) = 1. GF: A 1 + 0 + 5 = 6, B 0 + 1 + 2 = 3, C 1 + 0 + 1 = 2.
    t('no-split', [noBonus, ['A', 'B', 'C', 'D'], [m('1', 'A', 'B', 1, 0), m('2', 'B', 'C', 1, 0), m('3', 'C', 'A', 1, 0), m('4', 'A', 'D', 5, 0), m('5', 'B', 'D', 2, 0), m('6', 'C', 'D', 1, 0)]], [['A', 3, 6, 5, 6], ['B', 3, 6, 2, 3], ['C', 3, 6, 1, 2], ['D', 3, 0, -8, 0]]),
    // A, B, C have 6 points each. Mini-league: A 2-1 B, B 1-0 C, C 1-0 A: 3 points each, GD 0 each, GF A 2, B 2, C 1. C is last; {A, B} stays together.
    // A and B are ordered again by their own match: A won 2-1, so A is first, although B has the better overall GD (+4 against +1).
    t('recursion', [noBonus, ['A', 'B', 'C', 'D'], [m('1', 'A', 'B', 2, 1), m('2', 'B', 'C', 1, 0), m('3', 'C', 'A', 1, 0), m('4', 'A', 'D', 1, 0), m('5', 'B', 'D', 4, 0), m('6', 'C', 'D', 1, 0)]], [['A', 3, 6, 1, 3], ['B', 3, 6, 4, 6], ['C', 3, 6, 1, 2], ['D', 3, 0, -6, 0]]),
    // A has 6 points and loses 3: 3. B has 3 (it beat C). A and B are equal on 3; the mini-league (A beat B) puts A first, although B has the better overall GD (+5 against +2).
    t('mini-league', [noBonus, ['A', 'B', 'C'], [m('1', 'A', 'B', 1, 0), m('2', 'A', 'C', 1, 0), m('3', 'B', 'C', 6, 0), ['deduct', 'A', 3]]], [['A', 2, 3, 2, 2], ['B', 2, 3, 5, 6], ['C', 2, 0, -7, 0]]),
    // Three 0-0 draws: 2 points each, equal everywhere. Cards: M 1 + 1, N 1, O 1. Fewer cards first, and N before O by name.
    t('cards', [noBonus, ['M', 'N', 'O'], [m('1', 'M', 'N', 0, 0), m('2', 'N', 'O', 0, 0), m('3', 'M', 'O', 0, 0), ['card', 'M', 1], ['card', 'N', 1], ['card', 'O', 1], ['card', 'M', 1], ['card', 'Q', 5]]], [['N', 2, 2, 0, 0], ['O', 2, 2, 0, 0], ['M', 2, 2, 0, 0]]),
    // rules: win 2, draw 1, goals 2, bonus 1. 2-2: 1 + 1 each. B 1-0 A: B 2 + 0; A 0 + 1 (lost by one). A 5-0 B: A 2 + 1; B 0.
    t('bonus', [{ win: 2, draw: 1, goals: 2, bonus: 1 }, ['A', 'B'], [m('1', 'A', 'B', 2, 2), m('2', 'B', 'A', 1, 0), m('3', 'A', 'B', 5, 0)]], [['A', 3, 6, 4, 7], ['B', 3, 4, -4, 3]]),
    // No match: rows [name, 0, total, 0, 0]; the deduction makes A's total -4; Y and Z are equal everywhere, so the names decide.
    t('unplayed', [noBonus, ['Z', 'Y', 'A'], [['deduct', 'A', 4]]], [['Y', 0, 0, 0, 0], ['Z', 0, 0, 0, 0], ['A', 0, -4, 0, 0]]),
    // Seeded leagues. The low-scoring ones (top 1) have many equal totals, so the mini-league and its repeat decide places.
    t('name', league(1, 6, rulesA, 0.8)),
    t('void', league(1, 8, rulesA, 0.5)),
    t('replace', league(1, 8, { win: 3, draw: 1, goals: 2, bonus: 1 }, 0.55)),
    t('unknown-team', league(2, 8, noBonus, 0.8, 1)),
    t('deduct', league(1, 8, { win: 2, draw: 1, goals: 3, bonus: 1 }, 0.6)),
    t('mini-league', league(12, 8, noBonus, 0.8, 1)),
    t('recursion', league(140, 8, noBonus, 0.8, 1)),
    t('no-split', league(1, 10, { win: 3, draw: 2, goals: 2, bonus: 1 }, 0.4)),
  ],
};
