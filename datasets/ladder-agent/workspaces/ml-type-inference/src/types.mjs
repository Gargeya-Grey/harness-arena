// Type terms. A type is a variable or a constructor applied to arguments.
//   { kind: 'var', id }                      a type variable
//   { kind: 'con', name, args }              name is 'int' | 'bool' | 'string' | 'unit'
//                                            | '->' (2 args) | 'list' (1 arg) | '*' (2 or more args)
// You may add fields or keep your own substitution on the side.

let counter = 0;

export const newVar = () => ({ kind: 'var', id: (counter += 1) });
export const con = (name, args = []) => ({ kind: 'con', name, args });

export const tInt = con('int');
export const tBool = con('bool');
export const tString = con('string');
export const tUnit = con('unit');
export const tArrow = (from, to) => con('->', [from, to]);
export const tList = (item) => con('list', [item]);
export const tTuple = (items) => con('*', items);
