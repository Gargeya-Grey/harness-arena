// Prints types as SPEC.md section 7 says: precedence, parentheses and variable names.
//   showType(t)     -> string
//   showTypes([t,…]) -> string[]   one naming shared by all the types, in order
export function showTypes(types) {
  void types;
  throw new Error('not implemented: showTypes');
}

export const showType = (type) => showTypes([type])[0];
