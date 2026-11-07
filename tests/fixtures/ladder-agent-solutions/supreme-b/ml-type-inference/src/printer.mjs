const nameOf = (index) => `'${String.fromCharCode(97 + (index % 26))}${index >= 26 ? Math.floor(index / 26) : ''}`;

export function showTypes(types) {
  const names = new Map();
  const show = (type, prec) => {
    if (type.kind === 'var') {
      if (!names.has(type.id)) names.set(type.id, nameOf(names.size));
      return names.get(type.id);
    }
    if (type.name === '->') {
      const text = `${show(type.args[0], 1)} -> ${show(type.args[1], 0)}`;
      return prec >= 1 ? `(${text})` : text;
    }
    if (type.name === '*') {
      const text = type.args.map((item) => show(item, 2)).join(' * ');
      return prec >= 2 ? `(${text})` : text;
    }
    if (type.name === 'list') return `${show(type.args[0], 2)} list`;
    return type.name;
  };
  return types.map((type) => show(type, 0));
}

export const showType = (type) => showTypes([type])[0];
