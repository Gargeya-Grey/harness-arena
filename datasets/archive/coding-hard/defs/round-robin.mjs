import { t, rng, randInt } from './_util.mjs';

const rand = rng(4242);
function randomJobs(count, lastArrival, maxBurst) {
  return Array.from({ length: count }, (_, i) => ['J' + i, randInt(rand, 0, lastArrival), randInt(rand, 1, maxBurst)]);
}

export default {
  name: 'roundRobin',
  signature: 'roundRobin(jobs, quantum) -> array',
  kind: 'simulation',
  task: [
    'Simulate one CPU that shares its time between jobs in round-robin order.',
    'jobs is an array of [id, arrival, burst]: id is a unique string, arrival is the integer time when the job becomes ready (0 or more) and burst is the integer amount of CPU time it needs (1 or more). jobs is not sorted. quantum is an integer of 1 or more.',
    'Rules. The ready queue is first in, first out. When the CPU is free it takes the job at the front of the queue and runs it for min(quantum, remaining time) time units. If the job has time left afterwards, it goes to the back of the queue; otherwise it finishes at the current time. Switching jobs costs no time. If the queue is empty the CPU idles until the next job arrives.',
    'A job enters the queue at its arrival time. When several things happen at the same time t, the order is: first every job that arrives at a time less than or equal to t and is not yet queued enters the queue (earlier arrival times first; jobs with the same arrival time enter in the order in which they appear in jobs), and only then the job that just used up its quantum at time t goes to the back of the queue. This also holds for a job that arrives exactly when the CPU becomes free.',
    'Return an array of [id, finishTime] in the order in which the jobs finish.',
    'An empty jobs array gives an empty array.',
  ].join(' '),
  edges: {
    'arrival-before-requeue': 'and only then the job that just used up its quantum',
    idle: 'the CPU idles',
    'same-arrival-order': 'enter in the order in which they appear in jobs',
    unsorted: 'jobs is not sorted',
    empty: 'An empty jobs array',
    'exact-finish': 'otherwise it finishes at the current time',
    'free-cpu-arrival': 'a job that arrives exactly when the CPU becomes free',
  },
  tests: [
    t('arrival-before-requeue', [[['A', 0, 5], ['B', 1, 3], ['C', 2, 1]], 2], [['C', 5], ['B', 8], ['A', 9]]),
    t('arrival-before-requeue', [[['A', 0, 4], ['B', 2, 2]], 2], [['B', 4], ['A', 6]]),
    t('idle', [[['A', 5, 2]], 3], [['A', 7]]),
    t('idle', [[['A', 0, 1], ['B', 10, 1]], 4], [['A', 1], ['B', 11]]),
    t('same-arrival-order', [[['B', 3, 2], ['A', 3, 2], ['C', 0, 3]], 3], [['C', 3], ['B', 5], ['A', 7]]),
    t('empty', [[], 3], []),
    t('exact-finish', [[['A', 0, 2], ['B', 0, 3]], 10], [['A', 2], ['B', 5]]),
    t('basic', [[['A', 0, 3], ['B', 0, 2], ['C', 1, 1]], 1], [['C', 3], ['B', 5], ['A', 6]]),
    t('free-cpu-arrival', [[['A', 0, 2], ['B', 2, 2]], 5], [['A', 2], ['B', 4]]),
    t('basic', [[['P1', 0, 24], ['P2', 0, 3], ['P3', 0, 3]], 4], [['P2', 7], ['P3', 10], ['P1', 30]]),
    t('unsorted', [[['A', 0, 6], ['C', 3, 1], ['B', 2, 1]], 4], [['B', 5], ['C', 6], ['A', 8]]),
    t('exact-finish', [[['A', 0, 4], ['B', 1, 1]], 4], [['A', 4], ['B', 5]]),
    t('idle', [[['A', 0, 3], ['B', 3, 1], ['C', 9, 2]], 3], [['A', 3], ['B', 4], ['C', 11]]),
    t('basic', [randomJobs(12, 20, 9), 3]),
    t('basic', [randomJobs(30, 40, 12), 1]),
    t('arrival-before-requeue', [randomJobs(25, 30, 15), 4]),
  ],
};
