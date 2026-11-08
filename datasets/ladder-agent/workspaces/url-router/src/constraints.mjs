// Parameter types: ':id<int>'. They are listed from the strictest to the loosest.
const TYPES = {
  int: /^[+-]?\d+$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
};

export const TYPE_ORDER = Object.keys(TYPES);
export const knownType = (type) => Object.hasOwn(TYPES, type);
export const checkConstraint = (type, value) => !type || TYPES[type].test(value);

// Lower sorts first: typed parameters before plain ones.
export const typeRank = (type) => (type ? TYPE_ORDER.indexOf(type) : TYPE_ORDER.length);
