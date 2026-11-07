// Two normalized line lists ask for the same thing: the same skus with the same quantities.
export const sameLines = (a, b) => a.length === b.length && a.every((line, index) => line.sku === b[index].sku);
