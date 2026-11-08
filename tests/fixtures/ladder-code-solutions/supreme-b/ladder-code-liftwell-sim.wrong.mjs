function liftwell(spec) {
  const dwell = spec.dwell === undefined ? 2 : spec.dwell;
  const flow = spec.flow === undefined ? 2 : spec.flow;
  const park = spec.park === undefined ? 4 : spec.park;
  const until = spec.until;
  const events = spec.events || [];
  const log = [];
  let fire = false;

  const cars = spec.cars.map((car) => ({
    id: car.id,
    floor: car.floor,
    home: car.floor,
    cap: car.cap,
    zone: car.serves || 'all',
    dir: null,
    doors: 0,
    idle: 0,
    riders: [],
    out: false,
    moved: 0,
    stops: 0,
  }));

  const people = spec.people.map((p, index) => ({
    id: p.id,
    t: p.t,
    from: p.from,
    to: p.to,
    w: p.w === undefined ? 1 : p.w,
    vip: Boolean(p.vip),
    index,
    state: 'future',
    car: null,
    assigned: null,
    board: null,
    done: null,
  }));

  // ------------------------------------------------------------------ helpers

  const serves = (car, floor) => floor === 1 || car.zone === 'all' || (car.zone === 'even' ? floor % 2 === 0 : floor % 2 === 1);
  const dirOf = (p) => (p.to > p.from ? 'up' : 'down');
  const load = (car) => car.riders.reduce((sum, r) => sum + r.w, 0);
  const byOrder = (a, b) => a.t - b.t || a.index - b.index;
  const byPriority = (a, b) => Number(b.vip) - Number(a.vip) || byOrder(a, b);
  const assignedTo = (car) => people.filter((p) => p.state === 'waiting' && p.assigned === car.id);

  function stopCount(car) {
    const floors = new Set();
    for (const r of car.riders) floors.add(r.to);
    for (const p of assignedTo(car)) floors.add(p.from);
    return floors.size;
  }

  // The direction the car takes from its floor: keep going while a target lies ahead, else turn,
  // else none. A target is a rider's floor or the floor of a person assigned to the car; targets at
  // the floor of the car do not count.
  function direction(car) {
    const f = car.floor;
    let ups = false;
    let downs = false;
    for (const r of car.riders) {
      if (r.to > f) ups = true;
      if (r.to < f) downs = true;
    }
    for (const p of assignedTo(car)) {
      if (p.from > f) ups = true;
      if (p.from < f) downs = true;
    }
    if (car.dir === 'up' && ups) return 'up';
    if (car.dir === 'down' && downs) return 'down';
    if (ups && downs) return 'up';
    if (ups) return 'up';
    if (downs) return 'down';
    return null;
  }

  function mayBoard(car, p, sd) {
    return p.state === 'waiting' && p.assigned === car.id && p.from === car.floor;
  }

  // ------------------------------------------------------------------ the phases of a tick

  function applyEvents(tick) {
    for (const e of events) {
      if (e.t !== tick) continue;
      const car = cars.find((c) => c.id === e.car);
      if (e.kind === 'out' && car && !car.out) {
        car.out = true;
        for (const r of car.riders) {
          r.state = 'dropped';
          r.done = tick;
          log.push(`${tick} ${car.id} drop ${r.id}`);
        }
        car.riders = [];
        car.doors = 0;
        car.dir = null;
        for (const p of assignedTo(car)) p.assigned = null;
      } else if (e.kind === 'back' && car && car.out) {
        car.out = false;
        car.idle = 0;
      } else if (e.kind === 'fire') {
        fire = true;
        for (const c of cars) c.doors = 0;
        for (const p of people) if (p.state === 'waiting') p.assigned = null;
      } else if (e.kind === 'clear' && fire) {
        fire = false;
        for (const c of cars) {
          c.dir = null;
          c.idle = 0;
          c.doors = 0;
        }
      }
    }
  }

  function arrivals(tick) {
    for (const p of people) {
      if (p.t !== tick) continue;
      const bad = !Number.isInteger(p.from) || !Number.isInteger(p.to) || p.from < 1 || p.to < 1 || p.from > spec.floors || p.to > spec.floors || p.from === p.to;
      const nobody = !cars.some((c) => serves(c, p.from) && serves(c, p.to));
      if (bad || nobody) {
        p.state = 'void';
        continue;
      }
      p.state = 'waiting';
    }
  }

  function dispatch() {
    if (fire) return;
    const queue = people.filter((p) => p.state === 'waiting' && p.assigned === null).sort(byOrder);
    for (const p of queue) {
      let best = null;
      cars.forEach((car, order) => {
        if (car.out || !serves(car, p.from) || !serves(car, p.to)) return;
        let cost = Math.abs(car.floor - p.from) + 4 * stopCount(car);
        if ((car.dir === 'up' && p.from < car.floor) || (car.dir === 'down' && p.from > car.floor)) cost += 6;
        const carried = load(car);
        if (carried * 5 >= car.cap * 4) cost += 10;
        const key = [cost, carried, order];
        if (best === null || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) {
          best = { car, key };
        }
      });
      if (best !== null) p.assigned = best.car.id;
    }
  }

  function doorTick(car, tick) {
    const f = car.floor;
    const sd = direction(car);
    let busy = false;
    const leaving = car.riders.filter((r) => r.to === f).slice(0, flow);
    for (const r of leaving) {
      car.riders.splice(car.riders.indexOf(r), 1);
      r.state = 'done';
      r.done = tick;
      log.push(`${tick} ${car.id} out ${r.id}`);
      busy = true;
    }
    const waiting = people.filter((p) => mayBoard(car, p, sd)).sort(byPriority);
    let boarded = 0;
    for (const p of waiting) {
      if (boarded >= flow) break;
      if (load(car) + p.w <= car.cap) {
        p.state = 'riding';
        p.board = tick;
        p.car = car.id;
        p.assigned = null;
        car.riders.push(p);
        boarded += 1;
        busy = true;
        log.push(`${tick} ${car.id} in ${p.id}`);
      } else {
        p.assigned = null;
      }
    }
    car.dir = direction(car);
    car.doors = busy ? dwell : car.doors - 1;
  }

  function recallStep(car, tick) {
    if (car.doors > 0 || (car.floor === 1 && car.riders.length > 0)) {
      if (car.doors === 0) {
        car.stops += 1;
        log.push(`${tick} ${car.id} open 1`);
        car.doors = dwell;
      }
      const leaving = car.riders.slice(0, flow);
      for (const r of leaving) {
        car.riders.splice(car.riders.indexOf(r), 1);
        r.state = 'evac';
        r.done = tick;
        log.push(`${tick} ${car.id} evac ${r.id}`);
      }
      car.doors = leaving.length > 0 ? dwell : car.doors - 1;
      return;
    }
    if (car.floor === 1) {
      car.dir = null;
      return;
    }
    car.dir = 'down';
    car.floor -= 1;
    car.moved += 1;
  }

  function carStep(car, tick) {
    if (car.out) return;
    if (fire) {
      recallStep(car, tick);
      return;
    }
    if (car.doors > 0) {
      doorTick(car, tick);
      return;
    }
    const f = car.floor;
    const sd = direction(car);
    const stop = car.riders.some((r) => r.to === f) || people.some((p) => mayBoard(car, p, sd) && load(car) + p.w <= car.cap);
    if (stop) {
      car.stops += 1;
      car.idle = 0;
      log.push(`${tick} ${car.id} open ${f}`);
      car.doors = dwell;
      doorTick(car, tick);
      return;
    }
    if (sd !== null) {
      car.dir = sd;
      car.floor += sd === 'up' ? 1 : -1;
      car.moved += 1;
      car.idle = 0;
      return;
    }
    car.dir = null;
    car.idle += 1;
    if (car.idle > park && car.floor !== car.home) {
      car.floor += car.home > car.floor ? 1 : -1;
      car.moved += 1;
    }
  }

  // ------------------------------------------------------------------ the run

  for (let tick = 0; tick <= until; tick += 1) {
    applyEvents(tick);
    arrivals(tick);
    dispatch();
    for (const car of cars) carStep(car, tick);
  }

  return {
    people: people.map((p) => `${p.id}:${p.state}:${p.car === null ? '-' : p.car}:${p.board === null ? '-' : p.board}:${p.done === null ? '-' : p.done}`),
    cars: cars.map((c) => `${c.id}:${c.floor}:${c.out ? 'out' : c.doors > 0 ? 'open' : c.dir === null ? 'idle' : c.dir}:${load(c)}:${c.moved}:${c.stops}`),
    log,
  };
}
