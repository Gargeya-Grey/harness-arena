function preemptiveSchedule(cpus, jobs) {
  const list = jobs.map(([id, arrival, burst, priority], index) => ({ id, arrival, left: burst, priority, index, start: -1, finish: -1, preempted: 0, running: false }));
  const before = (a, b) => a.priority - b.priority || a.index - b.index;
  let time = 0;
  let finished = 0;
  while (finished < list.length) {
    const ready = list.filter((j) => j.arrival <= time && j.left > 0).sort(before);
    if (ready.length === 0) {
      let soonest = Infinity;
      for (const j of list) if (j.left > 0 && j.arrival < soonest) soonest = j.arrival;
      time = soonest;
      continue;
    }
    const chosen = ready.slice(0, cpus);
    for (const j of list) {
      if (j.running && !chosen.includes(j)) {
        j.running = false;
        j.preempted += 1;
      }
    }
    for (const j of chosen) {
      j.running = true;
      if (j.start < 0) j.start = time;
    }
    let step = Infinity;
    for (const j of chosen) if (j.left < step) step = j.left;
    for (const j of list) if (j.left > 0 && j.arrival > time && j.arrival - time < step) step = j.arrival - time;
    time += step;
    for (const j of chosen) {
      j.left -= step;
      if (j.left === 0) {
        j.running = false;
        j.finish = time;
        finished += 1;
      }
    }
  }
  return list.map((j) => [j.id, j.start, j.finish, j.preempted]);
}
