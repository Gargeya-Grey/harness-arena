import { renderBlock } from './blocks.mjs';
import { emit } from './escape.mjs';
import { parseExpr } from './expr.mjs';
import { defaultHelpers } from './helpers.mjs';
import { PartialRegistry } from './partials.mjs';

function stringify(value) {
  return value === null || value === undefined ? '' : String(value);
}

export function createEnv({ helpers = {}, partials = {} } = {}) {
  const allHelpers = { ...defaultHelpers, ...helpers };
  const registry = new PartialRegistry(partials);

  const env = {
    registry,

    evaluate(text, scope) {
      const expr = parseExpr(text);
      if (expr.kind === 'literal') return expr.value;
      if (expr.kind === 'path') return scope.lookup(expr.path);
      const helper = allHelpers[expr.helper];
      if (typeof helper !== 'function') throw new Error(`unknown helper ${expr.helper}`);
      return helper(...expr.args.map((arg) => (arg.kind === 'literal' ? arg.value : scope.lookup(arg.path))));
    },

    renderNodes(nodes, scope) {
      let out = '';
      for (const node of nodes) out += renderNode(node, scope);
      return out;
    },
  };

  function renderNode(node, scope) {
    if (node.type === 'text') return node.value;
    if (node.type === 'var') {
      const value = env.evaluate(node.expr, scope);
      return node.raw ? stringify(value) : emit(value);
    }
    if (node.type === 'block') return renderBlock(node, scope, env);
    if (node.type === 'partial') {
      const context = node.arg ? env.evaluate(node.arg, scope) : scope.context;
      return emit(registry.render(node.name, context, scope, env));
    }
    throw new Error(`unknown node ${node.type}`);
  }

  return env;
}
