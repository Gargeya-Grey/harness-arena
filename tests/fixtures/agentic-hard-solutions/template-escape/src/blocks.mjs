// #if, #unless and #each. A block renders its body, or its {{else}} part.
export function isTruthy(value) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function entriesOf(value) {
  if (Array.isArray(value)) return value.map((item, index) => [index, item]);
  if (value && typeof value === 'object') return Object.entries(value);
  return [];
}

export function renderBlock(node, scope, env) {
  const value = env.evaluate(node.arg, scope);
  if (node.name === 'if') return env.renderNodes(isTruthy(value) ? node.body : node.inverse, scope);
  if (node.name === 'unless') return env.renderNodes(isTruthy(value) ? node.inverse : node.body, scope);
  if (node.name === 'each') {
    const entries = entriesOf(value);
    if (entries.length === 0) return env.renderNodes(node.inverse, scope);
    let out = '';
    entries.forEach(([key, item], index) => {
      const data = { index, key, first: index === 0, last: index === entries.length - 1 };
      out += env.renderNodes(node.body, scope.push(item, data));
    });
    return out;
  }
  throw new Error(`unknown block #${node.name}`);
}
