import { optDefinition } from '../_opt-def.mjs';
import { certificateReview } from '../_certificate-review.mjs';

const INSTANCES = [
  {
    "family": "binpack",
    "slug": "box-shipping-conflict-thirteen",
    "level": 4,
    "minutes": 90,
    "seed": 20261108,
    "generation": {
      "stream": "box-shipping-conflict-thirteen-repair",
      "number": 37
    },
    "replaces": "box-shipping-thirteen-parcels",
    "answer": 59,
    "instance": {
      "items": [
        "P1",
        "P2",
        "P3",
        "P4",
        "P5",
        "P6",
        "P7",
        "P8",
        "P9",
        "P10",
        "P11",
        "P12",
        "P13"
      ],
      "size": [
        3,
        9,
        9,
        9,
        3,
        10,
        4,
        9,
        11,
        5,
        10,
        5,
        8
      ],
      "conflicts": [
        [
          0,
          1
        ],
        [
          0,
          4
        ],
        [
          0,
          6
        ],
        [
          1,
          8
        ],
        [
          4,
          6
        ],
        [
          4,
          11
        ],
        [
          8,
          12
        ],
        [
          10,
          11
        ],
        [
          11,
          12
        ]
      ],
      "boxes": [
        {
          "name": "Small",
          "cap": 10,
          "price": 7
        },
        {
          "name": "Medium",
          "cap": 17,
          "price": 11
        },
        {
          "name": "Large",
          "cap": 26,
          "price": 15
        }
      ]
    },
    "witness": {
      "boxes": [
        {
          "type": "Small",
          "items": [
            "P6"
          ]
        },
        {
          "type": "Medium",
          "items": [
            "P2",
            "P13"
          ]
        },
        {
          "type": "Medium",
          "items": [
            "P3",
            "P10",
            "P5"
          ]
        },
        {
          "type": "Large",
          "items": [
            "P9",
            "P11",
            "P7"
          ]
        },
        {
          "type": "Large",
          "items": [
            "P4",
            "P8",
            "P12",
            "P1"
          ]
        }
      ],
      "cost": 59
    }
  },
  {
    "family": "binpack",
    "slug": "box-shipping-conflict-seventeen",
    "level": 5,
    "minutes": 300,
    "seed": 20261108,
    "generation": {
      "stream": "box-shipping-conflict-seventeen-repair",
      "number": 86
    },
    "replaces": "box-shipping-seventeen-parcels",
    "answer": 85,
    "instance": {
      "items": [
        "P1",
        "P2",
        "P3",
        "P4",
        "P5",
        "P6",
        "P7",
        "P8",
        "P9",
        "P10",
        "P11",
        "P12",
        "P13",
        "P14",
        "P15",
        "P16",
        "P17"
      ],
      "size": [
        8,
        9,
        7,
        9,
        10,
        4,
        8,
        7,
        10,
        10,
        11,
        3,
        9,
        10,
        11,
        9,
        5
      ],
      "conflicts": [
        [
          0,
          13
        ],
        [
          3,
          5
        ],
        [
          3,
          8
        ],
        [
          4,
          7
        ],
        [
          5,
          10
        ],
        [
          5,
          11
        ],
        [
          6,
          10
        ],
        [
          8,
          10
        ],
        [
          8,
          14
        ],
        [
          8,
          16
        ],
        [
          10,
          14
        ],
        [
          14,
          15
        ]
      ],
      "boxes": [
        {
          "name": "Small",
          "cap": 10,
          "price": 7
        },
        {
          "name": "Medium",
          "cap": 17,
          "price": 11
        },
        {
          "name": "Large",
          "cap": 26,
          "price": 15
        }
      ]
    },
    "witness": {
      "boxes": [
        {
          "type": "Small",
          "items": [
            "P5"
          ]
        },
        {
          "type": "Small",
          "items": [
            "P9"
          ]
        },
        {
          "type": "Medium",
          "items": [
            "P10",
            "P3"
          ]
        },
        {
          "type": "Large",
          "items": [
            "P11",
            "P1",
            "P8"
          ]
        },
        {
          "type": "Large",
          "items": [
            "P15",
            "P14",
            "P6"
          ]
        },
        {
          "type": "Large",
          "items": [
            "P2",
            "P4",
            "P7"
          ]
        },
        {
          "type": "Large",
          "items": [
            "P13",
            "P16",
            "P17",
            "P12"
          ]
        }
      ],
      "cost": 85
    }
  },
  {
    "family": "rcpsp",
    "slug": "building-resource-fourteen",
    "level": 5,
    "minutes": 360,
    "seed": 20261108,
    "generation": {
      "stream": "building-resource-fourteen-repair",
      "number": 1
    },
    "replaces": "building-fourteen-tasks",
    "answer": 46,
    "instance": {
      "names": [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
        "H",
        "I",
        "J",
        "K",
        "L",
        "M",
        "N"
      ],
      "dur": [
        7,
        5,
        5,
        3,
        2,
        6,
        4,
        6,
        8,
        8,
        5,
        4,
        6,
        2
      ],
      "need": [
        [
          3,
          0
        ],
        [
          4,
          4
        ],
        [
          0,
          2
        ],
        [
          1,
          1
        ],
        [
          2,
          0
        ],
        [
          0,
          4
        ],
        [
          0,
          4
        ],
        [
          1,
          3
        ],
        [
          1,
          4
        ],
        [
          0,
          4
        ],
        [
          0,
          0
        ],
        [
          0,
          1
        ],
        [
          3,
          0
        ],
        [
          5,
          1
        ]
      ],
      "cap": [
        6,
        5
      ],
      "preds": [
        [],
        [
          0
        ],
        [
          0
        ],
        [
          0,
          1,
          2
        ],
        [
          1
        ],
        [
          4
        ],
        [
          2
        ],
        [
          4
        ],
        [
          6
        ],
        [
          7
        ],
        [
          8
        ],
        [],
        [
          11
        ],
        []
      ]
    },
    "witness": {
      "starts": {
        "A": 0,
        "B": 7,
        "C": 12,
        "D": 17,
        "E": 12,
        "F": 40,
        "G": 20,
        "H": 14,
        "I": 24,
        "J": 32,
        "K": 32,
        "L": 0,
        "M": 12,
        "N": 20
      },
      "makespan": 46
    }
  }
];

export default () => INSTANCES.map(config => {
  const schedule = config.family === 'rcpsp';
  const basis = schedule
    ? 'Estimate, not timed: a fourteen-task, two-resource schedule with branching precedences. Critical-path, resource-area and maximum incompatibility-clique bounds are strictly below the independently checked optimum. This excludes those short certificates only; no complete human solve or proof time has been measured.'
    : 'Estimate, not timed: an exact conflict-constrained packing with three box types. Capacity-price and maximum separate-box bounds are strictly below the independently checked optimum. This excludes those short certificates only; no complete human solve or proof time has been measured.';
  const def = optDefinition({ family: config.family, seed: config.seed, slug: config.slug, level: config.level, minutes: config.minutes, basis, tags: schedule ? ['scheduling', 'resources', 'optimization'] : ['bin-packing', 'search', 'optimization'], instance: config.instance });
  if (def.answer !== config.answer) throw new Error(config.slug + ': pinned answer disagrees with exact methods');
  const review = certificateReview(config.family, config.instance, def.answer);
  if (review.gap <= 0) throw new Error(config.slug + ': tested lower bound already certifies the answer');
  def.metadata.difficulty_review = { ...review, replaces: 'ladder-answer-' + config.replaces, generation: config.generation };
  def.metadata.feasible_witness = config.witness;
  return def;
});
