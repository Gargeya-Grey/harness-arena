import { t, rng, randInt } from './_util.mjs';

const rand = rng(5150);
function randomJobs(count, lastArrival, maxBurst, priorities) {
  return Array.from({ length: count }, (_, i) => ['J' + i, randInt(rand, 0, lastArrival), randInt(rand, 1, maxBurst), randInt(rand, 0, priorities - 1)]);
}

const task = [
  'cpus identical CPUs (an integer of 1 or more) run jobs. jobs is an array of [id, arrival, burst, priority]: id is a unique string; arrival is the integer time when the job becomes ready (0 or more); burst is the integer CPU time the job needs (1 or more); priority is an integer, and a lower number is more urgent. jobs is not sorted. Time is whole and starts at 0.',
  'Rules. At every moment the CPUs run the most urgent jobs among those that have arrived and are not finished, at most one job per CPU. Jobs are ordered by priority number (lower first), then by earlier arrival, then by earlier position in jobs.',
  'A running job gets 1 unit of CPU time per time unit. A job that arrives at time t is considered at time t, so it can preempt a running job at t; a job that finishes at time t is not considered at t.',
  'A job that stops running while it still needs time is preempted; when it is chosen again it continues with the time that is left. Switching is free. A CPU with no job to run waits.',
  'Return one entry per job, in the order of jobs: [id, start, finish, preemptions]. start is the first time the job runs, finish is the time it completes and preemptions is the number of times it was preempted.',
  'An empty jobs array gives an empty array.',
].join(' ');

export default {
  slug: 'preemptive-cpus',
  tier: { level: 4, human_minutes: 32, basis: 'estimated from the reference (about 40 lines): an event loop over arrivals and finishes with a three-part order and a preemption count; the long rule text and the count of preemptions at exact event ties are where the time goes. The lowest-confidence tier 4 estimate' },
  name: 'preemptiveSchedule',
  signature: 'preemptiveSchedule(cpus, jobs) -> array',
  tags: ['simulation'],
  task,
  edges: {
    'preempt-on-arrival': 'so it can preempt a running job at t',
    'tie-arrival': 'then by earlier arrival',
    'tie-position': 'then by earlier position in jobs',
    'finish-at-arrival': 'a job that finishes at time t is not considered at t',
    idle: 'A CPU with no job to run waits',
    resume: 'it continues with the time that is left',
    'preemption-count': 'the number of times it was preempted',
    unsorted: 'jobs is not sorted',
    empty: 'An empty jobs array',
    'many-cpus': 'at most one job per CPU',
  },
  tests: [
    t('preempt-on-arrival', [1, [['A', 0, 5, 2], ['B', 1, 2, 1]]], [['A', 0, 7, 1], ['B', 1, 3, 0]]),
    t('many-cpus', [2, [['A', 0, 4, 1], ['B', 0, 4, 2], ['C', 1, 2, 0]]], [['A', 0, 4, 0], ['B', 0, 6, 1], ['C', 1, 3, 0]]),
    t('idle', [1, [['A', 5, 2, 1]]], [['A', 5, 7, 0]]),
    t('tie-arrival', [1, [['X', 3, 2, 1], ['Y', 1, 5, 1]]], [['X', 6, 8, 0], ['Y', 1, 6, 0]]),
    t('tie-position', [1, [['P', 0, 3, 1], ['Q', 0, 3, 1]]], [['P', 0, 3, 0], ['Q', 3, 6, 0]]),
    t('many-cpus', [5, [['A', 0, 3, 1], ['B', 2, 3, 0]]], [['A', 0, 3, 0], ['B', 2, 5, 0]]),
    t('empty', [3, []], []),
    t('preemption-count', [1, [['A', 0, 10, 5], ['B', 2, 1, 1], ['C', 5, 1, 1]]], [['A', 0, 12, 2], ['B', 2, 3, 0], ['C', 5, 6, 0]]),
    t('finish-at-arrival', [1, [['A', 0, 2, 1], ['B', 2, 1, 0]]], [['A', 0, 2, 0], ['B', 2, 3, 0]]),
    t('unsorted', [1, [['C', 4, 1, 0], ['A', 0, 6, 3], ['B', 2, 2, 1]]]),
    t('resume', [2, [['A', 0, 6, 3], ['B', 1, 2, 2], ['C', 2, 2, 1], ['D', 3, 1, 0]]]),
    t('idle', [2, [['A', 0, 1, 0], ['B', 7, 2, 0], ['C', 7, 1, 1], ['D', 7, 3, 2]]]),
    t('tie-arrival', [2, [['A', 2, 4, 1], ['B', 0, 4, 1], ['C', 1, 4, 1]]]),
    t('preemption-count', [1, [['L', 0, 12, 9], ['M', 1, 2, 5], ['H', 2, 2, 1], ['M2', 3, 1, 5]]]),
    t('basic', [3, randomJobs(25, 30, 9, 4)]),
    t('basic', [1, randomJobs(30, 40, 8, 3)]),
    t('tie-position', [4, randomJobs(40, 25, 6, 2)]),
    t('many-cpus', [2, randomJobs(50, 60, 10, 5)]),
  ],
};
