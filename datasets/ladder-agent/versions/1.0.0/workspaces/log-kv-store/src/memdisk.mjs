/** An in-memory disk with the methods the store needs (see SPEC.md, "The disk"). */
export class MemDisk {
  #files = new Map();

  read(name) {
    const bytes = this.#files.get(name);
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }

  append(name, bytes) {
    const old = this.#files.get(name) ?? new Uint8Array(0);
    const next = new Uint8Array(old.length + bytes.length);
    next.set(old, 0);
    next.set(bytes, old.length);
    this.#files.set(name, next);
  }

  write(name, bytes) {
    this.#files.set(name, new Uint8Array(bytes));
  }

  rename(from, to) {
    const bytes = this.#files.get(from);
    if (bytes === undefined) throw new Error(`no file ${from}`);
    this.#files.delete(from);
    this.#files.set(to, bytes);
  }

  remove(name) {
    this.#files.delete(name);
  }

  list() {
    return [...this.#files.keys()];
  }
}
