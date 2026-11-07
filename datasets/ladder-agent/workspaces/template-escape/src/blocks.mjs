// #if, #unless and #each. A block renders its body, or its {{else}} part.
export function isTruthy(value) {
  return Boolean(value);
}

function entriesOf(value) {
  if (Array.isArray(value)) return value.map((item, index) => [index, item]);
  if (value && typeof value === 'object') return Object.entries(value);
  return [];
}

export function renderBlock(node, scope, env) {
  const value = env.evaluate(node.arg, scope);
  if (node.name === 'if' || node.name === 'unless') {
    const show = node.name === 'if' ? isTruthy(value) : !isTruthy(value);
    return env.renderNodes(show ? node.body : node.inverse, scope.push(scope.context, scope.data));
  }
  if (node.name === 'each') {
    const entries = entriesOf(value);
    if (entries.length === 0) return env.renderNodes(node.inverse, scope);
    let out = '';
    entries.forEach(([key, item], index) => {
      const inner = scope.push(item, scope.data);
      Object.assign(inner.data, { index, key, first: index === 0, last: index === entries.length - 1 });
      out += env.renderNodes(node.body, inner);
    });
    return out;
  }
  throw new Error(`unknown block #${node.name}`);
}
