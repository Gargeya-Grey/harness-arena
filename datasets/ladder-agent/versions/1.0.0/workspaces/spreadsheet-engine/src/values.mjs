// Error values. Done; SPEC.md section 5.
export const ERRORS = ['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#PARSE!', '#CYCLE!'];

export const makeError = (code) => ({ error: code });
export const isError = (value) => value !== null && typeof value === 'object' && typeof value.error === 'string';
