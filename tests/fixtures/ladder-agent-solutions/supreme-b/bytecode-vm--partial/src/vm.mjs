import { LangError } from './errors.mjs';
import { Op } from './compiler.mjs';
import { display, isTruthy, typeName } from './values.mjs';

export function execute(program, options = {}) {
  const maxCallDepth = options.maxCallDepth ?? 200;
  const maxSteps = options.maxSteps ?? 1000000;
  const output = [];
  const stack = [];
  const frames = [];
  let open = []; // open upvalues, { slot, value, closed }
  let steps = 0;

  const native = (name, arity, run) => ({ callable: 'native', name, arity, run });
  const globals = new Map(
    [
      native('print', 1, (args) => {
        output.push(display(args[0]));
        return null;
      }),
      native('len', 1, (args, fail) => {
        if (typeof args[0] === 'string' || Array.isArray(args[0])) return args[0].length;
        return fail('Argument must be an array or a string.');
      }),
      native('push', 2, (args, fail) => {
        if (!Array.isArray(args[0])) return fail('First argument must be an array.');
        args[0].push(args[1]);
        return args[0].length;
      }),
      native('pop', 1, (args, fail) => {
        if (!Array.isArray(args[0])) return fail('Argument must be an array.');
        if (!args[0].length) return fail('Cannot pop from an empty array.');
        return args[0].pop();
      }),
      native('str', 1, (args) => display(args[0])),
      native('type', 1, (args) => typeName(args[0])),
      native('floor', 1, (args, fail) => (typeof args[0] === 'number' ? Math.floor(args[0]) : fail('Argument must be a number.'))),
    ].map((fn) => [fn.name, fn]),
  );

  function fail(message, tok) {
    const trace = [];
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const frame = frames[i];
      const at = i === frames.length - 1 ? tok : frame.fn.pos[frame.ip - 1];
      const name = frame.closure.name === null ? '<anon>' : frame.closure.name;
      trace.push(`${name} at ${at.line}:${at.column}`);
    }
    throw new LangError('runtime', message, tok.line, tok.column, trace, output);
  }

  const mainClosure = { callable: 'fn', name: '<script>', fn: program.main, upvalues: [] };
  stack.push(mainClosure);
  frames.push({ closure: mainClosure, fn: program.main, ip: 0, base: 0 });
  let frame = frames[0];
  let code = frame.fn.code;

  function captureUpvalue(slot) {
    for (const up of open) if (up.slot === slot) return up;
    const up = { slot, value: undefined, closed: false };
    open.push(up);
    return up;
  }
  function closeUpvalues(from) {
    const keep = [];
    for (const up of open) {
      if (up.slot >= from) {
        up.value = stack[up.slot];
        up.closed = true;
      } else {
        keep.push(up);
      }
    }
    open = keep;
  }

  const finite = (n) => n;

  for (;;) {
    const index = frame.ip;
    const op = code[2 * index];
    const arg = code[2 * index + 1];
    const tok = frame.fn.pos[index];
    frame.ip = index + 1;
    switch (op) {
      case Op.CONST:
        stack.push(frame.fn.consts[arg]);
        break;
      case Op.NIL:
        stack.push(null);
        break;
      case Op.TRUE:
        stack.push(true);
        break;
      case Op.FALSE:
        stack.push(false);
        break;
      case Op.POP:
        stack.pop();
        break;
      case Op.GET_LOCAL:
        stack.push(stack[frame.base + arg]);
        break;
      case Op.SET_LOCAL:
        stack[frame.base + arg] = stack[stack.length - 1];
        break;
      case Op.GET_GLOBAL: {
        const name = frame.fn.consts[arg];
        if (!globals.has(name)) fail(`Undefined variable '${name}'.`, tok);
        stack.push(globals.get(name));
        break;
      }
      case Op.DEF_GLOBAL:
        globals.set(frame.fn.consts[arg], stack.pop());
        break;
      case Op.SET_GLOBAL: {
        const name = frame.fn.consts[arg];
        if (!globals.has(name)) fail(`Undefined variable '${name}'.`, tok);
        globals.set(name, stack[stack.length - 1]);
        break;
      }
      case Op.GET_UPVALUE: {
        const up = frame.closure.upvalues[arg];
        stack.push(up.closed ? up.value : stack[up.slot]);
        break;
      }
      case Op.SET_UPVALUE: {
        const up = frame.closure.upvalues[arg];
        if (up.closed) up.value = stack[stack.length - 1];
        else stack[up.slot] = stack[stack.length - 1];
        break;
      }
      case Op.CLOSE_UPVALUE:
        closeUpvalues(stack.length - 1);
        stack.pop();
        break;
      case Op.CLOSE_SLOT:
        closeUpvalues(frame.base + arg);
        break;
      case Op.EQ:
      case Op.NE: {
        const b = stack.pop();
        const a = stack.pop();
        stack.push(op === Op.EQ ? a === b : a !== b);
        break;
      }
      case Op.LT:
      case Op.LE:
      case Op.GT:
      case Op.GE: {
        const b = stack.pop();
        const a = stack.pop();
        if (typeof a !== 'number' || typeof b !== 'number') fail('Operands must be numbers.', tok);
        stack.push(op === Op.LT ? a < b : op === Op.LE ? a <= b : op === Op.GT ? a > b : a >= b);
        break;
      }
      case Op.ADD: {
        const b = stack.pop();
        const a = stack.pop();
        if (typeof a === 'number' && typeof b === 'number') stack.push(finite(a + b, tok));
        else if (typeof a === 'string' && typeof b === 'string') stack.push(a + b);
        else fail('Operands must be two numbers or two strings.', tok);
        break;
      }
      case Op.SUB:
      case Op.MUL:
      case Op.DIV:
      case Op.MOD: {
        const b = stack.pop();
        const a = stack.pop();
        if (typeof a !== 'number' || typeof b !== 'number') fail('Operands must be numbers.', tok);
        if ((op === Op.DIV || op === Op.MOD) && b === 0) fail('Division by zero.', tok);
        const result = op === Op.SUB ? a - b : op === Op.MUL ? a * b : op === Op.DIV ? a / b : a % b;
        stack.push(finite(result, tok) + 0);
        break;
      }
      case Op.NOT:
        stack.push(!isTruthy(stack.pop()));
        break;
      case Op.NEG: {
        const a = stack.pop();
        if (typeof a !== 'number') fail('Operand must be a number.', tok);
        stack.push(0 - a);
        break;
      }
      case Op.JUMP:
        frame.ip = arg;
        break;
      case Op.JUMP_IF_FALSE:
        if (!isTruthy(stack[stack.length - 1])) frame.ip = arg;
        break;
      case Op.JUMP_IF_TRUE:
        if (isTruthy(stack[stack.length - 1])) frame.ip = arg;
        break;
      case Op.LOOP:
        steps += 1;
        if (steps > maxSteps) fail('Step limit exceeded.', tok);
        frame.ip = arg;
        break;
      case Op.CLOSURE: {
        const fn = frame.fn.consts[arg];
        const upvalues = fn.upvalues.map((u) => (u.isLocal ? captureUpvalue(frame.base + u.index) : frame.closure.upvalues[u.index]));
        stack.push({ callable: 'fn', name: fn.name, fn, upvalues });
        break;
      }
      case Op.CALL: {
        const callee = stack[stack.length - 1 - arg];
        if (callee === null || typeof callee !== 'object' || Array.isArray(callee)) fail('Can only call functions.', tok);
        const arity = callee.callable === 'fn' ? callee.fn.arity : callee.arity;
        if (arity !== arg) fail(`Expected ${arity} arguments but got ${arg}.`, tok);
        if (callee.callable === 'native') {
          const args = stack.splice(stack.length - arg, arg);
          stack.pop();
          stack.push(callee.run(args, (message) => fail(message, tok)));
          break;
        }
        if (frames.length > maxCallDepth) fail('Stack overflow.', tok);
        frame = { closure: callee, fn: callee.fn, ip: 0, base: stack.length - 1 - arg };
        frames.push(frame);
        code = frame.fn.code;
        break;
      }
      case Op.RETURN: {
        const value = stack.pop();
        closeUpvalues(frame.base);
        frames.pop();
        stack.length = frame.base;
        if (!frames.length) return { output };
        stack.push(value);
        frame = frames[frames.length - 1];
        code = frame.fn.code;
        break;
      }
      case Op.ARRAY:
        stack.push(stack.splice(stack.length - arg, arg));
        break;
      case Op.GET_INDEX: {
        const i = stack.pop();
        const target = stack.pop();
        if (typeof target !== 'string' && !Array.isArray(target)) fail('Can only index arrays and strings.', tok);
        if (typeof i !== 'number' || !Number.isInteger(i)) fail('Index must be an integer.', tok);
        if (i < 0 || i >= target.length) fail('Index out of range.', tok);
        stack.push(target[i]);
        break;
      }
      case Op.SET_INDEX: {
        const value = stack.pop();
        const i = stack.pop();
        const target = stack.pop();
        if (!Array.isArray(target)) fail('Can only assign to array elements.', tok);
        if (typeof i !== 'number' || !Number.isInteger(i)) fail('Index must be an integer.', tok);
        if (i < 0 || i >= target.length) fail('Index out of range.', tok);
        target[i] = value;
        stack.push(value);
        break;
      }
      default:
        throw new Error(`bad opcode ${op}`);
    }
  }
}
