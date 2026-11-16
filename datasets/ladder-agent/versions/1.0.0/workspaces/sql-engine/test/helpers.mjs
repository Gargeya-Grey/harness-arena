import { Database } from '../src/index.mjs';

export const sample = () =>
  new Database({
    pets: {
      columns: ['id', 'name', 'kind', 'age', 'owner'],
      rows: [
        [1, 'rex', 'dog', 5, 1],
        [2, 'tom', 'cat', 3, 1],
        [3, 'bella', 'dog', null, 2],
        [4, 'kiwi', 'bird', 1, null],
      ],
    },
    owners: {
      columns: ['id', 'who'],
      rows: [
        [1, 'ann'],
        [2, 'raj'],
        [3, 'lee'],
      ],
    },
  });
