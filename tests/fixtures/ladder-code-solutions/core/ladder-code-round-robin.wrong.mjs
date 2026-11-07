function roundRobin(jobs, quantum) {
  const pending = jobs.map((job, index) => ({ id: job[0], arrival: job[1], left: job[2], index }));
  pending.sort((a, b) => a.arrival - b.arrival || a.index - b.index);
  const queue = [];
  const done = [];
  let time = 0;
  let next = 0;
  const admit = () => {
    while (next < pending.length && pending[next].arrival <= time) {
      queue.push(pending[next]);
      next += 1;
    }
  };
  for (;;) {
    admit();
    if (queue.length === 0) {
      if (next >= pending.length) break;
      time = pending[next].arrival;
      continue;
    }
    const job = queue.shift();
    const run = Math.min(quantum, job.left);
    time += run;
    job.left -= run;
    if (job.left > 0) queue.push(job);
    else done.push([job.id, time]);
    admit();
  }
  return done;
}
