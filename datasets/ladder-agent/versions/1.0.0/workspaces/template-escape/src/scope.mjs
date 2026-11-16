// A scope is a stack of frames. A frame holds a context (the value `this`
// stands for) and the loop data of the block that made it: @index, @key,
// @first and @last. `../` climbs one frame.
export class Scope {
  constructor(frames) {
    this.frames = frames;
  }

  static from(context) {
    return new Scope([{ context, data: {} }]);
  }

  get context() {
    return this.frames[this.frames.length - 1].context;
  }

  get data() {
    return this.frames[this.frames.length - 1].data;
  }

  get root() {
    return this.frames[0].context;
  }

  // A new frame on top, for the body of a loop item.
  push(context, data = {}) {
    return new Scope([...this.frames, { context, data }]);
  }

  // The same frames with another context on top, for a partial that gets its own context.
  withContext(context) {
    const frames = this.frames.slice(0, -1);
    return new Scope([...frames, { context, data: this.data }]);
  }

  lookup(path) {
    if (path.startsWith('@')) return this.data[path.slice(1)];
    let rest = path;
    let up = 0;
    while (rest.startsWith('../')) {
      up += 1;
      rest = rest.slice(3);
    }
    const frame = this.frames[this.frames.length - 1 - up];
    if (!frame) return undefined;
    let value = frame.context;
    if (rest === '' || rest === 'this' || rest === '.') return value;
    for (const segment of rest.replace(/^this\./, '').split('.')) {
      if (value === null || value === undefined) return undefined;
      value = Object.hasOwn(Object(value), segment) ? value[segment] : undefined;
    }
    return value;
  }
}
