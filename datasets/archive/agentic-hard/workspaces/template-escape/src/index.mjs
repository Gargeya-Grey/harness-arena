import { createEnv } from './render.mjs';
import { Scope } from './scope.mjs';
import { tokenize } from './lexer.mjs';
import { parse } from './parser.mjs';

export { SafeString, escapeHtml } from './escape.mjs';

// compile(source, { helpers, partials }) -> (context) => string
export function compile(source, options = {}) {
  const tree = parse(tokenize(source));
  const env = createEnv(options);
  return (context = {}) => env.renderNodes(tree, Scope.from(context));
}

export function render(source, context, options) {
  return compile(source, options)(context);
}
