// Turns tokens into a tree:
//   { type: 'text', value } { type: 'var', raw, expr } { type: 'partial', name, arg }
//   { type: 'block', name, arg, body: [...], inverse: [...] }
export function parse(tokens) {
  const root = { body: [] };
  const stack = [{ node: root, branch: 'body' }];
  const target = () => stack[stack.length - 1].node[stack[stack.length - 1].branch];
  for (const token of tokens) {
    if (token.type === 'text') target().push({ type: 'text', value: token.value });
    else if (token.type === 'var') target().push({ type: 'var', raw: token.raw, expr: token.expr });
    else if (token.type === 'partial') target().push({ type: 'partial', name: token.name, arg: token.arg });
    else if (token.type === 'open') {
      const block = { type: 'block', name: token.name, arg: token.arg, body: [], inverse: [] };
      target().push(block);
      stack.push({ node: block, branch: 'body' });
    } else if (token.type === 'else') {
      if (stack.length === 1) throw new Error('{{else}} outside a block');
      stack[stack.length - 1].branch = 'inverse';
    } else if (token.type === 'close') {
      if (stack.length === 1 || stack[stack.length - 1].node.name !== token.name) throw new Error(`unexpected {{/${token.name}}}`);
      stack.pop();
    }
  }
  if (stack.length > 1) throw new Error(`unclosed block {{#${stack[stack.length - 1].node.name}}}`);
  return root.body;
}
