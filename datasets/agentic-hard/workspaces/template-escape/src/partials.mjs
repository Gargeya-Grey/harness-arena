import { SafeString } from './escape.mjs';
import { parse } from './parser.mjs';
import { tokenize } from './lexer.mjs';

const MAX_DEPTH = 50;

// Partials are template strings or functions (context) => markup. Either way the
// markup is the template author's own: it is written out as it is.
export class PartialRegistry {
  constructor(partials = {}) {
    this.sources = new Map(Object.entries(partials));
    this.trees = new Map();
    this.depth = 0;
  }

  set(name, source) {
    this.sources.set(name, source);
    this.trees.delete(name);
  }

  render(name, context, scope, env) {
    const source = this.sources.get(name);
    if (source === undefined) throw new Error(`unknown partial ${name}`);
    if (this.depth >= MAX_DEPTH) throw new Error(`partial ${name} nests too deep`);
    this.depth += 1;
    try {
      if (typeof source === 'function') {
        return source(context);
      }
      if (!this.trees.has(name)) this.trees.set(name, parse(tokenize(source)));
      return new SafeString(env.renderNodes(this.trees.get(name), scope.withContext(context)));
    } finally {
      this.depth -= 1;
    }
  }
}
