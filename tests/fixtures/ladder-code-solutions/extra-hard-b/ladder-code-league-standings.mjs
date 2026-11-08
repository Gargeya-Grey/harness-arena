function standings(rules, teams, events) {
  const { win, draw, goals, bonus } = rules;
  const stored = new Map();
  const deduction = {};
  const cards = {};
  for (const team of teams) {
    deduction[team] = 0;
    cards[team] = 0;
  }
  for (const event of events) {
    const kind = event[0];
    if (kind === 'match') {
      const [, id, home, away, hg, ag] = event;
      stored.set(id, { home, away, hg, ag, awarded: false });
    } else if (kind === 'award') {
      const [, id, home, away, side] = event;
      stored.set(id, { home, away, hg: side === 'H' ? 3 : 0, ag: side === 'H' ? 0 : 3, awarded: true });
    } else if (kind === 'void') {
      stored.delete(event[1]);
    } else if (kind === 'deduct') {
      if (event[1] in deduction) deduction[event[1]] += event[2];
    } else if (kind === 'card') {
      if (event[1] in cards) cards[event[1]] += event[2];
    }
  }
  const known = new Set(teams);
  const matches = [...stored.values()].filter((m) => known.has(m.home) && known.has(m.away));

  const pointsOf = (m, gf, ga) => {
    let points = gf > ga ? win : gf === ga ? draw : 0;
    if (!m.awarded) {
      if (gf >= goals) points += bonus;
      if (ga - gf === 1) points += bonus;
    }
    return points;
  };
  // Record of every team in `set` from the matches between two members of the set.
  const record = (set) => {
    const rec = {};
    for (const team of set) rec[team] = { played: 0, points: 0, gf: 0, ga: 0 };
    for (const m of matches) {
      if (!set.has(m.home) || !set.has(m.away)) continue;
      for (const [team, gf, ga] of [[m.home, m.hg, m.ag], [m.away, m.ag, m.hg]]) {
        const r = rec[team];
        r.played += 1;
        r.points += pointsOf(m, gf, ga);
        r.gf += gf;
        r.ga += ga;
      }
    }
    return rec;
  };
  const overall = record(known);
  const total = (team) => overall[team].points - deduction[team];
  const gd = (team) => overall[team].gf - overall[team].ga;

  const byOverall = (group) => [...group].sort((a, b) => gd(b) - gd(a) || overall[b].gf - overall[a].gf || cards[a] - cards[b] || (a < b ? -1 : a > b ? 1 : 0));
  const resolve = (group) => {
    if (group.length === 1) return group;
    const rec = record(new Set(group));
    const key = (team) => [rec[team].points, rec[team].gf - rec[team].ga, rec[team].gf];
    const sorted = [...group].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return kb[0] - ka[0] || kb[1] - ka[1] || kb[2] - ka[2];
    });
    const parts = [];
    for (const team of sorted) {
      const last = parts[parts.length - 1];
      if (last && key(last[0]).join() === key(team).join()) last.push(team);
      else parts.push([team]);
    }
    if (parts.length === 1) return byOverall(group);
    return parts.flatMap(resolve);
  };

  const ordered = [...teams].sort((a, b) => total(b) - total(a));
  const table = [];
  for (let i = 0; i < ordered.length;) {
    let j = i;
    while (j < ordered.length && total(ordered[j]) === total(ordered[i])) j += 1;
    table.push(...resolve(ordered.slice(i, j)));
    i = j;
  }
  return table.map((team) => [team, overall[team].played, total(team), gd(team), overall[team].gf]);
}
