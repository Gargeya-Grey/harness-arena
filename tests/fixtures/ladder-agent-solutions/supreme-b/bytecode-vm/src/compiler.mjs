import { LangError } from './errors.mjs';

// Bytecode: code[2 * i] is the opcode of instruction i and code[2 * i + 1] its operand. Jumps hold an instruction
// index. pos[i] is the token whose position an error in instruction i reports.
export const Op = Object.fromEntries(
  ['CONST', 'NIL', 'TRUE', 'FALSE', 'POP', 'GET_LOCAL', 'SET_LOCAL', 'GET_GLOBAL', 'DEF_GLOBAL', 'SET_GLOBAL', 'GET_UPVALUE', 'SET_UPVALUE', 'CLOSE_UPVALUE', 'CLOSE_SLOT', 'EQ', 'NE', 'LT', 'LE', 'GT', 'GE', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'NOT', 'NEG', 'JUMP', 'JUMP_IF_FALSE', 'JUMP_IF_TRUE', 'LOOP', 'CALL', 'CLOSURE', 'RETURN', 'ARRAY', 'GET_INDEX', 'SET_INDEX'].map((name, index) => [name, index]),
);

class FunctionState {
  constructor(enclosing, name, arity) {
    this.enclosing = enclosing;
    this.fn = { name, arity, code: [], consts: [], pos: [], upvalues: [] };
    this.locals = [{ name: '', depth: 0, captured: false }];
    this.depth = 0;
    this.loops = [];
  }
}

export function compile(tree) {
  let state = new FunctionState(null, '<script>', 0);
  const fail = (message, tok) => {
    throw new LangError('compile', message, tok.line, tok.column);
  };

  const emit = (op, arg, tok) => {
    state.fn.code.push(op, arg);
    state.fn.pos.push(tok);
    return state.fn.pos.length - 1;
  };
  const here = () => state.fn.pos.length;
  const patch = (index, target = here()) => {
    state.fn.code[2 * index + 1] = target;
  };
  const constant = (value) => {
    const { consts } = state.fn;
    const found = consts.findIndex((c) => c === value);
    if (found >= 0) return found;
    consts.push(value);
    return consts.length - 1;
  };

  const beginScope = () => {
    state.depth += 1;
  };
  const endScope = (tok) => {
    state.depth -= 1;
    while (state.locals.length && state.locals[state.locals.length - 1].depth > state.depth) {
      emit(state.locals.pop().captured ? Op.CLOSE_UPVALUE : Op.POP, 0, tok);
    }
  };

  function declareLocal(name, tok) {
    for (let i = state.locals.length - 1; i >= 0 && state.locals[i].depth >= state.depth; i -= 1) {
      if (state.locals[i].name === name) fail(`Variable '${name}' is already declared in this scope.`, tok);
    }
    state.locals.push({ name, depth: -1, captured: false });
  }
  const markReady = () => {
    state.locals[state.locals.length - 1].depth = state.depth;
  };

  function resolveLocal(fs, name, tok) {
    for (let i = fs.locals.length - 1; i >= 0; i -= 1) {
      if (fs.locals[i].name === name) {
        if (fs.locals[i].depth === -1) fail(`Cannot read variable '${name}' in its own initializer.`, tok);
        return i;
      }
    }
    return -1;
  }

  function addUpvalue(fs, isLocal, index) {
    const list = fs.fn.upvalues;
    const found = list.findIndex((u) => u.isLocal === isLocal && u.index === index);
    if (found >= 0) return found;
    list.push({ isLocal, index });
    return list.length - 1;
  }

  function resolveUpvalue(fs, name, tok) {
    if (!fs.enclosing) return -1;
    const local = resolveLocal(fs.enclosing, name, tok);
    if (local >= 0) {
      fs.enclosing.locals[local].captured = true;
      return addUpvalue(fs, true, local);
    }
    const outer = resolveUpvalue(fs.enclosing, name, tok);
    return outer >= 0 ? addUpvalue(fs, false, outer) : -1;
  }

  function variable(name, tok, get) {
    let slot = resolveLocal(state, name, tok);
    if (slot >= 0) return emit(get ? Op.GET_LOCAL : Op.SET_LOCAL, slot, tok);
    slot = resolveUpvalue(state, name, tok);
    if (slot >= 0) return emit(get ? Op.GET_UPVALUE : Op.SET_UPVALUE, slot, tok);
    return emit(get ? Op.GET_GLOBAL : Op.SET_GLOBAL, constant(name), tok);
  }

  function functionBody(name, params, body, tok) {
    state = new FunctionState(state, name, params.length);
    beginScope();
    for (const param of params) {
      declareLocal(param.text, param);
      markReady();
    }
    for (const statement of body) compileStatement(statement);
    emit(Op.NIL, 0, tok);
    emit(Op.RETURN, 0, tok);
    const { fn } = state;
    state = state.enclosing;
    emit(Op.CLOSURE, constant(fn), tok);
  }

  function defineVariable(name, tok) {
    if (state.depth === 0) emit(Op.DEF_GLOBAL, constant(name), tok);
    else markReady();
  }

  function leaveLoopScopes(loop, tok) {
    for (let i = state.locals.length - 1; i >= 0 && state.locals[i].depth > loop.depth; i -= 1) {
      emit(state.locals[i].captured ? Op.CLOSE_UPVALUE : Op.POP, 0, tok);
    }
  }

  function compileStatement(node) {
    switch (node.t) {
      case 'let':
        if (state.depth > 0) declareLocal(node.name, node.tok);
        if (node.init) expression(node.init);
        else emit(Op.NIL, 0, node.tok);
        defineVariable(node.name, node.tok);
        break;
      case 'fn':
        if (state.depth > 0) {
          declareLocal(node.name, node.tok);
          markReady();
        }
        functionBody(node.name, node.params, node.body, node.tok);
        if (state.depth === 0) emit(Op.DEF_GLOBAL, constant(node.name), node.tok);
        break;
      case 'expr':
        expression(node.expr);
        emit(Op.POP, 0, node.expr.tok);
        break;
      case 'block':
        beginScope();
        for (const s of node.body) compileStatement(s);
        endScope(node.body.length ? node.body[node.body.length - 1].tok || node.tok : node.tok);
        break;
      case 'if': {
        expression(node.cond);
        const toElse = emit(Op.JUMP_IF_FALSE, 0, node.cond.tok);
        emit(Op.POP, 0, node.cond.tok);
        compileStatement(node.then);
        const toEnd = emit(Op.JUMP, 0, node.cond.tok);
        patch(toElse);
        emit(Op.POP, 0, node.cond.tok);
        if (node.otherwise) compileStatement(node.otherwise);
        patch(toEnd);
        break;
      }
      case 'while': {
        const start = here();
        const loop = { start, depth: state.depth, breaks: [], continues: [], forward: false };
        state.loops.push(loop);
        expression(node.cond);
        const exit = emit(Op.JUMP_IF_FALSE, 0, node.tok);
        emit(Op.POP, 0, node.tok);
        compileStatement(node.body);
        emit(Op.LOOP, start, node.tok);
        patch(exit);
        emit(Op.POP, 0, node.tok);
        for (const b of loop.breaks) patch(b);
        state.loops.pop();
        break;
      }
      case 'for': {
        beginScope();
        const first = state.locals.length;
        if (node.init) compileStatement(node.init);
        const declared = [];
        for (let i = first; i < state.locals.length; i += 1) declared.push(i);
        const start = here();
        const loop = { start, depth: state.depth, breaks: [], continues: [], forward: true };
        state.loops.push(loop);
        let exit = -1;
        if (node.cond) {
          expression(node.cond);
          exit = emit(Op.JUMP_IF_FALSE, 0, node.tok);
          emit(Op.POP, 0, node.tok);
        }
        compileStatement(node.body);
        for (const c of loop.continues) patch(c);
        for (const slot of declared) emit(Op.CLOSE_SLOT, slot, node.tok);
        if (node.step) {
          expression(node.step);
          emit(Op.POP, 0, node.tok);
        }
        emit(Op.LOOP, start, node.tok);
        if (exit >= 0) {
          patch(exit);
          emit(Op.POP, 0, node.tok);
        }
        for (const b of loop.breaks) patch(b);
        state.loops.pop();
        endScope(node.tok);
        break;
      }
      case 'return':
        if (state.enclosing === null) fail("Cannot use 'return' outside a function.", node.tok);
        if (node.value) expression(node.value);
        else emit(Op.NIL, 0, node.tok);
        emit(Op.RETURN, 0, node.tok);
        break;
      case 'break':
      case 'continue': {
        const loop = state.loops[state.loops.length - 1];
        if (!loop) fail(`Cannot use '${node.t}' outside a loop.`, node.tok);
        leaveLoopScopes(loop, node.tok);
        if (node.t === 'break') loop.breaks.push(emit(Op.JUMP, 0, node.tok));
        else if (loop.forward) loop.continues.push(emit(Op.JUMP, 0, node.tok));
        else emit(Op.LOOP, loop.start, node.tok);
        break;
      }
      default:
        throw new Error(`unknown statement ${node.t}`);
    }
  }

  const BINARY = { '+': Op.ADD, '-': Op.SUB, '*': Op.MUL, '/': Op.DIV, '%': Op.MOD, '==': Op.EQ, '!=': Op.NE, '<': Op.LT, '<=': Op.LE, '>': Op.GT, '>=': Op.GE };

  function expression(node) {
    switch (node.t) {
      case 'num':
      case 'str':
        emit(Op.CONST, constant(node.value), node.tok);
        break;
      case 'bool':
        emit(node.value ? Op.TRUE : Op.FALSE, 0, node.tok);
        break;
      case 'nil':
        emit(Op.NIL, 0, node.tok);
        break;
      case 'group':
        expression(node.inner);
        break;
      case 'var':
        variable(node.name, node.tok, true);
        break;
      case 'assign':
        if (node.target.t === 'var') {
          expression(node.value);
          variable(node.target.name, node.target.tok, false);
        } else {
          expression(node.target.object);
          expression(node.target.index);
          expression(node.value);
          emit(Op.SET_INDEX, 0, node.target.tok);
        }
        break;
      case 'unary':
        expression(node.operand);
        emit(node.op === '-' ? Op.NEG : Op.NOT, 0, node.tok);
        break;
      case 'binary':
        expression(node.left);
        expression(node.right);
        emit(BINARY[node.op], 0, node.tok);
        break;
      case 'logical': {
        expression(node.left);
        const skip = emit(node.op === 'and' ? Op.JUMP_IF_FALSE : Op.JUMP_IF_TRUE, 0, node.tok);
        emit(Op.POP, 0, node.tok);
        expression(node.right);
        patch(skip);
        break;
      }
      case 'call':
        expression(node.callee);
        for (const arg of node.args) expression(arg);
        emit(Op.CALL, node.args.length, node.tok);
        break;
      case 'index':
        expression(node.object);
        expression(node.index);
        emit(Op.GET_INDEX, 0, node.tok);
        break;
      case 'array':
        for (const item of node.items) expression(item);
        emit(Op.ARRAY, node.items.length, node.tok);
        break;
      case 'lambda':
        functionBody(null, node.params, node.body, node.tok);
        break;
      default:
        throw new Error(`unknown expression ${node.t}`);
    }
  }

  for (const statement of tree.body) compileStatement(statement);
  const last = tree.body.length ? tree.body[tree.body.length - 1] : null;
  const tok = last && (last.tok || (last.expr && last.expr.tok)) ? last.tok || last.expr.tok : { line: 1, column: 1 };
  emit(Op.NIL, 0, tok);
  emit(Op.RETURN, 0, tok);
  return { main: state.fn };
}
