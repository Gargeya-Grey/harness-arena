import { t, lcg, draw } from './_util.mjs';

const spec = [
  'Implement liftwell(spec), a tick-by-tick simulation of a bank of lifts (elevators) in a building. spec is an object { floors, cars, people, events, dwell, flow, park, until }. floors is the number of floors; they are numbered 1 to floors (floor 1 is the lobby). cars is an array of cars { id, floor, cap, serves }: id is a string, floor is the start floor, cap is the weight the car can carry, serves is "all" (the default), "even" or "odd". people is an array of persons { id, t, from, to, w, vip }: id is a string, t is the tick at which the person arrives and presses the call button on floor from, to is the wanted floor, w is the weight (default 1), vip is true or false (default false). events is an optional array of { t, kind, car } (kinds below; car is a car id and only used by "out" and "back"). dwell (default 2), flow (default 2) and park (default 4) are whole numbers. until is the last tick that is simulated: the simulation runs the ticks 0, 1, 2, ..., until, in this order. Nothing in the input is checked beyond what this text says.',
  '',
  'The function returns { people, cars, log }, three arrays of strings (their form is at the end).',
  '',
  'WHAT A CAR KNOWS. A car has a floor, a direction (up, down or none), a door counter (the doors are open while it is above 0), a list of riders in the order in which they boarded, a count of the ticks it has been idle, its home floor (its start floor), and a count of moves (floors travelled) and of stops (times the doors were opened). A car serves a floor when serves is "all", or the floor is 1, or serves is "even" and the floor is even, or serves is "odd" and the floor is odd. A car is out of service while it is "out" (see EVENTS). The load of a car is the sum of the weights of its riders. A person is waiting from its arrival until it boards, and may be assigned to one car.',
  '',
  'A TICK. In each tick, these steps run in this order: (1) the events of the tick; (2) the arrivals; (3) the dispatch; (4) every car, in the order of the array cars. Each car completes its whole step before the next car starts, so the later cars see the riders and the assignments that the earlier cars have changed in the same tick.',
  '',
  'ARRIVALS. The persons whose t is the tick, in the order of the array people, become waiting. But a person is void (it never waits and is never considered again) when from or to is not a whole number between 1 and floors, or from equals to, or no car at all (in or out of service) serves both from and to.',
  '',
  'TARGETS AND DIRECTION. The targets of a car are the to floors of its riders and the from floors of the waiting persons assigned to it. For the floor f of a car, "ups" is true when some target is above f and "downs" is true when some target is below f (a target at f itself counts for neither). The direction function of the car is: up when the car direction is up and ups is true; down when the car direction is down and downs is true; otherwise up when ups is true (also when both are true); otherwise down when downs is true; otherwise none. The word direction-rule below means this function. A person goes up when to is above from and down otherwise.',
  '',
  'DISPATCH. Not done while a fire is on (see EVENTS). Take the waiting persons who are not assigned, oldest first (by t, then by position in people). For each one, in that order, look at every car that is not out of service and that serves both from and to. The cost of a car is: the distance |floor of the car - from|, plus 4 for every stop of the car, plus 6 when the car direction is up and from is below its floor, or the car direction is down and from is above its floor, plus 10 when 5 * load >= 4 * cap. A stop of the car is a different floor among the to floors of its riders and the from floors of the persons already assigned to it (also those assigned a moment ago in this same dispatch; floors that occur more than once count once). The person is assigned to the car with the lowest cost; on a tie the car with the smaller load; on a tie the car that comes first in the array. This is the dispatch-cost rule. A person with no such car stays unassigned and is looked at again in the next tick.',
  '',
  'THE STEP OF A CAR. A car that is out of service does nothing. While a fire is on, the car follows FIRE (below). Otherwise:',
  '1. Doors open (the counter is above 0): do the DOOR TICK (below).',
  '2. Doors closed. Let sd be the direction-rule value of the car. The car stops when a rider has to equal its floor, or when there is a waiting person who is assigned to the car, has from equal to its floor, goes in the direction sd (or sd is none), and whose weight fits (load + w <= cap). When the car stops: add 1 to its stops, set idle to 0, write the log line "tick id open floor", set the door counter to dwell and do the DOOR TICK in the same tick.',
  '3. Otherwise, when sd is not none: the car direction becomes sd, the car moves one floor in that direction (add 1 to moves), idle becomes 0.',
  '4. Otherwise: the car direction becomes none; idle grows by 1; and when idle is now more than park and the floor of the car is not its home, the car moves one floor towards its home (add 1 to moves). A move towards home does not change idle.',
  '',
  'THE DOOR TICK of a car at floor f. Let sd be the direction-rule value of the car. (a) Leaving: the riders whose to is f, in the order of the riders list and at most flow of them, leave the car: each becomes done with the done tick set to the tick, and a log line "tick id out person" is written; this happens before anyone boards. (b) Boarding: the candidates are the waiting persons who are assigned to this car and have from equal to f and go in the direction sd (when sd is none every one of them is a candidate). Order the candidates with vip persons first, then by arrival tick, then by position in people (this is the vip-priority rule). Go through them in that order: stop when flow persons have boarded in this tick; a candidate with load + w <= cap boards (it is added at the end of the riders list, its board tick and its car are set, it is no longer waiting for an assignment, and "tick id in person" is written); a candidate with load + w > cap does not board and loses its assignment (it is unassigned and the going through goes on with the next candidate; this is the weight-fit rule). (c) The car direction becomes the direction-rule value (computed again now). (d) If at least one person left or boarded in this tick, the door counter becomes dwell; otherwise it falls by 1.',
  '',
  'EVENTS. The events of a tick are applied in the order of the array events, and only those with t equal to the tick. "out" with a car that is in service: the car goes out of service; all its riders become dropped with the done tick set to the tick (log line "tick id drop person", in the order of the riders), its riders list is emptied, its door counter becomes 0 and its direction none, and all persons assigned to it lose their assignment. "back" with a car that is out of service: the car is in service again, with idle 0 (everything else stays as it was). "fire": a fire starts (a fire that is already on stays on): the door counter of every car becomes 0 and every waiting person loses its assignment. "clear" while a fire is on: the fire ends; the direction of every car becomes none, and idle and the door counter become 0. All other events (also "out" for a car that is already out, "back" for one that is not out, "clear" without a fire, a car id that does not exist) do nothing.',
  '',
  'FIRE. While a fire is on, each car that is in service does this in its step and nothing else: (1) when the door counter is above 0, or when the car is at floor 1 and has riders: if the door counter is 0, add 1 to the stops, write the log line "tick id open 1" and set the door counter to dwell; then at most flow riders (in the order of the riders list) leave: each becomes evac with the done tick set to the tick and the log line "tick id evac person" is written (they leave wherever their to is); the door counter becomes dwell when at least one rider left, else it falls by 1. (2) Otherwise, when the car is at floor 1: its direction becomes none. (3) Otherwise: the direction becomes down and the car moves one floor down (add 1 to moves). Persons that arrive during a fire wait, and the dispatch does not run. A car that is out of service does nothing and "back" during a fire only changes its out state.',
  '',
  'THE RESULT. people has one string per person in the order of the array people, "id:state:car:board:done". state is future (arrival tick after until), void, waiting (arrived, not boarded), riding (in a car at the end), done, dropped or evac. car is the id of the car that carried the person, or "-" when the person never boarded. board and done are the ticks, or "-" when not set. cars has one string per car, in the order of cars, "id:floor:state:load:moves:stops", where state is "out" when the car is out of service, else "open" when its door counter is above 0, else its direction (up, down) or "idle" for none. log is the array of the log lines in the order in which they were written.',
].join('\n');

// ---------------------------------------------------------------------------------------------
// Hand-derived tests.

const worked = [
  {
    edge: 'direction-rule',
    args: [
      {
        floors: 5,
        until: 12,
        park: 2,
        cars: [{ id: 'A', floor: 1, cap: 4 }],
        people: [{ id: 'p1', t: 0, from: 1, to: 3 }],
      },
    ],
    returns: {
      people: ['p1:done:A:0:5'],
      cars: ['A:1:idle:0:4:2'],
      log: ['0 A open 1', '0 A in p1', '5 A open 3', '5 A out p1'],
    },
  },
  {
    edge: 'vip-priority',
    args: [
      {
        floors: 6,
        until: 20,
        cars: [{ id: 'A', floor: 1, cap: 3 }],
        people: [
          { id: 'p1', t: 0, from: 1, to: 4, w: 2 },
          { id: 'p2', t: 0, from: 1, to: 5, w: 2, vip: true },
          { id: 'p3', t: 0, from: 1, to: 3 },
          { id: 'p4', t: 0, from: 1, to: 2 },
        ],
      },
    ],
    returns: {
      people: ['p1:riding:A:17:-', 'p2:done:A:0:10', 'p3:done:A:0:5', 'p4:riding:A:17:-'],
      cars: ['A:2:up:3:9:4'],
      log: [
        '0 A open 1', '0 A in p2', '0 A in p3', '5 A open 3', '5 A out p3', '10 A open 5', '10 A out p2',
        '17 A open 1', '17 A in p1', '17 A in p4',
      ],
    },
  },
  {
    edge: 'fire-recall',
    args: [
      {
        floors: 4,
        until: 12,
        dwell: 1,
        flow: 1,
        park: 3,
        cars: [{ id: 'A', floor: 3, cap: 5 }],
        people: [
          { id: 'p1', t: 0, from: 3, to: 4 },
          { id: 'p2', t: 3, from: 2, to: 4 },
        ],
        events: [
          { t: 2, kind: 'fire' },
          { t: 6, kind: 'clear' },
        ],
      },
    ],
    returns: {
      people: ['p1:evac:A:0:4', 'p2:done:A:7:11'],
      cars: ['A:4:idle:0:5:4'],
      log: ['0 A open 3', '0 A in p1', '4 A open 1', '4 A evac p1', '7 A open 2', '7 A in p2', '11 A open 4', '11 A out p2'],
    },
  },
  {
    edge: 'weight-fit',
    args: [
      {
        floors: 4,
        until: 12,
        dwell: 1,
        cars: [{ id: 'A', floor: 1, cap: 3 }],
        people: [
          { id: 'p1', t: 0, from: 1, to: 3, w: 2 },
          { id: 'p2', t: 0, from: 1, to: 2, w: 2 },
        ],
      },
    ],
    returns: {
      people: ['p1:done:A:0:4', 'p2:done:A:8:11'],
      cars: ['A:2:idle:0:5:4'],
      log: ['0 A open 1', '0 A in p1', '4 A open 3', '4 A out p1', '8 A open 1', '8 A in p2', '11 A open 2', '11 A out p2'],
    },
  },
  {
    edge: 'dispatch-cost',
    args: [
      {
        floors: 6,
        until: 14,
        dwell: 1,
        park: 2,
        cars: [
          { id: 'A', floor: 1, cap: 3 },
          { id: 'B', floor: 5, cap: 3 },
        ],
        people: [
          { id: 'p1', t: 0, from: 2, to: 4 },
          { id: 'p2', t: 0, from: 4, to: 6 },
          { id: 'p3', t: 1, from: 3, to: 1 },
        ],
      },
    ],
    returns: {
      people: ['p1:done:A:1:5', 'p2:done:B:1:5', 'p3:done:A:8:12'],
      cars: ['A:1:idle:0:6:4', 'B:5:idle:0:4:2'],
      log: [
        '1 A open 2', '1 A in p1', '1 B open 4', '1 B in p2', '5 A open 4', '5 A out p1', '5 B open 6', '5 B out p2',
        '8 A open 3', '8 A in p3', '12 A open 1', '12 A out p3',
      ],
    },
  },
  // ---- small worked examples (not hidden) ----
  {
    edge: 'void',
    args: [
      {
        floors: 4,
        until: 5,
        cars: [{ id: 'A', floor: 1, cap: 2, serves: 'even' }],
        people: [
          { id: 'q1', t: 0, from: 3, to: 2 },
          { id: 'q2', t: 0, from: 2, to: 2 },
          { id: 'q3', t: 0, from: 0, to: 2 },
          { id: 'q4', t: 0, from: 2, to: 9 },
          { id: 'q5', t: 99, from: 2, to: 4 },
        ],
      },
    ],
    returns: {
      people: ['q1:void:-:-:-', 'q2:void:-:-:-', 'q3:void:-:-:-', 'q4:void:-:-:-', 'q5:future:-:-:-'],
      cars: ['A:1:idle:0:0:0'],
      log: [],
    },
  },
  {
    edge: 'out-event',
    args: [
      {
        floors: 3,
        until: 4,
        dwell: 1,
        cars: [{ id: 'A', floor: 1, cap: 3 }],
        people: [{ id: 'r1', t: 0, from: 1, to: 3 }],
        events: [
          { t: 2, kind: 'out', car: 'A' },
          { t: 2, kind: 'out', car: 'A' },
          { t: 3, kind: 'out', car: 'Z' },
        ],
      },
    ],
    returns: {
      people: ['r1:dropped:A:0:2'],
      cars: ['A:1:out:0:0:1'],
      log: ['0 A open 1', '0 A in r1', '2 A drop r1'],
    },
  },
];

const HIDDEN = new Set(['direction-rule', 'vip-priority', 'weight-fit', 'fire-recall', 'dispatch-cost']);
const hand = worked.filter((one) => HIDDEN.has(one.edge)).map((one) => t(one.edge, one.args, one.returns));
const examples = worked.filter((one) => !HIDDEN.has(one.edge)).map((one) => ({ edge: one.edge, args: one.args, returns: one.returns }));

// ---------------------------------------------------------------------------------------------
// Seeded random buildings. The expected value comes from the reference.

function randomBuilding(seed) {
  const next = lcg(seed);
  const floors = 7 + draw(next, 6);
  const carCount = 2 + draw(next, 2);
  const cars = [];
  for (let i = 0; i < carCount; i += 1) {
    const car = { id: String.fromCharCode(65 + i), floor: 1 + draw(next, floors), cap: 3 + draw(next, 3) };
    const zone = draw(next, 8);
    if (i > 0 && zone === 0) car.serves = 'even';
    if (i > 0 && zone === 1) car.serves = 'odd';
    cars.push(car);
  }
  const peopleCount = 18 + draw(next, 8);
  const people = [];
  for (let i = 0; i < peopleCount; i += 1) {
    const from = draw(next, 100) < 35 ? 1 : 1 + draw(next, floors);
    let to = 1 + draw(next, floors);
    if (to === from && draw(next, 100) >= 15) to = 1 + (to % floors);
    const person = { id: `p${i + 1}`, t: draw(next, 40), from, to };
    const weight = draw(next, 4);
    if (weight === 3) person.w = 2 + draw(next, 2);
    if (draw(next, 100) < 15) person.vip = true;
    people.push(person);
  }
  people.sort((a, b) => a.t - b.t);
  people.forEach((person, i) => {
    person.id = `p${i + 1}`;
  });
  const events = [];
  if (draw(next, 100) < 55) {
    const car = cars[draw(next, cars.length)].id;
    const start = 8 + draw(next, 25);
    events.push({ t: start, kind: 'out', car }, { t: start + 10 + draw(next, 20), kind: 'back', car });
  }
  if (draw(next, 100) < 45) {
    const start = 12 + draw(next, 25);
    events.push({ t: start, kind: 'fire' }, { t: start + 6 + draw(next, 8), kind: 'clear' });
  }
  events.sort((a, b) => a.t - b.t);
  const building = { floors, until: 70 + draw(next, 21), cars, people, events };
  const dwell = draw(next, 3);
  if (dwell > 0) building.dwell = dwell;
  const flow = draw(next, 3);
  if (flow > 0) building.flow = flow;
  if (draw(next, 2) === 0) building.park = 2 + draw(next, 4);
  return building;
}

const computed = [];
for (const seed of [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412]) {
  computed.push(t('mixed-run', [randomBuilding(seed)]));
}

export default {
  slug: 'liftwell-sim',
  tier: {
    level: 5,
    human_minutes: 480,
    basis: 'A discrete-time simulation of lifts with a fixed order of work in every tick: events, arrivals, dispatch by a four-term cost with ties, a scan direction rule with targets from riders and assignments, door timing with extension, boarding with vip priority, weight fit and per-tick flow limits, zones by floor parity, parking, out-of-service and a fire recall. The reference is about 300 lines. An expert needs most of a working day to read the rules closely, write it and check it against worked traces.',
  },
  tags: ['spec'],
  name: 'liftwell',
  signature: 'liftwell(spec) -> { people, cars, log }',
  task: spec,
  edges: {
    'direction-rule': 'The word direction-rule below means this function.',
    'vip-priority': 'this is the vip-priority rule',
    'weight-fit': 'this is the weight-fit rule',
    'dispatch-cost': 'This is the dispatch-cost rule.',
    'fire-recall': 'While a fire is on, each car that is in service does this in its step and nothing else',
    'mixed-run': 'Each car completes its whole step before the next car starts',
  },
  examples,
  tests: [...hand, ...computed],
};
