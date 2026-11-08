// A request that clashes with the state of the stock or of a hold.
export class ConflictError extends Error {}

// A sku that was never received.
export class UnknownSkuError extends Error {}
