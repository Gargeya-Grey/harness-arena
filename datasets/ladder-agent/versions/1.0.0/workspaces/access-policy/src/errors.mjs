// Something in a definition or a request is not valid.
export class PolicyError extends Error {}

// A role would inherit from itself.
export class CycleError extends PolicyError {}
